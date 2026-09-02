import type { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, EmbeddedFont } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';
import { parseVTTTimestamp } from '../vtt/vtt-parser';
import { decodeUUEncodedFont } from './fonts';

const FORMAT_START_RE = /^Format:[\s\t]*/,
  STYLE_START_RE = /^Style:[\s\t]*/,
  DIALOGUE_START_RE = /^Dialogue:[\s\t]*/,
  COMMENT_START_RE = /^Comment:/,
  FONT_NAME_RE = /^fontname:[\s\t]*(.+)$/i,
  FORMAT_SPLIT_RE = /[\s\t]*,[\s\t]*/,
  SECTION_RE = /^\[(.*)\]$/,
  SCRIPT_INFO_SECTION_RE = /^\[Script Info\]$/i,
  STYLES_SECTION_RE = /^\[.*Styles\]$/i,
  EVENTS_SECTION_RE = /^\[.*Events\]$/i,
  FONTS_SECTION_RE = /^\[Fonts\]$/i,
  OVERRIDE_BLOCK_RE = /\{([^}]*)\}/g,
  OVERRIDE_TAG_RE = /\\([1-4]?[a-zA-Z]+)([^\\]*)/g,
  COLOR_TAG_RE = /&H([0-9a-fA-F]{2,8})&?/,
  NEW_LINE_RE = /\\N/g,
  SOFT_LINE_RE = /\\n/g,
  HARD_SPACE_RE = /\\h/g,
  KEY_VALUE_RE = /^([^:]+):[\s\t]*(.*)$/,
  ANGLE_BRACKET_RE = /[<>]/g;

const enum Section {
  None = 0,
  Info = 1,
  Style = 2,
  Event = 3,
  Fonts = 4,
  Other = 5,
}

interface SSAStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  outlineColor?: string;
  backColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeOut?: boolean;
  scaleX?: number;
  scaleY?: number;
  spacing?: number;
  angle?: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  /** Numpad alignment (1-9). */
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  alpha?: number;
}

/** Open inline formatting tags, innermost last. */
type OpenTags = { key: 'i' | 'b' | 'u' | 'c'; open: string; close: string }[];

