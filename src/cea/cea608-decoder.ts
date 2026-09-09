import { VTTCue } from '../vtt/vtt-cue';
import type { CCDataTriplet } from './cc-data';

/**
 * Stream-oriented CEA-608 decoder. Decodes byte pairs (from SCC files or `cc_data` carried in
 * video streams) into `VTTCue` objects by modelling the displayed and non-displayed caption
 * memories of a single data channel.
 *
 * Channels 1 and 2 (CC1/CC2) are carried on field 1, channels 3 and 4 (CC3/CC4) on field 2. Within
 * a field, bit 3 of a control code's first byte selects the channel.
 *
 * @see {@link https://en.wikipedia.org/wiki/EIA-608}
 */

export interface CEA608DecoderOptions {
  /**
   * Data channel to decode: `1` (CC1) or `2` (CC2) on field 1, `3` (CC3) or `4` (CC4) on field 2.
   *
   * @defaultValue 1
   */
  channel?: 1 | 2 | 3 | 4;
  /**
   * Emit cues as soon as their content is displayed rather than once it is cleared. Live cues are
   * created with `endTime = Infinity`, delivered through `onCue`, and mutated in place (then
   * reported through `onCueUpdate`) when their end time becomes known.
   *
   * @defaultValue false
   */
  live?: boolean;
  /**
   * Invoked as each cue is completed (its end time is known). In live mode, invoked as soon as the
   * cue starts instead.
   */
  onCue?(cue: VTTCue): void;
  /**
   * Live mode only: invoked when a cue previously delivered through `onCue` receives its end
   * time. A cue that ends the moment it starts is removed from `cues` and reported here with
   * `endTime === startTime`.
   */
  onCueUpdate?(cue: VTTCue): void;
}

const FPS = 29.97,
  FRAME = 1 / FPS,
  ROWS = 15,
  COLS = 32;

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
 * clear for CC1/CC3 (0x10-0x17), set for CC2/CC4 (0x18-0x1f). Masking it off maps a second-channel
 * code onto its first-channel equivalent so a single decode path serves both channels.
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

export class CEA608Decoder {
  /** All cues emitted so far, in order of completion (order of start in live mode). */
  readonly cues: VTTCue[] = [];

  protected _onCue: CEA608DecoderOptions['onCue'];
  protected _onCueUpdate: CEA608DecoderOptions['onCueUpdate'];
  protected _live: boolean;
  /** Field the selected channel is carried on. */
  protected _field: 1 | 2;
  /** Channel within the field selected for decoding (`1` for CC1/CC3, `2` for CC2/CC4). */
  protected _selected: 1 | 2;
  /** Channel most recently addressed by a control code, which owns following characters. */
  protected _channel: 1 | 2 = 1;
  protected _cue: VTTCue | null = null;
  protected _cueKey = '';
  protected _displayed = createScreen();
  protected _hidden = createScreen();
  protected _mode = Mode.PopOn;
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

  constructor(options: CEA608DecoderOptions = {}) {
    const channel = options.channel ?? 1;
    this._onCue = options.onCue;
    this._onCueUpdate = options.onCueUpdate;
    this._live = options.live ?? false;
    this._field = channel >= 3 ? 2 : 1;
    this._selected = channel === 2 || channel === 4 ? 2 : 1;
  }

  /**
   * Decode a single byte pair received at `time` (seconds) on the given field. The odd parity bit
   * may be present or already stripped. Pairs on the field that does not carry the selected channel
   * are ignored.
   *
   * Changes to the displayed memory made by characters are not committed as cue boundaries until
   * `commit()` is called, so callers should invoke it at each frame boundary (`decodeCCData` does
   * this automatically).
   */
  decodePair(byte1: number, byte2: number, time: number, field: 1 | 2 = 1) {
    if (field !== this._field) return;
    this._time = this._lastTime = time;
    this._decode(byte1 & 0x7f, byte2 & 0x7f);
  }

  /**
   * Decode the `cc_data` triplets of a single frame presented at `time` (seconds). Type 0 triplets
   * are routed to field 1 and type 1 to field 2; DTVCC (CEA-708) triplets are ignored. Pending
   * changes are committed at the end of the frame.
   */
  decodeCCData(triplets: CCDataTriplet[], time: number) {
    for (const triplet of triplets) {
      if (triplet.type === 0) this.decodePair(triplet.data1, triplet.data2, time, 1);
      else if (triplet.type === 1) this.decodePair(triplet.data1, triplet.data2, time, 2);
    }
    this.commit();
  }

