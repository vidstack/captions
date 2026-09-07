import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, ParsedCaptionsResult } from '../parse/types';
import { type CueSpanStyle, type CueTextStyle, VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';

const CLOCK_TIME_RE = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d+)|:(\d+)(?:[.,](\d+))?)?$/,
  OFFSET_TIME_RE = /^(\d+(?:\.\d+)?|\.\d+)(h|m|s|ms|f|t)$/,
  ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
  WHITESPACE_RE = /\s+/,
  TRAILING_SPACES_RE = /(?<! ) +$/,
  LENGTH_RE = /^(-?(?:\d*\.)?\d+)(%|px|c|em|rw|rh)?$/,
  HEX_COLOR_RE = /^#([0-9a-f]{6})([0-9a-f]{2})?$/,
  RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*((?:\d*\.)?\d+)\s*)?\)$/,
  COLOR_NAME_RE = /^[a-z]+$/,
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
    'position',
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
  },
  /** Maps TTML generic font family names to CSS generic families. */
  FONT_FAMILIES: Record<string, string> = {
    default: '',
    monospace: 'monospace',
    sansSerif: 'sans-serif',
    serif: 'serif',
    monospaceSansSerif: 'monospace',
    monospaceSerif: 'monospace',
    proportionalSansSerif: 'sans-serif',
    proportionalSerif: 'serif',
  },
  /** `tts:ruby` values whose text children are structural whitespace, not content. */
  RUBY_CONTAINERS = /*#__PURE__*/ new Set(['container', 'baseContainer', 'textContainer']),
  /** `tts:position` keywords as a fraction of the free space along their axis. */
  H_KEYWORDS: Record<string, number> = { left: 0, center: 0.5, right: 1 },
  V_KEYWORDS: Record<string, number> = { top: 0, center: 0.5, bottom: 1 };

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
   * drop-frame timecode (frames 0 and 1 skipped at the start of every minute except every tenth).
   * `dropPAL` is the M/PAL variant (frames 0-3 skipped at the start of every even minute except
   * minutes 0, 20 and 40). Both imply a `1000/1001` frame rate multiplier unless one is given.
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
      if (ctx.dropMode === 'dropNTSC' || ctx.dropMode === 'dropPAL') {
        return dropFrameToSeconds(h, m, s, frames, ctx);
      }
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
 * Converts a drop-frame timecode to seconds. The timecode counts nominal frames (30 per second)
 * but skips frame numbers at the start of some minutes so the label stays in step with the real
 * 30000/1001 fps clock. The frame number is recovered by subtracting the skipped frames, then
 * divided by the effective frame rate.
 *
 * TTML1 §6.2.3 defines the two rules:
 *
 * - `dropNTSC`: "If the second of a time expression is 00 and the minute of the time expression
 *   is not 00, 10, 20, 30, 40, or 50, then frame codes 00 and 01 are dropped during that second".
 * - `dropPAL`: "If the second of a time expression is 00 and the minute of the time expression
 *   is even but not 00, 20, or 40, then frame codes 00 through 03 are dropped during that second"
 *   (the M/PAL system, e.g. `01:09:59:29` is followed by `01:10:00:04`).
 *
 * @see {@link https://www.w3.org/TR/ttml1/#parameter-attribute-dropMode}
 */
function dropFrameToSeconds(h: number, m: number, s: number, frames: number, ctx: TTMLTimeContext) {
  const nominal = Math.round(ctx.frameRate || DEFAULT_FRAME_RATE),
    // Frames dropped per dropping minute at 30 fps, doubled at 60 fps.
    scale = Math.max(1, Math.round(nominal / 30)),
    // Drops happen at the start of a minute, so every dropping minute up to and including the
    // current one (minute 0 never drops) has already been skipped.
    totalMinutes = h * 60 + m,
    droppedMinutes =
      ctx.dropMode === 'dropPAL'
        ? Math.floor(totalMinutes / 2) - Math.floor(totalMinutes / 20)
        : totalMinutes - Math.floor(totalMinutes / 10),
    perMinute = ctx.dropMode === 'dropPAL' ? 4 : 2,
    frameNumber = (h * 3600 + m * 60 + s) * nominal + frames - perMinute * scale * droppedMinutes,
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
const MAX_XML_DEPTH = 256;

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
      // Beyond the depth cap, elements are treated as self-closing so hostile nesting can not
      // overflow the recursive walkers; their content still parses as siblings.
      if (!selfClosing && stack.length < MAX_XML_DEPTH) stack.push(el);
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

/** Whether any element in the tree has the given attribute value (namespace prefixes stripped). */
function hasAttr(el: XMLElement, name: string, value: string): boolean {
  if (el.attrs[name]?.trim() === value) return true;
  for (const child of el.children) {
    if (typeof child !== 'string' && hasAttr(child, name, value)) return true;
  }
  return false;
}

function isSeq(el: XMLElement) {
  return el.attrs.timeContainer?.trim() === 'seq';
}

// -------------------------------------------------------------------------------------------
// Parser
// -------------------------------------------------------------------------------------------

type TTMLStyle = Record<string, string>;

/** A region's content box as percentages of the root container (padding already applied). */
interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  displayAlign: string;
}

interface TTMLRegion extends RegionBox {
  id: string;
  style: TTMLStyle;
  /** Region timing (`begin`/`end` on the region), in document time. */
  begin: number;
  end: number | undefined;
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
  /** `<set>` animations declared on ancestor containers (`body`, `div`), in document time. */
  anims: TTMLAnimation[];
}

/** Per-paragraph collector for `cue.spans` entries, keyed by their serialized style. */
interface SpanStyles {
  keys: Map<string, string>;
  styles: Record<string, CueSpanStyle>;
}

interface InlineContext {
  begin: number;
  style: TTMLStyle;
  /** Resolved style of the paragraph; spans whose style differs from it get a `cue.spans` entry. */
  pStyle: TTMLStyle;
  lang: string;
  baseLang: string;
  preserve: boolean;
  inRuby: boolean;
  timestamp: number | undefined;
  /** Region the content renders into (`''` when unresolved). */
  region: string;
  /** Interval being collected: spans that ended by `at` or begin at/after `until` are omitted. */
  at: number;
  until: number;
  /** The enclosing `tts:ruby="text"` span, so adjacent ruby texts serialize as separate `<rt>`. */
  rt: XMLElement | undefined;
  /**
   * The first pass over a paragraph: span timing errors are reported and nothing is hidden, so
   * content a `<set>` reveals later still counts as content.
   */
  probe: boolean;
  spans: SpanStyles;
}

interface TextRun {
  text: string;
  tags: string[];
  preserve: boolean;
  br: boolean;
  timestamp: number | undefined;
  region: string;
  spanKey: string | undefined;
  rt: XMLElement | undefined;
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

    // IMSC `itts:forcedDisplay`: forced cues get the `forced` class (see `_buildTextCue`); the
    // flag lets hosts know up front that filtering by that class is meaningful.
    if (hasAttr(tt, 'forcedDisplay', 'true')) this._metadata.HasForcedCues = 'true';

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
        anims: [],
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

    // IMSC 1 `ittp:aspectRatio` / TTML2 `ttp:displayAspectRatio`: the root container's aspect
    // ratio. Positions are percentages so no maths changes; hosts can letterbox the overlay.
    const aspect = attrs.displayAspectRatio ?? attrs.aspectRatio;
    if (aspect) {
      const [w, h] = aspect.trim().split(WHITESPACE_RE).map(toPositive);
      if (w && h) this._metadata.AspectRatio = `${w}:${h}`;
    }

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

    this._regions[id] = { id, style, begin, end, anims, ...this._regionBox(style) };
    this._regionIds.push(id);
  }

  /**
   * Resolves the region content box (percentages of the root container) from region styles:
   * `tts:origin`/`tts:position` and `tts:extent` give the region area, `tts:padding` insets it.
   */
  protected _regionBox(style: TTMLStyle): RegionBox {
    const origin = this._parseCoords(style.origin),
      extent = this._parseCoords(style.extent);

    let x = origin?.[0] ?? 0,
      y = origin?.[1] ?? 0;

    let w = extent?.[0] ?? 100 - x,
      h = extent?.[1] ?? 100 - y;

    // TTML2 `tts:position` places the region area within the root container like a CSS
    // `background-position`; it takes precedence over `tts:origin`.
    if (style.position) {
      const position = this._parsePosition(style.position, w, h);
      if (position) [x, y] = position;
    }

    const padding = this._parsePadding(style.padding, w, h, style.writingMode?.trim() ?? '');
    if (padding) {
      const [top, right, bottom, left] = padding;
      x += left;
      y += top;
      w = Math.max(0, w - left - right);
      h = Math.max(0, h - top - bottom);
    }

    return { x, y, w, h, displayAlign: style.displayAlign || 'before' };
  }

  /**
   * Parses `tts:position` (`[left|center|right|top|bottom|<length>]{1,2}` or keyword/offset pairs)
   * into the region origin. Percentages and keywords resolve against the free space left by the
   * region extent, so `center` centres the box and `right 10%` leaves a 10% margin on the right.
   */
  protected _parsePosition(value: string, w: number, h: number): [number, number] | null {
    const tokens = value.trim().split(WHITESPACE_RE);
    if (!tokens.length || tokens.length > 4) return null;

    type Component = { keyword?: string; offset?: string; length?: string };

    let xs: Component | undefined, ys: Component | undefined;

    const isH = (t: string) => t in H_KEYWORDS,
      isV = (t: string) => t in V_KEYWORDS,
      component = (t: string): Component => (isH(t) || isV(t) ? { keyword: t } : { length: t });

    if (tokens.length === 1) {
      const t = tokens[0];
      if (isV(t) && t !== 'center') ys = { keyword: t };
      else xs = component(t);
    } else if (tokens.length === 2) {
      const [a, b] = tokens;
      // `top left` / `center left`: the vertical component may come first.
      if ((isV(a) && a !== 'center') || (isH(b) && b !== 'center')) {
        ys = component(a);
        xs = component(b);
      } else {
        xs = component(a);
        ys = component(b);
      }
    } else {
      for (let i = 0; i < tokens.length;) {
        const keyword = tokens[i++];
        if (!isH(keyword) && !isV(keyword)) return null;
        const offset = i < tokens.length && LENGTH_RE.test(tokens[i]) ? tokens[i++] : undefined;
        const comp: Component = { keyword, offset };
        if (keyword === 'center') {
          if (xs) ys = comp;
          else xs = comp;
        } else if (isH(keyword)) xs = comp;
        else ys = comp;
      }
    }

    const x = this._resolvePosition(xs, w, this._rootWidth, this._cellColumns, H_KEYWORDS),
      y = this._resolvePosition(ys, h, this._rootHeight, this._cellRows, V_KEYWORDS);

    return x === null || y === null ? null : [x, y];
  }

  protected _resolvePosition(
    comp: { keyword?: string; offset?: string; length?: string } | undefined,
    size: number,
    rootSize: number,
    cells: number,
    keywords: Record<string, number>,
  ): number | null {
    const free = 100 - size;
    if (!comp) return free / 2;

    const length = (text: string): number | null => {
      const match = LENGTH_RE.exec(text);
      if (!match) return null;
      if (match[2] === '%') return (parseFloat(match[1]) / 100) * free;
      return this._parseLength(text, rootSize, cells);
    };

    if (comp.length !== undefined) return length(comp.length);

    const fraction = keywords[comp.keyword!];
    if (fraction === undefined) return null;

    const offset = comp.offset !== undefined ? length(comp.offset) : 0;
    if (offset === null) return null;

    // Offsets move away from the named edge; `center` takes none.
    if (fraction === 0.5) return free / 2;
    return fraction === 0 ? offset : free - offset;
  }

  /**
   * Parses `tts:padding` (1-4 lengths in `before end after start` order for the region's writing
   * mode) into physical `[top, right, bottom, left]` insets as percentages of the root container.
   * Percentages are relative to the region dimension along the padded side (TTML1 §8.2.10).
   */
  protected _parsePadding(
    value: string | undefined,
    w: number,
    h: number,
    writingMode: string,
  ): [number, number, number, number] | null {
    if (!value) return null;

    const parts = value.trim().split(WHITESPACE_RE);
    if (!parts.length || parts.length > 4) return null;

    const [before, end, after, start] =
      parts.length === 1
        ? [parts[0], parts[0], parts[0], parts[0]]
        : parts.length === 2
          ? [parts[0], parts[1], parts[0], parts[1]]
          : parts.length === 3
            ? [parts[0], parts[1], parts[2], parts[1]]
            : parts;

    let top: string, right: string, bottom: string, left: string;
    if (writingMode === 'tbrl' || writingMode === 'tb') {
      [right, left, top, bottom] = [before, after, start, end];
    } else if (writingMode === 'tblr') {
      [left, right, top, bottom] = [before, after, start, end];
    } else if (writingMode === 'rltb' || writingMode === 'rl') {
      [top, bottom, right, left] = [before, after, start, end];
    } else {
      [top, bottom, left, right] = [before, after, start, end];
    }

    const resolve = (text: string, size: number, rootSize: number, cells: number) => {
      const match = LENGTH_RE.exec(text);
      if (!match) return null;
      const length =
        match[2] === '%'
          ? (parseFloat(match[1]) / 100) * size
          : this._parseLength(text, rootSize, cells);
      return length === null ? null : Math.max(0, length);
    };

    const t = resolve(top, h, this._rootHeight, this._cellRows),
      r = resolve(right, w, this._rootWidth, this._cellColumns),
      b = resolve(bottom, h, this._rootHeight, this._cellRows),
      l = resolve(left, w, this._rootWidth, this._cellColumns);

    return t === null || r === null || b === null || l === null ? null : [t, r, b, l];
  }

  /** Resolves the id of the region a content element renders into (`''` when none applies). */
  protected _regionId(el: XMLElement, ctx: ContainerContext): string {
    return (
      el.attrs.region ?? ctx.region ?? (this._regionIds.length === 1 ? this._regionIds[0] : '')
    );
  }

  /** Resolves the region a content element renders into, if any. */
  protected _findRegion(el: XMLElement, ctx: ContainerContext): TTMLRegion | undefined {
    const id = this._regionId(el, ctx);
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

  /**
   * Resolves an IMSC 1.1 / TTML2 `<image>` child of a `div`: either embedded base64 content or a
   * `src` reference (`#id` or a data URL; external sources are not fetched).
   */
  protected _resolveImageElement(div: XMLElement): string | null {
    const image = findChild(div, 'image');
    if (!image) return null;

    const data = textContent(image).replace(ALL_WHITESPACE_RE, '');
    if (data && (image.attrs.encoding ?? 'base64').trim().toLowerCase() === 'base64') {
      const type = image.attrs.type?.trim();
      return `data:${type && type.includes('/') ? type : 'image/png'};base64,${data}`;
    }

    return this._resolveImage(image.attrs.src, image.line);
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
   * against `ttp:cellResolution` on the given axis; `rw`/`rh` (TTML2) are already percentages.
   */
  protected _parseLength(value: string, rootSize: number, cells: number): number | null {
    const match = LENGTH_RE.exec(value);
    if (!match) return null;
    const num = parseFloat(match[1]);
    switch (match[2]) {
      case '%':
      case 'rw':
      case 'rh':
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

  /** Element timing without error reporting, for look-ahead passes over already parsed nodes. */
  protected _silentTiming(el: XMLElement, parentBegin: number) {
    const beginOffset = el.attrs.begin ? parseTTMLTime(el.attrs.begin, this._time) : null,
      begin = parentBegin + (beginOffset || 0);

    let end: number | undefined;
    if (el.attrs.end !== undefined) {
      const offset = parseTTMLTime(el.attrs.end, this._time);
      if (offset !== null) end = parentBegin + offset;
    }
    if (el.attrs.dur !== undefined) {
      const dur = parseTTMLTime(el.attrs.dur, this._time);
      if (dur !== null) end = end === undefined ? begin + dur : Math.min(end, begin + dur);
    }

    return { begin, end, ownBegin: beginOffset !== null };
  }

  /**
   * The SMIL implicit end of an element (TTML1 §10.4): a `par` container ends with its last
   * child, a `seq` container when its children have run in sequence. Text is indefinite in a
   * `par` and zero-length in a `seq` container. Returns `undefined` for an indefinite duration.
   *
   * Inter-element whitespace and `br` are ignored: the spec makes a `br` indefinite too, but the
   * paragraph then only ever shows content while its timed spans are active, which is exactly
   * the interval this yields.
   */
  protected _implicitEnd(el: XMLElement, begin: number, seq: boolean): number | undefined {
    let end = begin,
      cursor = begin;

    for (const node of el.children) {
      if (typeof node === 'string') {
        if (!node.trim()) continue;
        if (!seq) return undefined;
        continue;
      }

      switch (node.name) {
        case 'metadata':
        case 'set':
        case 'animation':
        case 'br':
          continue;
      }

      const timing = this._silentTiming(node, seq ? cursor : begin),
        childEnd = timing.end ?? this._implicitEnd(node, timing.begin, isSeq(node));
      if (childEnd === undefined) return undefined;

      cursor = childEnd;
      end = seq ? childEnd : Math.max(end, childEnd);
    }

    return end;
  }

  /**
   * The active end of an element that produced no cue (for `seq` containers): its explicit end,
   * otherwise its implicit end clipped by the parent.
   */
  protected _activeEnd(el: XMLElement, timing: Timing, seq: boolean): number | undefined {
    if (timing.explicit) return timing.end;
    const implicit = this._implicitEnd(el, timing.begin, seq);
    if (timing.end === undefined) return implicit;
    return implicit === undefined ? timing.end : Math.min(timing.end, implicit);
  }

  /**
   * Resolves the end time of a cue-producing element: its explicit end, the implicit end of its
   * timed children, the next paragraph's begin, the region end, or the default duration (which
   * is reported). The result may not be after `timing.begin`; an inverted explicit interval is
   * reported here.
   */
  protected _resolveEnd(
    el: XMLElement,
    timing: Timing,
    ctx: ContainerContext,
    next: XMLElement | undefined,
    region: TTMLRegion | undefined,
    seq: boolean,
  ): number {
    const { begin } = timing,
      own = el.attrs.end !== undefined || el.attrs.dur !== undefined;
    let { end } = timing;

    if (!own) {
      // `<p><span begin=".." end=".."/></p>`: the paragraph ends with its last timed child.
      const implicit = this._implicitEnd(el, begin, seq);
      if (implicit !== undefined && (end === undefined || implicit < end)) end = implicit;
    }

    if (end === undefined && !own && next) {
      // Common in live EBU-TT-D and auto-generated files: a paragraph without `end`/`dur` runs
      // until the next paragraph begins. The sibling reports its own timing errors when parsed.
      const nextBegin = next.attrs.begin ? parseTTMLTime(next.attrs.begin, this._time) : null;
      if (nextBegin !== null && ctx.begin + nextBegin > begin) end = ctx.begin + nextBegin;
    }

    // A timed region bounds everything shown in it.
    if (end === undefined && region?.end !== undefined) end = region.end;

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

    if (end <= begin && timing.explicit) {
      this._handleError(
        this._buildError(
          ParseErrorCode.BadTimestamp,
          `cue end time \`${end}\` is not greater than start time \`${begin}\` on line ${el.line}`,
          el.line,
        ),
      );
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

  /**
   * Walks a `body`/`div` container. In a `seq` time container each child begins where the
   * previous one ended. Returns the container's active end (for a parent `seq`), `undefined`
   * when indefinite.
   */
  protected _walkContainer(el: XMLElement, ctx: ContainerContext): number | undefined {
    const timing = this._resolveTiming(el, ctx),
      ownStyle = this._elementStyle(el),
      seq = isSeq(el),
      anims = ctx.anims.slice();

    // `<set>` on a container applies to every paragraph within its interval.
    for (const node of el.children) {
      if (typeof node !== 'string' && node.name === 'set') {
        this._collectAnimation(node, el, timing, anims);
      }
    }

    const child: ContainerContext = {
      begin: timing.begin,
      end: timing.end,
      style: { ...ctx.style, ...ownStyle },
      lang: el.attrs.lang ?? ctx.lang,
      preserve: el.attrs.space ? el.attrs.space === 'preserve' : ctx.preserve,
      region: el.attrs.region ?? ctx.region,
      anims,
    };

    // IMSC image profile / SMPTE-TT: a `div` may paint an embedded image over its region, either
    // as `smpte:backgroundImage` or (IMSC 1.1) an `<image>` child.
    if (el.name === 'div' && !timing.badBegin) {
      const image =
        this._resolveImage(ownStyle.backgroundImage, el.line) ?? this._resolveImageElement(el);
      if (image) {
        const region = this._findRegion(el, ctx),
          end = this._resolveEnd(el, timing, ctx, undefined, region, seq);
        this._emitImageCue(el, timing.begin, end, image, region, isForced(child.style));
      }
    }

    const nodes = el.children;

    let cursor = timing.begin,
      implicit = timing.begin,
      indefinite = false;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (typeof node === 'string') continue;

      switch (node.name) {
        case 'metadata':
        case 'set':
        case 'animation':
        case 'image':
          continue;
      }

      // An indefinite child of a `seq` container: later siblings never begin.
      if (seq && !Number.isFinite(cursor)) break;

      const parent = seq ? { ...child, begin: cursor } : child,
        end =
          node.name === 'p'
            ? this._parseParagraph(node, parent, seq ? undefined : nextParagraph(nodes, i + 1), seq)
            : this._walkContainer(node, parent);

      if (end === undefined) indefinite = true;
      else implicit = seq ? end : Math.max(implicit, end);
      if (seq) cursor = end ?? Infinity;
    }

    if (timing.explicit || indefinite) return timing.end;
    return timing.end === undefined ? implicit : Math.min(timing.end, implicit);
  }

  /**
   * Parses a paragraph into one or more cues. Returns the paragraph's active end (for a parent
   * `seq` container), `undefined` when indefinite or skipped.
   */
  protected _parseParagraph(
    el: XMLElement,
    ctx: ContainerContext,
    next: XMLElement | undefined,
    seq: boolean,
  ): number | undefined {
    const timing = this._resolveTiming(el, ctx);
    if (timing.badBegin) return;

    const regionId = this._regionId(el, ctx),
      region: TTMLRegion | undefined = this._regions[regionId],
      ownStyle = this._elementStyle(el),
      pSeq = isSeq(el);

    const resolveStyle = (base: TTMLStyle): TTMLStyle => ({
      ...inheritedStyle(base),
      ...(region ? inheritedStyle(region.style) : {}),
      ...ownStyle,
    });

    const style = resolveStyle(ctx.style),
      lang = el.attrs.lang ?? ctx.lang,
      preserve = el.attrs.space ? el.attrs.space === 'preserve' : ctx.preserve;

    const inline = (
      sliceStyle: TTMLStyle,
      at: number,
      until: number,
      probe: boolean,
    ): InlineContext => ({
      begin: timing.begin,
      style: sliceStyle,
      pStyle: sliceStyle,
      lang,
      baseLang: lang,
      preserve,
      inRuby: false,
      timestamp: undefined,
      region: regionId,
      at,
      until,
      rt: undefined,
      probe,
      spans: { keys: new Map(), styles: {} },
    });

    // First pass: is there anything to show at all? Span timing errors are reported once, here.
    const content: TextRun[] = [];
    this._collectRuns(el, inline(style, -Infinity, Infinity, true), content);
    normalizeRuns(content);

    const image = this._resolveImage(ownStyle.backgroundImage, el.line);
    if (!content.length && !image) return this._activeEnd(el, timing, pSeq);

    const begin = timing.begin,
      end = this._resolveEnd(el, timing, ctx, seq ? undefined : next, region, pSeq);
    if (end <= begin) return begin;

    // A timed region only shows content while it is active.
    let cueBegin = begin,
      cueEnd = end;
    if (region) {
      if (region.begin > cueBegin) cueBegin = region.begin;
      if (region.end !== undefined && region.end < cueEnd) cueEnd = region.end;
    }
    if (cueEnd <= cueBegin) return end;

    if (image) this._emitImageCue(el, cueBegin, cueEnd, image, region, isForced(style));
    if (!content.length) return end;

    // `<set>` animations on the paragraph, its spans, its containers or its region, and spans
    // that end before the paragraph does, split the paragraph into consecutive cues, one per
    // interval over which the rendered content is constant.
    const anims: TTMLAnimation[] = [],
      spanEnds: number[] = [],
      bounds = new Set<number>([cueBegin, cueEnd]),
      addBound = (time: number) => {
        if (time > cueBegin && time < cueEnd) bounds.add(time);
      };

    this._collectAnimations(el, begin, end, anims, spanEnds);

    const regionAnims = region?.anims ?? [],
      containerAnims = ctx.anims;

    for (const anim of [...containerAnims, ...anims, ...regionAnims]) {
      addBound(anim.begin);
      if (anim.end !== undefined) addBound(anim.end);
    }
    for (const time of spanEnds) addBound(time);

    const times = [...bounds].sort((a, b) => a - b);
    // Keep the first `MAX_SLICES - 1` boundaries and the paragraph end; later animations are
    // folded into the last slice (which renders the styles active at its start).
    if (times.length > MAX_SLICES + 1) times.splice(MAX_SLICES, times.length - MAX_SLICES - 1);

    // Pending cue per region: consecutive slices that render identically are coalesced.
    const pending = new Map<string, { cue: VTTCue; key: string }>(),
      hasRegions = this._regionIds.length > 0;

    for (let i = 0; i < times.length - 1; i++) {
      const sliceBegin = times[i],
        sliceEnd = times[i + 1];

      let containerStyle: TTMLStyle | undefined;
      for (const anim of containerAnims) {
        if (!isActive(anim, sliceBegin)) continue;
        containerStyle = { ...(containerStyle ?? ctx.style), ...anim.style };
      }

      this._activeSets.clear();
      for (const anim of anims) {
        if (!isActive(anim, sliceBegin)) continue;
        const current = this._activeSets.get(anim.target);
        this._activeSets.set(anim.target, current ? { ...current, ...anim.style } : anim.style);
      }

      let sliceRegion = region;
      if (region && regionAnims.length) {
        let regionStyle: TTMLStyle | undefined;
        for (const anim of regionAnims) {
          if (!isActive(anim, sliceBegin)) continue;
          regionStyle = { ...(regionStyle ?? region.style), ...anim.style };
        }
        if (regionStyle) {
          sliceRegion = { ...region, style: regionStyle, ...this._regionBox(regionStyle) };
        }
      }

      const overrides = this._activeSets.get(el),
        base = containerStyle ? resolveStyle(containerStyle) : style,
        sliceStyle = overrides ? { ...base, ...overrides } : base,
        sliceCtx = inline(sliceStyle, sliceBegin, sliceEnd, false),
        runs: TextRun[] = [];

      this._collectRuns(el, sliceCtx, runs);
      normalizeRuns(runs);

      // Spans with their own `region` render into that region (TTML1 §9.3.2); with declared
      // regions, content that resolves to none is not shown.
      const groups = new Map<string, TextRun[]>();
      for (const run of runs) {
        let group = groups.get(run.region);
        if (!group) groups.set(run.region, (group = []));
        group.push(run);
      }
      if (groups.size > 1 && hasRegions) groups.delete('');

      const seen = new Set<string>();

      for (const [id, groupRuns] of groups) {
        if (groups.size > 1) normalizeRuns(groupRuns);
        if (!groupRuns.length) continue;

        // Content that only begins later in the slice (all runs timed) starts the cue then.
        const start = leadTimestamp(groupRuns, sliceBegin) ?? sliceBegin;
        if (start >= sliceEnd) continue;

        const cue = this._buildTextCue(
            el,
            start,
            sliceEnd,
            groupRuns,
            sliceStyle,
            id === regionId ? sliceRegion : this._regions[id],
            sliceCtx.spans.styles,
          ),
          key = cueRenderKey(cue),
          prev = pending.get(id);

        seen.add(id);

        if (prev && prev.key === key && prev.cue.endTime === start) {
          // Coalesce: the animation did not change what is rendered.
          prev.cue.endTime = sliceEnd;
          continue;
        }

        if (prev) this._emit(prev.cue);
        pending.set(id, { cue, key });
      }

      // Hidden for this interval: flush, nothing to coalesce with.
      for (const [id, prev] of pending) {
        if (seen.has(id)) continue;
        this._emit(prev.cue);
        pending.delete(id);
      }
    }

    for (const prev of pending.values()) this._emit(prev.cue);

    return end;
  }

  /**
   * Collects `<set>` animations on a paragraph and its descendant spans in document time, plus
   * the end times of spans with `end`/`dur` (the paragraph is sliced there so they disappear).
   */
  protected _collectAnimations(
    el: XMLElement,
    begin: number,
    end: number | undefined,
    out: TTMLAnimation[],
    spanEnds: number[],
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
          // in the expressions are reported when the runs are collected.
          const timing = this._silentTiming(node, begin);
          if (timing.end !== undefined) spanEnds.push(timing.end);
          this._collectAnimations(node, timing.begin, timing.end ?? end, out, spanEnds);
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
    forced: boolean,
  ) {
    if (region) {
      if (region.begin > begin) begin = region.begin;
      if (region.end !== undefined && region.end < end) end = region.end;
    }
    if (end <= begin) return;

    const cue = new VTTCue(begin, end, '');

    if (el.attrs.id) cue.id = el.attrs.id;

    cue.layout = region
      ? { left: region.x, top: region.y, width: region.w, height: region.h }
      : { left: 0, top: 0, width: 100, height: 100 };

    cue.textStyle = { backgroundImage: `url(${url})`, backgroundColor: 'transparent' };
    if (forced) cue.textStyle.className = 'forced';

    this._emit(cue);
  }

  protected _buildTextCue(
    el: XMLElement,
    begin: number,
    end: number,
    runs: TextRun[],
    style: TTMLStyle,
    region: TTMLRegion | undefined,
    spans: Record<string, CueSpanStyle>,
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

    const rows = this._cellRows,
      rootHeight = this._rootHeight,
      textStyle: CueTextStyle = {};

    const fontSize = toCSSFontSize(style.fontSize, rows, rootHeight, false);
    if (fontSize) textStyle.fontSize = fontSize;

    const lineHeight = toCSSLineHeight(style.lineHeight, rows, rootHeight);
    if (lineHeight) textStyle.lineHeight = lineHeight;

    const textStroke = style.textOutline
      ? toCSSTextStroke(style.textOutline, rows, rootHeight)
      : null;
    if (textStroke && textStroke !== '0') textStyle.textStroke = textStroke;

    const textShadow = style.textShadow
      ? toCSSTextShadow(style.textShadow, rows, rootHeight)
      : null;
    if (textShadow && textShadow !== 'none') textStyle.textShadow = textShadow;

    // `tts:opacity` is not inherited, so it only applies from the paragraph or its region.
    const opacity = toOpacity(style.opacity ?? region?.style.opacity);
    if (opacity !== null) textStyle.opacity = opacity;

    // Hosts that only want forced narrative subtitles filter cues by this class.
    if (isForced(style)) textStyle.className = 'forced';

    if (Object.keys(textStyle).length) cue.textStyle = textStyle;

    let used: Record<string, CueSpanStyle> | undefined;
    for (const run of runs) {
      if (run.spanKey && spans[run.spanKey]) (used ??= {})[run.spanKey] = spans[run.spanKey];
    }
    if (used) cue.spans = used;

    return cue;
  }

  protected _collectRuns(el: XMLElement, ctx: InlineContext, runs: TextRun[]) {
    // `tts:display="none"` removes the subtree; `tts:visibility="hidden"` content is not
    // rendered (a descendant may turn it back on).
    if (!ctx.probe && ctx.style.display?.trim() === 'none') return;

    const spanKey = this._spanKey(ctx),
      tags = buildTags(ctx, spanKey),
      hidden = !ctx.probe && ctx.style.visibility?.trim() === 'hidden',
      // Text directly inside ruby containers is only inter-element whitespace.
      rubyContainer = RUBY_CONTAINERS.has(ctx.style.ruby ?? '');

    for (const node of el.children) {
      if (typeof node === 'string') {
        if (hidden || rubyContainer) continue;
        runs.push({
          text: node,
          tags,
          preserve: ctx.preserve,
          br: false,
          timestamp: ctx.timestamp,
          region: ctx.region,
          spanKey,
          rt: ctx.rt,
        });
        continue;
      }

      switch (node.name) {
        case 'br':
          if (hidden) break;
          runs.push({
            text: '\n',
            tags,
            preserve: true,
            br: true,
            timestamp: undefined,
            region: ctx.region,
            spanKey,
            rt: ctx.rt,
          });
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

          if (ctx.probe) {
            this._parseTime(node.attrs.begin, node.line);
            this._parseTime(node.attrs.end, node.line);
            this._parseTime(node.attrs.dur, node.line);
          }

          const timing = this._silentTiming(node, ctx.begin);
          // Already finished, or not started, within the interval being collected.
          if (timing.end !== undefined && timing.end <= ctx.at) break;
          if (timing.begin >= ctx.until) break;

          const child: InlineContext = {
            ...ctx,
            begin: timing.begin,
            style,
            lang: node.attrs.lang ?? ctx.lang,
            preserve: node.attrs.space ? node.attrs.space === 'preserve' : ctx.preserve,
            inRuby: ctx.inRuby || style.ruby === 'container',
            timestamp: timing.ownBegin ? timing.begin : ctx.timestamp,
            region: node.attrs.region ?? ctx.region,
            rt: style.ruby === 'text' ? node : ctx.rt,
          };

          this._collectRuns(node, child, runs);
        }
      }
    }
  }

  /**
   * Registers a `cue.spans` entry for a span whose resolved typography differs from the
   * paragraph's, returning its key. Exact WebVTT palette colours keep using `<c.COLOR>` classes.
   */
  protected _spanKey(ctx: InlineContext): string | undefined {
    const s = ctx.style,
      p = ctx.pStyle;
    if (s === p) return;

    const rows = this._cellRows,
      rootHeight = this._rootHeight,
      span: CueSpanStyle = {};

    if (s.fontSize !== p.fontSize) {
      // Relative to the paragraph font size, which the cue element carries.
      const value = toCSSFontSize(s.fontSize, rows, rootHeight, true);
      if (value) span.fontSize = value;
    }

    if (s.fontFamily !== p.fontFamily) {
      const value = toCSSFontFamily(s.fontFamily);
      if (value) span.fontFamily = value;
    }

    if (s.textOutline !== p.textOutline) {
      const value = toCSSTextStroke(s.textOutline ?? 'none', rows, rootHeight);
      if (value) span.textStroke = value;
    }

    if (s.color !== p.color && !toVTTColor(s.color, true)) {
      const value = toCSSColor(s.color);
      if (value) span.color = value;
    }

    // A transparent span background needs no style: the paragraph's palette class is simply not
    // applied to the span (non-palette paragraph backgrounds are not rendered at all).
    if (
      s.backgroundColor !== p.backgroundColor &&
      !toVTTColor(s.backgroundColor, true) &&
      !isTransparent(s.backgroundColor)
    ) {
      const value = toCSSColor(s.backgroundColor);
      if (value) span.backgroundColor = value;
    }

    if (s.opacity !== p.opacity) {
      const num = parseFloat(s.opacity ?? '1');
      if (num >= 0) span.opacity = String(Math.min(1, num));
    }

    if (s.textShadow !== p.textShadow) {
      const value = toCSSTextShadow(s.textShadow ?? 'none', rows, rootHeight);
      if (value) span.textShadow = value;
    }

    const json = JSON.stringify(span);
    if (json === '{}') return;

    let key = ctx.spans.keys.get(json);
    if (!key) {
      key = String(ctx.spans.keys.size + 1);
      ctx.spans.keys.set(json, key);
      ctx.spans.styles[key] = span;
    }
    return key;
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

function isActive(anim: TTMLAnimation, time: number) {
  return anim.begin <= time && (anim.end === undefined || anim.end > time);
}

function isForced(style: TTMLStyle) {
  return style.forcedDisplay?.trim() === 'true';
}

/** Returns the next `p` element sibling starting at `from`, if any. */
function nextParagraph(nodes: (XMLElement | string)[], from: number): XMLElement | undefined {
  for (let i = from; i < nodes.length; i++) {
    const node = nodes[i];
    if (typeof node !== 'string' && node.name === 'p') return node;
  }
}

/**
 * When every run of a cue is timed and begins after the slice, the cue can simply start with the
 * first of them instead of showing an empty box until then.
 */
function leadTimestamp(runs: TextRun[], begin: number): number | undefined {
  let min: number | undefined;
  for (const run of runs) {
    if (run.br) continue;
    if (run.timestamp === undefined || run.timestamp <= begin) return;
    if (min === undefined || run.timestamp < min) min = run.timestamp;
  }
  return min;
}

/**
 * Converts a TTML length into a CSS value relative to the overlay.
 *
 * - `%`: relative to the default font size (5% of the overlay height), or when `relative` to the
 *   inherited font size as `em` (span font sizes, outlines, shadows).
 * - `c`: cell units, one cell being `1 / rows` of the overlay height.
 * - `px`: relative to the root container height (`tts:extent` on `<tt>`, default 1080).
 * - `rw` / `rh` (TTML2): percentages of the overlay width / height.
 * - `em`: passed through, relative to the inherited font size.
 */
function toCSSLength(value: string, rows: number, rootHeight: number, relative: boolean) {
  const match = LENGTH_RE.exec(value);
  if (!match) return null;

  const num = parseFloat(match[1]);

  switch (match[2]) {
    case '%':
      return relative
        ? `${round(num / 100)}em`
        : `calc(var(--overlay-height) * ${BASE_FONT_SIZE} * ${round(num / 100)})`;
    case 'c':
      return `calc(var(--overlay-height) * ${round(num / rows)})`;
    case 'px':
      return `calc(var(--overlay-height) * ${round(num / rootHeight)})`;
    case 'rh':
      return `calc(var(--overlay-height) * ${round(num / 100)})`;
    case 'rw':
      return `calc(var(--overlay-width) * ${round(num / 100)})`;
    case 'em':
      return `${num}em`;
    default:
      return null;
  }
}

/**
 * Converts a TTML `tts:fontSize` into a CSS value. Two-value font sizes use the second
 * (vertical) value. Returns `null` for unsupported units.
 */
function toCSSFontSize(
  value: string | undefined,
  rows: number,
  rootHeight: number,
  relative: boolean,
) {
  if (!value) return null;

  const parts = value.trim().split(WHITESPACE_RE),
    size = parts[parts.length - 1];

  if (!(parseFloat(size) > 0)) return null;
  return toCSSLength(size, rows, rootHeight, relative);
}

/** Converts `tts:lineHeight` to CSS: `normal`, a unitless multiple for `%`, or a scaled length. */
function toCSSLineHeight(value: string | undefined, rows: number, rootHeight: number) {
  if (!value) return null;

  const text = value.trim();
  if (text === 'normal') return text;

  const match = LENGTH_RE.exec(text);
  if (!match || !(parseFloat(match[1]) >= 0)) return null;
  if (match[2] === '%') return String(round(parseFloat(match[1]) / 100));
  return toCSSLength(text, rows, rootHeight, true);
}

/**
 * Converts `tts:textOutline` (`none | <color>? <length> <length>?`) to a CSS text stroke
 * (`<width> <color>`); the blur radius has no CSS equivalent. `none` yields `0`.
 */
function toCSSTextStroke(value: string, rows: number, rootHeight: number) {
  const text = value.trim();
  if (!text) return null;
  if (text === 'none') return '0';

  const parts = text.split(WHITESPACE_RE);
  let color: string | null = null,
    i = 0;

  if (!LENGTH_RE.test(parts[0])) {
    color = toCSSColor(parts[0]);
    if (!color) return null;
    i = 1;
  }

  if (!parts[i] || !(parseFloat(parts[i]) >= 0)) return null;
  const width = toCSSLength(parts[i], rows, rootHeight, true);
  if (!width) return null;

  return color ? `${width} ${color}` : width;
}

/** Converts `tts:textShadow` (`none | [<length>{2,3} <color>?]#`) to CSS `text-shadow`. */
function toCSSTextShadow(value: string, rows: number, rootHeight: number) {
  const text = value.trim();
  if (!text) return null;
  if (text === 'none') return 'none';

  const shadows: string[] = [];

  for (const part of text.split(',')) {
    const lengths: string[] = [];
    let color: string | null = null;

    for (const token of part.trim().split(WHITESPACE_RE)) {
      if (LENGTH_RE.test(token)) {
        const length = toCSSLength(token, rows, rootHeight, true);
        if (!length) return null;
        lengths.push(length);
      } else {
        color = toCSSColor(token);
        if (!color) return null;
      }
    }

    if (lengths.length < 2 || lengths.length > 3) return null;
    shadows.push(color ? `${lengths.join(' ')} ${color}` : lengths.join(' '));
  }

  return shadows.join(', ');
}

/** Maps a TTML `tts:fontFamily` list to CSS, translating generic family names. */
function toCSSFontFamily(value: string | undefined) {
  if (!value) return null;

  const families: string[] = [];
  for (const part of value.split(',')) {
    const name = part.trim().replace(QUOTES_RE, '').trim();
    if (!name) continue;
    const generic = FONT_FAMILIES[name];
    if (generic === '') continue; // `default`: leave the host font alone
    families.push(generic ?? (WHITESPACE_RE.test(name) ? `"${name}"` : name));
  }

  return families.length ? families.join(', ') : null;
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
    cue.spans,
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

/**
 * The alpha of a TTML `rgba()` component: TTML uses `0-255`, but CSS-style fractions are common
 * in the wild and are recognised by their decimal point.
 */
function rgbaAlpha(text: string) {
  const num = parseFloat(text);
  return text.includes('.') && num <= 1 ? num : Math.min(255, num) / 255;
}

/** Whether a TTML colour is fully transparent. */
function isTransparent(value: string | undefined) {
  if (!value) return false;
  const color = value.trim().toLowerCase();
  if (color === 'transparent') return true;
  const hex = HEX_COLOR_RE.exec(color);
  if (hex) return hex[2] === '00';
  const rgb = RGB_COLOR_RE.exec(color);
  return !!rgb && rgb[4] !== undefined && rgbaAlpha(rgb[4]) === 0;
}

/**
 * Maps a TTML colour to one of the WebVTT colour names, or `null` if not supported. With
 * `exact`, translucent colours do not match either.
 */
function toVTTColor(value: string | undefined, exact = false): string | null {
  if (!value) return null;

  const color = value.trim().toLowerCase();
  if (VTT_COLORS.has(color)) return color;

  let match = HEX_COLOR_RE.exec(color);
  if (match) {
    if (match[2] === '00') return null; // fully transparent
    if (exact && match[2] && match[2] !== 'ff') return null;
    return COLOR_NAMES[match[1]] ?? null;
  }

  match = RGB_COLOR_RE.exec(color);
  if (match) {
    if (match[4] !== undefined) {
      const alpha = rgbaAlpha(match[4]);
      if (alpha === 0 || (exact && alpha < 1)) return null;
    }
    const hex = [match[1], match[2], match[3]]
      .map((n) => Math.min(255, +n).toString(16).padStart(2, '0'))
      .join('');
    return COLOR_NAMES[hex] ?? null;
  }

  return null;
}

/** Converts a TTML colour (named, `#rrggbb[aa]`, `rgb()`, `rgba()`) to CSS. */
function toCSSColor(value: string | undefined): string | null {
  if (!value) return null;

  const color = value.trim().toLowerCase();
  if (COLOR_NAME_RE.test(color) || HEX_COLOR_RE.test(color)) return color;

  const match = RGB_COLOR_RE.exec(color);
  if (!match) return null;

  const [r, g, b] = [match[1], match[2], match[3]].map((n) => Math.min(255, +n));
  if (match[4] === undefined) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${round(rgbaAlpha(match[4]), 3)})`;
}

/** Builds the ordered list of WebVTT tags that apply to text within the given context. */
function buildTags(ctx: InlineContext, spanKey: string | undefined): string[] {
  const { style, pStyle } = ctx,
    tags: string[] = [];

  if (ctx.lang && ctx.lang !== ctx.baseLang) tags.push('lang ' + ctx.lang);
  if (ctx.inRuby) tags.push('ruby');
  if (ctx.inRuby && style.ruby === 'text') tags.push('rt');

  // A span colour that differs from the paragraph's only maps to a palette class when it is
  // exactly that colour; otherwise `_spanKey` carries it as a span style.
  const inSpan = style !== pStyle,
    classes: string[] = [],
    color = toVTTColor(style.color, inSpan && style.color !== pStyle.color),
    bgColor = toVTTColor(
      style.backgroundColor,
      inSpan && style.backgroundColor !== pStyle.backgroundColor,
    );

  if (color) classes.push(color);
  if (bgColor) classes.push('bg_' + bgColor);
  if (spanKey) classes.push('s-' + spanKey);
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
    lastTimestamp: number | undefined,
    lastRt: XMLElement | undefined;

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

    // Consecutive ruby texts share tags but must not merge into one annotation.
    if (run.rt && lastRt && run.rt !== lastRt) {
      const rt = run.tags.indexOf('rt');
      if (rt >= 0 && rt < common) common = rt;
    }
    lastRt = run.rt;

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