export class SSAParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _section = Section.None;
  protected _cue: VTTCue | null = null;
  protected _cueStyle: SSAStyle | null = null;
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _format: string[] | null = null;
  protected _errorBuilder?: typeof ParseErrorBuilder;
  protected _styles: Record<string, SSAStyle> = {};
  protected _metadata: Record<string, string> = {};
  protected _fonts: EmbeddedFont[] = [];
  protected _font: { name: string; data: string } | null = null;
  protected _playResX = 384;
  protected _playResY = 288;
  protected _hasPlayRes = false;
  protected _isASS = true;
  protected _wrapStyle = 0;

  async init(init: CaptionsParserInit) {
    this._init = init;
    if (init.errors) this._errorBuilder = (await import('../parse/errors')).ParseErrorBuilder;
  }

  parse(line: string, lineCount: number) {
    if (SECTION_RE.test(line)) {
      this._commitCue();
      this._commitFont();
      this._format = null;

      if (SCRIPT_INFO_SECTION_RE.test(line)) {
        this._section = Section.Info;
      } else if (STYLES_SECTION_RE.test(line)) {
        this._section = Section.Style;
        // Legacy SSA `[V4 Styles]` uses a different alignment scheme than ASS `[V4+ Styles]`.
        if (/v4[\s\t]*styles/i.test(line)) this._isASS = false;
        else if (/v4\+/i.test(line)) this._isASS = true;
      } else if (EVENTS_SECTION_RE.test(line)) {
        this._section = Section.Event;
      } else if (FONTS_SECTION_RE.test(line)) {
        this._section = Section.Fonts;
      } else {
        this._section = Section.Other;
      }

      return;
    }

    switch (this._section) {
      case Section.Info:
        this._parseInfo(line);
        break;
      case Section.Style:
        if (STYLE_START_RE.test(line)) {
          if (this._format) {
            this._parseStyle(line.replace(STYLE_START_RE, '').split(FORMAT_SPLIT_RE));
          } else {
            this._handleError(this._errorBuilder?._missingFormat('Style', lineCount));
          }
        } else if (FORMAT_START_RE.test(line)) {
          this._format = line.replace(FORMAT_START_RE, '').split(FORMAT_SPLIT_RE);
        }
        break;
      case Section.Event:
        if (line === '') {
          this._commitCue();
        } else if (DIALOGUE_START_RE.test(line)) {
          this._commitCue();
          if (this._format) {
            const values = splitFields(line.replace(DIALOGUE_START_RE, ''), this._format.length),
              cue = this._parseDialogue(values, lineCount);
            if (cue) this._cue = cue;
          } else {
            this._handleError(this._errorBuilder?._missingFormat('Dialogue', lineCount));
          }
        } else if (FORMAT_START_RE.test(line)) {
          this._format = line.replace(FORMAT_START_RE, '').split(FORMAT_SPLIT_RE);
        } else if (COMMENT_START_RE.test(line)) {
          this._commitCue();
        } else if (this._cue && this._cueStyle) {
          // Non-standard: plain lines following a dialogue are treated as continuation text.
          this._cue.text += '\n' + this._transformText(this._cue, this._cueStyle, line);
        }
        break;
      case Section.Fonts:
        this._parseFontLine(line);
        break;
    }
  }

  done() {
    this._commitCue();
    this._commitFont();
    return {
      metadata: this._metadata,
      cues: this._cues,
      regions: [],
      errors: this._errors,
      fonts: this._fonts,
    };
  }

  protected _commitCue() {
    if (!this._cue) return;
    this._cues.push(this._cue);
    this._init.onCue?.(this._cue);
    this._cue = null;
    this._cueStyle = null;
  }

  protected _parseInfo(line: string) {
    const match = line.match(KEY_VALUE_RE);
    if (!match || line.startsWith(';') || line.startsWith('!')) return;

    const key = match[1].trim(),
      value = match[2].trim();

    this._metadata[key] = value;

    switch (key) {
      case 'PlayResX':
        this._playResX = parseFloat(value) || this._playResX;
        this._hasPlayRes = true;
        break;
      case 'PlayResY':
        this._playResY = parseFloat(value) || this._playResY;
        this._hasPlayRes = true;
        break;
      case 'WrapStyle':
        this._wrapStyle = parseInt(value, 10) || 0;
        break;
      case 'ScriptType':
        this._isASS = /v4\.00\+/i.test(value);
        break;
    }
  }

  protected _parseStyle(values: string[]) {
    let name = 'Default';

    const style: SSAStyle = {
      borderStyle: 1,
      outline: 2,
      shadow: 2,
      alignment: 2,
      marginL: 10,
      marginR: 10,
      marginV: 10,
    };

    for (let i = 0; i < this._format!.length; i++) {
      const field = this._format![i],
        value = values[i];

      if (value === undefined) continue;

      switch (field) {
        case 'Name':
          name = value;
          break;
        case 'Fontname':
          style.fontName = value;
          break;
        case 'Fontsize':
          style.fontSize = parseFloat(value);
          break;
        case 'PrimaryColour':
          style.primaryColor = parseColor(value) ?? undefined;
          break;
        case 'OutlineColour':
        case 'TertiaryColour':
          style.outlineColor = parseColor(value) ?? undefined;
          break;
        case 'BackColour':
          style.backColor = parseColor(value) ?? undefined;
          break;
        case 'Bold':
          style.bold = isTruthyFlag(value);
          break;
        case 'Italic':
          style.italic = isTruthyFlag(value);
          break;
        case 'Underline':
          style.underline = isTruthyFlag(value);
          break;
        case 'StrikeOut':
          style.strikeOut = isTruthyFlag(value);
          break;
        case 'ScaleX':
          style.scaleX = parseFloat(value);
          break;
        case 'ScaleY':
          style.scaleY = parseFloat(value);
          break;
        case 'Spacing':
          style.spacing = parseFloat(value);
          break;
        case 'Angle':
          style.angle = parseFloat(value);
          break;
        case 'BorderStyle':
          style.borderStyle = parseInt(value, 10) || 1;
          break;
        case 'Outline':
          style.outline = parseFloat(value) || 0;
          break;
        case 'Shadow':
          style.shadow = parseFloat(value) || 0;
          break;
        case 'Alignment':
          style.alignment = this._isASS
            ? parseInt(value, 10) || 2
            : toNumpadAlignment(parseInt(value, 10) || 2);
          break;
        case 'MarginL':
          style.marginL = parseFloat(value) || 0;
          break;
        case 'MarginR':
          style.marginR = parseFloat(value) || 0;
          break;
        case 'MarginV':
          style.marginV = parseFloat(value) || 0;
          break;
        case 'AlphaLevel':
          const alpha = parseFloat(value);
          if (!Number.isNaN(alpha)) style.alpha = alpha > 1 ? 1 - alpha / 255 : alpha;
          break;
      }
    }

    this._styles[name] = style;
  }

  protected _parseDialogue(values: string[], lineCount: number) {
    const fields = this._buildFields(values);

    const timestamp = this._parseTimestamp(fields.Start, fields.End, lineCount);
    if (!timestamp) return;

    const cue = new VTTCue(timestamp[0], timestamp[1], ''),
      baseStyle = fields.Style ? this._styles[fields.Style.replace(/^\*/, '')] : undefined,
      style: SSAStyle = { ...(baseStyle || this._parseStyleDefaults()) },
      initialAlignment = style.alignment;

    const marginL = parseFloat(fields.MarginL),
      marginR = parseFloat(fields.MarginR),
      marginV = parseFloat(fields.MarginV);

    if (marginL) style.marginL = marginL;
    if (marginR) style.marginR = marginR;
    if (marginV) style.marginV = marginV;

    const layer = parseInt(fields.Layer ?? fields.Marked?.replace(/^Marked=/i, ''), 10);
    if (layer) cue.layer = layer;

    const text = this._transformText(cue, style, fields.Text ?? '');
    if (!text) return;

    const voice = fields.Name?.replace(ANGLE_BRACKET_RE, '').trim();
    cue.text = (voice ? `<v ${voice}>` : '') + text;

    // Only emit styles when the dialogue resolved to a defined style or used positioning
    // override tags, otherwise leave rendering to the WebVTT defaults.
    const hasOverrides = style.alignment !== initialAlignment || cue.style?.__posX !== undefined;
    cue.style = baseStyle || hasOverrides ? this._buildCueStyle(cue, style) : undefined;
    this._cueStyle = style;

    return cue;
  }

  protected _parseStyleDefaults(): SSAStyle {
    return {
      borderStyle: 1,
      outline: 2,
      shadow: 2,
      alignment: 2,
      marginL: 10,
      marginR: 10,
      marginV: 10,
    };
  }

  /**
   * Converts dialogue text with SSA/ASS override tags into WebVTT cue text. Positioning tags
   * (`\an`, `\a`, `\pos`) mutate the style/cue, formatting tags are mapped to WebVTT tags, and
   * karaoke tags are mapped to WebVTT timestamp tags.
   */
  protected _transformText(cue: VTTCue, style: SSAStyle, text: string): string {
    let result = '',
      open: OpenTags = [],
      karaokeTime = cue.startTime,
      drawing = false,
      lastIndex = 0,
      match: RegExpExecArray | null;

    OVERRIDE_BLOCK_RE.lastIndex = 0;

    const appendText = (raw: string) => {
      if (drawing || !raw) return;
      result += escapeText(raw);
    };

    while ((match = OVERRIDE_BLOCK_RE.exec(text))) {
      appendText(text.slice(lastIndex, match.index));
      lastIndex = match.index + match[0].length;

      const block = match[1];
      let tag: RegExpExecArray | null;
      OVERRIDE_TAG_RE.lastIndex = 0;

      while ((tag = OVERRIDE_TAG_RE.exec(block))) {
        const name = tag[1],
          arg = tag[2].trim();

        switch (name) {
          case 'i':
            result += toggleTag(open, 'i', '<i>', '</i>', arg);
            break;
          case 'b':
            result += toggleTag(open, 'b', '<b>', '</b>', arg);
            break;
          case 'u':
            result += toggleTag(open, 'u', '<u>', '</u>', arg);
            break;
          case 'c':
          case '1c': {
            const color = parseColor(arg, true);
            result += closeTag(open, 'c');
            if (color) result += openTag(open, 'c', `<c.${color}>`, '</c>');
            break;
          }
          case 'r':
            result += closeTags(open);
            break;
          case 'an':
            style.alignment = parseInt(arg, 10) || style.alignment;
            break;
          case 'a':
            style.alignment = toNumpadAlignment(parseInt(arg, 10) || 2);
            break;
          case 'pos': {
            const coords = arg.replace(/[()]/g, '').split(',');
            const x = parseFloat(coords[0]),
              y = parseFloat(coords[1]);
            if (!Number.isNaN(x) && !Number.isNaN(y)) {
              cue.style = { ...cue.style, __posX: x + '', __posY: y + '' };
            }
            break;
          }
          case 'k':
          case 'K':
          case 'kf':
          case 'ko': {
            const duration = parseFloat(arg);
            if (!Number.isNaN(duration)) {
              result += toTimestampTag(Math.min(karaokeTime, cue.endTime));
              karaokeTime += duration / 100;
            }
            break;
          }
          case 'p':
            drawing = (parseInt(arg, 10) || 0) > 0;
            break;
        }
      }
    }

    appendText(text.slice(lastIndex));
    result += closeTags(open);

    return result
      .replace(NEW_LINE_RE, '\n')
      .replace(SOFT_LINE_RE, this._wrapStyle === 2 ? '\n' : ' ')
      .replace(HARD_SPACE_RE, '&nbsp;')
      .trim();
  }

  /**
   * Builds the CSS custom properties applied to the cue display element. All script pixel values
   * are converted to percentages of the play resolution so they scale with the overlay.
   */
  protected _buildCueStyle(cue: VTTCue, style: SSAStyle): Record<string, string> {
    const css: Record<string, string> = {},
      transform: string[] = [],
      pctX = (px: number) => `${round((px / this._playResX) * 100)}%`,
      pctY = (px: number) => `${round((px / this._playResY) * 100)}%`,
      // Lengths relative to the overlay height so they scale exactly like the video.
      lenY = (px: number) => `calc(var(--overlay-height) * ${round(px / this._playResY, 5)})`;

    if (style.fontName) css['font-family'] = `"${style.fontName.replace(/"/g, '')}", sans-serif`;
    if (style.fontSize) css['font-size'] = lenY(style.fontSize);
    if (style.primaryColor) css['--cue-color'] = style.primaryColor;
    if (style.bold) css['font-weight'] = 'bold';
    if (style.italic) css['font-style'] = 'italic';

    const decorations = [style.underline && 'underline', style.strikeOut && 'line-through'].filter(
      Boolean,
    );
    if (decorations.length) css['text-decoration'] = decorations.join(' ');

    if (style.spacing) css['letter-spacing'] = lenY(style.spacing);
    if (style.alpha !== undefined) css['opacity'] = style.alpha + '';
    if (style.scaleX && style.scaleX !== 100) transform.push(`scaleX(${style.scaleX / 100})`);
    if (style.scaleY && style.scaleY !== 100) transform.push(`scaleY(${style.scaleY / 100})`);
    // ASS rotates counter-clockwise, CSS rotates clockwise.
    if (style.angle) transform.push(`rotate(${-style.angle}deg)`);

    css['--cue-white-space'] = 'pre-wrap';
    css['--cue-line-height'] = 'normal';
    // Boxes hug the text like libass so unrelated cues do not collide across the whole width.
    css['--cue-width'] = 'max-content';

    const horizontal = (style.alignment - 1) % 3, // 0 left, 1 center, 2 right
      vertical = Math.floor((style.alignment - 1) / 3); // 0 bottom, 1 middle, 2 top

    css['--cue-text-align'] = horizontal === 0 ? 'left' : horizontal === 2 ? 'right' : 'center';

    const posX = cue.style?.__posX,
      posY = cue.style?.__posY;

    if (posX !== undefined && posY !== undefined) {
      css['--cue-left'] = pctX(parseFloat(posX));
      css['--cue-top'] = pctY(parseFloat(posY));
      if (horizontal === 1) transform.push('translateX(-50%)');
      else if (horizontal === 2) transform.push('translateX(-100%)');
      if (vertical === 0) transform.push('translateY(-100%)');
      else if (vertical === 1) transform.push('translateY(-50%)');
      // Explicitly positioned cues are not subject to collision avoidance (matches libass).
      css.__fixed = '1';
    } else {
      const left = (style.marginL / this._playResX) * 100,
        right = (style.marginR / this._playResX) * 100;

      css['--cue-max-width'] = `${round(Math.max(0, 100 - left - right))}%`;

      if (horizontal === 0) {
        css['--cue-left'] = `${round(left)}%`;
      } else if (horizontal === 2) {
        css['--cue-right'] = `${round(right)}%`;
      } else {
        css['--cue-left'] = `${round((left + (100 - right)) / 2)}%`;
        transform.push('translateX(-50%)');
      }

      if (vertical === 2) {
        css['--cue-top'] = pctY(style.marginV);
      } else if (vertical === 1) {
        css['--cue-top'] = '50%';
        transform.push('translateY(-50%)');
      } else {
        css['--cue-bottom'] = pctY(style.marginV);
      }
    }

    if (style.borderStyle === 3) {
      // Opaque box.
      if (style.backColor) css['--cue-bg-color'] = style.backColor;
      if (style.outline && style.outlineColor) {
        css['--cue-outline'] = `${lenY(style.outline)} solid ${style.outlineColor}`;
      }
    } else {
      // Outline + drop shadow.
      css['--cue-bg-color'] = 'transparent';
      css['--cue-padding-y'] = '0';
      if (style.outline && style.outlineColor) {
        // Stroke is centered on the glyph edge so it needs to be twice the outline width.
        css['--cue-text-stroke'] = `${lenY(style.outline * 2)} ${style.outlineColor}`;
      }
      if (style.shadow) {
        const shadowColor = style.backColor || 'rgba(0,0,0,0.8)';
        css['--cue-text-shadow'] = `${lenY(style.shadow)} ${lenY(style.shadow)} 0 ${shadowColor}`;
      }
    }

    if (transform.length) css['--cue-transform'] = transform.join(' ');
    if (cue.layer) css['--cue-z-index'] = cue.layer + '';

    return css;
  }

  protected _buildFields(values: string[]) {
    const fields: Record<string, string> = {};
    for (let i = 0; i < this._format!.length; i++) {
      fields[this._format![i]] = values[i];
    }
    return fields;
  }

  protected _parseTimestamp(startTimeText: string, endTimeText: string, lineCount: number) {
    const startTime = parseVTTTimestamp(startTimeText),
      endTime = parseVTTTimestamp(endTimeText);
    if (startTime !== null && endTime !== null && endTime > startTime) {
      return [startTime, endTime];
    } else {
      if (startTime === null) {
        this._handleError(this._errorBuilder?._badStartTimestamp(startTimeText, lineCount));
      }
      if (endTime === null) {
        this._handleError(this._errorBuilder?._badEndTimestamp(endTimeText, lineCount));
      }
      if (startTime !== null && endTime !== null && endTime <= startTime) {
        this._handleError(this._errorBuilder?._badRangeTimestamp(startTime, endTime, lineCount));
      }
    }
  }

  protected _parseFontLine(line: string) {
    const name = line.match(FONT_NAME_RE);
    if (name) {
      this._commitFont();
      this._font = { name: name[1].trim(), data: '' };
    } else if (this._font && line) {
      this._font.data += line;
    }
  }

  protected _commitFont() {
    if (!this._font) return;
    const data = decodeUUEncodedFont(this._font.data);
    if (data.length) this._fonts.push({ name: this._font.name, data });
    this._font = null;
  }

  protected _handleError(error?: ParseError) {
    if (!error) return;
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
 * Splits a dialogue/style line into at most `count` fields. The last field (Text) may contain
 * commas so it is never split.
 */
function splitFields(line: string, count: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < count - 1; i++) {
    const index = line.indexOf(',', start);
    if (index === -1) break;
    fields.push(line.slice(start, index).trim());
    start = index + 1;
  }
  fields.push(line.slice(start));
  return fields;
}

