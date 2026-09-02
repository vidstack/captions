import { VTTCue } from '../vtt/vtt-cue';
import type { CCDataTriplet } from './cc-data';

/**
 * CEA-708 (DTVCC) caption decoder. Reassembles DTVCC packets from `cc_data` triplets, extracts
 * the service blocks for a single caption service, and models the eight caption windows of that
 * service. Every visible window is emitted as its own `VTTCue`, positioned from the window anchor,
 * so multiple simultaneous windows keep their independent placement.
 *
 * @see {@link https://en.wikipedia.org/wiki/CEA-708}
 */

const MAX_WINDOWS = 8,
  MAX_ROWS = 15,
  MAX_COLS = 42,
  /** Column count that maps onto the full video width for `size`. */
  FULL_WIDTH_COLS = 32,
  /** Absolute anchor coordinate ranges (CEA-708 assumes a 75-row by 210-column 16:9 grid). */
  ANCHOR_ROWS = 75,
  ANCHOR_COLS = 210,
  /** Minimum cue duration used when `flush()` is called without a later time. */
  MIN_DURATION = 1 / 30;

// Cell style bit layout: bits 0-5 foreground RGB (2 bits per channel, blue lowest), bit 6 italics,
// bit 7 underline, bits 8-13 background RGB, bit 14 transparent background.
const FG_MASK = 0x3f,
  ITALICS = 1 << 6,
  UNDERLINE = 1 << 7,
  BG_SHIFT = 8,
  BG_MASK = 0x3f << BG_SHIFT,
  BG_TRANSPARENT = 1 << 14,
  /** White foreground on solid black background. */
  DEFAULT_STYLE = FG_MASK;

/** Two-bit colour component -> 8-bit component. */
const COMPONENTS = [0x00, 0x55, 0xaa, 0xff];

/** Window justification values from SWA / the predefined window styles. */
const enum Justify {
  Left = 0,
  Right = 1,
  Center = 2,
  Full = 3,
}

/** Predefined window styles 1-7 (index 0 unused): justification and word wrap. */
const WINDOW_STYLE_JUSTIFY = [
  Justify.Left,
  Justify.Left,
  Justify.Left,
  Justify.Center,
  Justify.Left,
  Justify.Left,
  Justify.Center,
  Justify.Left,
];
const WINDOW_STYLE_WORD_WRAP = [false, false, false, false, true, true, true, false];

const JUSTIFY_ALIGN: VTTCue['align'][] = ['left', 'right', 'center', 'left'];

/** G2 character set (after EXT1, 0x20-0x7f). Unlisted codes are undefined and dropped. */
const G2_CHARS: Record<number, string> = {
  0x20: ' ', // transparent space
  0x21: ' ', // non-breaking transparent space
  0x25: '…',
  0x2a: 'Š',
  0x2c: 'Œ',
  0x30: '█',
  0x31: '‘',
  0x32: '’',
  0x33: '“',
  0x34: '”',
  0x35: '•',
  0x39: '™',
  0x3a: 'š',
  0x3c: 'œ',
  0x3d: '℠',
  0x3f: 'Ÿ',
  0x76: '⅛',
  0x77: '⅜',
  0x78: '⅝',
  0x79: '⅞',
  0x7a: '│',
  0x7b: '┐',
  0x7c: '└',
  0x7d: '─',
  0x7e: '┘',
  0x7f: '┌',
};

/** G3 character set (after EXT1, 0xa0-0xff). Only the `[CC]` symbol is assigned. */
const G3_CHARS: Record<number, string> = {
  0xa0: '㏄',
};

/** Byte lengths (including the command byte) of the C1 control codes 0x80-0x9f. */
const C1_LENGTHS = [
  1, 1, 1, 1, 1, 1, 1, 1, // CW0-CW7
  2, 2, 2, 2, 2, // CLW, DSW, HDW, TGW, DLW
  2, 1, 1, // DLY, DLC, RST
  3, 4, 3, // SPA, SPC, SPL
  1, 1, 1, 1, // reserved
  5, // SWA
  7, 7, 7, 7, 7, 7, 7, 7, // DF0-DF7
]; // prettier-ignore

