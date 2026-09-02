import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, ParsedCaptionsResult } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';

/**
 * Scenarist Closed Caption (SCC) parser. Decodes CEA-608 byte pairs into `VTTCue` objects by
 * modelling the displayed and non-displayed caption memories of a single data channel (CC1 by
 * default, or CC2 via the `channel` option). SCC files only carry field 1, so CC3/CC4 are not
 * available.
 *
 * @see {@link https://en.wikipedia.org/wiki/EIA-608}
 */

const FPS = 29.97,
  ROWS = 15,
  COLS = 32;

const HEADER_RE = /^Scenarist_SCC V1\.0\s*$/,
  BOM_RE = /^﻿/,
  LINE_RE = /^(\d{2}:\d{2}:\d{2}[:;.,]\d{2})(?:\s+(.*))?$/,
  TIMECODE_RE = /^(\d{2}):(\d{2}):(\d{2})([:;.,])(\d{2})$/,
  HEX_WORD_RE = /^[0-9a-fA-F]{4}$/,
  WORD_SPLIT_RE = /\s+/;

/** Basic character set (0x20-0x7f) substitutions that differ from ASCII. */
const BASIC_CHARS: Record<number, string> = {
  0x2a: 'á',
  0x5c: 'é',
  0x5e: 'í',
  0x5f: 'ó',
  0x60: 'ú',
  0x7b: 'ç',
  0x7c: '÷',
  0x7d: 'Ñ',
  0x7e: 'ñ',
  0x7f: '█',
};

/** Special characters (0x11 0x30-0x3f). Index 9 is the transparent space. */
const SPECIAL_CHARS = [
  '®', '°', '½', '¿', '™', '¢', '£', '♪', 'à', ' ', 'è', 'â', 'ê', 'î', 'ô', 'û',
]; // prettier-ignore

/** Extended Spanish/Miscellaneous/French characters (0x12 0x20-0x3f). */
const EXTENDED_CHARS_1 = [
  'Á', 'É', 'Ó', 'Ú', 'Ü', 'ü', '‘', '¡', '*', "'", '—', '©', '℠', '•', '“', '”',
  'À', 'Â', 'Ç', 'È', 'Ê', 'Ë', 'ë', 'Î', 'Ï', 'ï', 'Ô', 'Ù', 'ù', 'Û', '«', '»',
]; // prettier-ignore

/** Extended Portuguese/German/Danish characters (0x13 0x20-0x3f). */
const EXTENDED_CHARS_2 = [
  'Ã', 'ã', 'Í', 'Ì', 'ì', 'Ò', 'ò', 'Õ', 'õ', '{', '}', '\\', '^', '_', '|', '~',
  'Ä', 'ä', 'Ö', 'ö', 'ß', '¥', '¤', '¦', 'Å', 'å', 'Ø', 'ø', '┌', '┐', '└', '┘',
]; // prettier-ignore

/** CEA-608 colour index -> WebVTT class name (green is rendered as `lime`). */
const COLORS = ['white', 'lime', 'blue', 'cyan', 'red', 'yellow', 'magenta', 'black'];

/** Preamble address code first byte -> base row (1-based). Second byte bit 0x20 adds one. */
const PAC_ROWS: Record<number, number> = {
  0x11: 1,
  0x12: 3,
  0x15: 5,
  0x16: 7,
  0x17: 9,
  0x10: 11,
  0x13: 12,
  0x14: 14,
};

/**
 * Control code first bytes are 0x10-0x1f (after parity strip). Bit 3 selects the data channel:
 * clear for CC1 (0x10-0x17), set for CC2 (0x18-0x1f). Masking it off maps a CC2 code onto its CC1
 * equivalent so a single decode path serves both channels.
 */
const CHANNEL_BIT = 0x08;

// Cell style bit layout: bits 0-2 colour, bit 3 italics, bit 4 underline, bits 5-8 background
// (0 = none/transparent, otherwise colour index + 1).
const COLOR_MASK = 0x07,
  ITALICS = 1 << 3,
  UNDERLINE = 1 << 4,
  BG_SHIFT = 5,
  BG_MASK = 0x0f << BG_SHIFT;

const enum Mode {
  PopOn = 0,
  RollUp = 1,
  PaintOn = 2,
  Text = 3,
}

interface Screen {
  chars: string[][];
  styles: number[][];
}

interface ScreenContent {
  text: string;
  line: number;
  position: number;
}

