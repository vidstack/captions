import type { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { toCoords, toFloat, toNumber, toPercentage } from '../utils/unit';
import { VTTCue } from './vtt-cue';
import { VTTRegion } from './vtt-region';

const HEADER_MAGIC /*#__PURE__*/ = 'WEBVTT',
  COMMA = /*#__PURE__*/ ',',
  PERCENT_SIGN = /*#__PURE__*/ '%',
  SETTING_SEP_RE = /*#__PURE__*/ /[:=]/,
  SETTING_LINE_RE = /*#__PURE__*/ /^[\s\t]*[a-z]+[:=]/,
  NOTE_BLOCK_START = /*#__PURE__*/ 'NOTE',
  REGION_BLOCK_START = /*#__PURE__*/ 'REGION',
  REGION_BLOCK_START_RE = /*#__PURE__*/ /^REGION:?[\s\t]+/,
  SPACE_RE = /*#__PURE__*/ /[\s\t]+/,
  TIMESTAMP_SEP = /*#__PURE__*/ '-->',
  TIMESTAMP_SEP_RE = /*#__PURE__*/ /[\s\t]*-->[\s\t]+/,
  ALIGN_RE = /*#__PURE__*/ /start|center|end|left|right/,
  LINE_ALIGN_RE = /*#__PURE__*/ /start|center|end/,
  POS_ALIGN_RE = /*#__PURE__*/ /line-(?:left|right)|center|auto/,
  TIMESTAMP_RE = /*#__PURE__*/ /^(?:(\d{1,2}):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

export const enum VTTBlock {
  None = 0,
  Header = 1,
  Cue = 2,
  Region = 3,
  Note = 4,
}

export class VTTParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _block = VTTBlock.None;
  protected _metadata: Record<string, any> = {};
  protected _regions: Record<string, VTTRegion> = {};
  protected _cues: VTTCue[] = [];
  protected _cue: VTTCue | null = null;
  protected _region: VTTRegion | null = null;
  protected _errors: ParseError[] = [];
  protected _errorBuilder?: typeof ParseErrorBuilder;
  protected _prevLine = '';

  async init(init: CaptionsParserInit) {
    this._init = init;
    if (init.strict) this._block = VTTBlock.Header;
    if (init.errors) this._errorBuilder = (await import('../parse/errors')).ParseErrorBuilder;
  }

  parse(line: string, lineCount: number) {
    if (line === '') {
      if (this._cue) {
        this._cues.push(this._cue);
        this._init.onCue?.(this._cue);
        this._cue = null;
      } else if (this._region) {
        this._regions[this._region.id] = this._region;
        this._init.onRegion?.(this._region);
        this._region = null;
      } else if (this._block === VTTBlock.Header) {
        this._parseHeader(line, lineCount);
        this._init.onHeaderMetadata?.(this._metadata);
      }

      this._block = VTTBlock.None;
    } else if (this._block) {
      switch (this._block) {
        case VTTBlock.Header:
          this._parseHeader(line, lineCount);
          break;
        case VTTBlock.Cue:
          if (this._cue) {
            const hasText = this._cue!.text.length > 0;
            if (!hasText && SETTING_LINE_RE.test(line)) {
              this._parseCueSettings(line.split(SPACE_RE), lineCount);
            } else {
              this._cue!.text += (hasText ? '\n' : '') + line;
            }
          }
          break;
        case VTTBlock.Region:
          this._parseRegionSettings(line.split(SPACE_RE), lineCount);
          break;
      }
    } else if (line.startsWith(NOTE_BLOCK_START)) {
      this._block = VTTBlock.Note;
    } else if (line.startsWith(REGION_BLOCK_START)) {
      this._block = VTTBlock.Region;
      this._region = new VTTRegion();
      this._parseRegionSettings(line.replace(REGION_BLOCK_START_RE, '').split(SPACE_RE), lineCount);
    } else if (line.includes(TIMESTAMP_SEP)) {
      const result = this._parseTimestamp(line, lineCount);
      if (result) {
        this._cue = new VTTCue(result[0], result[1], '');
        this._cue.id = this._prevLine;
        this._parseCueSettings(result[2], lineCount);
      }
      this._block = VTTBlock.Cue;
    } else if (lineCount === 1) {
      this._parseHeader(line, lineCount);
    }

    this._prevLine = line;
  }

  done() {
    return {
      metadata: this._metadata,
      cues: this._cues,
      regions: Object.values(this._regions),
      errors: this._errors,
    };
  }

  protected _parseHeader(line: string, lineCount: number) {
    if (lineCount > 1) {
      if (SETTING_SEP_RE.test(line)) {
        const [key, value] = line.split(SETTING_SEP_RE);
        if (key) this._metadata[key] = (value || '').replace(SPACE_RE, '');
      }
    } else if (line.startsWith(HEADER_MAGIC)) {
      this._block = VTTBlock.Header;
    } else {
      this._handleError(this._errorBuilder?._badVTTHeader());
    }
  }

  protected _parseTimestamp(line: string, lineCount: number) {
    const [startTimeText, trailingText = ''] = line.split(TIMESTAMP_SEP_RE),
      [endTimeText, ...settingsText] = trailingText.split(SPACE_RE),
      startTime = parseVTTTimestamp(startTimeText),
      endTime = parseVTTTimestamp(endTimeText);
    if (startTime !== null && endTime !== null && endTime > startTime) {
      return [startTime, endTime, settingsText] as const;
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

  /**
   * @see {@link https://www.w3.org/TR/webvtt1/#region-settings-parsing}
   */
  protected _parseRegionSettings(settings: string[], line: number) {
    let badValue: boolean;
    for (let i = 0; i < settings.length; i++) {
      if (SETTING_SEP_RE.test(settings[i])) {
        badValue = false;
        const [name, value] = settings[i].split(SETTING_SEP_RE);
        switch (name) {
          case 'id':
            this._region!.id = value;
            break;
          case 'width':
            const width = toPercentage(value);
            if (width !== null) this._region!.width = width;
            else badValue = true;
            break;
          case 'lines':
            const lines = toNumber(value);
            if (lines !== null) this._region!.lines = lines;
            else badValue = true;
            break;
          case 'regionanchor':
            const region = toCoords(value);
            if (region !== null) {
              this._region!.regionAnchorX = region[0];
              this._region!.regionAnchorY = region[1];
            } else badValue = true;
            break;
          case 'viewportanchor':
            const viewport = toCoords(value);
            if (viewport !== null) {
              this._region!.viewportAnchorX = viewport[0];
              this._region!.viewportAnchorY = viewport[1];
            } else badValue = true;
            break;
          case 'scroll':
            if (value === 'up') this._region!.scroll = 'up';
            else badValue = true;
            break;
          default:
            this._handleError(this._errorBuilder?._unknownRegionSetting(name, value, line));
        }
        if (badValue) {
          this._handleError(this._errorBuilder?._badRegionSetting(name, value, line));
        }
      }
    }
  }

  /**
   * @see {@link https://www.w3.org/TR/webvtt1/#cue-timings-and-settings-parsing}
   */
  protected _parseCueSettings(settings: string[], line: number) {
    let badValue: boolean;
    for (let i = 0; i < settings.length; i++) {
      badValue = false;
      if (SETTING_SEP_RE.test(settings[i])) {
        const [name, value] = settings[i].split(SETTING_SEP_RE);
        switch (name) {
          case 'region':
            const region = this._regions[value];
            if (region) this._cue!.region = region;
            break;
          case 'vertical':
            if (value === 'lr' || value === 'rl') {
              this._cue!.vertical = value;
              this._cue!.region = null;
            } else badValue = true;
            break;
          case 'line':
            const [linePos, lineAlign] = value.split(COMMA);

            if (linePos.includes(PERCENT_SIGN)) {
              const percentage = toPercentage(linePos);
              if (percentage !== null) {
                this._cue!.line = percentage;
                this._cue!.snapToLines = false;
              } else badValue = true;
            } else {
              const number = toFloat(linePos);
              if (number !== null) this._cue!.line = number;
              else badValue = true;
            }

            if (LINE_ALIGN_RE.test(lineAlign)) {
              this._cue!.lineAlign = lineAlign as VTTCue['lineAlign'];
            } else if (lineAlign) {
              badValue = true;
            }

            if (this._cue!.line !== 'auto') this._cue!.region = null;
            break;
          case 'position':
            const [colPos, colAlign] = value.split(COMMA),
              position = toPercentage(colPos);

            if (position !== null) this._cue!.position = position;
            else badValue = true;

            if (colAlign && POS_ALIGN_RE.test(colAlign)) {
              this._cue!.positionAlign = colAlign as VTTCue['positionAlign'];
            } else if (colAlign) {
              badValue = true;
            }
            break;
          case 'size':
            const size = toPercentage(value);
            if (size !== null) {
              this._cue!.size = size;
              if (size < 100) this._cue!.region = null;
            } else {
              badValue = true;
            }
            break;
          case 'align':
            if (ALIGN_RE.test(value)) {
              this._cue!.align = value as VTTCue['align'];
            } else {
              badValue = true;
            }
            break;
          default:
            this._handleError(this._errorBuilder?._unknownCueSetting(name, value, line));
        }

        if (badValue) {
          this._handleError(this._errorBuilder?._badCueSetting(name, value, line));
        }
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

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#collect-a-webvtt-timestamp}
 */
export function parseVTTTimestamp(timestamp: string): number | null {
  const match = timestamp.match(TIMESTAMP_RE);
  if (!match) return null;

  const hours = match[1] ? parseInt(match[1], 10) : 0,
    minutes = parseInt(match[2], 10),
    seconds = parseInt(match[3], 10),
    milliseconds = match[4] ? parseInt(match[4], 10) : 0,
    total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;

  if (hours < 0 || minutes < 0 || seconds < 0 || milliseconds < 0 || minutes > 59 || seconds > 59) {
    return null;
  }

  return total;
}

export default function createVTTParser() {
  return new VTTParser();
}