export interface CEA708DecoderOptions {
  /** Caption service to decode (1-63). Defaults to the primary caption service (1). */
  service?: number;
  /** Called every time a cue is completed (its end time is known). */
  onCue?(cue: VTTCue): void;
}

interface CaptionWindow {
  visible: boolean;
  rowLock: boolean;
  columnLock: boolean;
  priority: number;
  relative: boolean;
  anchorVertical: number;
  anchorHorizontal: number;
  anchorPoint: number;
  rowCount: number;
  columnCount: number;
  justify: Justify;
  wordWrap: boolean;
  chars: string[][];
  styles: number[][];
  penRow: number;
  penCol: number;
  style: number;
}

export class CEA708Decoder {
  protected _service: number;
  protected _onCue?: (cue: VTTCue) => void;
  protected _cues: VTTCue[] = [];
  /** Open cue per window, or `null` when the window has nothing on screen. */
  protected _windowCues: (VTTCue | null)[] = [];
  protected _windowKeys: string[] = [];
  protected _windows: (CaptionWindow | null)[] = [];
  protected _current = -1;
  /** DTVCC packet under assembly (data bytes after the header), and its expected size. */
  protected _packet: number[] | null = null;
  protected _packetSize = 0;
  protected _sequence = -1;
  /** Service bytes carried over because they end mid-command. */
  protected _pending: number[] = [];
  protected _time = 0;
  protected _lastTime = 0;

  constructor(options: CEA708DecoderOptions = {}) {
    const service = options.service ?? 1;
    this._service = service >= 1 && service <= 63 ? Math.floor(service) : 1;
    this._onCue = options.onCue;
    this._resetCues();
    this._resetState();
  }

  /** Completed cues, in the order their end times became known. */
  get cues(): VTTCue[] {
    return this._cues;
  }

  /**
   * Feed `cc_data` triplets that share a presentation time (seconds). Types 2 (continuation) and
   * 3 (packet start) are DTVCC; 608 field data (types 0/1) is ignored. Display changes are
   * committed as cue boundaries once the whole group has been processed.
   */
  decodeCCData(triplets: CCDataTriplet[], time: number) {
    this._time = this._lastTime = time;

    for (let i = 0; i < triplets.length; i++) {
      const { type, data1, data2 } = triplets[i];
      if (type === 3) {
        this._finishPacket();
        this._startPacket(data1, data2);
      } else if (type === 2 && this._packet) {
        this._packet.push(data1, data2);
        if (this._packet.length >= this._packetSize) this._finishPacket();
      }
    }

    this._commit();
  }

  /** Close any open cue. Defaults to the last decode time (or a minimum duration past start). */
  flush(endTime?: number) {
    for (let w = 0; w < MAX_WINDOWS; w++) {
      const cue = this._windowCues[w];
      if (!cue) continue;
      this._closeCue(w, endTime ?? Math.max(this._lastTime, cue.startTime + MIN_DURATION));
    }
  }

  /** Drop all decoder state and completed cues. */
  reset() {
    this._time = this._lastTime = 0;
    this._resetCues();
    this._resetState();
  }

  protected _resetCues() {
    this._cues = [];
    this._windowCues = [];
    this._windowKeys = [];
    for (let w = 0; w < MAX_WINDOWS; w++) {
      this._windowCues.push(null);
      this._windowKeys.push('');
    }
  }

  /**
   * Drop the caption service state (windows, pen, packet assembly). Open cues are kept so the
   * following commit can close them at the reset time.
   */
  protected _resetState() {
    this._windows = [];
    for (let w = 0; w < MAX_WINDOWS; w++) this._windows.push(null);
    this._current = -1;
    this._packet = null;
    this._packetSize = 0;
    this._sequence = -1;
    this._pending = [];
  }

  protected _startPacket(data1: number, data2: number) {
    const sequence = data1 >> 6,
      sizeCode = data1 & 0x3f;

    // A gap in the sequence numbers means a packet was lost, so any command straddling packets
    // cannot be completed reliably.
    if (this._sequence >= 0 && sequence !== ((this._sequence + 1) & 0x03)) {
      this._pending = [];
    }

    this._sequence = sequence;
    // The size is in 16-bit words including the header byte; 0 stands for 128 bytes.
    this._packetSize = (sizeCode === 0 ? 128 : sizeCode * 2) - 1;
    this._packet = [data2];
    if (this._packet.length >= this._packetSize) this._finishPacket();
  }

