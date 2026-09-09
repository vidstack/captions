import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';

const TIMING_LINE_RE = /^(\d+:\d{2}:\d{2}\.\d{3})\s*,\s*(\d+:\d{2}:\d{2}\.\d{3})$/,
  TIMESTAMP_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{3})$/,
  LINE_BREAK_RE = /\[br\]/gi,
  AMP_RE = /&/g,
  LT_RE = /</g;

const enum Block {
  None = 0,
  Cue = 1,
  Skip = 2,
}

export class SBVParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _block = Block.None;
  protected _cue: VTTCue | null = null;
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];

  init(init: CaptionsParserInit) {
    this._init = init;
  }

  parse(line: string, lineCount: number) {
    const text = line.trim();

    if (text === '') {
      this._commitCue();
      this._block = Block.None;
    } else if (this._block === Block.Cue) {
      this._cue!.text += (this._cue!.text ? '\n' : '') + escapeText(text);
    } else if (this._block === Block.None) {
      const match = text.match(TIMING_LINE_RE);

      if (!match) {
        this._handleError(
          ParseErrorCode.BadFormat,
          `expected cue timing line \`H:MM:SS.mmm,H:MM:SS.mmm\` on line ${lineCount}`,
          lineCount,
        );
        this._block = Block.Skip;
        return;
      }

      const startTime = parseSBVTimestamp(match[1]),
        endTime = parseSBVTimestamp(match[2]);

      if (startTime === null || endTime === null || endTime <= startTime) {
        this._handleError(
          ParseErrorCode.BadTimestamp,
          startTime === null
            ? `cue start timestamp \`${match[1]}\` is invalid on line ${lineCount}`
            : endTime === null
              ? `cue end timestamp \`${match[2]}\` is invalid on line ${lineCount}`
              : `cue end timestamp \`${match[2]}\` is not greater than start \`${match[1]}\` on line ${lineCount}`,
          lineCount,
        );
        this._block = Block.Skip;
        return;
      }

      this._cue = new VTTCue(startTime, endTime, '');
      this._block = Block.Cue;
    }
  }

  done() {
    this._commitCue();
    return {
      metadata: {},
      regions: [],
      cues: this._cues,
      errors: this._errors,
    };
  }

  protected _commitCue() {
    if (!this._cue) return;
    this._cues.push(this._cue);
    this._init.onCue?.(this._cue);
    this._cue = null;
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
  return text.replace(AMP_RE, '&amp;').replace(LT_RE, '&lt;').replace(LINE_BREAK_RE, '\n');
}

function parseSBVTimestamp(text: string): number | null {
  const match = text.match(TIMESTAMP_RE);
  if (!match) return null;

  const hours = parseInt(match[1], 10),
    minutes = parseInt(match[2], 10),
    seconds = parseInt(match[3], 10),
    milliseconds = parseInt(match[4], 10);

  if (minutes > 59 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export default function createSBVParser() {
  return new SBVParser();
}
