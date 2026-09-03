import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, ParsedCaptionsResult } from '../parse/types';
import { VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';

const CLOCK_TIME_RE = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d+)|:(\d+)(?:[.,](\d+))?)?$/,
  OFFSET_TIME_RE = /^(\d+(?:\.\d+)?|\.\d+)(h|m|s|ms|f|t)$/,
  ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
  WHITESPACE_RE = /\s+/,
  TRAILING_SPACES_RE = / +$/,
  LENGTH_RE = /^(-?\d*\.?\d+)(%|px|c|em|rw|rh)?$/,
  HEX_COLOR_RE = /^#([0-9a-f]{6})([0-9a-f]{2})?$/,
  RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  UNDERLINE_RE = /(^|\s)underline(\s|$)/,
  TAG_NAME_END_RE = /[ .]/,
  AMP_RE = /&/g,
  LT_RE = /</g,
  CSS_URL_RE = /^url\(\s*(.*?)\s*\)$/,
  QUOTES_RE = /^["']|["']$/g,
  ALL_WHITESPACE_RE = /\s+/g;

const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  },
  COLOR_NAMES: Record<string, string> = {
    ffffff: 'white',
    '00ff00': 'lime',
    '00ffff': 'cyan',
    ff0000: 'red',
    ffff00: 'yellow',
    ff00ff: 'magenta',
    '0000ff': 'blue',
    '000000': 'black',
  },
  VTT_COLORS = /*#__PURE__*/ new Set(Object.values(COLOR_NAMES)),
  TEXT_ALIGNS = /*#__PURE__*/ new Set(['start', 'left', 'center', 'right', 'end']),
  /** Attributes that are not TTML style properties and should not be collected as such. */
  NON_STYLE_ATTRS = /*#__PURE__*/ new Set([
    'id',
    'style',
    'begin',
    'end',
    'dur',
    'region',
    'lang',
    'space',
    'timeContainer',
    'agent',
    'role',
    'base',
    'type',
  ]),
  /** Style properties that are not inherited by child content elements. */
  NON_INHERITED_STYLES = /*#__PURE__*/ new Set([
    'backgroundColor',
    'origin',
    'extent',
    'displayAlign',
    'opacity',
    'overflow',
    'padding',
    'showBackground',
    'unicodeBidi',
    'zIndex',
    'ruby',
    'backgroundImage',
  ]),
  /** Maps SMPTE-TT `imagetype` values to MIME types. */
  IMAGE_TYPES: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };

const DEFAULT_FRAME_RATE = 30,
  DEFAULT_DURATION = 10,
  /** Maximum number of cues a single paragraph is split into by `<set>` animations. */
  MAX_SLICES = 64,
  DEFAULT_ROOT_WIDTH = 1920,
  DEFAULT_ROOT_HEIGHT = 1080,
  DEFAULT_CELL_COLUMNS = 32,
  DEFAULT_CELL_ROWS = 15,
  /** Font size (as a fraction of the overlay height) that a `100%` TTML font size maps to. */
  BASE_FONT_SIZE = 0.05;

/** Maps `tts:writingMode` values to the WebVTT cue `vertical` setting. */
const WRITING_MODES: Record<string, VTTCue['vertical']> = {
  lrtb: '',
  rltb: '',
  lr: '',
  rl: '',
  tbrl: 'rl',
  tb: 'rl',
  tblr: 'lr',
};

// -------------------------------------------------------------------------------------------
// Time Expressions
// -------------------------------------------------------------------------------------------

export interface TTMLTimeContext {
  /** @defaultValue 30 */
  frameRate?: number;
  /** @defaultValue 1 */
  frameRateMultiplier?: number;
  /** @defaultValue 1 */
  subFrameRate?: number;
  /** @defaultValue 1 */
  tickRate?: number;
  /**
   * `ttp:dropMode` for the `smpte` time base. `dropNTSC` converts `hh:mm:ss:ff` as SMPTE 12M
   * drop-frame timecode (frames 0 and 1 skipped every minute except every tenth). `dropPAL`
   * (M/PAL, 4 frames skipped every other minute) is rare and its residual error is not exactly
   * specified, so it is treated as `nonDrop`.
   *
   * @defaultValue 'nonDrop'
   */
  dropMode?: 'nonDrop' | 'dropNTSC' | 'dropPAL';
}

/**
 * Parses a TTML time expression (clock-time or offset-time) into seconds. Returns `null` if the
 * expression is invalid.
 *
 * @see {@link https://www.w3.org/TR/ttml1/#timing-value-timeExpression}
 */
export function parseTTMLTime(text: string, ctx: TTMLTimeContext = {}): number | null {
  const value = text.trim(),
    frameRate = (ctx.frameRate || DEFAULT_FRAME_RATE) * (ctx.frameRateMultiplier || 1);

  let match = CLOCK_TIME_RE.exec(value);
  if (match) {
    const h = +match[1],
      m = +match[2],
      s = +match[3];
    let seconds = h * 3600 + m * 60 + s;
    if (match[4]) {
      seconds += parseFloat('0.' + match[4]);
    } else if (match[5]) {
      let frames = +match[5];
      if (match[6]) frames += +match[6] / (ctx.subFrameRate || 1);
      if (ctx.dropMode === 'dropNTSC') return dropFrameToSeconds(h, m, s, frames, ctx);
      seconds += frames / frameRate;
    }
    return seconds;
  }

  match = OFFSET_TIME_RE.exec(value);
  if (match) {
    const num = parseFloat(match[1]);
    switch (match[2]) {
      case 'h':
        return num * 3600;
      case 'm':
        return num * 60;
      case 's':
        return num;
      case 'ms':
        return num / 1000;
      case 'f':
        return num / frameRate;
      case 't':
        return num / (ctx.tickRate || 1);
    }
  }

  return null;
}

/**
 * Converts an NTSC drop-frame timecode to seconds. The timecode counts nominal frames (30 per
 * second) but skips frame numbers 0 and 1 at the start of every minute except every tenth, so
 * the label stays in step with the real 30000/1001 fps clock. The frame number is recovered by
 * subtracting the skipped frames, then divided by the effective frame rate.
 *
 * @see {@link https://www.w3.org/TR/ttml1/#parameter-attribute-dropMode}
 */