  /** Split the assembled packet into service blocks and decode the selected service. */
  protected _finishPacket() {
    const packet = this._packet;
    if (!packet) return;
    this._packet = null;

    let i = 0;
    while (i < packet.length) {
      const header = packet[i++];
      let service = header >> 5;
      const size = header & 0x1f;

      // Null service block: only padding follows.
      if (service === 0) break;
      if (service === 7) {
        if (i >= packet.length) break;
        service = packet[i++] & 0x3f;
      }

      if (service === this._service) {
        for (let b = 0; b < size && i + b < packet.length; b++) this._pending.push(packet[i + b]);
        this._decodeService();
      }

      i += size;
    }
  }

  /** Decode as many complete commands as the pending service bytes contain. */
  protected _decodeService() {
    const bytes = this._pending;

    let i = 0;
    while (i < bytes.length) {
      const length = commandLength(bytes, i);
      if (length < 0 || i + length > bytes.length) break;
      this._command(bytes, i, length);
      i += length;
    }

    this._pending = i > 0 ? bytes.slice(i) : bytes;
  }

  protected _command(bytes: number[], i: number, length: number) {
    const code = bytes[i];

    if (code < 0x20) {
      this._c0(bytes, i, length);
    } else if (code < 0x80) {
      this._writeChar(code === 0x7f ? '♪' : String.fromCharCode(code));
    } else if (code < 0xa0) {
      this._c1(bytes, i);
    } else {
      this._writeChar(String.fromCharCode(code));
    }
  }

  protected _c0(bytes: number[], i: number, length: number) {
    switch (bytes[i]) {
      case 0x08: // BS
        this._backspace();
        break;
      case 0x0c: // FF
        this._formFeed();
        break;
      case 0x0d: // CR
        this._carriageReturn();
        break;
      case 0x0e: // HCR
        this._horizontalCarriageReturn();
        break;
      case 0x10: // EXT1
        this._extended(bytes, i + 1, length - 1);
        break;
      case 0x18: // P16
        this._writeChar(String.fromCharCode((bytes[i + 1] << 8) | bytes[i + 2]));
        break;
      // NUL, ETX (display is committed at the end of the cc_data group), reserved codes.
    }
  }

  /** Extended character/command following EXT1: C2, G2, C3, or G3. */
  protected _extended(bytes: number[], i: number, length: number) {
    const code = bytes[i];
    if (code >= 0x20 && code < 0x80) {
      const char = G2_CHARS[code];
      if (char) this._writeChar(char);
    } else if (code >= 0xa0) {
      const char = G3_CHARS[code];
      if (char) this._writeChar(char);
    }
    // C2 and C3 are reserved for future use, skip them.
  }

  protected _c1(bytes: number[], i: number) {
    const code = bytes[i];

    if (code <= 0x87) {
      // CW0-CW7 - set current window
      if (this._windows[code - 0x80]) this._current = code - 0x80;
      return;
    }

    if (code >= 0x98) {
      this._defineWindow(code - 0x98, bytes, i + 1);
      return;
    }

    switch (code) {
      case 0x88: // CLW - clear windows
        this._forEachWindow(bytes[i + 1], (window) => clearWindow(window));
        break;
      case 0x89: // DSW - display windows
        this._forEachWindow(bytes[i + 1], (window) => (window.visible = true));
        break;
      case 0x8a: // HDW - hide windows
        this._forEachWindow(bytes[i + 1], (window) => (window.visible = false));
        break;
      case 0x8b: // TGW - toggle windows
        this._forEachWindow(bytes[i + 1], (window) => (window.visible = !window.visible));
        break;
      case 0x8c: // DLW - delete windows
        for (let w = 0; w < MAX_WINDOWS; w++) {
          if (!(bytes[i + 1] & (1 << w))) continue;
          this._windows[w] = null;
          if (this._current === w) this._current = -1;
        }
        break;
      case 0x8f: // RST - reset
        this._resetState();
        break;
      case 0x90: // SPA - set pen attributes
        this._setPenAttributes(bytes[i + 2]);
        break;
      case 0x91: // SPC - set pen color
        this._setPenColor(bytes[i + 1], bytes[i + 2]);
        break;
      case 0x92: // SPL - set pen location
        this._setPenLocation(bytes[i + 1] & 0x0f, bytes[i + 2] & 0x3f);
        break;
      case 0x97: // SWA - set window attributes
        this._setWindowAttributes(bytes[i + 3]);
        break;
      // DLY (delay) and DLC (delay cancel) affect timing only, which is driven by cc_data time.
    }
  }

