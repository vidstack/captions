/**
 * WebVTT-in-ISOBMFF (`wvtt`, ISO/IEC 14496-30 §7) sample decoding.
 *
 * Each sample holds one or more `vttc` boxes (one per cue active during the sample), a single
 * `vtte` box (nothing on screen), and optionally `vtta` boxes (comments/notes, ignored). A cue
 * that spans several samples appears in each of them with the same `vsid`; those pieces are
 * merged back into one `VTTCue`.
 */

import { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParserInit } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';
import { VTTParser } from '../vtt/vtt-parser';
import type { VTTRegion } from '../vtt/vtt-region';
import { boxString, readBoxes, type Sample, u32 } from './boxes';

const SPACE_RE = /[ \t\f\r\n]+/,
  NUL_RE = /\0/g,
  LINE_RE = /\r\n|\r|\n/,
  /** Samples whose start is within this many seconds of the previous end are contiguous. */
  EPSILON = 1e-4;

export interface WVTTDecoderOptions {
  onRegion?(region: VTTRegion): void;
  onStyle?(css: string): void;
  onError?(error: ParseError): void;
}

/**
 * Cue construction reuses the WebVTT parser (settings, regions, `STYLE` blocks) without going
 * through a text stream: the header from `vttC` is fed as lines, cues are built directly.
 */
class WVTTCueParser extends VTTParser {
  /** Synchronous variant of `init`: the error builder is imported statically. */
  setup(init: CaptionsParserInit) {
    this._init = init;
    this._errorBuilder = ParseErrorBuilder;
  }

  parseHeader(header: string) {
    const lines = header.replace(/^\uFEFF/, '').split(LINE_RE);
    let n = 1;
    for (const line of lines) this.parse(line, n++);
    this.parse('', n);
  }

  buildCue(start: number, end: number, id: string, settings: string, text: string) {
    const cue = new VTTCue(start, end, text.replace(NUL_RE, '\uFFFD'));
    cue.id = id;
    this._cue = cue;
    if (settings) this._parseCueSettings(settings.split(SPACE_RE).filter(Boolean), 0);
    this._cue = null;
    return cue;
  }

  get metadata() {
    return this._metadata;
  }
}

interface PendingCue {
  cue: VTTCue;
  sourceId: number;
  key: string;
}

export class WVTTDecoder {
  private _parser = new WVTTCueParser();
  private _pending: PendingCue[] = [];
  private _errors: ParseError[] = [];

  constructor(header: string | undefined, options: WVTTDecoderOptions) {
    this._parser.setup({
      strict: false,
      errors: true,
      cancel() {},
      onRegion: options.onRegion,
      onStyle: options.onStyle,
      onError: (error) => {
        this._errors.push(error);
        options.onError?.(error);
      },
    });
    this._parser.parseHeader(header || 'WEBVTT');
  }

  get metadata() {
    return this._parser.metadata;
  }

  get errors() {
    return this._errors;
  }

  /** Forgets in-flight cue continuations (call after a seek or discontinuity). */
  reset() {
    this._pending = [];
  }

  /**
   * Decodes one sample. `start`/`end` are presentation times in seconds. Returns the cues that
   * began in this sample; cues continued from the previous sample are extended in place.
   */
  decode(bytes: Uint8Array, sample: Sample, start: number, end: number): VTTCue[] {
    const cues: VTTCue[] = [],
      next: PendingCue[] = [],
      prev = this._pending;

    for (const box of readBoxes(bytes, sample.start, sample.end)) {
      if (box.type !== 'vttc') continue;

      let sourceId = -1,
        id = '',
        settings = '',
        text = '';

      for (const child of readBoxes(bytes, box.dataStart, box.end)) {
        switch (child.type) {
          case 'vsid':
            if (child.end - child.dataStart >= 4) sourceId = u32(bytes, child.dataStart);
            break;
          case 'iden':
            id = boxString(bytes, child);
            break;
          case 'sttg':
            settings = boxString(bytes, child);
            break;
          case 'payl':
            text = boxString(bytes, child);
            break;
          // `ctim` (original timing string) is informational only.
        }
      }

      const key = `${id}\0${settings}\0${text}`,
        continued = findContinuation(prev, sourceId, key, start);

      if (continued) {
        if (end > continued.cue.endTime) continued.cue.endTime = end;
        next.push(continued);
        continue;
      }

      const cue = this._parser.buildCue(start, end, id, settings, text);
      cues.push(cue);
      next.push({ cue, sourceId, key });
    }

    this._pending = next;
    return cues;
  }
}

/**
 * A cue in the previous sample continues into this one when it carries the same `vsid`, or
 * (for muxers that omit `vsid`) when id, settings, and payload are identical and the samples
 * are contiguous.
 */
function findContinuation(prev: PendingCue[], sourceId: number, key: string, start: number) {
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    if (Math.abs(p.cue.endTime - start) > EPSILON) continue;
    if (sourceId >= 0 ? p.sourceId === sourceId : p.sourceId < 0 && p.key === key) {
      prev.splice(i, 1);
      return p;
    }
  }
  return null;
}
