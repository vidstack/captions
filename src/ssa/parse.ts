import type { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { parseVTTTimestamp } from '../vtt/parse';
import { VTTCue } from '../vtt/vtt-cue';

const FORMAT_START_RE = /*#__PURE__*/ /^Format:[\s\t]*/,
  STYLE_START_RE = /*#__PURE__*/ /^Style:[\s\t]*/,
  DIALOGUE_START_RE = /*#__PURE__*/ /^Dialogue:[\s\t]*/,
  FORMAT_SPLIT_RE = /*#__PURE__*/ /[\s\t]*,[\s\t]*/,
  STYLE_FUNCTION_RE = /*#__PURE__*/ /\{[^}]+\}/g,
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
            this._cue.text += '\n' + line.replace(STYLE_FUNCTION_RE, '');
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
          styles['font-size'] = value + 'px';
          break;
        case 'PrimaryColour':
          const color = parseColor(value);
          if (color) styles['--cue-color'] = color;
          break;
        case 'BackColour':
          const bgColor = parseColor(value);
          if (bgColor) styles['--cue-bg-color'] = bgColor;
          break;
        case 'OutlineColor':
          const outlineColor = parseColor(value);
          if (outlineColor) styles['outline-color'] = outlineColor;
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
        case 'MarginL':
          styles['--cue-margin-left'] = value + '%';
          break;
        case 'MarginR':
          styles['--cue-margin-right'] = value + '%';
          break;
        case 'MarginV':
          styles['--cue-margin-bottom'] = value + '%';
          break;
        case 'Outline':
          styles['--cue-outline'] = `${value}px solid`;
          break;
        case 'Alignment':
          switch (parseInt(value, 10)) {
            case 1:
              styles._line = 100;
              styles._align = 'start';
              break;
            case 2:
              styles._line = 100;
              styles._align = 'center';
              break;
            case 3:
              styles._line = 100;
              styles._align = 'end';
              break;
            case 5:
              styles._line = 0;
              styles._align = 'start';
              break;
            case 6:
              styles._line = 0;
              styles._align = 'center';
              break;
            case 7:
              styles._line = 0;
              styles._align = 'end';
              break;
            case 9:
              styles._line = 50;
              styles._align = 'start';
              break;
            case 10:
              styles._line = 50;
              styles._align = 'center';
              break;
            case 11:
              styles._line = 50;
              styles._align = 'end';
              break;
          }
      }
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

    if (styles._align) {
      cue.align = styles._align;
      cue.line = styles._line;
      cue.snapToLines = false;
      delete styles._line;
      delete styles._align;
    }

    if (fields.MarginL) styles['--cue-margin-left'] = fields.MarginL + '%';
    if (fields.MarginR) styles['--cue-margin-right'] = fields.MarginR + '%';
    if (fields.MarginV) styles['--cue-margin-bottom'] = fields.MarginV + '%';

    cue.text =
      voice +
      values
        .slice(this._format!.length - 1)
        .join(', ')
        .replace(STYLE_FUNCTION_RE, '');

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

export default function createSSAParser() {
  return new SSAParser();
}
