import type { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { toCoords, toFloat, toNumber, toPercentage } from '../utils/unit';
import { VTTCue } from './vtt-cue';
import { VTTRegion } from './vtt-region';

const HEADER_MAGIC = 'WEBVTT',
  // https://www.w3.org/TR/webvtt1/#webvtt-file-structure (optional BOM, then WEBVTT + space/tab/EOL)
  HEADER_RE = /^\uFEFF?WEBVTT(?:$|[ \t])/,
  COMMA = ',',
  PERCENT_SIGN = '%',
  SETTING_SEP_RE = /[:=]/,
  SETTING_LINE_RE = /^[ \t\f\r\n]*(region|vertical|line|position|size|align)[:=]/,
  NOTE_BLOCK_START = 'NOTE',
  STYLE_BLOCK_START = 'STYLE',
  REGION_BLOCK_START = 'REGION',
  REGION_BLOCK_START_RE = /^REGION:?[ \t\f\r\n]+/,
  // WebVTT whitespace is TAB, LF, FF, CR, and SPACE (not U+000B or Unicode spaces).
  SPACE_RE = /[ \t\f\r\n]+/,
  TRIM_RE = /^[ \t\f\r\n]+|[ \t\f\r\n]+$/g,
  NUL_RE = /\0/g,
  TIMESTAMP_SEP = '-->',
  TIMESTAMP_SEP_RE = /[ \t\f\r\n]*-->[ \t\f\r\n]*/,
  ALIGN_RE = /^(?:start|center|end|left|right)$/,
  LINE_ALIGN_RE = /^(?:start|center|end)$/,
  POS_ALIGN_RE = /^(?:line-(?:left|right)|center)$/,
  // Lenient: any hour digits, 1-3 fraction digits, `,` or `.` separator. Strict follows the spec.
  TIMESTAMP_RE = /^(?:(\d+):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/,
  STRICT_TIMESTAMP_RE = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/,
  TIMING_LINE_RE = /^[ \t\f\r\n]*\d/;

export const enum VTTBlock {
  None = 0,
  Header = 1,
  Cue = 2,
  Region = 3,
  Note = 4,
  Style = 5,
}

export class VTTParser implements CaptionsParser {
  /** Whether strict mode applies the WebVTT timestamp grammar (SRT has its own grammar). */
  protected _strictTimestamps = true;

  /** Percentages must carry a `%` sign per spec; lenient mode also accepts bare numbers. */
  protected _toPercentage(text: string) {
    return toPercentage(text, !this._init.strict);
  }

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
  protected _styles: string[] = [];
  protected _style = '';

  async init(init: CaptionsParserInit) {
    this._init = init;
    if (init.errors) this._errorBuilder = (await import('../parse/errors')).ParseErrorBuilder;
  }

  parse(line: string, lineCount: number) {
    // https://www.w3.org/TR/webvtt1/#webvtt-parser-algorithm step 2: NUL becomes U+FFFD.
    if (line.includes('\0')) line = line.replace(NUL_RE, '\uFFFD');

    if (lineCount === 1) {
      if (HEADER_RE.test(line)) {
        this._block = VTTBlock.Header;
        this._prevLine = line;
        return;
      }

      // Invalid or missing signature: strict mode throws, otherwise report and keep going so
      // real-world files without a header still play.
      this._handleError(this._errorBuilder?._badVTTHeader());
    }

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
      } else if (this._block === VTTBlock.Style) {
        this._commitStyle();
      }

      this._block = VTTBlock.None;
    } else if (this._block) {
      switch (this._block) {
        case VTTBlock.Header:
          // A timing line ends the header even without the blank separator.
          if (line.includes(TIMESTAMP_SEP)) {
            this._init.onHeaderMetadata?.(this._metadata);
            this._block = VTTBlock.None;
            // Header lines are never cue identifiers.
            this._prevLine = '';
            this.parse(line, lineCount);
            return;
          }
          this._parseHeader(line, lineCount);
          break;
        case VTTBlock.Cue:
          // A timing line inside cue text ends the current cue and starts the next one
          // (https://www.w3.org/TR/webvtt1/#collect-a-webvtt-block).
          if (line.includes(TIMESTAMP_SEP) && TIMING_LINE_RE.test(line)) {
            this.parse('', lineCount);
            this.parse(line, lineCount);
            return;
          }

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
          // A `-->` line inside a region block discards the region and is parsed as timings.
          if (line.includes(TIMESTAMP_SEP)) {
            this._region = null;
            this._block = VTTBlock.None;
            this.parse(line, lineCount);
            return;
          }
          this._parseRegionSettings(line.split(SPACE_RE), lineCount);
          break;
        case VTTBlock.Style:
          // A timing line inside a STYLE block means the blank separator was missing.
          if (line.includes(TIMESTAMP_SEP)) {
            this._commitStyle();
            this._block = VTTBlock.None;
            this.parse(line, lineCount);
            return;
          }
          this._style += (this._style ? '\n' : '') + line;
          break;
      }
    } else if (line.startsWith(NOTE_BLOCK_START)) {
      this._block = VTTBlock.Note;
    } else if (line === STYLE_BLOCK_START || /^STYLE[\s\t]*$/.test(line)) {
      this._block = VTTBlock.Style;
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
    }

    this._prevLine = line;
  }

  done() {
    this._commitStyle();
    return {
      metadata: this._metadata,
      cues: this._cues,
      regions: Object.values(this._regions),
      errors: this._errors,
      styles: this._styles,
    };
  }

  protected _commitStyle() {
    const css = this._style.trim();
    this._style = '';
    if (!css) return;
    this._styles.push(css);
    this._init.onStyle?.(css);
  }

  protected _parseHeader(line: string, lineCount: number) {
    if (lineCount <= 1 || line.startsWith(HEADER_MAGIC)) return;
    const sepIndex = line.search(SETTING_SEP_RE);
    if (sepIndex > 0) {
      const key = line.slice(0, sepIndex).trim(),
        value = line.slice(sepIndex + 1).trim();
      if (key) this._metadata[key] = value;
    }
  }

  protected _parseTimestamp(line: string, lineCount: number) {
    const [startTimeText, trailingText = ''] = line.replace(TRIM_RE, '').split(TIMESTAMP_SEP_RE),
      // The end timestamp is collected as a prefix; whatever follows (even without whitespace) is
      // settings text, per "collect a WebVTT timestamp".
      endMatch = trailingText.match(/^([\d:.,]*)(.*)$/)!,
      endTimeText = endMatch[1],
      remainder = endMatch[2],
      settingsText = remainder.split(SPACE_RE).filter(Boolean),
      strict = !!this._init.strict && this._strictTimestamps,
      startTime = parseVTTTimestamp(startTimeText, strict);

    // Text glued to the end timestamp is only settings when the timestamp itself is complete per
    // the spec grammar; otherwise (e.g. `00:00:01.00x` in lenient mode) the timing is invalid.
    let endTime = parseVTTTimestamp(endTimeText, strict);
    if (endTime !== null && remainder && !SPACE_RE.test(remainder[0])) {
      if (!STRICT_TIMESTAMP_RE.test(endTimeText)) endTime = null;
    }
    if (startTime === null) {
      this._handleError(this._errorBuilder?._badStartTimestamp(startTimeText, lineCount));
    }
    if (endTime === null) {
      this._handleError(this._errorBuilder?._badEndTimestamp(endTimeText, lineCount));
    }
    if (startTime === null || endTime === null) return;

    // The spec keeps cues whose end is not after their start (they are simply never active).
    // Report it so authors notice; strict mode throws.
    if (endTime <= startTime) {
      this._handleError(this._errorBuilder?._badRangeTimestamp(startTime, endTime, lineCount));
    }

    return [startTime, endTime, settingsText] as const;
  }

  /**
   * @see {@link https://www.w3.org/TR/webvtt1/#region-settings-parsing}
   */
  protected _parseRegionSettings(settings: string[], line: number) {
    let badValue: boolean;
    for (let i = 0; i < settings.length; i++) {
      const [name, value] = splitSetting(settings[i]);
      if (name && value) {
        badValue = false;
        switch (name) {
          case 'id':
            this._region!.id = value;
            break;
          case 'width':
            const width = this._toPercentage(value);
            if (width !== null) this._region!.width = width;
            else badValue = true;
            break;
          case 'lines':
            const lines = toNumber(value);
            if (lines !== null) this._region!.lines = lines;
            else badValue = true;
            break;
          case 'regionanchor':
            const region = toCoords(value, !this._init.strict);
            if (region !== null) {
              this._region!.regionAnchorX = region[0];
              this._region!.regionAnchorY = region[1];
            } else badValue = true;
            break;
          case 'viewportanchor':
            const viewport = toCoords(value, !this._init.strict);
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
      const [name, value] = splitSetting(settings[i]);
      if (name && value) {
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
          case 'line': {
            // The whole setting is ignored if any component is invalid.
            const [linePos, lineAlign, ...extra] = value.split(COMMA),
              isPercent = linePos.includes(PERCENT_SIGN),
              lineValue = isPercent ? toPercentage(linePos, false) : toFloat(linePos),
              alignValid = lineAlign === undefined || LINE_ALIGN_RE.test(lineAlign);

            if (lineValue === null || !alignValid || extra.length) {
              badValue = true;
              break;
            }

            this._cue!.line = lineValue;
            this._cue!.snapToLines = !isPercent;
            if (lineAlign) this._cue!.lineAlign = lineAlign as VTTCue['lineAlign'];
            this._cue!.region = null;
            break;
          }
          case 'position': {
            const [colPos, colAlign, ...extra] = value.split(COMMA),
              position = this._toPercentage(colPos),
              alignValid = colAlign === undefined || POS_ALIGN_RE.test(colAlign);

            if (position === null || !alignValid || extra.length) {
              badValue = true;
              break;
            }

            this._cue!.position = position;
            if (colAlign) this._cue!.positionAlign = colAlign as VTTCue['positionAlign'];
            break;
          }
          case 'size':
            const size = this._toPercentage(value);
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
            } else if (value === 'middle' && !this._init.strict) {
              // Pre-2013 WebVTT drafts used `middle`; still common in the wild.
              this._cue!.align = 'center';
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
 * Splits `name:value` on the first separator. Settings whose separator is the first or last
 * character are skipped per spec (returned as empty name/value).
 */
function splitSetting(setting: string): [string, string] {
  const index = setting.search(SETTING_SEP_RE);
  if (index <= 0 || index === setting.length - 1) return ['', ''];
  return [setting.slice(0, index), setting.slice(index + 1)];
}

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#collect-a-webvtt-timestamp}
 */
export function parseVTTTimestamp(timestamp: string, strict = false): number | null {
  const match = timestamp.match(strict ? STRICT_TIMESTAMP_RE : TIMESTAMP_RE);
  if (!match) return null;

  const hours = match[1] ? parseInt(match[1], 10) : 0,
    minutes = parseInt(match[2], 10),
    seconds = parseInt(match[3], 10),
    milliseconds = match[4] ? parseInt(match[4].padEnd(3, '0'), 10) : 0,
    total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;

  if (hours < 0 || minutes < 0 || seconds < 0 || milliseconds < 0 || minutes > 59 || seconds > 59) {
    return null;
  }

  return total;
}

export default function createVTTParser() {
  return new VTTParser();
}
