import { VTTCue } from '../vtt/vtt-cue';
import type { CueAnimation, CueSpanStyle, CueTextStyle } from '../vtt/vtt-cue';
import type { CCDataTriplet } from './cc-data';

/**
 * CEA-708 (DTVCC) caption decoder. Reassembles DTVCC packets from `cc_data` triplets, extracts
 * the service blocks for a single caption service, and models the eight caption windows of that
 * service. Every visible window is emitted as its own `VTTCue`, positioned from the window anchor,
 * so multiple simultaneous windows keep their independent placement. Anchors are mapped onto the
 * full video area; broadcast content assumes a title-safe margin, which the renderer applies
 * through its `safeArea` option rather than the decoder.
 *
 * Window attributes (fill, border, print direction, display effect) and the dominant pen edge are
 * mapped onto `cue.textStyle` / `cue.vertical` / `cue.animations`. Per-run pen attributes become
 * cue text tags: `<c.#rrggbb>` for the foreground colour, `<i>` / `<u>`, `<c.pen-small>` /
 * `<c.pen-large>` for the pen size, and `<c.s-KEY>` spans (see `cue.spans`) when a run needs a
 * pen background that differs from the window fill or a font tag. A run has a single wrapper: when
 * a span is needed the pen size class rides along as the span's `className`. Approximations:
 *
 * - Flash opacity (fill and pen background) is not animated and rendered as solid.
 * - Font tag 7 (small caps) is `sans-serif` plus a `small-caps` class hook; the stylesheet must
 *   supply `font-variant: small-caps` for it.
 * - Left-to-right / right-to-left scroll directions shift the window contents one column instead
 *   of one row (ticker behaviour): text enters at the edge it scrolls away from. Right-to-left
 *   scroll with left-to-right print is the common ticker case; left-to-right scroll is its mirror.
 * - Predefined window style 7 (ticker tape) keeps horizontal text instead of the specified
 *   top-to-bottom print direction; it gets a full-width bottom layout and, while scrolling
 *   right-to-left, a marquee animation across the cue duration (attached when the cue closes).
 * - Right-to-left print direction keeps the text in logical order (the renderer's
 *   `unicode-bidi: plaintext` handles RTL scripts) and mirrors left/right justification.
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
  MIN_DURATION = 1 / 30,
  /** Display effect speed unit (seconds) and the floor applied to the resulting duration. */
  EFFECT_SPEED_UNIT = 0.5,
  MIN_EFFECT_DURATION = 0.1,
  /** Predefined window style whose windows are treated as tickers. */
  TICKER_STYLE = 7;

/** SPA pen sizes. */
const enum PenSize {
  Small = 0,
  Standard = 1,
  Large = 2,
}

/** SPA pen edge types (6 and 7 are reserved and treated as none). */
const enum EdgeType {
  None = 0,
  Raised = 1,
  Depressed = 2,
  Uniform = 3,
  LeftDropShadow = 4,
  RightDropShadow = 5,
}

/** SPA font tags. */
const enum FontTag {
  Default = 0,
  SmallCaps = 7,
}

/** Window justification values from SWA / the predefined window styles. */
const enum Justify {
  Left = 0,
  Right = 1,
  Center = 2,
  Full = 3,
}

/** SWA print / scroll / effect direction values. */
const enum Direction {
  LeftToRight = 0,
  RightToLeft = 1,
  TopToBottom = 2,
  BottomToTop = 3,
}

/** SWA fill / pen opacity values. */
const enum Opacity {
  Solid = 0,
  Flash = 1,
  Translucent = 2,
  Transparent = 3,
}

/** SWA display effects (3 is reserved and treated as snap). */
const enum DisplayEffect {
  Snap = 0,
  Fade = 1,
  Wipe = 2,
}

// Cell style bit layout: bits 0-5 foreground RGB (2 bits per channel, blue lowest), bit 6 italics,
// bit 7 underline, bits 8-13 background RGB, bits 14-15 background opacity, bits 16-17 pen size,
// bits 18-20 edge type, bits 21-26 edge RGB, bits 27-29 font tag.
const FG_MASK = 0x3f,
  ITALICS = 1 << 6,
  UNDERLINE = 1 << 7,
  BG_SHIFT = 8,
  BG_MASK = 0x3f << BG_SHIFT,
  BG_OPACITY_SHIFT = 14,
  BG_OPACITY_MASK = 0x03 << BG_OPACITY_SHIFT,
  SIZE_SHIFT = 16,
  SIZE_MASK = 0x03 << SIZE_SHIFT,
  EDGE_SHIFT = 18,
  EDGE_MASK = 0x07 << EDGE_SHIFT,
  EDGE_COLOR_SHIFT = 21,
  EDGE_COLOR_MASK = 0x3f << EDGE_COLOR_SHIFT,
  FONT_SHIFT = 27,
  FONT_MASK = 0x07 << FONT_SHIFT,
  /** White foreground on solid black background, standard size, no edge, default font. */
  DEFAULT_STYLE = FG_MASK | (PenSize.Standard << SIZE_SHIFT);