  protected _forEachWindow(bitmap: number, callback: (window: CaptionWindow) => void) {
    for (let w = 0; w < MAX_WINDOWS; w++) {
      const window = this._windows[w];
      if (window && bitmap & (1 << w)) callback(window);
    }
  }

  /** DFx: create or redefine a window and make it current. Existing text is retained. */
  protected _defineWindow(id: number, bytes: number[], i: number) {
    const rowCount = Math.min(MAX_ROWS, (bytes[i + 3] & 0x0f) + 1),
      columnCount = Math.min(MAX_COLS, (bytes[i + 4] & 0x3f) + 1),
      windowStyle = (bytes[i + 5] >> 3) & 0x07;

    let window = this._windows[id];
    if (!window) {
      window = this._windows[id] = {
        visible: false,
        rowLock: false,
        columnLock: false,
        priority: 0,
        relative: false,
        anchorVertical: 0,
        anchorHorizontal: 0,
        anchorPoint: 0,
        rowCount,
        columnCount,
        justify: Justify.Left,
        wordWrap: false,
        chars: [],
        styles: [],
        penRow: 0,
        penCol: 0,
        style: DEFAULT_STYLE,
      };
      clearWindow(window);
    } else if (window.rowCount !== rowCount || window.columnCount !== columnCount) {
      resizeWindow(window, rowCount, columnCount);
    }

    window.visible = (bytes[i] & 0x20) !== 0;
    window.rowLock = (bytes[i] & 0x10) !== 0;
    window.columnLock = (bytes[i] & 0x08) !== 0;
    window.priority = bytes[i] & 0x07;
    window.relative = (bytes[i + 1] & 0x80) !== 0;
    window.anchorVertical = bytes[i + 1] & 0x7f;
    window.anchorHorizontal = bytes[i + 2];
    window.anchorPoint = Math.min(8, bytes[i + 3] >> 4);

    // Window style 0 means "keep the current attributes", which for a new window are style 1.
    if (windowStyle > 0) {
      window.justify = WINDOW_STYLE_JUSTIFY[windowStyle];
      window.wordWrap = WINDOW_STYLE_WORD_WRAP[windowStyle];
    }

    this._current = id;
  }

  /** SPA second byte: italics (bit 7) and underline (bit 6). Size/font/edge are not rendered. */
  protected _setPenAttributes(byte2: number) {
    const window = this._windows[this._current];
    if (!window) return;
    window.style &= ~(ITALICS | UNDERLINE);
    if (byte2 & 0x80) window.style |= ITALICS;
    if (byte2 & 0x40) window.style |= UNDERLINE;
  }

  /** SPC: opacity (2 bits) + RGB (2 bits each) for foreground and background. */
  protected _setPenColor(fg: number, bg: number) {
    const window = this._windows[this._current];
    if (!window) return;
    let style = (window.style & ~(FG_MASK | BG_MASK | BG_TRANSPARENT)) | (fg & FG_MASK);
    style |= (bg & 0x3f) << BG_SHIFT;
    // Opacity 3 is transparent.
    if (bg >> 6 === 3) style |= BG_TRANSPARENT;
    window.style = style;
  }

  protected _setPenLocation(row: number, col: number) {
    const window = this._windows[this._current];
    if (!window) return;
    window.penRow = Math.min(row, window.rowCount - 1);
    window.penCol = Math.min(col, window.columnCount - 1);
  }

  /** SWA third byte: word wrap (bit 6), print/scroll direction (ignored), justify (bits 0-1). */
  protected _setWindowAttributes(byte3: number) {
    const window = this._windows[this._current];
    if (!window) return;
    window.wordWrap = (byte3 & 0x40) !== 0;
    window.justify = byte3 & 0x03;
  }

