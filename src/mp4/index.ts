/**
 * ISOBMFF (fMP4) subtitle demuxing for DASH/HLS players: feed init and media segments, get
 * `VTTCue`s. Supports WebVTT (`wvtt`) and TTML/IMSC (`stpp`) tracks per ISO/IEC 14496-30.
 *
 * @example
 * ```ts
 * const demuxer = new MP4SubtitleDemuxer({ onCue: (cue) => track.add(cue) });
 * demuxer.init(initSegment);
 * demuxer.push(mediaSegment, { timeOffset: periodStart });
 * ```
 */

import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { ParsedCaptionsResult } from '../parse/types';
import type { VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';
import type { VTTRegion } from '../vtt/vtt-region';
import {
  type Box,
  readBoxes,
  readMovie,
  readMovieFragment,
  type Sample,
  type TrackInfo,
} from './boxes';
import { STPPDecoder } from './stpp';
import { WVTTDecoder } from './wvtt';

export interface MP4SubtitleTrack {
  /** `track_ID` from `tkhd`, matched against `tfhd` in media segments. */
  id: number;
  type: 'wvtt' | 'stpp';
  /** Media timescale from `mdhd` (ticks per second). */
  timescale: number;
  /** ISO 639-2/T language from `mdhd`, if set. */
  language?: string;
  /** WebVTT file header (`vttC`), including any `REGION`/`STYLE` blocks. */
  header?: string;
  /** WebVTT source label (`vlab`). */
  label?: string;
  /** TTML auxiliary MIME types or `mime` box content type. */
  mime?: string;
  /** TTML namespaces declared by the sample entry. */
  namespace?: string;
  /**
   * Seconds added to media times to get presentation times (from the edit list), so that the
   * first edit's `media_time` presents at zero.
   */
  editOffset: number;
}

export interface MP4SubtitleDemuxerOptions {
  onCue?(cue: VTTCue): void;
  onRegion?(region: VTTRegion): void;
  onStyle?(css: string): void;
  onError?(error: ParseError): void;
}

export interface MP4PushOptions {
  /** Only decode samples of this track (default: every subtitle track found in the init segment). */
  trackId?: number;
  /**
   * Seconds added to every cue, e.g. the DASH period start or the HLS discontinuity offset minus
   * the segment's first presentation time.
   *
   * @defaultValue 0
   */
  timeOffset?: number;
}

interface TrackState {
  info: TrackInfo;
  track: MP4SubtitleTrack;
  decoder: WVTTDecoder | STPPDecoder;
}

export class MP4SubtitleDemuxer {
  private _options: MP4SubtitleDemuxerOptions;
  private _tracks = new Map<number, TrackState>();
  private _cues: VTTCue[] = [];
  private _regions: VTTRegion[] = [];
  private _styles: string[] = [];
  private _errors: ParseError[] = [];

  constructor(options: MP4SubtitleDemuxerOptions = {}) {
    this._options = options;
  }

  /** Subtitle tracks found by `init()`. */
  get tracks(): MP4SubtitleTrack[] {
    return Array.from(this._tracks.values(), (state) => state.track);
  }

  /** Every cue decoded so far (also delivered through `onCue`). */
  get cues(): VTTCue[] {
    return this._cues;
  }

  /** Regions declared in WebVTT headers (`vttC`). */
  get regions(): VTTRegion[] {
    return this._regions;
  }

  /** CSS from `STYLE` blocks in WebVTT headers (`vttC`). */
  get styles(): string[] {
    return this._styles;
  }

  /** Errors reported so far (also delivered through `onError`). */
  get errors(): ParseError[] {
    return this._errors;
  }

  /** WebVTT header metadata (e.g. `X-TIMESTAMP-MAP`) and TTML document metadata, merged. */
  get metadata(): VTTHeaderMetadata {
    const metadata: VTTHeaderMetadata = {};
    for (const { decoder } of this._tracks.values()) Object.assign(metadata, decoder.metadata);
    return metadata;
  }

  /**
   * Parses an init segment (`moov`) and returns the subtitle tracks found. Replaces any tracks
   * from a previous init segment; decoded cues are kept.
   */
  init(segment: Uint8Array): MP4SubtitleTrack[] {
    try {
      const moov = readBoxes(segment).find((box) => box.type === 'moov');
      if (!moov) throw this._error('no `moov` box found in init segment');
      return this._initMovie(segment, moov);
    } catch (error) {
      this._report(error);
      return [];
    }
  }

  /**
   * Parses a media segment (`moof`/`mdat` pairs) and returns the cues that start in it. Cues
   * continued from a previous segment (WebVTT `vsid`) are extended in place and not returned
   * again. Self-initialising segments (containing `moov`) are initialised on the fly.
   */
  push(segment: Uint8Array, options: MP4PushOptions = {}): VTTCue[] {
    const cues: VTTCue[] = [],
      offset = options.timeOffset ?? 0;

    try {
      const boxes = readBoxes(segment),
        moov = boxes.find((box) => box.type === 'moov');

      if (moov) this._initMovie(segment, moov);

      const defaults = new Map<number, number>();
      for (const { info } of this._tracks.values()) defaults.set(info.id, info.defaultDuration);

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.type !== 'moof') continue;

        if (!this._tracks.size) throw this._error('media segment pushed before an init segment');

        const mdat = nextMdat(boxes, i);

        for (const fragment of readMovieFragment(segment, box, mdat, defaults)) {
          if (options.trackId !== undefined && fragment.trackId !== options.trackId) continue;

          const state = this._tracks.get(fragment.trackId);
          if (!state) continue;

          this._decodeSamples(segment, state, fragment.samples, offset, cues);
        }
      }
    } catch (error) {
      this._report(error);
    }

    return cues;
  }

  /** Drops decoded cues and in-flight cue continuations. Tracks, regions, and styles are kept. */
  reset() {
    this._cues = [];
    this._errors = [];
    for (const { decoder } of this._tracks.values()) decoder.reset();
  }

  private _initMovie(segment: Uint8Array, moov: Box) {
    this._tracks.clear();
    this._regions = [];
    this._styles = [];

    const tracks: MP4SubtitleTrack[] = [];

    for (const info of readMovie(segment, moov)) {
      const entry = info.entry;
      if (!entry || (entry.type !== 'wvtt' && entry.type !== 'stpp')) continue;

      const track: MP4SubtitleTrack = {
        id: info.id,
        type: entry.type,
        timescale: info.timescale,
        editOffset: info.editOffset,
      };

      if (info.language) track.language = info.language;
      if (entry.header !== undefined) track.header = entry.header;
      if (entry.label) track.label = entry.label;
      if (entry.mime) track.mime = entry.mime;
      if (entry.namespace) track.namespace = entry.namespace;

      const onError = (error: ParseError) => {
        this._errors.push(error);
        this._options.onError?.(error);
      };

      const decoder =
        entry.type === 'wvtt'
          ? new WVTTDecoder(entry.header, {
              onError,
              onRegion: (region) => {
                this._regions.push(region);
                this._options.onRegion?.(region);
              },
              onStyle: (css) => {
                this._styles.push(css);
                this._options.onStyle?.(css);
              },
            })
          : new STPPDecoder({ onError });

      this._tracks.set(info.id, { info, track, decoder });
      tracks.push(track);
    }

    return tracks;
  }

  private _decodeSamples(
    segment: Uint8Array,
    state: TrackState,
    samples: readonly Sample[],
    offset: number,
    out: VTTCue[],
  ) {
    const { timescale, editOffset } = state.info,
      decoder = state.decoder;

    for (const sample of samples) {
      if (sample.end <= sample.start) continue;

      const start = sample.time / timescale + editOffset;

      let cues: VTTCue[];
      try {
        cues =
          decoder instanceof WVTTDecoder
            ? decoder.decode(
                segment,
                sample,
                start + offset,
                start + offset + sample.duration / timescale,
              )
            : decoder.decode(segment, sample, start, offset);
      } catch (error) {
        this._report(error);
        continue;
      }

      for (const cue of cues) {
        this._cues.push(cue);
        out.push(cue);
        this._options.onCue?.(cue);
      }
    }
  }

  private _error(reason: string) {
    return new ParseError({ code: ParseErrorCode.BadFormat, reason, line: 0 });
  }

  private _report(error: unknown) {
    const parseError =
      error instanceof ParseError
        ? error
        : this._error(error instanceof Error ? error.message : String(error));
    this._errors.push(parseError);
    this._options.onError?.(parseError);
  }
}

/** The `mdat` that follows a `moof` (skipping `sidx`, `styp`, `emsg`, etc.). */
function nextMdat(boxes: Box[], from: number): Box | null {
  for (let i = from + 1; i < boxes.length; i++) {
    if (boxes[i].type === 'mdat') return boxes[i];
    if (boxes[i].type === 'moof') break;
  }
  return null;
}

/**
 * Convenience: demuxes an init segment plus media segments in one call and returns the same
 * shape as `parseText`/`parseResponse`.
 */
export function parseMP4Subtitles(
  init: Uint8Array,
  segments: Uint8Array[],
  options: MP4PushOptions = {},
): ParsedCaptionsResult {
  const demuxer = new MP4SubtitleDemuxer();
  demuxer.init(init);
  for (const segment of segments) demuxer.push(segment, options);
  return {
    metadata: demuxer.metadata,
    regions: demuxer.regions,
    cues: demuxer.cues,
    errors: demuxer.errors,
    styles: demuxer.styles,
  };
}

export { readBoxes, type Box } from './boxes';
