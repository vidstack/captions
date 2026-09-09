import { CEA608Decoder, type CEA608DecoderOptions } from '../cea/cea608-decoder';
import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, ParsedCaptionsResult } from '../parse/types';

export { sccChannelOf } from '../cea/cea608-decoder';

/**
 * Scenarist Closed Caption (SCC) parser. Parses the file header, SMPTE timecodes and hex words,
 * and feeds the resulting CEA-608 byte pairs to a `CEA608Decoder` which produces the `VTTCue`
 * objects.
 *
 * SCC files only carry field 1, so the `channel` option decodes CC1 (default) or CC2. Channels 3
 * and 4 are accepted for API symmetry with the decoder but live on field 2 and therefore never
 * produce cues from an SCC file.
 *
 * @see {@link https://en.wikipedia.org/wiki/EIA-608}
 */

const FPS = 29.97;

const HEADER_RE = /^Scenarist_SCC V1\.0\s*$/,
  BOM_RE = /^﻿/,
  LINE_RE = /^(\d{2}:\d{2}:\d{2}[:;.,]\d{2})(?:\s+(.*))?$/,
  TIMECODE_RE = /^(\d{2}):(\d{2}):(\d{2})([:;.,])(\d{2})$/,
  HEX_WORD_RE = /^[0-9a-fA-F]{4}$/,
  WORD_SPLIT_RE = /\s+/;

export class SCCParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _decoder!: CEA608Decoder;
  protected _errors: ParseError[] = [];
  protected _started = false;

  init(init: CaptionsParserInit) {
    this._init = init;
    this._decoder = new CEA608Decoder({
      channel: init.channel as CEA608DecoderOptions['channel'],
      onCue: (cue) => this._init.onCue?.(cue),
    });
  }

  parse(line: string, lineCount: number) {
    line = line.replace(BOM_RE, '').trim();
    if (line === '') return;

    if (!this._started) {
      this._started = true;
      if (HEADER_RE.test(line)) return;
      this._handleError(
        ParseErrorCode.BadSignature,
        'missing `Scenarist_SCC V1.0` file header',
        lineCount,
      );
    }

    const match = LINE_RE.exec(line);
    if (!match) {
      this._handleError(
        ParseErrorCode.BadTimestamp,
        `invalid SCC timecode on line ${lineCount}`,
        lineCount,
      );
      return;
    }

    const frames = parseSCCFrames(match[1]);
    if (frames === null) {
      this._handleError(
        ParseErrorCode.BadTimestamp,
        `SCC timecode \`${match[1]}\` is invalid on line ${lineCount}`,
        lineCount,
      );
      return;
    }

    const words = match[2] ? match[2].split(WORD_SPLIT_RE) : [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!HEX_WORD_RE.test(word)) {
        this._handleError(
          ParseErrorCode.BadFormat,
          `malformed hex word \`${word}\` on line ${lineCount}`,
          lineCount,
        );
        continue;
      }
      // Each word occupies one frame, starting at the line's timecode.
      const value = parseInt(word, 16);
      this._decoder.decodePair((value >> 8) & 0xff, value & 0xff, (frames + i) / FPS, 1);
    }

    // Commit displayed-memory changes at the end of every line.
    this._decoder.commit();
  }

  done(): ParsedCaptionsResult {
    this._decoder.flush();
    return {
      metadata: {},
      regions: [],
      cues: this._decoder.cues,
      errors: this._errors,
    };
  }

  protected _handleError(
    code: (typeof ParseErrorCode)[keyof typeof ParseErrorCode],
    reason: string,
    line: number,
  ) {
    if (!this._init.errors) return;
    const error = new ParseError({ code, reason, line });
    this._errors.push(error);
    if (this._init.strict) {
      this._init.cancel();
      throw error;
    } else {
      this._init.onError?.(error);
    }
  }
}

/**
 * Convert a SMPTE timecode (`HH:MM:SS:FF` non-drop or `HH:MM:SS;FF` drop-frame) into a frame
 * count at 29.97 fps. Returns `null` if the timecode is invalid.
 */
export function parseSCCFrames(text: string): number | null {
  const match = TIMECODE_RE.exec(text);
  if (!match) return null;

  const hours = parseInt(match[1], 10),
    minutes = parseInt(match[2], 10),
    seconds = parseInt(match[3], 10),
    frames = parseInt(match[5], 10),
    dropFrame = match[4] !== ':';

  if (minutes >= 60 || seconds >= 60 || frames >= 30) return null;

  let total = ((hours * 60 + minutes) * 60 + seconds) * 30 + frames;

  if (dropFrame) {
    // Two frames are dropped every minute, except every tenth minute.
    const totalMinutes = hours * 60 + minutes;
    total -= 2 * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return total;
}

/**
 * Convert a SMPTE timecode (`HH:MM:SS:FF` non-drop or `HH:MM:SS;FF` drop-frame) into seconds
 * at 29.97 fps. Returns `null` if the timecode is invalid.
 */
export function parseSCCTimecode(text: string): number | null {
  const frames = parseSCCFrames(text);
  return frames === null ? null : frames / FPS;
}

/**
 * Convert whitespace separated 4-digit hex words into byte pairs with the parity bit stripped.
 * Malformed words are skipped.
 */
export function sccWordsToBytes(words: string): [number, number][] {
  const pairs: [number, number][] = [];
  for (const word of words.trim().split(WORD_SPLIT_RE)) {
    if (!HEX_WORD_RE.test(word)) continue;
    const value = parseInt(word, 16);
    pairs.push([(value >> 8) & 0x7f, value & 0x7f]);
  }
  return pairs;
}

export default function createSCCParser() {
  return new SCCParser();
}