  protected _writeChar(char: string) {
    const window = this._windows[this._current];
    if (!window) return;

    if (window.penCol >= window.columnCount) {
      // Past the right edge: wrap onto the next row, or truncate for fixed-layout windows.
      if (!window.wordWrap) return;
      this._carriageReturn();
    }

    window.chars[window.penRow][window.penCol] = char;
    window.styles[window.penRow][window.penCol] = window.style;
    window.penCol++;
  }

  protected _backspace() {
    const window = this._windows[this._current];
    if (!window || window.penCol <= 0) return;
    window.penCol--;
    window.chars[window.penRow][window.penCol] = '';
    window.styles[window.penRow][window.penCol] = DEFAULT_STYLE;
  }

  protected _formFeed() {
    const window = this._windows[this._current];
    if (!window) return;
    clearWindow(window);
  }

  /** CR: move to the start of the next row, scrolling the window up when on the last row. */
  protected _carriageReturn() {
    const window = this._windows[this._current];
    if (!window) return;

    window.penCol = 0;
    if (window.penRow < window.rowCount - 1) {
      window.penRow++;
      return;
    }

    window.chars.shift();
    window.styles.shift();
    window.chars.push(emptyRow(window.columnCount, ''));
    window.styles.push(emptyRow(window.columnCount, DEFAULT_STYLE));
  }

  /** HCR: erase the current row and return to its first column. */
  protected _horizontalCarriageReturn() {
    const window = this._windows[this._current];
    if (!window) return;
    window.chars[window.penRow] = emptyRow(window.columnCount, '');
    window.styles[window.penRow] = emptyRow(window.columnCount, DEFAULT_STYLE);
    window.penCol = 0;
  }

  /** Compare every window's visible content with its open cue and emit boundaries at `_time`. */
  protected _commit() {
    for (let w = 0; w < MAX_WINDOWS; w++) {
      const window = this._windows[w],
        text = window && window.visible ? renderWindow(window) : '',
        key = text && window ? windowKey(window, text) : '';

      // Identical content, keep the current cue going.
      if (key === this._windowKeys[w]) continue;

      this._closeCue(w, this._time);

      if (window && text) {
        const cue = new VTTCue(this._time, this._time, text);
        positionCue(cue, window);
        this._windowCues[w] = cue;
        this._windowKeys[w] = key;
      }
    }
  }

  protected _closeCue(w: number, endTime: number) {
    const cue = this._windowCues[w];
    this._windowCues[w] = null;
    this._windowKeys[w] = '';
    if (!cue || endTime <= cue.startTime) return;
    cue.endTime = endTime;
    this._cues.push(cue);
    this._onCue?.(cue);
  }
}

/**
 * Number of bytes (including the first) taken by the command starting at `bytes[i]`, or `-1`
 * when more bytes are needed to know.
 */
function commandLength(bytes: number[], i: number) {
  const code = bytes[i];

  if (code >= 0x20 && code < 0x80) return 1; // G0
  if (code >= 0xa0) return 1; // G1
  if (code >= 0x80) return C1_LENGTHS[code - 0x80];

  // C0
  if (code === 0x10) {
    // EXT1
    if (i + 1 >= bytes.length) return -1;
    const ext = bytes[i + 1];
    if (ext < 0x20) return 2 + (ext >> 3); // C2: 0, 1, 2, or 3 extra bytes
    if (ext < 0x80) return 2; // G2
    if (ext < 0x88) return 6; // C3 fixed-length
    if (ext < 0x90) return 7; // C3 fixed-length
    if (ext < 0xa0) {
      // C3 variable-length: the next byte holds the payload length.
      if (i + 2 >= bytes.length) return -1;
      return 3 + (bytes[i + 2] & 0x3f);
    }
    return 2; // G3
  }

  if (code >= 0x18) return 3; // P16 and reserved 0x19-0x1f
  if (code >= 0x11) return 2; // reserved 0x11-0x17
  return 1;
}

function emptyRow<T>(count: number, value: T): T[] {
  const row: T[] = [];
  for (let c = 0; c < count; c++) row.push(value);
  return row;
}

function clearWindow(window: CaptionWindow) {
  window.chars = [];
  window.styles = [];
  for (let r = 0; r < window.rowCount; r++) {
    window.chars.push(emptyRow(window.columnCount, ''));
    window.styles.push(emptyRow(window.columnCount, DEFAULT_STYLE));
  }
  window.penRow = 0;
  window.penCol = 0;
}

