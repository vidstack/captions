import type { CaptionsParser } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';
import { VTTBlock, VTTParser } from '../vtt/vtt-parser';

const MILLISECOND_SEP_RE = /*#__PURE__*/ /,/g,
  TIMESTAMP_SEP = /*#__PURE__*/ '-->',
  // Extended SRT coordinates (`X1:100 X2:200 Y1:50 Y2:80`) can not be mapped without knowing the
  // video dimensions, so they are stripped from the timing line.
  COORDS_RE = /*#__PURE__*/ /^[XY][12]:-?\d+$/i,
  // Common SSA/ASS override tags that survive SRT conversions (e.g., `{\an8}` for top placement).
  ALIGN_TAG_RE = /*#__PURE__*/ /\{\\an?([1-9])\}/,
  OVERRIDE_TAG_RE = /*#__PURE__*/ /\{\\[^}]*\}/g,
  FONT_OPEN_RE = /*#__PURE__*/ /<font\b([^>]*)>/gi,
  FONT_CLOSE_RE = /*#__PURE__*/ /<\/font\s*>/gi,
  FONT_COLOR_RE = /*#__PURE__*/ /color\s*=\s*["']?\s*([#\w]+)/i,
  HEX_COLOR_RE = /*#__PURE__*/ /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  STRIKE_TAG_RE = /*#__PURE__*/ /<\/?(?:s|strike|del)\s*>/gi,
  VTT_COLORS = /*#__PURE__*/ new Set([
    'white',
    'lime',
    'cyan',
    'red',
    'yellow',
    'magenta',
    'blue',
    'black',
  ]),
  // HTML colour names that are commonly used in SRT files but are not part of the WebVTT palette.
  HTML_COLORS = /*#__PURE__*/ {
    green: '#008000',
    orange: '#ffa500',
    purple: '#800080',
    gray: '#808080',
    grey: '#808080',
    silver: '#c0c0c0',
    pink: '#ffc0cb',
    gold: '#ffd700',
    brown: '#a52a2a',
    navy: '#000080',
    teal: '#008080',
    olive: '#808000',
    maroon: '#800000',
    aqua: '#00ffff',
    fuchsia: '#ff00ff',
  };

export class SRTParser extends VTTParser implements CaptionsParser {
  override parse(line: string, lineCount: number): void {
    if (line === '') {
      if (this._cue) {
        this._cue.text = this._transformText(this._cue, this._cue.text);
        this._cues.push(this._cue);
        this._init.onCue?.(this._cue);
        this._cue = null;
      }

      this._block = VTTBlock.None;
    } else if (this._block === VTTBlock.Cue) {
      this._cue!.text += (this._cue!.text ? '\n' : '') + line;
    } else if (line.includes(TIMESTAMP_SEP)) {
      const result = this._parseTimestamp(line, lineCount);
      if (result) {
        // Anything after the end timestamp that isn't a coordinate is kept as text for tolerance.
        const trailing = result[2].filter((text) => !COORDS_RE.test(text)).join(' ');
        this._cue = new VTTCue(result[0], result[1], trailing);
        this._cue.id = this._prevLine;
        this._block = VTTBlock.Cue;
      }
    }

    this._prevLine = line;
  }

  protected override _parseTimestamp(line: string, lineCount: number) {
    return super._parseTimestamp(line.replace(MILLISECOND_SEP_RE, '.'), lineCount);
  }

  /**
   * Converts SRT-flavoured markup into WebVTT cue text and applies positioning override tags.
   */
  protected _transformText(cue: VTTCue, text: string): string {
    const align = text.match(ALIGN_TAG_RE);
    if (align) applyNumpadAlignment(cue, parseInt(align[1], 10));

    return text
      .replace(OVERRIDE_TAG_RE, '')
      .replace(FONT_OPEN_RE, (_, attrs: string) => {
        const color = attrs.match(FONT_COLOR_RE)?.[1],
          vttColor = color && toVTTColor(color);
        return vttColor ? `<c.${vttColor}>` : '<c>';
      })
      .replace(FONT_CLOSE_RE, '</c>')
      .replace(STRIKE_TAG_RE, '');
  }
}

/**
 * Applies SSA/ASS numpad alignment (1-9) to a cue: 1-3 bottom, 4-6 middle, 7-9 top, and
 * 1/4/7 left, 2/5/8 center, 3/6/9 right.
 */
export function applyNumpadAlignment(cue: VTTCue, alignment: number) {
  if (alignment < 1 || alignment > 9) return;

  const horizontal = (alignment - 1) % 3,
    vertical = Math.floor((alignment - 1) / 3);

  cue.align = horizontal === 0 ? 'left' : horizontal === 2 ? 'right' : 'center';

  if (vertical === 1) {
    cue.snapToLines = false;
    cue.line = 50;
    cue.lineAlign = 'center';
  } else if (vertical === 2) {
    cue.snapToLines = true;
    cue.line = 0;
    cue.lineAlign = 'start';
  }
}

function toVTTColor(color: string): string | null {
  const name = color.toLowerCase();
  if (VTT_COLORS.has(name)) return name;
  if (HEX_COLOR_RE.test(name)) return name;
  if (HTML_COLORS[name]) return HTML_COLORS[name];
  return null;
}

export default function createSRTParser() {
  return new SRTParser();
}