  /**
   * Commit any pending change to the displayed memory as a cue boundary. Identical displayed
   * content keeps the current cue going. Optionally advances the decoder clock to `time`.
   */
  commit(time?: number) {
    if (time !== undefined) this._time = this._lastTime = time;
    this._commit();
  }

  /**
   * Commit pending changes and close the open cue, if any. The cue ends at `endTime`, or by
   * default at the last decoded time (one frame after the cue started if that would make it
   * zero-length).
   */
  flush(endTime?: number) {
    this._commit();
    const cue = this._cue;
    if (!cue) return;
    if (endTime === undefined) {
      endTime = this._lastTime > cue.startTime ? this._lastTime : cue.startTime + FRAME;
    }
    this._closeCue(endTime);
  }

  /**
   * Discard all decoder state and emitted cues, including any open cue. In live mode the open cue
   * is first closed at the last decoded time so its `onCueUpdate` is delivered.
   */
  reset() {
    if (this._live) this._closeCue(this._lastTime);
    this.cues.length = 0;
    this._channel = 1;
    this._cue = null;
    this._cueKey = '';
    clearScreen(this._displayed);
    clearScreen(this._hidden);
    this._mode = Mode.PopOn;
    this._row = ROWS - 1;
    this._col = 0;
    this._style = 0;
    this._rollUpRows = 2;
    this._baseRow = ROWS - 1;
    this._lastControl = -1;
    this._dirty = false;
    this._dirtyTime = 0;
    this._time = 0;
    this._lastTime = 0;
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
        this._commit();
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
        this._commit();
        this._mode = Mode.PaintOn;
        break;
      case 0x2a: // TR - text restart
      case 0x2b: // RTD - resume text display
        this._commit();
        this._mode = Mode.Text;
        break;
      case 0x2c: // EDM - erase displayed memory
        this._commit();
        clearScreen(this._displayed);
        this._markDirty();
        this._commit();
        break;
      case 0x2d: // CR - carriage return
        if (this._mode === Mode.RollUp) this._carriageReturn();
        break;
      case 0x2e: // ENM - erase non-displayed memory
        clearScreen(this._hidden);
        break;
      case 0x2f: {
        // EOC - end of caption (flip memories)
        this._commit();
        const displayed = this._displayed;
        this._displayed = this._hidden;
        this._hidden = displayed;
        this._mode = Mode.PopOn;
        this._markDirty();
        this._commit();
        break;
      }
    }
  }

  protected _rollUp(rows: number) {
    this._commit();

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
    this._commit();

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
    this._commit();
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
  protected _commit() {
    if (!this._dirty) return;
    this._dirty = false;

    const time = this._dirtyTime,
      content = readScreen(this._displayed),
      key = content ? content.line + '|' + content.position + '|' + content.text : '';

    // Identical displayed content, keep the current cue going.
    if (this._cue && key === this._cueKey) return;

    this._closeCue(time);

    if (content) {
      const cue = new VTTCue(time, this._live ? Infinity : time, content.text);
      cue.snapToLines = false;
      cue.line = content.line;
      cue.lineAlign = 'start';
      cue.position = content.position;
      cue.positionAlign = 'line-left';
      cue.size = 100 - content.position;
      cue.align = 'left';
      this._cue = cue;
      this._cueKey = key;
      if (this._live) {
        this.cues.push(cue);
        this._onCue?.(cue);
      }
    }
  }

  protected _closeCue(endTime: number) {
    const cue = this._cue;
    if (!cue) return;
    this._cue = null;
    this._cueKey = '';
    if (this._live) {
      // Already delivered when it started. A zero-length cue would have been dropped in non-live
      // mode, so drop it here too and let the consumer know it no longer applies.
      if (endTime <= cue.startTime) {
        endTime = cue.startTime;
        const index = this.cues.lastIndexOf(cue);
        if (index >= 0) this.cues.splice(index, 1);
      }
      cue.endTime = endTime;
      this._onCueUpdate?.(cue);
      return;
    }
    if (endTime <= cue.startTime) return;
    cue.endTime = endTime;
    this.cues.push(cue);
    this._onCue?.(cue);
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
 * Channel within a field addressed by a CEA-608 control code first byte (parity already
 * stripped): `1` for CC1/CC3 (0x10-0x17), `2` for CC2/CC4 (0x18-0x1f), or `null` if the byte is
 * not a control code.
 */
export function sccChannelOf(byte1: number): 1 | 2 | null {
  if (byte1 < 0x10 || byte1 > 0x1f) return null;
  return byte1 & CHANNEL_BIT ? 2 : 1;
}