function dropFrameToSeconds(h: number, m: number, s: number, frames: number, ctx: TTMLTimeContext) {
  const nominal = Math.round(ctx.frameRate || DEFAULT_FRAME_RATE),
    // Two frames per minute at 30 fps, four at 60 fps.
    dropped = 2 * Math.max(1, Math.round(nominal / 30)),
    totalMinutes = h * 60 + m,
    frameNumber =
      (h * 3600 + m * 60 + s) * nominal +
      frames -
      dropped * (totalMinutes - Math.floor(totalMinutes / 10)),
    effectiveRate = nominal * (ctx.frameRateMultiplier || 1000 / 1001);
  return frameNumber / effectiveRate;
}

// -------------------------------------------------------------------------------------------
// XML Tokenizer
// -------------------------------------------------------------------------------------------

interface XMLElement {
  name: string;
  attrs: Record<string, string>;
  children: (XMLElement | string)[];
  line: number;
}

function isWhitespace(code: number) {
  return code === 32 || code === 10 || code === 9 || code === 13 || code === 12;
}

function isNameEnd(code: number) {
  return isWhitespace(code) || code === 47 /* / */ || code === 62 /* > */ || code === 61; /* = */
}

function localName(name: string) {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

function decodeEntities(text: string) {
  if (text.indexOf('&') === -1) return text;
  return text.replace(ENTITY_RE, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITIES[entity];
  });
}

/**
 * A small tolerant XML parser. Namespace prefixes are stripped from element and attribute
 * names, `xmlns` declarations are dropped, comments/processing instructions/doctypes are ignored.
 */
function parseXML(text: string): XMLElement {
  const root: XMLElement = { name: '', attrs: {}, children: [], line: 1 },
    stack: XMLElement[] = [root],
    len = text.length;

  let i = 0,
    line = 1;

  function advance(to: number) {
    for (let j = i; j < to && j < len; j++) if (text.charCodeAt(j) === 10) line++;
    i = to;
  }

  function indexOf(search: string, from: number) {
    const index = text.indexOf(search, from);
    return index < 0 ? len : index;
  }

  function pushText(value: string) {
    if (value) stack[stack.length - 1].children.push(value);
  }

  while (i < len) {
    const lt = text.indexOf('<', i);

    if (lt < 0) {
      pushText(decodeEntities(text.slice(i)));
      break;
    }

    if (lt > i) {
      pushText(decodeEntities(text.slice(i, lt)));
      advance(lt);
    }

    const next = text.charCodeAt(i + 1);

    if (text.startsWith('<!--', i)) {
      advance(indexOf('-->', i + 4) + 3);
    } else if (text.startsWith('<![CDATA[', i)) {
      const stop = indexOf(']]>', i + 9);
      pushText(text.slice(i + 9, stop));
      advance(stop + 3);
    } else if (next === 63 /* ? */) {
      advance(indexOf('?>', i + 2) + 2);
    } else if (next === 33 /* ! */) {
      advance(indexOf('>', i + 2) + 1);
    } else if (next === 47 /* / */) {
      const stop = indexOf('>', i + 2),
        name = localName(text.slice(i + 2, stop).trim());
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      advance(stop + 1);
    } else {
      let j = i + 1;
      const nameStart = j;
      while (j < len && !isNameEnd(text.charCodeAt(j))) j++;

      const name = text.slice(nameStart, j);
      if (!name) {
        // Stray `<` in text content, keep it as text.
        pushText('<');
        advance(i + 1);
        continue;
      }

      const el: XMLElement = { name: localName(name), attrs: {}, children: [], line };
      let selfClosing = false;

      while (j < len) {
        const code = text.charCodeAt(j);

        if (isWhitespace(code)) {
          j++;
          continue;
        }

        if (code === 47 /* / */) {
          selfClosing = true;
          j++;
          continue;
        }

        if (code === 62 /* > */) {
          j++;
          break;
        }

        const attrStart = j;
        while (j < len && !isNameEnd(text.charCodeAt(j))) j++;
        const attrName = text.slice(attrStart, j);

        while (j < len && isWhitespace(text.charCodeAt(j))) j++;

        let value = '';
        if (text.charCodeAt(j) === 61 /* = */) {
          j++;
          while (j < len && isWhitespace(text.charCodeAt(j))) j++;
          const quote = text.charCodeAt(j);
          if (quote === 34 /* " */ || quote === 39 /* ' */) {
            const stop = indexOf(text[j], j + 1);
            value = text.slice(j + 1, stop);
            j = stop + 1;
          } else {
            const valueStart = j;
            while (j < len && !isNameEnd(text.charCodeAt(j))) j++;
            value = text.slice(valueStart, j);
          }
        }

        if (attrName && !attrName.startsWith('xmlns')) {
          el.attrs[localName(attrName)] = decodeEntities(value);
        }
      }

      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
      advance(j);
    }
  }

  return root;
}

function findChild(el: XMLElement, name: string): XMLElement | undefined {
  for (const child of el.children) {
    if (typeof child !== 'string' && child.name === name) return child;
  }
}

function textContent(el: XMLElement): string {
  let text = '';
  for (const child of el.children) {
    text += typeof child === 'string' ? child : textContent(child);
  }
  return text;
}

// -------------------------------------------------------------------------------------------
// Parser
// -------------------------------------------------------------------------------------------

type TTMLStyle = Record<string, string>;

interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  displayAlign: string;
}

interface TTMLRegion extends RegionBox {
  style: TTMLStyle;
  /** `<set>` animations declared on the region, in document time. */
  anims: TTMLAnimation[];
}

/** A `<set>` animation: `style` applies to `target` while `begin <= t < end`. */
interface TTMLAnimation {
  begin: number;
  end: number | undefined;
  target: XMLElement;
  style: TTMLStyle;
}