/** Two-bit colour component -> 8-bit component. */
const COMPONENTS = [0x00, 0x55, 0xaa, 0xff];

/** Predefined window styles 1-7 (index 0 unused): justification, word wrap, fill opacity. */
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
const WINDOW_STYLE_FILL_OPACITY = [
  Opacity.Solid,
  Opacity.Solid,
  Opacity.Transparent,
  Opacity.Solid,
  Opacity.Solid,
  Opacity.Transparent,
  Opacity.Solid,
  Opacity.Solid,
];

const JUSTIFY_ALIGN: VTTCue['align'][] = ['left', 'right', 'center', 'left'];

/** Print direction -> cue `vertical`. Vertical print directions stack lines like TTML `tb` modes. */
const PRINT_VERTICAL: VTTCue['vertical'][] = ['', '', 'lr', 'rl'];

/** Anchor component (0 start / 1 middle / 2 end) -> line and position alignment. */
const LINE_ALIGNS: VTTCue['lineAlign'][] = ['start', 'center', 'end'],
  POSITION_ALIGNS: VTTCue['positionAlign'][] = ['line-left', 'center', 'line-right'];

/** Fill / pen background opacity -> CSS alpha. Flash is not animated and rendered as solid. */
const FILL_ALPHA = [1, 1, 0.5, 0];

/**
 * SPA font tag -> CSS font family. Tag 0 (default) is unset; 7 (small caps) is a sans-serif with
 * the `small-caps` class hook.
 */
const FONT_FAMILIES = [
  '',
  '"Courier New", Courier, monospace', // monospaced serif
  '"Times New Roman", serif', // proportional serif
  '"Lucida Console", Monaco, monospace', // monospaced sans-serif
  'Arial, Helvetica, sans-serif', // proportional sans-serif
  '"Comic Sans MS", "Chalkboard SE", casual, sans-serif', // casual
  '"Brush Script MT", cursive', // cursive
  'sans-serif', // small caps
];

/**
 * Wipe effect direction -> `clip-path` hiding the whole box on the side the wipe reveals last.
 * Inset order is top, right, bottom, left.
 */
const WIPE_HIDDEN = [
  'inset(0 100% 0 0)', // left-to-right: revealed from the left, so the right is hidden
  'inset(0 0 0 100%)', // right-to-left
  'inset(0 0 100% 0)', // top-to-bottom
  'inset(100% 0 0 0)', // bottom-to-top
];

/** Cue-box layout for ticker windows: one full-width row along the bottom edge. */
const TICKER_LAYOUT = { left: 0, bottom: 0, width: 100 };

/** G2 character set (after EXT1, 0x20-0x7f). Unlisted codes are undefined and dropped. */
const G2_CHARS: Record<number, string> = {
  0x20: ' ', // transparent space
  0x21: ' ', // non-breaking transparent space
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
  /**
   * Emit cues as soon as their window is displayed rather than once it is hidden or changed. Live
   * cues are created with `endTime = Infinity`, delivered through `onCue`, and mutated in place
   * (then reported through `onCueUpdate`) when their end time becomes known.
   *
   * @defaultValue false
   */
  live?: boolean;
  /**
   * Called every time a cue is completed (its end time is known). In live mode, called as soon as
   * the cue starts instead.
   */
  onCue?(cue: VTTCue): void;
  /**
   * Live mode only: called when a cue previously delivered through `onCue` receives its end time.
   * A cue that ends the moment it starts is removed from `cues` and reported here with
   * `endTime === startTime`.
   */
  onCueUpdate?(cue: VTTCue): void;
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
  printDirection: Direction;
  scrollDirection: Direction;
  /** 6-bit fill RGB and its opacity. */
  fillColor: number;
  fillOpacity: Opacity;
  /** Border type (0 none, 1 raised, 2 depressed, 3 uniform, 4/5 shadow) and 6-bit RGB. */
  borderType: number;
  borderColor: number;
  displayEffect: DisplayEffect;
  effectDirection: Direction;
  /** Display effect speed in 0.5 s units. */
  effectSpeed: number;
  /** The window was just displayed: the next cue created for it carries the display effect. */
  effectPending: boolean;
  /** Defined with predefined window style 7 (ticker tape). */
  ticker: boolean;
  chars: string[][];
  styles: number[][];
  penRow: number;
  penCol: number;
  style: number;
}