/**
 * Converts legacy SSA (v4.00) alignment to ASS numpad alignment. SSA uses 1-3 for bottom
 * left/center/right, +4 for top, +8 for middle.
 */
export function toNumpadAlignment(alignment: number): number {
  const horizontal = alignment & 3 || 2;
  if (alignment & 4) return 6 + horizontal;
  if (alignment & 8) return 3 + horizontal;
  return horizontal;
}

function toggleTag(open: OpenTags, key: 'i' | 'b' | 'u', start: string, end: string, arg: string) {
  const isOpen = open.some((tag) => tag.key === key),
    enabled = arg === '' ? !isOpen : parseInt(arg, 10) > 0;
  if (enabled && !isOpen) return openTag(open, key, start, end);
  if (!enabled && isOpen) return closeTag(open, key);
  return '';
}

function openTag(open: OpenTags, key: OpenTags[number]['key'], start: string, end: string) {
  open.push({ key, open: start, close: end });
  return start;
}

/**
 * Closes the given tag. Tags opened after it are closed first and re-opened afterwards so the
 * output is always properly nested (SSA tags toggle independently, HTML tags nest).
 */
function closeTag(open: OpenTags, key: OpenTags[number]['key']) {
  const index = open.findIndex((tag) => tag.key === key);
  if (index === -1) return '';

  let result = '';
  const reopen = open.splice(index + 1);
  for (let i = reopen.length - 1; i >= 0; i--) result += reopen[i].close;
  result += open.pop()!.close;
  for (const tag of reopen) {
    result += tag.open;
    open.push(tag);
  }
  return result;
}

