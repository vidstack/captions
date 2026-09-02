import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';

const LEADING_TAG_RE = /^\[([^\]]*)\]/,
  ID_TAG_RE = /^([A-Za-z_][\w-]*):\s*(.*)$/,
  DIGIT_START_RE = /^\d/,
  INLINE_TAG_RE = /<(\d{1,3}(?::\d{1,3})?:\d{2}(?:\.\d{1,3})?)>/g,
  TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/,
  OFFSET_RE = /^[+-]?\d+$/,
  AMP_RE = /&/g,
  LT_RE = /</g,
  DEFAULT_CUE_DURATION = 5;

/**
 * A lyric line that has been parsed but not yet converted into a cue. Word timings (enhanced
 * LRC) are stored as numbers between text parts so the `offset` tag can be applied at the end.
 */
interface LRCLine {
  time: number;
  parts: (string | number)[];
}

export class LRCParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _metadata: Record<string, string> = {};
  protected _lines: LRCLine[] = [];
  protected _boundaries: number[] = [];
  protected _errors: ParseError[] = [];

  init(init: CaptionsParserInit) {
    this._init = init;
  }

  parse(line: string, lineCount: number) {
    let text = line.trim();
    if (text === '' || text[0] !== '[') return;

    const times: number[] = [];
    let match: RegExpMatchArray | null;

    while ((match = text.match(LEADING_TAG_RE))) {
      const tag = match[1].trim();

      if (DIGIT_START_RE.test(tag)) {
        const time = parseLRCTimestamp(tag);
        if (time !== null) {
          times.push(time);
        } else {
          this._handleError(
            ParseErrorCode.BadTimestamp,
            `lyric timestamp \`${tag}\` is invalid on line ${lineCount}`,
            lineCount,
          );
        }
      } else if (!times.length) {
        const idTag = tag.match(ID_TAG_RE);
        if (idTag) {
          this._metadata[idTag[1].toLowerCase()] = idTag[2].trim();
        }
        // Unknown non-timestamp tags (e.g., `[Chorus]`) are ignored.
        return;
      } else {
        break;
      }

      text = text.slice(match[0].length);
    }

    if (!times.length) return;

    text = text.trim();

    if (text === '') {
      // Empty lyric lines terminate the previous cue but do not produce a cue themselves.
      this._boundaries.push(...times);
      return;
    }

    const parts = this._parseText(text);
    for (const time of times) this._lines.push({ time, parts });
  }

  done() {
    const cues: VTTCue[] = [],
      offset = this._parseOffset(),
      length = this._metadata.length ? parseLRCTimestamp(this._metadata.length) : null;

    if (Object.keys(this._metadata).length) {
      this._init.onHeaderMetadata?.(this._metadata);
    }

    const lines = this._lines
      .map((line) => ({ ...line, time: this._applyOffset(line.time, offset) }))
      .sort((a, b) => a.time - b.time);

    const boundaries = this._boundaries
      .map((time) => this._applyOffset(time, offset))
      .sort((a, b) => a - b);

    let boundaryIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const { time, parts } = lines[i];

      let end = -1;

      // Next cue with a later start time.
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].time > time) {
          end = lines[j].time;
          break;
        }
      }

      // Empty lyric lines can also terminate a cue.
      while (boundaryIndex < boundaries.length && boundaries[boundaryIndex] <= time) {
        boundaryIndex++;
      }

      if (boundaryIndex < boundaries.length && (end < 0 || boundaries[boundaryIndex] < end)) {
        end = boundaries[boundaryIndex];
      }

      if (end < 0) {
        end = time + DEFAULT_CUE_DURATION;
        if (length !== null && length > end) end = length;
      }

      const cue = new VTTCue(time, end, this._buildText(parts, time, offset));
      cues.push(cue);
      this._init.onCue?.(cue);
    }

    return {
      metadata: this._metadata,
      regions: [],
      cues,
      errors: this._errors,
    };
  }

  protected _parseText(text: string): (string | number)[] {
    const parts: (string | number)[] = [];

    let lastIndex = 0,
      match: RegExpExecArray | null;

    INLINE_TAG_RE.lastIndex = 0;
    while ((match = INLINE_TAG_RE.exec(text))) {
      const time = parseLRCTimestamp(match[1]);
      if (time === null) continue;
      if (match.index > lastIndex) parts.push(escapeText(text.slice(lastIndex, match.index)));
      parts.push(time);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) parts.push(escapeText(text.slice(lastIndex)));

    return parts;
  }

  protected _buildText(parts: (string | number)[], startTime: number, offset: number) {
    let text = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part === 'string') {
        text += part;
      } else {
        const time = this._applyOffset(part, offset);
        // Strip a leading inline tag that matches the line time as it's redundant.
        if (i === 0 && time === startTime) continue;
        text += `<${formatTimestamp(time)}>`;
      }
    }

    return text;
  }

  protected _parseOffset() {
    const offset = this._metadata.offset;
    if (!offset || !OFFSET_RE.test(offset)) return 0;
    return parseInt(offset, 10) / 1000;
  }

  protected _applyOffset(time: number, offset: number) {
    // Positive offsets shift times earlier per the LRC convention.
    return Math.max(0, Math.round((time - offset) * 1000) / 1000);
  }

  protected _handleError(code: ParseError['code'], reason: string, line: number) {
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

function escapeText(text: string) {
  return text.replace(AMP_RE, '&amp;').replace(LT_RE, '&lt;');
}

function formatTimestamp(time: number) {
  const hours = Math.floor(time / 3600),
    minutes = Math.floor((time % 3600) / 60),
    seconds = Math.floor(time % 60),
    milliseconds = Math.round((time - Math.floor(time)) * 1000);
  return pad(hours, 2) + ':' + pad(minutes, 2) + ':' + pad(seconds, 2) + '.' + pad(milliseconds, 3);
}

function pad(value: number, length: number) {
  return String(value).padStart(length, '0');
}

/**
 * Parses an LRC timestamp (`mm:ss`, `mm:ss.xx`, `mm:ss.xxx`, or `hh:mm:ss.xx`) into seconds.
 * Returns `null` if the timestamp is invalid.
 */
export function parseLRCTimestamp(text: string): number | null {
  const match = text.match(TIMESTAMP_RE);
  if (!match) return null;

  const hours = match[1] ? parseInt(match[1], 10) : 0,
    minutes = parseInt(match[2], 10),
    seconds = parseInt(match[3], 10),
    milliseconds = match[4] ? parseInt(match[4].padEnd(3, '0'), 10) : 0;

  if (seconds > 59 || (match[1] && minutes > 59)) return null;

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export default function createLRCParser() {
  return new LRCParser();
}
