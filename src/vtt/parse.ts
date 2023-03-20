import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { toCoords, toFloat, toNumber, toPercentage } from '../utils/unit';
import { VTTCue } from './vtt-cue';
import { VTTRegion } from './vtt-region';

const COMMA = /*#__PURE__*/ ',',
  PERCENT_SIGN = /*#__PURE__*/ '%',
  SETTING_SEP_RE = /*#__PURE__*/ /[:=]/,
  SETTING_LINE_RE = /*#__PURE__*/ /[\s\t]*\w+[:=]/,
  NOTE_BLOCK_START_RE = /*#__PURE__*/ /^NOTE/i,
  REGION_BLOCK_START_RE = /*#__PURE__*/ /^REGION:?[\s\t]*/i,
  SPACE_RE = /*#__PURE__*/ /[\s\t]+/,
  TIMESTAMP_SEP = /*#__PURE__*/ '-->',
  TIMESTAMP_SEP_RE = /*#__PURE__*/ /[\s\t]*-->[\s\t]+/,
  ALIGN_RE = /*#__PURE__*/ /start|center|end|left|right/,
  LINE_ALIGN_RE = /*#__PURE__*/ /start|center|end/,
  POS_ALIGN_RE = /*#__PURE__*/ /line-(?:left|right)|center|auto/,
  TIMESTAMP_RE = /*#__PURE__*/ /^(?:(\d{1,2}):)?(\d{2}):(\d{2})(?:\.(\d{3}))?$/;

const enum VTTBlock {
  Header = 0,
  None = 1,
  Cue = 2,
  Region = 3,
  Note = 4,
}

export default class WebVTTParser implements CaptionsParser {
  private _block = VTTBlock.Header;
  private _metadata: Record<string, any> = {};
  private _regions: Record<string, VTTRegion> = {};
  private _cues: VTTCue[] = [];
  private _cue: VTTCue | null = null;
  private _region: VTTRegion | null = null;
  private _errors: ParseError[] = [];
  private _prevLine = '';

  constructor(private _init: CaptionsParserInit) {}