function closeTags(open: OpenTags) {
  let result = '';
  while (open.length) result += open.pop()!.close;
  return result;
}

function escapeText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function toTimestampTag(time: number) {
  const hours = Math.floor(time / 3600),
    minutes = Math.floor((time % 3600) / 60),
    seconds = Math.floor(time % 60),
    ms = Math.round((time - Math.floor(time)) * 1000);
  return `<${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}>`;
}

function pad(num: number, length = 2) {
  return (num + '').padStart(length, '0');
}

function round(num: number, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

function isTruthyFlag(value: string) {
  const num = parseInt(value, 10);
  return !Number.isNaN(num) && num !== 0;
}

/**
 * Parses SSA/ASS colours (`&HAABBGGRR`, `&HBBGGRR&`, or decimal) to CSS. When `hex` is true the
 * result is a `#rrggbb` string suitable for a `<c.#rrggbb>` tag, otherwise an `rgba()` string.
 */
export function parseColor(color: string, hex = false): string | null {
  const match = color.match(COLOR_TAG_RE),
    raw = match ? match[1] : color.trim();

  const abgr = match ? parseInt(raw.padStart(8, '0'), 16) : parseInt(raw, 10);
  if (Number.isNaN(abgr) || abgr < 0) return null;

  const a = ((abgr >>> 24) & 0xff) ^ 0xff,
    b = (abgr >> 16) & 0xff,
    g = (abgr >> 8) & 0xff,
    r = abgr & 0xff;

  if (hex) return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return 'rgba(' + [r, g, b, round(a / 255)].join(',') + ')';
}

export default function createSSAParser() {
  return new SSAParser();
}