export class SCCParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _cue: VTTCue | null = null;
  protected _cueKey = '';
  protected _started = false;
  protected _displayed = createScreen();
  protected _hidden = createScreen();
  protected _mode = Mode.PopOn;
  /** Data channel selected for decoding (`channel` option). */
  protected _selected: 1 | 2 = 1;
  /** Data channel most recently addressed by a control code, which owns following characters. */
  protected _channel: 1 | 2 = 1;
  protected _row = ROWS - 1;
  protected _col = 0;
  protected _style = 0;
  protected _rollUpRows = 2;
  protected _baseRow = ROWS - 1;
  protected _lastControl = -1;
  protected _dirty = false;
  protected _dirtyTime = 0;
  protected _time = 0;
  protected _lastTime = 0;

  init(init: CaptionsParserInit) {
    this._init = init;
    this._selected = init.channel === 2 ? 2 : 1;
  }

  parse(line: string, lineCount: number) {
    line = line.replace(BOM_RE, '').trim();
    if (line === '') return;

    if (!this._started) {
      this._started = true;
      if (HEADER_RE.test(line)) return;
      this._handleError(
        ParseErrorCode.BadSignature,
        'missing `Scenarist_SCC V1.0` file header',
        lineCount,
      );
    }

    const match = LINE_RE.exec(line);
    if (!match) {
      this._handleError(
        ParseErrorCode.BadTimestamp,
        `invalid SCC timecode on line ${lineCount}`,
        lineCount,
      );
      return;
    }

    const frames = parseSCCFrames(match[1]);
    if (frames === null) {
      this._handleError(
        ParseErrorCode.BadTimestamp,
        `SCC timecode \`${match[1]}\` is invalid on line ${lineCount}`,
        lineCount,
      );
      return;
    }

    const words = match[2] ? match[2].split(WORD_SPLIT_RE) : [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!HEX_WORD_RE.test(word)) {
        this._handleError(
          ParseErrorCode.BadFormat,
          `malformed hex word \`${word}\` on line ${lineCount}`,
          lineCount,
        );
        continue;
      }
      const value = parseInt(word, 16);
      this._time = this._lastTime = (frames + i) / FPS;
      this._decode((value >> 8) & 0x7f, value & 0x7f);
    }

    this._flush();
  }

  done(): ParsedCaptionsResult {
    this._flush();
    if (this._cue) {
      const start = this._cue.startTime;
      this._closeCue(this._lastTime > start ? this._lastTime : start + 1 / FPS);
    }
    return {
      metadata: {},
      regions: [],
      cues: this._cues,
      errors: this._errors,
    };
  }

  /** Decode a single byte pair (parity already stripped). */
  protected _decode(a: number, b: number) {
    // Filler (0x80 0x80 before parity strip) is transparent.
    if (a === 0 && b === 0) return;

    if (a >= 0x10 && a <= 0x1f) {
      // Control codes are always transmitted twice, ignore the immediate duplicate.
      const code = (a << 8) | b;
      if (code === this._lastControl) {
        this._lastControl = -1;
        return;
      }
      this._lastControl = code;
      // Every control code addresses a channel, and owns the characters that follow it. Codes
      // for the other channel are dropped, so its modes never leak into the selected channel.
      this._channel = sccChannelOf(a)!;
      if (this._channel !== this._selected) return;
      this._control(a & ~CHANNEL_BIT, b);
      return;
    }

    this._lastControl = -1;

    // 0x01-0x0f are XDS/undefined, skip the pair.
    if (a > 0 && a < 0x10) return;
    if (this._channel !== this._selected || this._mode === Mode.Text) return;

    if (a >= 0x20) this._writeChar(BASIC_CHARS[a] || String.fromCharCode(a));
    if (b >= 0x20) this._writeChar(BASIC_CHARS[b] || String.fromCharCode(b));
  }

  /** Control code with the channel bit already masked off (`a` is 0x10-0x17). */
  protected _control(a: number, b: number) {
    if (this._mode === Mode.Text && a !== 0x14) return;

    if (b >= 0x40) {
      this._pac(a, b);
      return;
    }

    if (b < 0x20) return;

    switch (a) {
      case 0x10:
        // Background attribute codes (0x20-0x2f), the low bit is semi-transparency (ignored).
        if (b < 0x30)
          this._style = (this._style & ~BG_MASK) | ((((b & 0x0e) >> 1) + 1) << BG_SHIFT);
        break;
      case 0x11:
        if (b < 0x30) this._midRow(b);
        else this._writeChar(SPECIAL_CHARS[b - 0x30]);
        break;
      case 0x12:
        this._writeExtended(EXTENDED_CHARS_1[b - 0x20]);
        break;
      case 0x13:
        this._writeExtended(EXTENDED_CHARS_2[b - 0x20]);
        break;
      case 0x14:
        this._misc(b);
        break;
      case 0x17:
        if (b >= 0x21 && b <= 0x23) {
          // Tab offsets.
          this._col = Math.min(COLS, this._col + (b - 0x20));
        } else if (b === 0x2d) {
          // Transparent background.
          this._style &= ~BG_MASK;
        } else if (b === 0x2e || b === 0x2f) {
          // Black foreground, optionally underlined.
          this._style = (this._style & ~(COLOR_MASK | ITALICS)) | 7;
          if (b === 0x2f) this._style |= UNDERLINE;
        }
        break;
    }
  }

  /** Preamble address code: sets cursor row/column and the current style. */
  protected _pac(a: number, b: number) {
    const base = PAC_ROWS[a];
    if (base === undefined) return;

    let row = a === 0x10 ? base : base + (b & 0x20 ? 1 : 0),
      col = 0,
      style = 0;

    const low = b & 0x1f;
    if (low < 0x10) {
      const idx = low >> 1;
      style = idx === 7 ? ITALICS : idx;
    } else {
      col = ((low >> 1) & 0x07) * 4;
    }

    if (low & 1) style |= UNDERLINE;

    this._row = Math.min(ROWS, row) - 1;
    this._col = col;
    this._style = style;

    if (this._mode === Mode.RollUp) {
      this._moveRollUpWindow(this._row - this._baseRow);
      this._baseRow = this._row;
    }
  }

  /** Mid-row code: displayed as a space, and changes the style of the following text. */
  protected _midRow(b: number) {
    const idx = (b & 0x0e) >> 1;
    this._writeChar(' ');
    if (idx === 7) {
      this._style = (this._style & ~UNDERLINE) | ITALICS;
    } else {
      this._style = (this._style & ~(COLOR_MASK | ITALICS | UNDERLINE)) | idx;
    }
    if (b & 1) this._style |= UNDERLINE;
  }

  /** Miscellaneous control codes (0x14 second byte). */
  protected _misc(b: number) {
    if (this._mode === Mode.Text) {
      // Only mode switches leave text mode, everything else belongs to the text service.
      const leaves = b === 0x20 || b === 0x29 || b === 0x2f || (b >= 0x25 && b <= 0x27);
      if (!leaves) return;
    }

    switch (b) {
      case 0x20: // RCL - resume caption loading (pop-on)
        this._flush();
        this._mode = Mode.PopOn;
        break;
      case 0x21: // BS - backspace
        this._backspace();
        break;
      case 0x24: {
        // DER - delete to end of row
        const screen = this._target();
        for (let c = this._col; c < COLS; c++) clearCell(screen, this._row, c);
        if (screen === this._displayed) this._markDirty();
        break;
      }
      case 0x25: // RU2
      case 0x26: // RU3
      case 0x27: // RU4
        this._rollUp(b - 0x23);
        break;
      case 0x29: // RDC - resume direct captioning (paint-on)
        this._flush();
        this._mode = Mode.PaintOn;
        break;
      case 0x2a: // TR - text restart
      case 0x2b: // RTD - resume text display
        this._flush();
        this._mode = Mode.Text;
        break;
      case 0x2c: // EDM - erase displayed memory
        this._flush();
        clearScreen(this._displayed);
        this._markDirty();
        this._flush();
        break;
      case 0x2d: // CR - carriage return
        if (this._mode === Mode.RollUp) this._carriageReturn();
        break;
      case 0x2e: // ENM - erase non-displayed memory
        clearScreen(this._hidden);
        break;
      case 0x2f: {
        // EOC - end of caption (flip memories)
        this._flush();
        const displayed = this._displayed;
        this._displayed = this._hidden;
        this._hidden = displayed;
        this._mode = Mode.PopOn;
        this._markDirty();
        this._flush();
        break;
      }
    }
  }

  protected _rollUp(rows: number) {
    this._flush();

    if (this._mode !== Mode.RollUp) {
      // Switching from another caption mode erases both memories.
      clearScreen(this._displayed);
      clearScreen(this._hidden);
      this._mode = Mode.RollUp;
      this._baseRow = ROWS - 1;
    } else if (rows < this._rollUpRows) {
      // Shrinking the window erases rows that fall outside of it.
      const top = this._baseRow - rows + 1;
      for (let r = Math.max(0, this._baseRow - this._rollUpRows + 1); r < top; r++) {
        clearRow(this._displayed, r);
      }
    }

    // Commit the erase now so the following text starts a cue at its own time.
    this._markDirty();
    this._flush();

    this._rollUpRows = rows;
    this._row = this._baseRow;
    this._col = 0;
  }

  /** Roll-up carriage return: scroll the window up one row and clear the base row. */
  protected _carriageReturn() {
    const base = this._baseRow,
      top = Math.max(0, base - this._rollUpRows + 1);

    for (let r = top; r < base; r++) copyRow(this._displayed, r + 1, r);
    clearRow(this._displayed, base);

    this._row = base;
    this._col = 0;
    this._markDirty();
  }

  /** Relocate the roll-up window when a PAC changes the base row. */
  protected _moveRollUpWindow(delta: number) {
    if (!delta) return;

    const screen = this._displayed,
      chars = screen.chars.slice(),
      styles = screen.styles.slice();

    for (let r = 0; r < ROWS; r++) {
      const from = r - delta;
      if (from >= 0 && from < ROWS) {
        screen.chars[r] = chars[from];
        screen.styles[r] = styles[from];
      } else {
        screen.chars[r] = emptyRow('');
        screen.styles[r] = emptyRow(0);
      }
    }

    this._markDirty();
    this._flush();
  }

  protected _target() {
    return this._mode === Mode.PopOn ? this._hidden : this._displayed;
  }

  protected _writeChar(char: string) {
    if (this._channel !== this._selected || this._mode === Mode.Text) return;

    const screen = this._target(),
      col = Math.min(this._col, COLS - 1);

    screen.chars[this._row][col] = char;
    screen.styles[this._row][col] = this._style;

    if (this._col < COLS) this._col++;
    if (screen === this._displayed) this._markDirty();
  }

  /** Extended characters replace the basic-character placeholder that precedes them. */
  protected _writeExtended(char: string) {
    this._backspace();
    this._writeChar(char);
  }

  protected _backspace() {
    if (this._col <= 0) return;
    this._col--;
    const screen = this._target();
    clearCell(screen, this._row, this._col);
    if (screen === this._displayed) this._markDirty();
  }

  protected _markDirty() {
    if (this._dirty) return;
    this._dirty = true;
    this._dirtyTime = this._time;
  }

  /** Commit any pending change to the displayed memory as a cue boundary. */
  protected _flush() {
    if (!this._dirty) return;
    this._dirty = false;

    const time = this._dirtyTime,
      content = readScreen(this._displayed),
      key = content ? content.line + '|' + content.position + '|' + content.text : '';

    // Identical displayed content, keep the current cue going.
    if (this._cue && key === this._cueKey) return;

    this._closeCue(time);

    if (content) {
      const cue = new VTTCue(time, time, content.text);
      cue.snapToLines = false;
      cue.line = content.line;
      cue.lineAlign = 'start';
      cue.position = content.position;
      cue.positionAlign = 'line-left';
      cue.size = 100 - content.position;
      cue.align = 'left';
      this._cue = cue;
      this._cueKey = key;
    }
  }

  protected _closeCue(endTime: number) {
    const cue = this._cue;
    if (!cue) return;
    this._cue = null;
    this._cueKey = '';
    if (endTime <= cue.startTime) return;
    cue.endTime = endTime;
    this._cues.push(cue);
    this._init.onCue?.(cue);
  }

  protected _handleError(
    code: (typeof ParseErrorCode)[keyof typeof ParseErrorCode],
    reason: string,
    line: number,
  ) {
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

function emptyRow<T>(value: T): T[] {
  const row: T[] = [];
  for (let c = 0; c < COLS; c++) row.push(value);
  return row;
}

function createScreen(): Screen {
  const screen: Screen = { chars: [], styles: [] };
  for (let r = 0; r < ROWS; r++) {
    screen.chars.push(emptyRow(''));
    screen.styles.push(emptyRow(0));
  }
  return screen;
}

function clearCell(screen: Screen, row: number, col: number) {
  screen.chars[row][col] = '';
  screen.styles[row][col] = 0;
}

function clearRow(screen: Screen, row: number) {
  for (let c = 0; c < COLS; c++) clearCell(screen, row, c);
}

function clearScreen(screen: Screen) {
  for (let r = 0; r < ROWS; r++) clearRow(screen, r);
}

function copyRow(screen: Screen, from: number, to: number) {
  for (let c = 0; c < COLS; c++) {
    screen.chars[to][c] = screen.chars[from][c];
    screen.styles[to][c] = screen.styles[from][c];
  }
}

/** Convert the displayed memory into WebVTT cue text and positioning, or `null` if empty. */
function readScreen(screen: Screen): ScreenContent | null {
  let topRow = -1,
    leftCol = 0;

  const lines: string[] = [];

  for (let r = 0; r < ROWS; r++) {
    const chars = screen.chars[r];

    let start = -1,
      end = -1;

    for (let c = 0; c < COLS; c++) {
      if (chars[c] !== '' && chars[c] !== ' ') {
        if (start < 0) start = c;
        end = c;
      }
    }

    if (start < 0) continue;

    if (topRow < 0) {
      topRow = r;
      leftCol = start;
    }

    lines.push(renderRow(chars, screen.styles[r], start, end));
  }

  if (topRow < 0) return null;

  return {
    text: lines.join('\n'),
    line: (topRow / ROWS) * 100,
    position: (leftCol / COLS) * 100,
  };
}

function renderRow(chars: string[], styles: number[], start: number, end: number) {
  let text = '',
    current = -1;

  for (let c = start; c <= end; c++) {
    const char = chars[c],
      // Never-written cells continue the current run so styles are not needlessly split.
      style = char === '' ? current : styles[c];

    if (style !== current) {
      if (current >= 0) text += closeTags(current);
      text += openTags(style);
      current = style;
    }

    text += char === '' ? ' ' : char === '&' ? '&amp;' : char === '<' ? '&lt;' : char;
  }

  return text + closeTags(current);
}

function openTags(style: number) {
  const color = style & COLOR_MASK,
    bg = (style & BG_MASK) >> BG_SHIFT,
    classes: string[] = [];

  if (color) classes.push(COLORS[color]);
  if (bg) classes.push('bg_' + COLORS[bg - 1]);

  let tags = classes.length ? '<c.' + classes.join('.') + '>' : '';
  if (style & ITALICS) tags += '<i>';
  if (style & UNDERLINE) tags += '<u>';
  return tags;
}

function closeTags(style: number) {
  let tags = '';
  if (style & UNDERLINE) tags += '</u>';
  if (style & ITALICS) tags += '</i>';
  if (style & (COLOR_MASK | BG_MASK)) tags += '</c>';
  return tags;
}

/**
 * Convert a SMPTE timecode (`HH:MM:SS:FF` non-drop or `HH:MM:SS;FF` drop-frame) into a frame
 * count at 29.97 fps. Returns `null` if the timecode is invalid.
 */
export function parseSCCFrames(text: string): number | null {
  const match = TIMECODE_RE.exec(text);
  if (!match) return null;

  const hours = parseInt(match[1], 10),
    minutes = parseInt(match[2], 10),
    seconds = parseInt(match[3], 10),
    frames = parseInt(match[5], 10),
    dropFrame = match[4] !== ':';

  if (minutes >= 60 || seconds >= 60 || frames >= 30) return null;

  let total = ((hours * 60 + minutes) * 60 + seconds) * 30 + frames;

  if (dropFrame) {
    // Two frames are dropped every minute, except every tenth minute.
    const totalMinutes = hours * 60 + minutes;
    total -= 2 * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return total;
}

/**
 * Convert a SMPTE timecode (`HH:MM:SS:FF` non-drop or `HH:MM:SS;FF` drop-frame) into seconds
 * at 29.97 fps. Returns `null` if the timecode is invalid.
 */
export function parseSCCTimecode(text: string): number | null {
  const frames = parseSCCFrames(text);
  return frames === null ? null : frames / FPS;
}

/**
 * Data channel addressed by a CEA-608 control code first byte (parity already stripped): `1` for
 * CC1 (0x10-0x17), `2` for CC2 (0x18-0x1f), or `null` if the byte is not a control code.
 */
export function sccChannelOf(byte1: number): 1 | 2 | null {
  if (byte1 < 0x10 || byte1 > 0x1f) return null;
  return byte1 & CHANNEL_BIT ? 2 : 1;
}

/**
 * Convert whitespace separated 4-digit hex words into byte pairs with the parity bit stripped.
 * Malformed words are skipped.
 */
export function sccWordsToBytes(words: string): [number, number][] {
  const pairs: [number, number][] = [];
  for (const word of words.trim().split(WORD_SPLIT_RE)) {
    if (!HEX_WORD_RE.test(word)) continue;
    const value = parseInt(word, 16);
    pairs.push([(value >> 8) & 0x7f, value & 0x7f]);
  }
  return pairs;
}

export default function createSCCParser() {
  return new SCCParser();
}