interface ContainerContext {
  begin: number;
  end: number | undefined;
  style: TTMLStyle;
  lang: string;
  preserve: boolean;
  region: string | undefined;
}

interface InlineContext {
  begin: number;
  style: TTMLStyle;
  lang: string;
  baseLang: string;
  preserve: boolean;
  inRuby: boolean;
  timestamp: number | undefined;
}

interface TextRun {
  text: string;
  tags: string[];
  preserve: boolean;
  br: boolean;
  timestamp: number | undefined;
}

interface Timing {
  begin: number;
  end: number | undefined;
  /** Whether the element itself specified an end time (via `end` or `dur`). */
  explicit: boolean;
  badBegin: boolean;
}

export class TTMLParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _buffer = '';
  protected _done = false;
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _metadata: VTTHeaderMetadata = {};
  protected _time: TTMLTimeContext = {};
  protected _rootWidth = DEFAULT_ROOT_WIDTH;
  protected _rootHeight = DEFAULT_ROOT_HEIGHT;
  protected _cellColumns = DEFAULT_CELL_COLUMNS;
  protected _cellRows = DEFAULT_CELL_ROWS;
  protected _styleEls: Record<string, XMLElement> = {};
  protected _styles: Record<string, TTMLStyle> = {};
  protected _regions: Record<string, TTMLRegion> = {};
  protected _regionIds: string[] = [];
  protected _timeBase = 'media';
  /** Embedded images (`smpte:image` / IMSC 1.1 `image`) by `xml:id`, as data URLs. */
  protected _images: Record<string, string> = {};
  /** `<set>` style overrides active for the paragraph slice currently being collected. */
  protected _activeSets = new Map<XMLElement, TTMLStyle>();

  init(init: CaptionsParserInit) {
    this._init = init;
  }

  parse(line: string) {
    // XML is not line-oriented so we buffer the whole document.
    this._buffer += line + '\n';
  }

  done(cancelled: boolean): ParsedCaptionsResult {
    if (!cancelled && !this._done) {
      this._done = true;
      this._parseDocument();
    }

    return {
      metadata: this._metadata,
      regions: [],
      cues: this._cues,
      errors: this._errors,
    };
  }

  protected _parseDocument() {
    const doc = parseXML(this._buffer),
      tt = findChild(doc, 'tt');

    this._buffer = '';

    if (!tt) {
      this._handleError(
        this._buildError(ParseErrorCode.BadSignature, 'missing TTML `<tt>` root element', 1),
      );
      return;
    }

    this._parseRoot(tt);

    const head = findChild(tt, 'head');
    if (head) this._parseHead(head);

    const body = findChild(tt, 'body');

    // With `ttp:timeBase="clock"` times are times of day. Cues are shifted so the earliest
    // paragraph starts at 0 and the wall-clock reference is exposed as `ClockStart`, so a
    // consumer that knows the media's wall-clock start can re-offset with `shiftVTTCues`.
    let offset = 0;
    if (this._timeBase === 'clock') {
      this._metadata.TimeBase = 'clock';
      const start = body && this._earliestBegin(body);
      if (start) {
        offset = start.time;
        this._metadata.ClockStart = start.expr;
      }
    }

    this._init.onHeaderMetadata?.(this._metadata);

    if (body) {
      this._walkContainer(body, {
        begin: -offset,
        end: undefined,
        style: {},
        lang: tt.attrs.lang || '',
        preserve: tt.attrs.space === 'preserve',
        region: undefined,
      });
    }
  }

  protected _parseRoot(tt: XMLElement) {
    const attrs = tt.attrs,
      time: TTMLTimeContext = {};

    if (attrs.frameRate) time.frameRate = toPositive(attrs.frameRate);
    if (attrs.tickRate) time.tickRate = toPositive(attrs.tickRate);
    if (attrs.subFrameRate) time.subFrameRate = toPositive(attrs.subFrameRate);

    if (attrs.frameRateMultiplier) {
      const [num, den] = attrs.frameRateMultiplier.trim().split(WHITESPACE_RE).map(toPositive);
      if (num && den) time.frameRateMultiplier = num / den;
    }

    if (attrs.timeBase) this._timeBase = attrs.timeBase.trim();

    // `ttp:dropMode` only has meaning for SMPTE timecodes. `ttp:clockMode` (`local`, `gps`,
    // `utc`) does not change how expressions are parsed since all cues are relative to the
    // earliest one; the mode is left to the consumer via `ClockStart`.
    if (this._timeBase === 'smpte') {
      const dropMode = attrs.dropMode?.trim();
      if (dropMode === 'dropNTSC' || dropMode === 'dropPAL') time.dropMode = dropMode;
    }

    this._time = time;

    if (attrs.lang) this._metadata.Language = attrs.lang;

    if (attrs.cellResolution) {
      const [columns, rows] = attrs.cellResolution.trim().split(WHITESPACE_RE).map(toPositive);
      if (columns && rows) {
        this._cellColumns = columns;
        this._cellRows = rows;
      }
    }

    if (attrs.extent) {
      const [w, h] = attrs.extent
        .trim()
        .split(WHITESPACE_RE)
        .map((v) => parsePixels(v));
      if (w && h) {
        this._rootWidth = w;
        this._rootHeight = h;
      }
    }
  }

  protected _parseHead(head: XMLElement) {
    const metadata = findChild(head, 'metadata');
    if (metadata) {
      for (const child of metadata.children) {
        if (typeof child === 'string') continue;
        const text = textContent(child).trim();
        if (!text) continue;
        switch (child.name) {
          case 'title':
            this._metadata.Title = text;
            break;
          case 'desc':
            this._metadata.Description = text;
            break;
          case 'copyright':
            this._metadata.Copyright = text;
            break;
        }
      }
    }

    // SMPTE-TT `<smpte:image>` lives in `<metadata>`, IMSC 1.1 `<image>` directly in `<head>`.
    this._collectImages(head);

    const styling = findChild(head, 'styling');
    if (styling) {
      for (const child of styling.children) {
        if (typeof child !== 'string' && child.name === 'style' && child.attrs.id) {
          this._styleEls[child.attrs.id] = child;
        }
      }
    }

    const layout = findChild(head, 'layout');
    if (layout) {
      for (const child of layout.children) {
        if (typeof child !== 'string' && child.name === 'region') this._parseRegion(child);
      }
    }
  }

  protected _collectImages(el: XMLElement) {
    for (const child of el.children) {
      if (typeof child === 'string') continue;

      if (child.name !== 'image') {
        this._collectImages(child);
        continue;
      }

      const id = child.attrs.id,
        encoding = (child.attrs.encoding ?? 'Base64').trim().toLowerCase();
      if (!id || encoding !== 'base64') continue;

      // IMSC 1.1 uses `type="image/png"`, SMPTE-TT `imagetype="PNG"`.
      const type = child.attrs.type?.trim(),
        imageType = (child.attrs.imagetype ?? child.attrs.imageType ?? 'png').trim().toLowerCase(),
        mime = type && type.includes('/') ? type : (IMAGE_TYPES[imageType] ?? 'image/png'),
        data = textContent(child).replace(ALL_WHITESPACE_RE, '');

      if (data) this._images[id] = `data:${mime};base64,${data}`;
    }
  }

  protected _parseRegion(el: XMLElement) {
    const id = el.attrs.id;
    if (!id) return;

    const style = this._elementStyle(el),
      anims: TTMLAnimation[] = [];

    // Region timing is in document time; its `<set>` children are relative to the region.
    const begin = parseTTMLTime(el.attrs.begin ?? '', this._time) ?? 0,
      end =
        el.attrs.end !== undefined
          ? (parseTTMLTime(el.attrs.end, this._time) ?? undefined)
          : undefined;

    for (const child of el.children) {
      if (typeof child === 'string') continue;
      // Regions may contain inline style elements.
      if (child.name === 'style') Object.assign(style, this._elementStyle(child));
      else if (child.name === 'set') this._collectAnimation(child, el, { begin, end }, anims);
    }

    this._regions[id] = { style, anims, ...this._regionBox(style) };
    this._regionIds.push(id);
  }

  /** Resolves the region box (percentages of the root container) from region styles. */
  protected _regionBox(style: TTMLStyle): RegionBox {
    const origin = this._parseCoords(style.origin),
      extent = this._parseCoords(style.extent),
      x = origin?.[0] ?? 0,
      y = origin?.[1] ?? 0;

    return {
      x,
      y,
      w: extent?.[0] ?? 100 - x,
      h: extent?.[1] ?? 100 - y,
      displayAlign: style.displayAlign || 'before',
    };
  }

  /** Resolves the region a content element renders into, if any. */
  protected _findRegion(el: XMLElement, ctx: ContainerContext): TTMLRegion | undefined {
    const id =
      el.attrs.region ?? ctx.region ?? (this._regionIds.length === 1 ? this._regionIds[0] : '');
    return id ? this._regions[id] : undefined;
  }

  /**
   * Resolves a `tts:backgroundImage` / `smpte:backgroundImage` value to a data URL. Only
   * embedded images (`#id`) and inline `data:image/*` URLs are accepted; external URLs are not
   * fetched.
   */
  protected _resolveImage(value: string | undefined, line: number): string | null {
    if (!value) return null;

    let ref = value.trim();
    const match = CSS_URL_RE.exec(ref);
    if (match) ref = match[1];
    ref = ref.replace(QUOTES_RE, '').trim();

    if (ref[0] === '#') {
      const image = this._images[ref.slice(1)];
      if (image) return image;
      this._handleError(
        this._buildError(
          ParseErrorCode.BadSettingValue,
          `background image \`${ref}\` is not defined in the document head on line ${line}`,
          line,
        ),
      );
      return null;
    }

    return ref.startsWith('data:image/') ? ref : null;
  }

  protected _parseCoords(value: string | undefined): [number, number] | null {
    if (!value) return null;
    const parts = value.trim().split(WHITESPACE_RE);
    if (parts.length !== 2) return null;
    const x = this._parseLength(parts[0], this._rootWidth, this._cellColumns),
      y = this._parseLength(parts[1], this._rootHeight, this._cellRows);
    return x !== null && y !== null ? [x, y] : null;
  }

  /**
   * Parses a TTML length into a percentage of the root container. Cell units (`c`) are resolved
   * against `ttp:cellResolution` on the given axis.
   */
  protected _parseLength(value: string, rootSize: number, cells: number): number | null {
    const match = LENGTH_RE.exec(value);
    if (!match) return null;
    const num = parseFloat(match[1]);
    switch (match[2]) {
      case '%':
        return num;
      case 'px':
        return (num / rootSize) * 100;
      case 'c':
        return (num / cells) * 100;
      default:
        return null;
    }
  }

  /** Resolves a style referenced by `xml:id`, including chained references. */
  protected _resolveStyle(id: string, visiting: Set<string> = new Set()): TTMLStyle {
    if (this._styles[id]) return this._styles[id];

    const el = this._styleEls[id];
    if (!el || visiting.has(id)) return {};

    visiting.add(id);
    const style = this._elementStyle(el, visiting);
    visiting.delete(id);

    this._styles[id] = style;
    return style;
  }

  /** Computes the specified style of an element: referenced styles (later wins) then inline. */
  protected _elementStyle(el: XMLElement, visiting?: Set<string>): TTMLStyle {
    const style: TTMLStyle = {};

    if (el.attrs.style) {
      for (const ref of el.attrs.style.trim().split(WHITESPACE_RE)) {
        if (ref) Object.assign(style, this._resolveStyle(ref, visiting));
      }
    }

    for (const name of Object.keys(el.attrs)) {
      if (!NON_STYLE_ATTRS.has(name)) style[name] = el.attrs[name];
    }

    return style;
  }

  protected _parseTime(value: string | undefined, line: number): number | null | undefined {
    if (value === undefined) return undefined;
    const time = parseTTMLTime(value, this._time);
    if (time === null) {
      this._handleError(
        this._buildError(
          ParseErrorCode.BadTimestamp,
          `time expression \`${value}\` is invalid on line ${line}`,
          line,
        ),
      );
    }
    return time;
  }

  /** Resolves element timing relative to its parent (TTML `par` time container semantics). */
  protected _resolveTiming(el: XMLElement, parent: { begin: number; end: number | undefined }) {
    const beginOffset = this._parseTime(el.attrs.begin, el.line),
      endOffset = this._parseTime(el.attrs.end, el.line),
      dur = this._parseTime(el.attrs.dur, el.line);

    const timing: Timing = {
      begin: parent.begin + (beginOffset || 0),
      end: parent.end,
      explicit: false,
      badBegin: beginOffset === null,
    };

    if (typeof endOffset === 'number') {
      timing.end = parent.begin + endOffset;
      timing.explicit = true;
    }

    if (typeof dur === 'number') {
      const durEnd = timing.begin + dur;
      timing.end = timing.explicit ? Math.min(timing.end!, durEnd) : durEnd;
      timing.explicit = true;
    }

    if (parent.end !== undefined && timing.end !== undefined && timing.end > parent.end) {
      // Clipped by the ancestor: an empty interval here is valid TTML, not an authoring error.
      timing.end = parent.end;
      timing.explicit = false;
    }

    return timing;
  }

  /**
   * Resolves the end time of a cue-producing element, inferring it from the next paragraph or
   * falling back to the default duration. Returns `undefined` (after reporting) when the
   * resulting interval is empty.
   */
  protected _resolveEnd(
    el: XMLElement,
    timing: Timing,
    ctx: ContainerContext,
    next?: XMLElement,
  ): number | undefined {
    let { begin, end } = timing;

    if (end === undefined && el.attrs.end === undefined && el.attrs.dur === undefined && next) {
      // Common in live EBU-TT-D and auto-generated files: a paragraph without `end`/`dur` runs
      // until the next paragraph begins. The sibling reports its own timing errors when parsed.
      const nextBegin = next.attrs.begin ? parseTTMLTime(next.attrs.begin, this._time) : null;
      if (nextBegin !== null && ctx.begin + nextBegin > begin) end = ctx.begin + nextBegin;
    }

    if (end === undefined) {
      end = begin + DEFAULT_DURATION;
      this._handleError(
        this._buildError(
          ParseErrorCode.BadTimestamp,
          `cue on line ${el.line} has no end time (missing \`end\` or \`dur\` on the element ` +
            `or an ancestor), defaulting to a ${DEFAULT_DURATION}s duration`,
          el.line,
        ),
      );
    }

    if (end <= begin) {
      if (timing.explicit) {
        this._handleError(
          this._buildError(
            ParseErrorCode.BadTimestamp,
            `cue end time \`${end}\` is not greater than start time \`${begin}\` on line ${el.line}`,
            el.line,
          ),
        );
      }
      return;
    }

    return end;
  }

  /**
   * Finds the earliest paragraph begin in the body (clock time base). Returns the time and the
   * authored expression that produced it, or `null` if there are no paragraphs.
   */
  protected _earliestBegin(body: XMLElement): { time: number; expr: string } | null {
    let time = Infinity,
      expr = '';

    const visit = (el: XMLElement, parentBegin: number, parentExpr: string) => {
      for (const node of el.children) {
        if (typeof node === 'string') continue;
        if (node.name === 'metadata' || node.name === 'set' || node.name === 'animation') continue;

        const own =
            node.attrs.begin !== undefined ? parseTTMLTime(node.attrs.begin, this._time) : null,
          begin = parentBegin + (own || 0),
          // Nested offsets have no single authored expression; format the resolved time then.
          nodeExpr =
            own !== null
              ? parentBegin === 0
                ? node.attrs.begin.trim()
                : formatTimestamp(begin)
              : parentExpr;

        if (node.name === 'p') {
          if (begin < time) {
            time = begin;
            expr = nodeExpr;
          }
        } else {
          visit(node, begin, nodeExpr);
        }
      }
    };

    const bodyBegin = parseTTMLTime(body.attrs.begin ?? '', this._time) || 0;
    visit(body, bodyBegin, body.attrs.begin?.trim() ?? '');

    if (time === Infinity) return null;
    return { time, expr: expr || formatTimestamp(time) };
  }

  protected _walkContainer(el: XMLElement, ctx: ContainerContext) {
    const timing = this._resolveTiming(el, ctx),
      ownStyle = this._elementStyle(el),
      child: ContainerContext = {
        begin: timing.begin,
        end: timing.end,
        style: { ...ctx.style, ...ownStyle },
        lang: el.attrs.lang ?? ctx.lang,
        preserve: el.attrs.space ? el.attrs.space === 'preserve' : ctx.preserve,
        region: el.attrs.region ?? ctx.region,
      };

    // IMSC image profile / SMPTE-TT: a `div` may paint an embedded image over its region.
    if (el.name === 'div' && ownStyle.backgroundImage && !timing.badBegin) {
      const image = this._resolveImage(ownStyle.backgroundImage, el.line);
      if (image) {
        const end = this._resolveEnd(el, timing, ctx);
        if (end !== undefined) {
          this._emitImageCue(el, timing.begin, end, image, this._findRegion(el, ctx));
        }
      }
    }

    const nodes = el.children;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (typeof node === 'string') continue;
      switch (node.name) {
        case 'p':
          this._parseParagraph(node, child, nextParagraph(nodes, i + 1));
          break;
        case 'metadata':
        case 'set':
        case 'animation':
          break;
        default:
          this._walkContainer(node, child);
      }
    }
  }

  protected _parseParagraph(el: XMLElement, ctx: ContainerContext, next?: XMLElement) {
    const timing = this._resolveTiming(el, ctx);
    if (timing.badBegin) return;

    const region = this._findRegion(el, ctx),
      ownStyle = this._elementStyle(el);

    const style: TTMLStyle = {
      ...inheritedStyle(ctx.style),
      ...(region ? inheritedStyle(region.style) : {}),
      ...ownStyle,
    };

    const lang = el.attrs.lang ?? ctx.lang,
      inline: InlineContext = {
        begin: timing.begin,
        style,
        lang,
        baseLang: lang,
        preserve: el.attrs.space ? el.attrs.space === 'preserve' : ctx.preserve,
        inRuby: false,
        timestamp: undefined,
      },
      runs: TextRun[] = [];

    this._activeSets.clear();
    this._collectRuns(el, inline, runs);
    normalizeRuns(runs);

    const image = this._resolveImage(ownStyle.backgroundImage, el.line);
    if (!runs.length && !image) return;

    const begin = timing.begin,
      end = this._resolveEnd(el, timing, ctx, next);
    if (end === undefined) return;

    if (image) this._emitImageCue(el, begin, end, image, region);
    if (!runs.length) return;

    // `<set>` animations on the paragraph, its spans, or its region split the paragraph into
    // consecutive cues, one per interval over which the active styles are constant.
    const anims: TTMLAnimation[] = [];
    this._collectAnimations(el, begin, end, anims);
    const regionAnims = region?.anims ?? [];

    if (!anims.length && !regionAnims.length) {
      this._emit(this._buildTextCue(el, begin, end, runs, style, region));
      return;
    }

    const bounds = new Set<number>([begin, end]);
    for (const anim of anims.concat(regionAnims)) {
      if (anim.begin > begin && anim.begin < end) bounds.add(anim.begin);
      if (anim.end !== undefined && anim.end > begin && anim.end < end) bounds.add(anim.end);
    }

    const times = [...bounds].sort((a, b) => a - b);
    // Keep the first `MAX_SLICES - 1` boundaries and the paragraph end; later animations are
    // folded into the last slice (which renders the styles active at its start).
    if (times.length > MAX_SLICES + 1) times.splice(MAX_SLICES, times.length - MAX_SLICES - 1);

    let prev: VTTCue | undefined,
      prevKey = '';

    for (let i = 0; i < times.length - 1; i++) {
      const sliceBegin = times[i],
        sliceEnd = times[i + 1];

      this._activeSets.clear();
      for (const anim of anims) {
        if (anim.begin > sliceBegin || (anim.end !== undefined && anim.end <= sliceBegin)) continue;
        const current = this._activeSets.get(anim.target);
        this._activeSets.set(anim.target, current ? { ...current, ...anim.style } : anim.style);
      }

      let sliceRegion = region;
      if (region && regionAnims.length) {
        let regionStyle: TTMLStyle | undefined;
        for (const anim of regionAnims) {
          if (anim.begin > sliceBegin || (anim.end !== undefined && anim.end <= sliceBegin))
            continue;
          regionStyle = { ...(regionStyle ?? region.style), ...anim.style };
        }
        if (regionStyle) {
          sliceRegion = { ...region, style: regionStyle, ...this._regionBox(regionStyle) };
        }
      }

      const overrides = this._activeSets.get(el),
        sliceStyle = overrides ? { ...style, ...overrides } : style,
        sliceRuns: TextRun[] = [];

      this._collectRuns(el, { ...inline, style: sliceStyle }, sliceRuns);
      normalizeRuns(sliceRuns);

      if (!sliceRuns.length) {
        // Hidden for this interval: flush the previous cue, nothing to coalesce with.
        if (prev) this._emit(prev);
        prev = undefined;
        continue;
      }

      const cue = this._buildTextCue(el, sliceBegin, sliceEnd, sliceRuns, sliceStyle, sliceRegion),
        key = cueRenderKey(cue);

      if (prev && prevKey === key) {
        // Coalesce: the animation did not change what is rendered.
        prev.endTime = sliceEnd;
        continue;
      }

      if (prev) this._emit(prev);
      prev = cue;
      prevKey = key;
    }

    if (prev) this._emit(prev);
  }

  /** Collects `<set>` animations on a paragraph and its descendant spans in document time. */
  protected _collectAnimations(
    el: XMLElement,
    begin: number,
    end: number | undefined,
    out: TTMLAnimation[],
  ) {
    for (const node of el.children) {
      if (typeof node === 'string') continue;
      switch (node.name) {
        case 'set':
          this._collectAnimation(node, el, { begin, end }, out);
          break;
        case 'br':
        case 'metadata':
        case 'animation':
          break;
        default: {
          // Mirrors `_collectRuns`: a timed span shifts the origin of its own animations. Errors
          // in the expression are reported when the runs are collected.
          const offset = node.attrs.begin ? parseTTMLTime(node.attrs.begin, this._time) : null;
          this._collectAnimations(node, begin + (offset || 0), end, out);
        }
      }
    }
  }

  protected _collectAnimation(
    set: XMLElement,
    target: XMLElement,
    parent: { begin: number; end: number | undefined },
    out: TTMLAnimation[],
  ) {
    const timing = this._resolveTiming(set, parent);
    if (timing.badBegin || (timing.end !== undefined && timing.end <= timing.begin)) return;

    const style = this._elementStyle(set);
    if (Object.keys(style).length) {
      out.push({ begin: timing.begin, end: timing.end, target, style });
    }
  }

  protected _emit(cue: VTTCue) {
    this._cues.push(cue);
    this._init.onCue?.(cue);
  }

  /**
   * Emits an image cue (IMSC image profile / SMPTE-TT). The cue has no text; the renderer paints
   * `textStyle.backgroundImage` over the region box given by `layout`.
   */
  protected _emitImageCue(
    el: XMLElement,
    begin: number,
    end: number,
    url: string,
    region: TTMLRegion | undefined,
  ) {
    const cue = new VTTCue(begin, end, '');

    if (el.attrs.id) cue.id = el.attrs.id;

    cue.layout = region
      ? { left: region.x, top: region.y, width: region.w, height: region.h }
      : { left: 0, top: 0, width: 100, height: 100 };

    cue.textStyle = { backgroundImage: `url(${url})`, backgroundColor: 'transparent' };

    this._emit(cue);
  }

  protected _buildTextCue(
    el: XMLElement,
    begin: number,
    end: number,
    runs: TextRun[],
    style: TTMLStyle,
    region: TTMLRegion | undefined,
  ) {
    const cue = new VTTCue(begin, end, serializeRuns(runs, begin));

    if (el.attrs.id) cue.id = el.attrs.id;

    // `tts:writingMode` is a region property but we also accept it inherited from content.
    const vertical = WRITING_MODES[style.writingMode?.trim() ?? ''] ?? '';
    cue.vertical = vertical;

    if (region) {
      cue.snapToLines = false;
      cue.positionAlign = 'line-left';

      // WebVTT `position`/`size` run along the inline axis and `line` along the block axis. For
      // horizontal text that is x/w and y/h; for vertical text the axes swap: `position`/`size`
      // come from origin-y/extent-h and `line` from origin-x/extent-w.
      let start: number, length: number;
      if (vertical) {
        cue.position = clamp(region.y);
        cue.size = clamp(region.h);
        start = region.x;
        length = region.w;
      } else {
        cue.position = clamp(region.x);
        cue.size = clamp(region.w);
        start = region.y;
        length = region.h;
      }

      // `tts:displayAlign` aligns along the block progression direction. Horizontal (`lrtb`)
      // and `tblr` (lr) progress top->bottom / left->right, so `before` is the region start
      // (origin-y / origin-x). `tbrl` (rl) progresses right->left, so `before` is the far edge
      // (origin-x + extent-w) and `after` is origin-x. The renderer anchors `line` from the
      // left for both vertical directions, so we flip the alignment for `rl` here.
      let displayAlign = region.displayAlign;
      if (vertical === 'rl') {
        if (displayAlign === 'before') displayAlign = 'after';
        else if (displayAlign === 'after') displayAlign = 'before';
      }

      if (displayAlign === 'after') {
        cue.line = clamp(start + length);
        cue.lineAlign = 'end';
      } else if (displayAlign === 'center') {
        cue.line = clamp(start + length / 2);
        cue.lineAlign = 'center';
      } else {
        cue.line = clamp(start);
      }
    }

    if (style.textAlign && TEXT_ALIGNS.has(style.textAlign)) {
      cue.align = style.textAlign as VTTCue['align'];
    }

    const fontSize = toCSSFontSize(style.fontSize, this._cellRows, this._rootHeight);
    if (fontSize) cue.textStyle = { ...cue.textStyle, fontSize };

    // `tts:opacity` is not inherited, so it only applies from the paragraph or its region.
    const opacity = toOpacity(style.opacity ?? region?.style.opacity);
    if (opacity !== null) cue.textStyle = { ...cue.textStyle, opacity };

    return cue;
  }

  protected _collectRuns(el: XMLElement, ctx: InlineContext, runs: TextRun[]) {
    const tags = buildTags(ctx),
      // `tts:visibility="hidden"` content is not rendered (a descendant may turn it back on).
      hidden = ctx.style.visibility?.trim() === 'hidden';

    for (const node of el.children) {
      if (typeof node === 'string') {
        if (hidden) continue;
        runs.push({
          text: node,
          tags,
          preserve: ctx.preserve,
          br: false,
          timestamp: ctx.timestamp,
        });
        continue;
      }

      switch (node.name) {
        case 'br':
          if (hidden) break;
          runs.push({ text: '\n', tags, preserve: true, br: true, timestamp: undefined });
          break;
        case 'metadata':
        case 'set':
        case 'animation':
          break;
        default: {
          // `span` and unknown elements: keep their text, apply their styles.
          const style = { ...ctx.style };
          delete style.ruby; // not inherited
          Object.assign(style, this._elementStyle(node));

          const sets = this._activeSets.get(node);
          if (sets) Object.assign(style, sets);

          const child: InlineContext = {
            begin: ctx.begin,
            style,
            lang: node.attrs.lang ?? ctx.lang,
            baseLang: ctx.baseLang,
            preserve: node.attrs.space ? node.attrs.space === 'preserve' : ctx.preserve,
            inRuby: ctx.inRuby || style.ruby === 'container',
            timestamp: ctx.timestamp,
          };

          const begin = this._parseTime(node.attrs.begin, node.line);
          if (typeof begin === 'number') {
            child.begin = ctx.begin + begin;
            child.timestamp = child.begin;
          }

          this._collectRuns(node, child, runs);
        }
      }
    }
  }

  protected _buildError(code: ParseError['code'], reason: string, line: number) {
    if (!this._init.errors) return;
    return new ParseError({ code, reason, line });
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

// -------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------

function toPositive(text: string): number | undefined {
  const num = parseFloat(text);
  return num > 0 ? num : undefined;
}

function parsePixels(text: string): number | undefined {
  const match = LENGTH_RE.exec(text);
  return match && (!match[2] || match[2] === 'px') ? toPositive(match[1]) : undefined;
}

function clamp(num: number) {
  return Math.min(100, Math.max(0, num));
}

function round(num: number, precision = 5) {
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

/** Returns the next `p` element sibling starting at `from`, if any. */
function nextParagraph(nodes: (XMLElement | string)[], from: number): XMLElement | undefined {
  for (let i = from; i < nodes.length; i++) {
    const node = nodes[i];
    if (typeof node !== 'string' && node.name === 'p') return node;
  }
}

/**
 * Converts a TTML `tts:fontSize` into a CSS value relative to the overlay. Two-value font sizes
 * use the second (vertical) value. Returns `null` for unsupported units.
 *
 * - `%`: relative to the default font size (5% of the overlay height).
 * - `c`: cell units, one cell being `1 / rows` of the overlay height.
 * - `px`: relative to the root container height (`tts:extent` on `<tt>`, default 1080).
 * - `em`: passed through, relative to the inherited font size.
 */
function toCSSFontSize(value: string | undefined, rows: number, rootHeight: number) {
  if (!value) return null;

  const parts = value.trim().split(WHITESPACE_RE),
    match = LENGTH_RE.exec(parts[parts.length - 1]);

  if (!match) return null;

  const num = parseFloat(match[1]);
  if (!(num > 0)) return null;

  switch (match[2]) {
    case '%':
      return `calc(var(--overlay-height) * ${BASE_FONT_SIZE} * ${round(num / 100)})`;
    case 'c':
      return `calc(var(--overlay-height) * ${round(num / rows)})`;
    case 'px':
      return `calc(var(--overlay-height) * ${round(num / rootHeight)})`;
    case 'em':
      return `${num}em`;
    default:
      return null;
  }
}

/** Converts `tts:opacity` to a CSS value, or `null` when absent, invalid, or fully opaque. */
function toOpacity(value: string | undefined): string | null {
  if (!value) return null;
  const num = parseFloat(value);
  if (!(num >= 0) || num >= 1) return null;
  return String(Math.min(1, num));
}

/**
 * Everything that affects how a text cue renders, used to coalesce animation slices that end up
 * looking identical.
 */
function cueRenderKey(cue: VTTCue) {
  return JSON.stringify([
    cue.text,
    cue.textStyle,
    cue.vertical,
    cue.snapToLines,
    cue.line,
    cue.lineAlign,
    cue.position,
    cue.positionAlign,
    cue.size,
    cue.align,
  ]);
}

/** Drops style properties that are not inherited by descendant elements. */
function inheritedStyle(style: TTMLStyle): TTMLStyle {
  const result: TTMLStyle = {};
  for (const name of Object.keys(style)) {
    if (!NON_INHERITED_STYLES.has(name)) result[name] = style[name];
  }
  return result;
}

/** Maps a TTML colour to one of the WebVTT colour names, or `null` if not supported. */
function toVTTColor(value: string | undefined): string | null {
  if (!value) return null;

  const color = value.trim().toLowerCase();
  if (VTT_COLORS.has(color)) return color;

  let match = HEX_COLOR_RE.exec(color);
  if (match) {
    if (match[2] === '00') return null; // fully transparent
    return COLOR_NAMES[match[1]] ?? null;
  }

  match = RGB_COLOR_RE.exec(color);
  if (match) {
    const hex = [match[1], match[2], match[3]]
      .map((n) => Math.min(255, +n).toString(16).padStart(2, '0'))
      .join('');
    return COLOR_NAMES[hex] ?? null;
  }

  return null;
}

/** Builds the ordered list of WebVTT tags that apply to text within the given context. */
function buildTags(ctx: InlineContext): string[] {
  const { style } = ctx,
    tags: string[] = [];

  if (ctx.lang && ctx.lang !== ctx.baseLang) tags.push('lang ' + ctx.lang);
  if (ctx.inRuby) tags.push('ruby');
  if (ctx.inRuby && style.ruby === 'text') tags.push('rt');

  const classes: string[] = [],
    color = toVTTColor(style.color),
    bgColor = toVTTColor(style.backgroundColor);

  if (color) classes.push(color);
  if (bgColor) classes.push('bg_' + bgColor);
  if (classes.length) tags.push('c.' + classes.join('.'));

  if (style.fontWeight === 'bold') tags.push('b');
  if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') tags.push('i');
  if (style.textDecoration && UNDERLINE_RE.test(style.textDecoration)) tags.push('u');

  return tags;
}

/**
 * Collapses whitespace in runs that do not preserve space, trims the paragraph, and removes
 * empty runs.
 */
function normalizeRuns(runs: TextRun[]) {
  let prevSpace = true;

  function trimTrailing(index: number) {
    for (let i = index; i >= 0 && !runs[i].br; i--) {
      if (runs[i].preserve) break;
      runs[i].text = runs[i].text.replace(TRAILING_SPACES_RE, '');
      if (runs[i].text) break;
    }
  }

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];

    if (run.br) {
      trimTrailing(i - 1);
      prevSpace = true;
      continue;
    }

    if (run.preserve) {
      prevSpace = false;
      continue;
    }

    let text = '';
    for (let j = 0; j < run.text.length; j++) {
      const code = run.text.charCodeAt(j);
      if (isWhitespace(code)) {
        if (!prevSpace) text += ' ';
        prevSpace = true;
      } else {
        text += run.text[j];
        prevSpace = false;
      }
    }

    run.text = text;
  }

  trimTrailing(runs.length - 1);

  for (let i = runs.length - 1; i >= 0; i--) {
    if (!runs[i].text) runs.splice(i, 1);
  }

  // Trim leading/trailing line breaks.
  while (runs.length && runs[0].br) runs.shift();
  while (runs.length && runs[runs.length - 1].br) runs.pop();
}

