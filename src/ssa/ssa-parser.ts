import type { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';
import { parseVTTTimestamp } from '../vtt/vtt-parser';

const FORMAT_START_RE = /*#__PURE__*/ /^Format:[\s\t]*/,
  STYLE_START_RE = /*#__PURE__*/ /^Style:[\s\t]*/,
  DIALOGUE_START_RE = /*#__PURE__*/ /^Dialogue:[\s\t]*/,
  FORMAT_SPLIT_RE = /*#__PURE__*/ /[\s\t]*,[\s\t]*/,
  STYLE_FUNCTION_RE = /*#__PURE__*/ /\{[^}]+\}/g,
  NEW_LINE_RE = /\\N/g,
  STYLES_SECTION_START_RE = /*#__PURE__*/ /^\[(.*)[\s\t]?Styles\]$/,
  EVENTS_SECTION_START_RE = /*#__PURE__*/ /^\[(.*)[\s\t]?Events\]$/;

const enum Section {
  None = 0,
  Style = 1,
  Event = 2,
}

export class SSAParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _section = Section.None;
  protected _cue: VTTCue | null = null;
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _format: string[] | null = null;
  protected _errorBuilder?: typeof ParseErrorBuilder;
  protected _styles: Record<string, Record<string, any>> = {};

  async init(init) {
    this._init = init;
    if (init.errors) this._errorBuilder = (await import('../parse/errors')).ParseErrorBuilder;
  }

  parse(line: string, lineCount: number) {
    if (this._section) {
      switch (this._section) {
        case Section.Style:
          if (line === '') {
            this._section = Section.None;
          } else if (STYLE_START_RE.test(line)) {
            if (this._format) {
              const styles = line.replace(STYLE_START_RE, '').split(FORMAT_SPLIT_RE);
              this._parseStyles(styles);
            } else {
              this._handleError(this._errorBuilder?._missingFormat('Style', lineCount));
            }
          } else if (FORMAT_START_RE.test(line)) {
            this._format = line.replace(FORMAT_START_RE, '').split(FORMAT_SPLIT_RE);
          } else if (EVENTS_SECTION_START_RE.test(line)) {
            this._format = null;
            this._section = Section.Event;
          }
          break;
        case Section.Event:
          if (line === '') {
            this._commitCue();
          } else if (DIALOGUE_START_RE.test(line)) {
            this._commitCue();
            if (this._format) {
              const dialogue = line.replace(DIALOGUE_START_RE, '').split(FORMAT_SPLIT_RE),
                cue = this._parseDialogue(dialogue, lineCount);
              if (cue) this._cue = cue;
            } else {
              this._handleError(this._errorBuilder?._missingFormat('Dialogue', lineCount));
            }
          } else if (this._cue) {
            this._cue.text += '\n' + line.replace(STYLE_FUNCTION_RE, '').replace(NEW_LINE_RE, '\n');
          } else if (FORMAT_START_RE.test(line)) {
            this._format = line.replace(FORMAT_START_RE, '').split(FORMAT_SPLIT_RE);
          } else if (STYLES_SECTION_START_RE.test(line)) {
            this._format = null;
            this._section = Section.Style;
          } else if (EVENTS_SECTION_START_RE.test(line)) {
            this._format = null;
          }
      }
    } else if (line === '') {
      // no-op
    } else if (STYLES_SECTION_START_RE.test(line)) {
      this._format = null;
      this._section = Section.Style;
    } else if (EVENTS_SECTION_START_RE.test(line)) {
      this._format = null;
      this._section = Section.Event;
    }
  }

  done() {
    return {
      metadata: {},
      cues: this._cues,
      regions: [],
      errors: this._errors,
    };
  }

  protected _commitCue() {
    if (!this._cue) return;
    this._cues.push(this._cue);
    this._init.onCue?.(this._cue);
    this._cue = null;
  }

  protected _parseStyles(values: string[]) {
    let name = 'Default',
      styles: Record<string, any> = {},
      outlineX: number | undefined,
      align: 'start' | 'center' | 'end' = 'center',
      vertical: 'top' | 'center' | 'bottom' = 'bottom',
      marginV: number | undefined,
      outlineY = 1.2,
      outlineColor: string | undefined,
      bgColor: string | undefined | null,
      borderStyle = 3,
      transform: string[] = [];

    for (let i = 0; i < this._format!.length; i++) {
      const field = this._format![i],
        value = values[i];
      switch (field) {
        case 'Name':
          name = value;
          break;
        case 'Fontname':
          styles['font-family'] = value;
          break;
        case 'Fontsize':
          styles['font-size'] = `calc(${value} / var(--overlay-height))`;
          break;
        case 'PrimaryColour':
          const color = parseColor(value);
          if (color) styles['--cue-color'] = color;
          break;
        case 'BorderStyle':
          borderStyle = parseInt(value, 10);
          break;
        case 'BackColour':
          bgColor = parseColor(value);
          break;
        case 'OutlineColour':
          const _outlineColor = parseColor(value);
          if (_outlineColor) outlineColor = _outlineColor;
          break;
        case 'Bold':
          if (parseInt(value)) styles['font-weight'] = 'bold';
          break;
        case 'Italic':
          if (parseInt(value)) styles['font-style'] = 'italic';
          break;
        case 'Underline':
          if (parseInt(value)) styles['text-decoration'] = 'underline';
          break;
        case 'StrikeOut':
          if (parseInt(value)) styles['text-decoration'] = 'line-through';
          break;
        case 'Spacing':
          styles['letter-spacing'] = value + 'px';
          break;
        case 'AlphaLevel':
          styles['opacity'] = parseFloat(value);
          break;
        case 'ScaleX':
          transform.push(`scaleX(${parseFloat(value) / 100})`);
          break;
        case 'ScaleY':
          transform.push(`scaleY(${parseFloat(value) / 100})`);
          break;
        case 'Angle':
          transform.push(`rotate(${value}deg)`);
          break;
        case 'Shadow':
          outlineY = parseInt(value, 10) * 1.2;
          break;
        case 'MarginL':
          styles['--cue-width'] = 'auto';
          styles['--cue-left'] = parseFloat(value) + 'px';
          break;
        case 'MarginR':
          styles['--cue-width'] = 'auto';
          styles['--cue-right'] = parseFloat(value) + 'px';
          break;
        case 'MarginV':
          marginV = parseFloat(value);
          break;
        case 'Outline':
          outlineX = parseInt(value, 10);
          break;
        case 'Alignment':
          const alignment = parseInt(value, 10);
          if (alignment >= 4) vertical = alignment >= 7 ? 'top' : 'center';
          switch (alignment % 3) {
            case 1:
              align = 'start';
              break;
            case 2:
              align = 'center';
              break;
            case 3:
              align = 'end';
              break;
          }
      }
    }

    styles._vertical = vertical;
    styles['--cue-white-space'] = 'normal';
    styles['--cue-line-height'] = 'normal';
    styles['--cue-text-align'] = align;

    if (vertical === 'center') {
      styles[`--cue-top`] = '50%';
      transform.push('translateY(-50%)');
    } else {
      styles[`--cue-${vertical}`] = (marginV || 0) + 'px';
    }

    if (borderStyle === 1) {
      styles['--cue-padding-y'] = '0';
    }

    if (borderStyle === 1 || bgColor) {
      styles['--cue-bg-color'] = borderStyle === 1 ? 'none' : bgColor;
    }

    if (borderStyle === 3 && outlineColor) {
      styles['--cue-outline'] = `${outlineX}px solid ${outlineColor}`;
    }

    if (borderStyle === 1 && typeof outlineX === 'number') {
      const color = bgColor ?? '#000';
      styles['--cue-text-shadow'] = [
        outlineColor && buildTextShadow(outlineX * 1.2, outlineY * 1.2, outlineColor),
        outlineColor
          ? buildTextShadow(outlineX * (outlineX / 2), outlineY * (outlineX / 2), color)
          : buildTextShadow(outlineX, outlineY, color),
      ]
        .filter(Boolean)
        .join(', ');
    }

    if (transform.length) styles['--cue-transform'] = transform.join(' ');
    this._styles[name] = styles;
  }

  protected _parseDialogue(values: string[], lineCount: number) {
    const fields = this._buildFields(values);

    const timestamp = this._parseTimestamp(fields.Start, fields.End, lineCount);
    if (!timestamp) return;

    const cue = new VTTCue(timestamp[0], timestamp[1], ''),
      styles = { ...(this._styles[fields.Style] || {}) },
      voice = fields.Name ? `<v ${fields.Name}>` : '';

    const vertical = styles._vertical,
      marginLeft = fields.MarginL && parseFloat(fields.MarginL),
      marginRight = fields.MarginR && parseFloat(fields.MarginR),
      marginV = fields.MarginV && parseFloat(fields.MarginV);

    if (marginLeft) {
      styles['--cue-width'] = 'auto';
      styles['--cue-left'] = marginLeft + 'px';
    }

    if (marginRight) {
      styles['--cue-width'] = 'auto';
      styles['--cue-right'] = marginRight + 'px';
    }

    if (marginV && vertical !== 'center') {
      styles[`--cue-${vertical}`] = marginV + 'px';
    }

    cue.text =
      voice +
      values
        .slice(this._format!.length - 1)
        .join(', ')
        .replace(STYLE_FUNCTION_RE, '')
        .replace(NEW_LINE_RE, '\n');

    delete styles._vertical;
    if (Object.keys(styles).length) cue.style = styles;
    return cue;
  }

  protected _buildFields(values: string[]) {
    const fields: Record<string, any> = {};
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
      if (startTime != null && endTime !== null && endTime > startTime) {
        this._handleError(this._errorBuilder?._badRangeTimestamp(startTime, endTime, lineCount));
      }
    }
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

function parseColor(color: string) {
  const abgr = parseInt(color.replace('&H', ''), 16);

  if (abgr >= 0) {
    const a = ((abgr >> 24) & 0xff) ^ 0xff;
    const alpha = a / 255;
    const b = (abgr >> 16) & 0xff;
    const g = (abgr >> 8) & 0xff;
    const r = abgr & 0xff;
    return 'rgba(' + [r, g, b, alpha].join(',') + ')';
  }

  return null;
}

function buildTextShadow(x: number, y: number, color: string) {
  const noOfShadows = Math.ceil(2 * Math.PI * x);

  let textShadow = '';

  for (let i = 0; i < noOfShadows; i++) {
    const theta = (2 * Math.PI * i) / noOfShadows;
    textShadow +=
      x * Math.cos(theta) +
      'px ' +
      y * Math.sin(theta) +
      'px 0 ' +
      color +
      (i == noOfShadows - 1 ? '' : ',');
  }

  return textShadow;
}

export default function createSSAParser() {
  return new SSAParser();
}