/** Cue text tags wrapping one run of identically styled characters. */
interface Run {
  open: string;
  close: string;
}

/** Per-window state for resolving cell styles into runs. */
interface RunContext {
  /** Window fill as `rgba()`; pen backgrounds equal to it need no span. */
  fill: string;
  /** Font tags are per run (`true`) or hoisted onto the cue text style (`false`). */
  spanFont: boolean;
  spans: Record<string, CueSpanStyle>;
  runs: Map<number, Run>;
}

interface RenderedWindow {
  text: string;
  spans?: Record<string, CueSpanStyle>;
  /** Font tag shared by every written character, `0` for none, `-1` when mixed. */
  font: number;
}

const BLANK_RUN: Run = { open: '', close: '' };

export class CEA708Decoder {
  protected _service: number;
  protected _onCue?: (cue: VTTCue) => void;
  protected _onCueUpdate?: (cue: VTTCue) => void;
  protected _live: boolean;
  protected _cues: VTTCue[] = [];
  /** Open cue per window, or `null` when the window has nothing on screen. */
  protected _windowCues: (VTTCue | null)[] = [];
  protected _windowKeys: string[] = [];
  /** The open cue is a right-to-left ticker: attach the marquee once its duration is known. */
  protected _windowMarquee: boolean[] = [];
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
    this._onCueUpdate = options.onCueUpdate;
    this._live = options.live ?? false;
    this._resetCues();
    this._resetState();
  }

  /** Completed cues, in the order their end times became known (start order in live mode). */
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

  /**
   * Drop all decoder state and completed cues. In live mode the open cues are first closed at the
   * last decoded time so their `onCueUpdate` is delivered.
   */
  reset() {
    if (this._live) {
      for (let w = 0; w < MAX_WINDOWS; w++) this._closeCue(w, this._lastTime);
    }
    this._time = this._lastTime = 0;
    this._resetCues();
    this._resetState();
  }

  protected _resetCues() {
    this._cues = [];
    this._windowCues = [];
    this._windowKeys = [];
    this._windowMarquee = [];
    for (let w = 0; w < MAX_WINDOWS; w++) {
      this._windowCues.push(null);
      this._windowKeys.push('');
      this._windowMarquee.push(false);
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
  protected _extended(bytes: number[], i: number, _length: number) {
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
        this._forEachWindow(bytes[i + 1], (window) => setVisible(window, true));
        break;
      case 0x8a: // HDW - hide windows
        this._forEachWindow(bytes[i + 1], (window) => setVisible(window, false));
        break;
      case 0x8b: // TGW - toggle windows
        this._forEachWindow(bytes[i + 1], (window) => setVisible(window, !window.visible));
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
        this._setPenAttributes(bytes[i + 1], bytes[i + 2]);
        break;
      case 0x91: // SPC - set pen color
        this._setPenColor(bytes[i + 1], bytes[i + 2], bytes[i + 3]);
        break;
      case 0x92: // SPL - set pen location
        this._setPenLocation(bytes[i + 1] & 0x0f, bytes[i + 2] & 0x3f);
        break;
      case 0x97: // SWA - set window attributes
        this._setWindowAttributes(bytes[i + 1], bytes[i + 2], bytes[i + 3], bytes[i + 4]);
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
        printDirection: Direction.LeftToRight,
        scrollDirection: Direction.BottomToTop,
        fillColor: 0,
        fillOpacity: Opacity.Solid,
        borderType: 0,
        borderColor: 0,
        displayEffect: DisplayEffect.Snap,
        effectDirection: Direction.LeftToRight,
        effectSpeed: 0,
        effectPending: false,
        ticker: false,
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

    setVisible(window, (bytes[i] & 0x20) !== 0);
    window.rowLock = (bytes[i] & 0x10) !== 0;
    window.columnLock = (bytes[i] & 0x08) !== 0;
    window.priority = bytes[i] & 0x07;
    window.relative = (bytes[i + 1] & 0x80) !== 0;
    window.anchorVertical = bytes[i + 1] & 0x7f;
    window.anchorHorizontal = bytes[i + 2];
    window.anchorPoint = Math.min(8, bytes[i + 3] >> 4);

    // Window style 0 means "keep the current attributes", which for a new window are style 1.
    if (windowStyle > 0) applyWindowStyle(window, windowStyle);

    this._current = id;
  }

  /**
   * SPA: pen size (byte 1 bits 0-1), italics (byte 2 bit 7), underline (bit 6), edge type
   * (bits 5-3), and font tag (bits 2-0). Text tag and offset are not rendered.
   */
  protected _setPenAttributes(byte1: number, byte2: number) {
    const window = this._windows[this._current];
    if (!window) return;

    let size = byte1 & 0x03,
      edge = (byte2 >> 3) & 0x07;
    const font = byte2 & 0x07;
    if (size > PenSize.Large) size = PenSize.Standard; // reserved
    if (edge > EdgeType.RightDropShadow) edge = EdgeType.None; // reserved

    let style = window.style & ~(ITALICS | UNDERLINE | SIZE_MASK | EDGE_MASK | FONT_MASK);
    if (byte2 & 0x80) style |= ITALICS;
    if (byte2 & 0x40) style |= UNDERLINE;
    window.style = style | (size << SIZE_SHIFT) | (edge << EDGE_SHIFT) | (font << FONT_SHIFT);
  }

  /**
   * SPC: opacity (2 bits) + RGB (2 bits each) for foreground and background, then the edge RGB.
   * The foreground opacity is not rendered. The background is stored per character and rendered
   * as a span wherever it differs from the window fill.
   */
  protected _setPenColor(fg: number, bg: number, edge: number) {
    const window = this._windows[this._current];
    if (!window) return;
    let style =
      (window.style & ~(FG_MASK | BG_MASK | BG_OPACITY_MASK | EDGE_COLOR_MASK)) | (fg & FG_MASK);
    style |= (bg & 0x3f) << BG_SHIFT;
    style |= (bg >> 6) << BG_OPACITY_SHIFT;
    style |= (edge & 0x3f) << EDGE_COLOR_SHIFT;
    window.style = style;
  }

  protected _setPenLocation(row: number, col: number) {
    const window = this._windows[this._current];
    if (!window) return;
    window.penRow = Math.min(row, window.rowCount - 1);
    window.penCol = Math.min(col, window.columnCount - 1);
  }

  /**
   * SWA: fill opacity + RGB (byte 1), border type low bits + border RGB (byte 2), border type
   * high bit / word wrap / print direction / scroll direction / justify (byte 3), display effect /
   * effect direction / effect speed (byte 4).
   */
  protected _setWindowAttributes(byte1: number, byte2: number, byte3: number, byte4: number) {
    const window = this._windows[this._current];
    if (!window) return;

    window.fillOpacity = byte1 >> 6;
    window.fillColor = byte1 & 0x3f;
    window.borderType = (byte2 >> 6) | ((byte3 & 0x80) >> 5);
    window.borderColor = byte2 & 0x3f;
    window.wordWrap = (byte3 & 0x40) !== 0;
    window.printDirection = (byte3 >> 4) & 0x03;
    window.scrollDirection = (byte3 >> 2) & 0x03;
    window.justify = byte3 & 0x03;
    window.displayEffect = byte4 >> 6;
    window.effectDirection = (byte4 >> 4) & 0x03;
    window.effectSpeed = byte4 & 0x0f;
  }

  protected _writeChar(char: string) {
    const window = this._windows[this._current];
    if (!window) return;

    if (window.penCol >= window.columnCount) {
      if (isHorizontalScroll(window)) {
        // Ticker: make room by shifting the existing text one column along.
        scrollColumns(window);
      } else if (!window.wordWrap) {
        // Past the right edge of a fixed-layout window: truncate.
        return;
      } else if (char === ' ') {
        // A space at the boundary is consumed by the line break itself.
        this._carriageReturn();
        return;
      } else {
        this._wrapWord();
      }
    }

    window.chars[window.penRow][window.penCol] = char;
    window.styles[window.penRow][window.penCol] = window.style;
    window.penCol++;
  }

  /**
   * Word wrap at the right edge: carry the unfinished word (everything after the last space on
   * the row) onto the next row. Without a space to break at, the row breaks mid-word.
   */
  protected _wrapWord() {
    const window = this._windows[this._current]!,
      row = window.chars[window.penRow],
      rowStyles = window.styles[window.penRow];

    let start = -1;
    for (let c = window.columnCount - 1; c >= 0; c--) {
      if (row[c] === ' ' || row[c] === '') {
        start = c + 1;
        break;
      }
    }

    if (start < 0 || start >= window.columnCount) {
      this._carriageReturn();
      return;
    }

    const word = row.slice(start),
      wordStyles = rowStyles.slice(start);
    for (let c = start; c < window.columnCount; c++) {
      row[c] = '';
      rowStyles[c] = DEFAULT_STYLE;
    }

    this._carriageReturn();

    const target = window.chars[window.penRow],
      targetStyles = window.styles[window.penRow];
    for (let c = 0; c < word.length; c++) {
      target[c] = word[c];
      targetStyles[c] = wordStyles[c];
    }
    window.penCol = word.length;
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

  /**
   * CR: move to the start of the next row in the scroll direction, scrolling the window when the
   * pen is already on the last row. Bottom-to-top (the default) fills downwards and scrolls rows
   * up; top-to-bottom fills upwards and scrolls rows down, dropping the bottom row. The horizontal
   * scroll directions have no "next row": they shift the contents one column along and return the
   * pen to the entry column (see `scrollColumns`).
   */
  protected _carriageReturn() {
    const window = this._windows[this._current];
    if (!window) return;

    if (isHorizontalScroll(window)) {
      scrollColumns(window);
      return;
    }

    window.penCol = 0;

    if (window.scrollDirection === Direction.TopToBottom) {
      if (window.penRow > 0) {
        window.penRow--;
        return;
      }
      window.chars.pop();
      window.styles.pop();
      window.chars.unshift(emptyRow(window.columnCount, ''));
      window.styles.unshift(emptyRow(window.columnCount, DEFAULT_STYLE));
      return;
    }

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
        rendered = window && window.visible ? renderWindow(window) : null,
        text = rendered ? rendered.text : '',
        textStyle = window && rendered && text ? windowTextStyle(window, rendered.font) : undefined,
        key = window && rendered && text ? windowKey(window, rendered, textStyle) : '';

      // Identical content, keep the current cue going. The display effect only applies to a new
      // cue, so it lapses unless the window is still waiting for its first text.
      if (key === this._windowKeys[w]) {
        if (window && (text || !window.visible)) window.effectPending = false;
        continue;
      }

      this._closeCue(w, this._time);

      if (window && rendered && text) {
        const cue = new VTTCue(this._time, this._live ? Infinity : this._time, text);
        positionCue(cue, window);
        if (textStyle) cue.textStyle = textStyle;
        if (rendered.spans) cue.spans = rendered.spans;
        if (window.effectPending) {
          window.effectPending = false;
          const animation = displayAnimation(window);
          if (animation) cue.animations = [animation];
        }
        this._windowCues[w] = cue;
        this._windowKeys[w] = key;
        this._windowMarquee[w] = window.ticker && window.scrollDirection === Direction.RightToLeft;
        if (this._live) {
          this._cues.push(cue);
          this._onCue?.(cue);
        }
      }
    }
  }

  protected _closeCue(w: number, endTime: number) {
    const cue = this._windowCues[w],
      marquee = this._windowMarquee[w];
    this._windowCues[w] = null;
    this._windowKeys[w] = '';
    this._windowMarquee[w] = false;
    if (!cue) return;
    if (this._live) {
      // Already delivered when it started. A zero-length cue would have been dropped in non-live
      // mode, so drop it here too and let the consumer know it no longer applies.
      if (endTime <= cue.startTime) {
        endTime = cue.startTime;
        const index = this._cues.lastIndexOf(cue);
        if (index >= 0) this._cues.splice(index, 1);
      }
      cue.endTime = endTime;
      if (marquee) addMarquee(cue);
      this._onCueUpdate?.(cue);
      return;
    }
    if (endTime <= cue.startTime) return;
    cue.endTime = endTime;
    if (marquee) addMarquee(cue);
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

/** Show or hide a window; becoming visible arms the display effect for the next cue. */
function setVisible(window: CaptionWindow, visible: boolean) {
  if (visible && !window.visible) window.effectPending = true;
  window.visible = visible;
}

function isHorizontalScroll(window: CaptionWindow) {
  return (
    window.scrollDirection === Direction.LeftToRight ||
    window.scrollDirection === Direction.RightToLeft
  );
}

/**
 * Column scroll for the horizontal scroll directions: every row shifts one column in the scroll
 * direction, the column that falls off the far edge is lost, and the pen returns to the entry
 * column that the shift freed (the last column for right-to-left, the first for left-to-right).
 * Writing past the right edge and CR both scroll this way, so text streams in from the entry edge
 * like a ticker.
 */
function scrollColumns(window: CaptionWindow) {
  const rtl = window.scrollDirection === Direction.RightToLeft;
  for (let r = 0; r < window.rowCount; r++) {
    const chars = window.chars[r],
      styles = window.styles[r];
    if (rtl) {
      chars.shift();
      styles.shift();
      chars.push('');
      styles.push(DEFAULT_STYLE);
    } else {
      chars.pop();
      styles.pop();
      chars.unshift('');
      styles.unshift(DEFAULT_STYLE);
    }
  }
  window.penCol = rtl ? window.columnCount - 1 : 0;
}

/**
 * Apply predefined window style 1-7. All styles print left-to-right, snap on, and have no border;
 * styles 2 and 5 have a transparent fill. Styles 1-6 scroll bottom-to-top. Style 7 ("ticker
 * tape") is specified with a top-to-bottom print direction and right-to-left scroll; the scroll
 * direction is honoured (column scrolling plus a marquee animation) but the text stays horizontal,
 * as real-world tickers are.
 */
function applyWindowStyle(window: CaptionWindow, style: number) {
  window.ticker = style === TICKER_STYLE;
  window.justify = WINDOW_STYLE_JUSTIFY[style];
  window.wordWrap = WINDOW_STYLE_WORD_WRAP[style];
  window.printDirection = Direction.LeftToRight;
  window.scrollDirection = window.ticker ? Direction.RightToLeft : Direction.BottomToTop;
  window.fillColor = 0;
  window.fillOpacity = WINDOW_STYLE_FILL_OPACITY[style];
  window.borderType = 0;
  window.borderColor = 0;
  window.displayEffect = DisplayEffect.Snap;
  window.effectDirection = Direction.LeftToRight;
  window.effectSpeed = 0;
}

/** Identity of a window's on-screen content, including everything that affects cue placement. */
function windowKey(
  window: CaptionWindow,
  rendered: RenderedWindow,
  textStyle: CueTextStyle | undefined,
) {
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
    ':' +
    window.printDirection +
    ':' +
    window.scrollDirection +
    (window.ticker ? 't' : '') +
    ':' +
    (textStyle ? JSON.stringify(textStyle) : '') +
    ':' +
    (rendered.spans ? JSON.stringify(rendered.spans) : '') +
    '|' +
    rendered.text
  );
}

/** Map the window anchor and print direction onto WebVTT line/position/vertical settings. */
function positionCue(cue: VTTCue, window: CaptionWindow) {
  const anchor = window.anchorPoint,
    // Anchor points number 0-8 across a 3x3 grid: top/middle/bottom rows, left/center/right columns.
    anchorRow = Math.floor(anchor / 3),
    anchorCol = anchor % 3,
    vertical = Math.min(
      100,
      window.relative ? window.anchorVertical : (window.anchorVertical / ANCHOR_ROWS) * 100,
    ),
    horizontal = Math.min(
      100,
      window.relative ? window.anchorHorizontal : (window.anchorHorizontal / ANCHOR_COLS) * 100,
    ),
    writingMode = PRINT_VERTICAL[window.printDirection];

  cue.snapToLines = false;
  cue.vertical = writingMode;

  // WebVTT `position`/`size` run along the inline axis and `line` along the block axis. For
  // vertical print directions the axes swap, as they do for TTML vertical writing modes.
  if (writingMode) {
    cue.line = horizontal;
    cue.lineAlign = LINE_ALIGNS[anchorCol];
    cue.position = vertical;
    cue.positionAlign = POSITION_ALIGNS[anchorRow];
  } else {
    cue.line = vertical;
    cue.lineAlign = LINE_ALIGNS[anchorRow];
    cue.position = horizontal;
    cue.positionAlign = POSITION_ALIGNS[anchorCol];
  }

  cue.size = Math.min(100, Math.round((window.columnCount / FULL_WIDTH_COLS) * 100));

  // Justification is relative to the print direction, so left/right swap for right-to-left.
  let align = JUSTIFY_ALIGN[window.justify];
  if (window.printDirection === Direction.RightToLeft) {
    if (align === 'left') align = 'right';
    else if (align === 'right') align = 'left';
  }
  cue.align = align;

  // Tickers run along the bottom edge at full width regardless of their anchor.
  if (window.ticker) cue.layout = { ...TICKER_LAYOUT };
}

/**
 * Marquee for a right-to-left ticker: the cue box travels from just off the right edge to just off
 * the left edge over the cue's lifetime. Needs the final end time, so it is attached on close.
 */
function addMarquee(cue: VTTCue) {
  const duration = cue.endTime - cue.startTime;
  if (!(duration > 0) || !Number.isFinite(duration)) return;
  const animation: CueAnimation = {
    target: 'display',
    duration,
    keyframes: [{ left: '100%' }, { left: '-100%' }],
  };
  cue.animations = cue.animations ? [...cue.animations, animation] : [animation];
}

/**
 * Window fill, border, dominant pen edge, and window-wide font as cue text styling. The default
 * solid black fill is left unset so the renderer's (user-configurable) background applies. Returns
 * `undefined` when nothing deviates from the defaults.
 */
function windowTextStyle(window: CaptionWindow, font: number): CueTextStyle | undefined {
  const style: CueTextStyle = {};
  let any = false;

  if (window.fillColor !== 0 || window.fillOpacity >= Opacity.Translucent) {
    style.backgroundColor = rgbaColor(window.fillColor, FILL_ALPHA[window.fillOpacity]);
    any = true;
  }

  if (window.borderType !== 0) {
    style.outline = '0.08em solid ' + hexColor(window.borderColor);
    any = true;
  }

  const edge = dominantEdge(window);
  if (edge > 0) {
    const color = hexColor((edge & EDGE_COLOR_MASK) >> EDGE_COLOR_SHIFT);
    switch ((edge & EDGE_MASK) >> EDGE_SHIFT) {
      case EdgeType.Uniform:
        style.textStroke = '0.08em ' + color;
        break;
      case EdgeType.Raised:
        style.textShadow = '-0.04em -0.04em 0 ' + color;
        break;
      case EdgeType.Depressed:
        style.textShadow = '0.04em 0.04em 0 ' + color;
        break;
      case EdgeType.LeftDropShadow:
        style.textShadow = '-0.06em 0.06em 0.06em ' + color;
        break;
      case EdgeType.RightDropShadow:
        style.textShadow = '0.06em 0.06em 0.06em ' + color;
        break;
    }
    any = true;
  }

  // A font shared by the whole window is hoisted here instead of wrapping every run in a span.
  if (font > 0) {
    style.fontFamily = FONT_FAMILIES[font];
    if (font === FontTag.SmallCaps) style.className = 'small-caps';
    any = true;
  }

  return any ? style : undefined;
}

/**
 * Cell style of the first written character with a non-none edge type, or `0` when no character
 * in the window has an edge. Edges are rendered per cue, so the first one seen wins.
 */
function dominantEdge(window: CaptionWindow) {
  for (let r = 0; r < window.rowCount; r++) {
    const chars = window.chars[r],
      styles = window.styles[r];
    for (let c = 0; c < window.columnCount; c++) {
      if (chars[c] !== '' && styles[c] & EDGE_MASK) return styles[c];
    }
  }
  return 0;
}

/**
 * Font tag shared by every written character in the window: `0` when all use the default font,
 * `-1` when they differ (fonts are then applied per run).
 */
function windowFont(window: CaptionWindow) {
  let font = -2;
  for (let r = 0; r < window.rowCount; r++) {
    const chars = window.chars[r],
      styles = window.styles[r];
    for (let c = 0; c < window.columnCount; c++) {
      if (chars[c] === '') continue;
      const cellFont = (styles[c] & FONT_MASK) >> FONT_SHIFT;
      if (font === -2) font = cellFont;
      else if (font !== cellFont) return -1;
    }
  }
  return font < 0 ? 0 : font;
}

/**
 * Media-synchronised animation for the window's display effect, or `undefined` for snap. Fade
 * ramps the opacity; wipe reveals the box with a moving `clip-path` inset from the effect
 * direction. The duration is `effect_speed` half-seconds, at least `MIN_EFFECT_DURATION`.
 */
function displayAnimation(window: CaptionWindow): CueAnimation | undefined {
  const effect = window.displayEffect;
  if (effect !== DisplayEffect.Fade && effect !== DisplayEffect.Wipe) return;
  const duration = Math.max(MIN_EFFECT_DURATION, window.effectSpeed * EFFECT_SPEED_UNIT);
  return {
    target: 'display',
    duration,
    keyframes:
      effect === DisplayEffect.Fade
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ clipPath: WIPE_HIDDEN[window.effectDirection] }, { clipPath: 'inset(0)' }],
  };
}