function escapeText(text: string) {
  return text.replace(AMP_RE, '&amp;').replace(LT_RE, '&lt;');
}

function pad(num: number, size: number) {
  return String(num).padStart(size, '0');
}

function formatTimestamp(time: number) {
  let ms = Math.round(time * 1000);
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function closingTag(tag: string) {
  const end = tag.search(TAG_NAME_END_RE);
  return end < 0 ? tag : tag.slice(0, end);
}

/** Serializes text runs into WebVTT cue text. */
function serializeRuns(runs: TextRun[], cueStart: number) {
  let text = '',
    lastTimestamp: number | undefined;

  const open: string[] = [];

  for (const run of runs) {
    if (run.br) {
      text += '\n';
      continue;
    }

    let common = 0;
    while (common < open.length && common < run.tags.length && open[common] === run.tags[common]) {
      common++;
    }

    while (open.length > common) text += `</${closingTag(open.pop()!)}>`;

    if (
      run.timestamp !== undefined &&
      run.timestamp !== lastTimestamp &&
      run.timestamp > cueStart
    ) {
      text += `<${formatTimestamp(run.timestamp)}>`;
      lastTimestamp = run.timestamp;
    }

    for (; common < run.tags.length; common++) {
      text += `<${run.tags[common]}>`;
      open.push(run.tags[common]);
    }

    text += escapeText(run.text);
  }

  while (open.length) text += `</${closingTag(open.pop()!)}>`;

  return text;
}

export default function createTTMLParser() {
  return new TTMLParser();
}
