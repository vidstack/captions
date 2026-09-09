import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, ParsedCaptionsResult } from '../parse/types';
import { type CueSpanStyle, VTTCue } from '../vtt/vtt-cue';

const LINE_RE = /^\{(\d+)\}\{(\d+)\}(.*)$/,
  FPS_RE = /^\d+(?:[.,]\d+)?$/,
  // `{y:i}` style control codes; lower-case applies to the line, upper-case to the whole subtitle.
  CONTROL_RE = /\{([a-zA-Z]):([^}]*)\}/g,
  BGR_COLOR_RE = /^\$?([0-9a-f]{6})$/i,
  POSITION_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  AMP_RE = /&/g,
  LT_RE = /</g,
  /** Frame rate assumed when the file has no `{1}{1}fps` header. */
  DEFAULT_FRAME_RATE = 23.976,
  /** `{s:size}` is a point size; sizes are expressed relative to this default. */
  DEFAULT_FONT_SIZE = 24,
  /**
   * `{P:x,y}` positions are pixels on the video the subtitles were authored for, which the file
   * does not record. A 640x480 canvas is assumed and positions become overlay percentages.
   */
  CANVAS_WIDTH = 640,
  CANVAS_HEIGHT = 480;

/** Formatting collected from control codes for a line or the whole subtitle. */
interface Format {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fontFamily?: string;
  /** Multiple of the default font size. */
  fontSize?: number;
  position?: [x: number, y: number];
}

/**
 * Parses MicroDVD (`.sub`) subtitles.
 *
 * Lines have the form `{start}{end}Text|second line` where times are frame numbers. An optional
 * first line `{1}{1}25.000` declares the frame rate, otherwise 23.976 fps is assumed. The frame
 * rate in use is reported as `metadata.FrameRate`.
 *
 * Control codes are mapped as follows: `{y:i,b,u}` -> `<i>`, `<b>`, `<u>` (`{y:s}` strike-through
 * becomes a span with `textDecoration`), `{c:$bbggrr}` -> `<c.#rrggbb>`, `{f:name}` and `{s:size}`
 * -> `cue.spans` entries with `fontFamily` / `fontSize` (`size / 24 em`), and `{P:x,y}` ->
 * `cue.layout` as percentages of an assumed 640x480 canvas. `{o:...}` and unknown codes are
 * dropped. Lower-case codes apply to their line, upper-case codes to the whole subtitle.
 */