/**
 * Convert a window's text buffer into WebVTT cue text: rows joined by newlines with trailing
 * spaces trimmed, leading and trailing blank rows dropped. Returns an empty `text` when nothing is
 * visible. Runs that need a per-run style are referenced through `spans`.
 */
function renderWindow(window: CaptionWindow): RenderedWindow {
  const font = windowFont(window),
    context: RunContext = {
      fill: rgbaColor(window.fillColor, FILL_ALPHA[window.fillOpacity]),
      spanFont: font < 0,
      spans: {},
      runs: new Map(),
    },
    rows: string[] = [];

  let first = -1,
    last = -1;

  for (let r = 0; r < window.rowCount; r++) {
    const chars = window.chars[r];

    let end = -1;
    for (let c = 0; c < window.columnCount; c++) {
      if (chars[c] !== '' && chars[c] !== ' ') end = c;
    }

    rows.push(end < 0 ? '' : renderRow(chars, window.styles[r], end, context));

    if (end >= 0) {
      if (first < 0) first = r;
      last = r;
    }
  }

  const text = first < 0 ? '' : rows.slice(first, last + 1).join('\n');
  return {
    text,
    spans: text && Object.keys(context.spans).length ? context.spans : undefined,
    font,
  };
}

function renderRow(chars: string[], styles: number[], end: number, context: RunContext) {
  let text = '',
    current = BLANK_RUN;

  for (let c = 0; c <= end; c++) {
    const char = chars[c],
      // Never-written cells continue the current run so styles are not needlessly split; leading
      // ones carry no pen background at all.
      run = char === '' ? current : runFor(styles[c], context);

    // Distinct styles can resolve to the same tags (e.g. solid vs flash background).
    if (run.open !== current.open) {
      text += current.close + run.open;
      current = run;
    }

    text += char === '' ? ' ' : char === '&' ? '&amp;' : char === '<' ? '&lt;' : char;
  }

  return text + current.close;
}