  parse(line: string, lineCount: number) {
    if (this._block > VTTBlock.Header) {
      if (line === '') {
        if (this._cue) {
          this._cues.push(this._cue);
          this._init.onCue?.(this._cue);
          this._cue = null;
        } else if (this._region) {
          this._regions[this._region.id] = this._region;
          this._init.onRegion?.(this._region);
          this._region = null;
        }

        this._block = VTTBlock.None;
      } else if (this._block > VTTBlock.None) {
        switch (this._block) {
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
      } else if (NOTE_BLOCK_START_RE.test(line)) {
        this._block = VTTBlock.Note;
      } else if (REGION_BLOCK_START_RE.test(line)) {
        this._block = VTTBlock.Region;
        this._region = new VTTRegion();
        this._parseRegionSettings(
          line.replace(REGION_BLOCK_START_RE, '').split(SPACE_RE),
          lineCount,
        );
      } else if (line.includes(TIMESTAMP_SEP)) {
        this._block = VTTBlock.Cue;
        const [startTimeText, trailingText = ''] = line.split(TIMESTAMP_SEP_RE),
          [endTimeText, ...settingsText] = trailingText.split(SPACE_RE),
          startTime = parseTimestamp(startTimeText),
          endTime = parseTimestamp(endTimeText);
        if (startTime !== null && endTime !== null && endTime > startTime) {
          this._cue = new VTTCue(startTime, endTime, '');
          this._cue.id = this._prevLine;
          this._parseCueSettings(settingsText, lineCount);
        } else if (__DEV__) {
          if (startTime === null) {
            const error = new ParseError({
              code: ParseErrorCode.BadTimestamp,
              reason: `cue start timestamp \`${startTimeText}\` is invalid on line ${lineCount}`,
              line: lineCount,
            });
            this._errors.push(error);
            this._init.onError?.(error);
          }
          if (endTime === null) {
            const error = new ParseError({
              code: ParseErrorCode.BadTimestamp,
              reason: `cue end timestamp \`${endTimeText}\` is invalid on line ${lineCount}`,
              line: lineCount,
            });
            this._errors.push(error);
            this._init.onError?.(error);
          }
          if (startTime != null && endTime !== null && endTime > startTime) {
            const error = new ParseError({
              code: ParseErrorCode.BadTimestamp,
              reason: `cue end timestamp \`${endTime}\` is greater than start \`${startTime}\` on line ${lineCount}`,
              line: lineCount,
            });
            this._errors.push(error);
            this._init.onError?.(error);
          }
        }
      }
    } else if (lineCount === 1) {
      if (!line.startsWith('WEBVTT')) {
        if (__DEV__) {
          const error = new ParseError({
            code: ParseErrorCode.BadSignature,
            reason: 'missing WEBVTT file header',
            line: lineCount,
          });
          this._errors.push(error);
          this._init.onError?.(error);
        }

        this._init.cancel();
      }
    } else if (line === '') {
      this._block = VTTBlock.None;
      this._init.onHeaderMetadata?.(this._metadata);
    } else if (SETTING_SEP_RE.test(line)) {
      const [key, value] = line.split(SETTING_SEP_RE);
      if (key) this._metadata[key] = (value || '').replace(SPACE_RE, '');
    }

    this._prevLine = line;
  }

  done() {
    return {
      metadata: this._metadata,
      cues: this._cues,
      regions: Object.values(this._regions),
      errors: __DEV__ && this._errors.length ? this._errors : null,
    };
  }

  /**
   * @see {@link https://www.w3.org/TR/webvtt1/#region-settings-parsing}
   */
  private _parseRegionSettings(settings: string[], line: number) {
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
            else if (__DEV__) badValue = true;
            break;
          case 'lines':
            const lines = toNumber(value);
            if (lines !== null) this._region!.lines = lines;
            else if (__DEV__) badValue = true;
            break;
          case 'regionanchor':
            const region = toCoords(value);
            if (region !== null) {
              this._region!.regionAnchorX = region[0];
              this._region!.regionAnchorY = region[1];
            } else if (__DEV__) badValue = true;
            break;
          case 'viewportanchor':
            const viewport = toCoords(value);
            if (viewport !== null) {
              this._region!.viewportAnchorX = viewport[0];
              this._region!.viewportAnchorY = viewport[1];
            } else if (__DEV__) badValue = true;
            break;
          case 'scroll':
            if (value === 'up') this._region!.scroll = 'up';
            else if (__DEV__) badValue = true;
            break;
          default:
            if (__DEV__) {
              const error = new ParseError({
                code: ParseErrorCode.UnknownSetting,
                reason: `unknown region setting \`${name}\` on line ${line} (value: ${value})`,
                line,
              });
              this._errors.push(error);
              this._init.onError?.(error);
            }
        }
        if (__DEV__ && badValue) {
          const error = new ParseError({
            code: ParseErrorCode.BadSettingValue,
            reason: `invalid value for region setting \`${name}\` on line ${line} (value: ${value})`,
            line,
          });
          this._errors.push(error);
          this._init.onError?.(error);
        }
      }
    }
  }

  /**
   * @see {@link https://www.w3.org/TR/webvtt1/#cue-timings-and-settings-parsing}
   */
  private _parseCueSettings(settings: string[], line: number) {
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
            } else if (__DEV__) badValue = true;
            break;
          case 'line':
            const [linePos, lineAlign] = value.split(COMMA);

            if (linePos.includes(PERCENT_SIGN)) {
              const percentage = toPercentage(linePos);
              if (percentage !== null) {
                this._cue!.line = percentage;
                this._cue!.snapToLines = false;
              } else if (__DEV__) badValue = true;
            } else {
              const number = toFloat(linePos);
              if (number !== null) this._cue!.line = number;
              else if (__DEV__) badValue = true;
            }

            if (LINE_ALIGN_RE.test(lineAlign)) {
              this._cue!.lineAlign = lineAlign as VTTCue['lineAlign'];
            } else if (__DEV__ && lineAlign) {
              badValue = true;
            }

            if (this._cue!.line !== 'auto') this._cue!.region = null;
            break;
          case 'position':
            const [colPos, colAlign] = value.split(COMMA),
              position = toPercentage(colPos);

            if (position !== null) this._cue!.position = position;
            else if (__DEV__) badValue = true;

            if (colAlign && POS_ALIGN_RE.test(colAlign)) {
              this._cue!.positionAlign = colAlign as VTTCue['positionAlign'];
            } else if (__DEV__ && colAlign) {
              badValue = true;
            }
            break;
          case 'size':
            const size = toPercentage(value);
            if (size !== null) {
              this._cue!.size = size;
              if (size < 100) this._cue!.region = null;
            } else if (__DEV__) {
              badValue = true;
            }
            break;
          case 'align':
            if (ALIGN_RE.test(value)) {
              this._cue!.align = value as VTTCue['align'];
            } else if (__DEV__) {
              badValue = true;
            }
            break;
          default:
            if (__DEV__) {
              const error = new ParseError({
                code: ParseErrorCode.UnknownSetting,
                reason: `unknown cue setting \`${name}\` on line ${line} (value: ${value})`,
                line,
              });
              this._errors.push(error);
              this._init.onError?.(error);
            }
        }
        if (__DEV__ && badValue) {
          const error = new ParseError({
            code: ParseErrorCode.BadSettingValue,
            reason: `invalid value for cue setting \`${name}\` on line ${line} (value: ${value})`,
            line,
          });
          this._errors.push(error);
          this._init.onError?.(error);
        }
      }
    }
  }
}

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#collect-a-webvtt-timestamp}
 */
export function parseTimestamp(timestamp: string): number | null {
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
