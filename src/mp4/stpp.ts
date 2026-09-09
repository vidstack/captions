/**
 * TTML-in-ISOBMFF (`stpp`, ISO/IEC 14496-30 §6) sample decoding.
 *
 * Each sample is a complete TTML document. Images may travel in the same sample as extra
 * sub-samples (declared by a `subs` box); the document references them as
 * `urn:mpeg:14496-30:subs:N`, where sub-sample 0 is the document and `N` >= 1 an image. Those
 * references are rewritten to data URLs before the document is handed to the TTML parser.
 */

import type { ParseError } from '../parse/parse-error';
import type { ParsedCaptionsResult } from '../parse/types';
import createTTMLParser from '../ttml/ttml-parser';
import type { VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';
import { decodeUTF8, type Sample } from './boxes';

const SUBS_URN_RE = /urn:mpeg:14496-30:subs:(\d+)/g,
  BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface STPPDecoderOptions {
  onError?(error: ParseError): void;
}

export class STPPDecoder {
  private _errors: ParseError[] = [];
  private _metadata: VTTHeaderMetadata = {};

  constructor(private _options: STPPDecoderOptions) {}

  get errors() {
    return this._errors;
  }

  /** Header metadata (`Language`, `Title`, ...) from the most recent document. */
  get metadata() {
    return this._metadata;
  }

  reset() {}

  /**
   * Decodes one sample. `start` is the sample presentation time in seconds (media time plus
   * edit offset), `offset` is added to every cue (`timeOffset` from the caller).
   *
   * Time base heuristic: ISO 14496-30 places TTML document times on the track timeline, so
   * `begin="12s"` in a sample presented at 10s means 12s. Some muxers instead restart every
   * document at zero, relative to the sample. If the earliest cue in the document starts before
   * the sample itself, the document is treated as sample-relative and shifted by the sample's
   * presentation time. Documents with `ttp:timeBase="clock"` are always sample-relative (the
   * TTML parser rebases them to start at zero).
   */
  decode(bytes: Uint8Array, sample: Sample, start: number, offset: number): VTTCue[] {
    let text: string;

    if (sample.subSamples && sample.subSamples.length > 1) {
      const sizes = sample.subSamples,
        docEnd = Math.min(sample.start + sizes[0], sample.end),
        ranges: [number, number][] = [];

      let pos = docEnd;
      for (let i = 1; i < sizes.length; i++) {
        const end = Math.min(pos + sizes[i], sample.end);
        ranges.push([pos, end]);
        pos = end;
      }

      text = decodeUTF8(bytes, sample.start, docEnd).replace(SUBS_URN_RE, (match, index) => {
        const range = ranges[Number(index) - 1];
        return range ? toDataURL(bytes, range[0], range[1]) : match;
      });
    } else {
      text = decodeUTF8(bytes, sample.start, sample.end);
    }

    const parser = createTTMLParser();

    parser.init({
      strict: false,
      errors: true,
      cancel() {},
      onError: (error) => {
        this._errors.push(error);
        this._options.onError?.(error);
      },
    });

    parser.parse(text);

    const result: ParsedCaptionsResult = parser.done(false),
      cues = result.cues;

    this._metadata = result.metadata;

    if (!cues.length) return cues;

    let earliest = Infinity;
    for (const cue of cues) if (cue.startTime < earliest) earliest = cue.startTime;

    const relative = result.metadata.TimeBase === 'clock' || earliest < start,
      shift = (relative ? start : 0) + offset;

    if (shift) {
      for (const cue of cues) {
        cue.startTime += shift;
        cue.endTime += shift;
      }
    }

    return cues;
  }
}

function sniffMime(bytes: Uint8Array, start: number) {
  const a = bytes[start],
    b = bytes[start + 1];
  if (a === 0x89 && b === 0x50) return 'image/png';
  if (a === 0xff && b === 0xd8) return 'image/jpeg';
  if (a === 0x47 && b === 0x49) return 'image/gif';
  if (a === 0x52 && b === 0x49) return 'image/webp';
  return 'image/png';
}

function toDataURL(bytes: Uint8Array, start: number, end: number) {
  let out = '';
  for (let i = start; i < end; i += 3) {
    const b0 = bytes[i],
      b1 = i + 1 < end ? bytes[i + 1] : 0,
      b2 = i + 2 < end ? bytes[i + 2] : 0;
    out +=
      BASE64[b0 >> 2] +
      BASE64[((b0 & 3) << 4) | (b1 >> 4)] +
      (i + 1 < end ? BASE64[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
      (i + 2 < end ? BASE64[b2 & 63] : '=');
  }
  return `data:${sniffMime(bytes, start)};base64,${out}`;
}