/** Change a window's grid size, keeping whatever text still fits. */
function resizeWindow(window: CaptionWindow, rowCount: number, columnCount: number) {
  const chars = window.chars,
    styles = window.styles;

  window.rowCount = rowCount;
  window.columnCount = columnCount;
  clearWindow(window);

  for (let r = 0; r < rowCount && r < chars.length; r++) {
    for (let c = 0; c < columnCount && c < chars[r].length; c++) {
      window.chars[r][c] = chars[r][c];
      window.styles[r][c] = styles[r][c];
    }
  }
}

/** Identity of a window's on-screen content, including everything that affects cue placement. */
function windowKey(window: CaptionWindow, text: string) {
  return (
    (window.relative ? 'r' : 'a') +
    window.anchorPoint +
    ':' +
    window.anchorVertical +
    ':' +
    window.anchorHorizontal +
    ':' +
    window.columnCount +
    ':' +
    window.justify +
    '|' +
    text
  );
}

/** Map the window anchor onto WebVTT line/position settings. */
function positionCue(cue: VTTCue, window: CaptionWindow) {
  const anchor = window.anchorPoint,
    vertical = window.relative
      ? window.anchorVertical
      : (window.anchorVertical / ANCHOR_ROWS) * 100,
    horizontal = window.relative
      ? window.anchorHorizontal
      : (window.anchorHorizontal / ANCHOR_COLS) * 100;

  cue.snapToLines = false;
  cue.line = Math.min(100, vertical);
  cue.lineAlign = anchor < 3 ? 'start' : anchor < 6 ? 'center' : 'end';
  cue.position = Math.min(100, horizontal);
  cue.positionAlign = anchor % 3 === 0 ? 'line-left' : anchor % 3 === 1 ? 'center' : 'line-right';
  cue.size = Math.min(100, Math.round((window.columnCount / FULL_WIDTH_COLS) * 100));
  cue.align = JUSTIFY_ALIGN[window.justify];
}

/**
 * Convert a window's text buffer into WebVTT cue text: rows joined by newlines with trailing
 * spaces trimmed, leading and trailing blank rows dropped. Returns `''` when nothing is visible.
 */
function renderWindow(window: CaptionWindow) {
  const rows: string[] = [];

  let first = -1,
    last = -1;

  for (let r = 0; r < window.rowCount; r++) {
    const chars = window.chars[r];

    let end = -1;
    for (let c = 0; c < window.columnCount; c++) {
      if (chars[c] !== '' && chars[c] !== ' ') end = c;
    }

    rows.push(end < 0 ? '' : renderRow(chars, window.styles[r], end));

    if (end >= 0) {
      if (first < 0) first = r;
      last = r;
    }
  }

  return first < 0 ? '' : rows.slice(first, last + 1).join('\n');
}

function renderRow(chars: string[], styles: number[], end: number) {
  let text = '',
    current = -1;

  for (let c = 0; c <= end; c++) {
    const char = chars[c],
      // Never-written cells continue the current run so styles are not needlessly split.
      style = char === '' ? (current < 0 ? DEFAULT_STYLE : current) : styles[c];

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
  const fg = style & FG_MASK;
  let tags = fg !== FG_MASK ? '<c.' + hexColor(fg) + '>' : '';
  if (style & ITALICS) tags += '<i>';
  if (style & UNDERLINE) tags += '<u>';
  return tags;
}

function closeTags(style: number) {
  let tags = '';
  if (style & UNDERLINE) tags += '</u>';
  if (style & ITALICS) tags += '</i>';
  if ((style & FG_MASK) !== FG_MASK) tags += '</c>';
  return tags;
}

/** 6-bit CEA-708 colour (2 bits per channel) -> `#rrggbb`. */
function hexColor(rgb: number) {
  return (
    '#' +
    hex2(COMPONENTS[(rgb >> 4) & 0x03]) +
    hex2(COMPONENTS[(rgb >> 2) & 0x03]) +
    hex2(COMPONENTS[rgb & 0x03])
  );
}

function hex2(value: number) {
  return value.toString(16).padStart(2, '0');
}