/**
 * Tags for a cell style, outermost first: foreground colour, then a single wrapper for the pen
 * size / background / font (a `<c.s-KEY>` span when a background or font is involved, else the
 * `pen-small` / `pen-large` class), then italics and underline.
 */
function runFor(style: number, context: RunContext): Run {
  let run = context.runs.get(style);
  if (run) return run;

  const fg = style & FG_MASK,
    size = (style & SIZE_MASK) >> SIZE_SHIFT,
    font = context.spanFont ? (style & FONT_MASK) >> FONT_SHIFT : FontTag.Default,
    bgColor = (style & BG_MASK) >> BG_SHIFT,
    bgAlpha = FILL_ALPHA[(style & BG_OPACITY_MASK) >> BG_OPACITY_SHIFT],
    background = rgbaColor(bgColor, bgAlpha),
    sizeClass = size === PenSize.Small ? 'pen-small' : size === PenSize.Large ? 'pen-large' : '';

  let span: CueSpanStyle | undefined,
    key = '',
    className = '';

  if (background !== context.fill) {
    span = { backgroundColor: background };
    key += 'bg' + hexColor(bgColor).slice(1) + '-' + bgAlpha * 100;
  }

  if (font !== FontTag.Default) {
    span = span ?? {};
    span.fontFamily = FONT_FAMILIES[font];
    if (font === FontTag.SmallCaps) className = 'small-caps';
    key += (key ? '-' : '') + 'font' + font;
  }

  let open = fg !== FG_MASK ? '<c.' + hexColor(fg) + '>' : '',
    close = '';

  if (span) {
    if (sizeClass) {
      className = className ? sizeClass + ' ' + className : sizeClass;
      key += '-' + sizeClass;
    }
    if (className) span.className = className;
    context.spans[key] = span;
    open += '<c.s-' + key + '>';
    close = '</c>';
  } else if (sizeClass) {
    open += '<c.' + sizeClass + '>';
    close = '</c>';
  }

  if (style & ITALICS) {
    open += '<i>';
    close = '</i>' + close;
  }
  if (style & UNDERLINE) {
    open += '<u>';
    close = '</u>' + close;
  }
  if (fg !== FG_MASK) close += '</c>';

  run = { open, close };
  context.runs.set(style, run);
  return run;
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

/** 6-bit CEA-708 colour plus alpha -> `rgba(r,g,b,a)`. */
function rgbaColor(rgb: number, alpha: number) {
  return (
    'rgba(' +
    COMPONENTS[(rgb >> 4) & 0x03] +
    ',' +
    COMPONENTS[(rgb >> 2) & 0x03] +
    ',' +
    COMPONENTS[rgb & 0x03] +
    ',' +
    alpha +
    ')'
  );
}

function hex2(value: number) {
  return value.toString(16).padStart(2, '0');
}