export class MicroDVDParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _frameRate = DEFAULT_FRAME_RATE;
  protected _metadata: Record<string, string> = {};
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _started = false;

  init(init: CaptionsParserInit) {
    this._init = init;
  }

  parse(line: string, lineCount: number) {
    const text = line.trim();
    if (text === '') return;

    const match = text.match(LINE_RE);

    if (!match) {
      this._handleError(
        ParseErrorCode.BadFormat,
        `expected subtitle line \`{start}{end}Text\` on line ${lineCount}`,
        lineCount,
      );
      return;
    }

    const startFrame = parseInt(match[1], 10),
      endFrame = parseInt(match[2], 10),
      body = match[3];

    if (!this._started) {
      this._started = true;
      // `{1}{1}25.000` on the first line declares the frame rate.
      if (startFrame === 1 && endFrame === 1 && FPS_RE.test(body.trim())) {
        const fps = parseFloat(body.trim().replace(',', '.'));
        if (fps > 0) {
          this._frameRate = fps;
          return;
        }
      }
    }

    if (endFrame < startFrame) {
      this._handleError(
        ParseErrorCode.BadTimestamp,
        `subtitle end frame \`${endFrame}\` is before start frame \`${startFrame}\` on line ${lineCount}`,
        lineCount,
      );
    }

    const cue = new VTTCue(this._toSeconds(startFrame), this._toSeconds(endFrame), '');
    cue.text = this._buildText(cue, body);
    this._cues.push(cue);
    this._init.onCue?.(cue);
  }

  done(): ParsedCaptionsResult {
    this._metadata.FrameRate = String(this._frameRate);
    this._init.onHeaderMetadata?.(this._metadata);
    return {
      metadata: this._metadata,
      regions: [],
      cues: this._cues,
      errors: this._errors,
    };
  }

  protected _toSeconds(frame: number) {
    return Math.round((frame / this._frameRate) * 1000) / 1000;
  }

  /** Converts `Text|second line` with control codes into WebVTT cue text. */
  protected _buildText(cue: VTTCue, body: string) {
    const whole: Format = {},
      lines = body.split('|').map((line) => {
        const format: Format = {},
          text = line.replace(CONTROL_RE, (_, code: string, value: string) => {
            applyControlCode(code === code.toUpperCase() ? whole : format, code, value);
            return '';
          });
        return { format, text: text.trim() };
      });

    // Position is a whole-subtitle property; a per-line `{p:x,y}` is honoured as a fallback.
    const position = whole.position ?? lines.find((line) => line.format.position)?.format.position;
    if (position) {
      cue.layout = {
        left: round((position[0] / CANVAS_WIDTH) * 100),
        top: round((position[1] / CANVAS_HEIGHT) * 100),
        fixed: true,
      };
    }

    return lines
      .map(({ format, text }) => this._formatLine(cue, { ...whole, ...format }, text))
      .join('\n');
  }

  protected _formatLine(cue: VTTCue, format: Format, text: string) {
    let open = '',
      close = '';

    const wrap = (openTag: string, closeTag: string) => {
      open += openTag;
      close = closeTag + close;
    };

    if (format.color) wrap(`<c.${format.color}>`, '</c>');

    const span: CueSpanStyle = {};
    if (format.fontFamily) span.fontFamily = format.fontFamily;
    if (format.fontSize) span.fontSize = { unit: 'em', value: format.fontSize };
    if (format.strike) span.strike = true;
    if (Object.keys(span).length) wrap(`<c.s-${this._addSpan(cue, span)}>`, '</c>');

    if (format.bold) wrap('<b>', '</b>');
    if (format.italic) wrap('<i>', '</i>');
    if (format.underline) wrap('<u>', '</u>');

    return open + escapeText(text) + close;
  }

  protected _addSpan(cue: VTTCue, css: CueSpanStyle) {
    const spans = (cue.spans ??= {}),
      key = String(Object.keys(spans).length + 1);
    spans[key] = css;
    return key;
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

function applyControlCode(format: Format, code: string, value: string) {
  switch (code.toLowerCase()) {
    case 'y':
      for (const flag of value.toLowerCase().split(',')) {
        const key = flag.trim();
        if (key === 'i') format.italic = true;
        else if (key === 'b') format.bold = true;
        else if (key === 'u') format.underline = true;
        else if (key === 's') format.strike = true;
      }
      break;
    case 'c': {
      const color = toRGBColor(value.trim());
      if (color) format.color = color;
      break;
    }
    case 'f': {
      const family = value.trim();
      if (family) format.fontFamily = family;
      break;
    }
    case 's': {
      const size = parseFloat(value);
      if (size > 0) format.fontSize = round(size / DEFAULT_FONT_SIZE, 1000);
      break;
    }
    case 'p': {
      const match = value.match(POSITION_RE);
      if (match) format.position = [parseFloat(match[1]), parseFloat(match[2])];
      break;
    }
    // `{o:...}` (encoding/coordinate offsets), `{H:...}` (charset) and unknown codes are dropped.
  }
}

/** MicroDVD colours are `$bbggrr`; WebVTT wants `#rrggbb`. */
function toRGBColor(value: string) {
  const match = value.match(BGR_COLOR_RE);
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function round(value: number, precision = 100) {
  return Math.round(value * precision) / precision;
}

function escapeText(text: string) {
  return text.replace(AMP_RE, '&amp;').replace(LT_RE, '&lt;');
}

export default function createMicroDVDParser() {
  return new MicroDVDParser();
}
