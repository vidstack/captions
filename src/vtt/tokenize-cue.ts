import type { CueSpanStyle, VTTCue } from './vtt-cue';
import { parseVTTTimestamp } from './vtt-parser';

const DIGIT_RE = /[0-9]/,
  MULTI_SPACE_RE = /[\s\t]+/g,
  TAG_NAME: Record<string, string> = {
    c: 'span',
    i: 'i',
    b: 'b',
    u: 'u',
    ruby: 'ruby',
    rt: 'rt',
    v: 'span',
    lang: 'span',
    timestamp: 'span',
  },
  HTML_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u{a0}',
    lrm: '\u{200e}',
    rlm: '\u{200f}',
    hellip: '\u{2026}',
    ndash: '\u{2013}',
    mdash: '\u{2014}',
    lsquo: '\u{2018}',
    rsquo: '\u{2019}',
    ldquo: '\u{201c}',
    rdquo: '\u{201d}',
    laquo: '\u{ab}',
    raquo: '\u{bb}',
    copy: '\u{a9}',
    reg: '\u{ae}',
    trade: '\u{2122}',
    deg: '\u{b0}',
    middot: '\u{b7}',
    bull: '\u{2022}',
    iexcl: '\u{a1}',
    iquest: '\u{bf}',
    frac12: '\u{bd}',
    frac14: '\u{bc}',
    frac34: '\u{be}',
    times: '\u{d7}',
    divide: '\u{f7}',
    euro: '\u{20ac}',
    pound: '\u{a3}',
    yen: '\u{a5}',
    cent: '\u{a2}',
    not: '\u{ac}',
    notin: '\u{2209}',
    para: '\u{b6}',
    sect: '\u{a7}',
    shy: '\u{ad}',
    plusmn: '\u{b1}',
    micro: '\u{b5}',
    sup2: '\u{b2}',
    sup3: '\u{b3}',
    AMP: '&',
    LT: '<',
    GT: '>',
    QUOT: '"',
    COPY: '\u{a9}',
    REG: '\u{ae}',
  },
  // HTML legacy references that decode even without a trailing `;` (Latin-1 subset we ship).
  LEGACY_ENTITIES = new Set([
    'amp',
    'AMP',
    'lt',
    'LT',
    'gt',
    'GT',
    'quot',
    'QUOT',
    'nbsp',
    'copy',
    'COPY',
    'reg',
    'REG',
    'not',
    'para',
    'sect',
    'shy',
    'deg',
    'plusmn',
    'micro',
    'middot',
    'iexcl',
    'iquest',
    'laquo',
    'raquo',
    'frac12',
    'frac14',
    'frac34',
    'times',
    'divide',
    'pound',
    'yen',
    'cent',
    'sup2',
    'sup3',
  ]),
  HTML_ENTITY_RE = /&(?:#(\d+);|#[xX]([0-9a-fA-F]+);|([a-zA-Z][a-zA-Z0-9]*)(;?))/g,
  COLORS = /*#__PURE__*/ new Set([
    'white',
    'lime',
    'cyan',
    'red',
    'yellow',
    'magenta',
    'blue',
    'black',
  ]),
  HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  SPAN_KEY_RE = /^s-(.+)$/,
  MAX_DEPTH = 64,
  BLOCK_TYPES = /*#__PURE__*/ new Set(Object.keys(TAG_NAME));

const enum Mode {
  Data = 1,
  Tag = 2,
  Class = 3,
  Annotation = 4,
  EndTag = 5,
  Timestamp = 6,
}

/**
 * Tokenizes WebVTT cue text into a tree of nodes. Text data and annotations are entity-decoded, so
 * they must be escaped again before being inserted into HTML (see `renderVTTTokensString`).
 *
 * @see {@link https://www.w3.org/TR/webvtt1/#cue-text-parsing-rules}
 */
export function tokenizeVTTCue(cue: VTTCue): VTTNode[] {
  // Rendering re-tokenizes a cue every time its element is (re)created; cache on the cue and
  // invalidate when the text or span table changes.
  const cached = TOKEN_CACHE.get(cue);
  if (cached && cached.text === cue.text && cached.spans === cue.spans) return cached.tokens;
  const tokens = tokenize(cue);
  TOKEN_CACHE.set(cue, { text: cue.text, spans: cue.spans, tokens });
  return tokens;
}

const TOKEN_CACHE = new WeakMap<VTTCue, { text: string; spans: unknown; tokens: VTTNode[] }>();

function tokenize(cue: VTTCue): VTTNode[] {
  let buffer = '',
    mode: Mode = Mode.Data,
    result: VTTNode[] = [],
    stack: VTTBlockNode[] = [],
    node: VTTBlockNode | undefined;

  for (let i = 0; i < cue.text.length; i++) {
    const char = cue.text[i];
    switch (mode as Mode) {
      case Mode.Data:
        if (char === '<') {
          addText();
          mode = Mode.Tag;
        } else {
          buffer += char;
        }
        break;
      case Mode.Tag:
        switch (char) {
          case '\n':
          case '\t':
          case ' ':
            addNode();
            mode = Mode.Annotation;
            break;
          case '.':
            addNode();
            mode = Mode.Class;
            break;
          case '/':
            // Also treats self-closing tags such as `<br/>` as unknown tags that are skipped.
            buffer = '';
            mode = Mode.EndTag;
            break;
          case '>':
            addNode();
            mode = Mode.Data;
            break;
          default:
            if (!buffer && DIGIT_RE.test(char)) mode = Mode.Timestamp;
            buffer += char;
            break;
        }
        break;
      case Mode.Class:
        switch (char) {
          case '\t':
          case ' ':
          case '\n':
            addClass();
            mode = Mode.Annotation;
            break;
          case '.':
            addClass();
            break;
          case '>':
            addClass();
            mode = Mode.Data;
            break;
          default:
            buffer += char;
        }
        break;
      case Mode.Annotation:
        if (char === '>') {
          setAnnotation();
          mode = Mode.Data;
        } else {
          buffer += char;
        }
        break;
      case Mode.EndTag:
        if (char === '>') {
          // End tag names are matched verbatim; `</ c>` does not close `<c>`.
          closeNode(buffer);
          buffer = '';
          mode = Mode.Data;
        } else {
          buffer += char;
        }
        break;
      case Mode.Timestamp:
        if (char === '>') {
          addTimestamp();
          mode = Mode.Data;
        } else {
          buffer += char;
        }
        break;
    }
  }

  // End of input: emit whatever tag was being read (the spec's tokenizer returns the pending
  // start tag / timestamp tag on EOF).
  switch (mode as Mode) {
    case Mode.Tag:
      addNode();
      break;
    case Mode.Class:
      addClass();
      break;
    case Mode.Annotation:
      setAnnotation();
      break;
    case Mode.Timestamp:
      addTimestamp();
      break;
  }

  function addTimestamp() {
    const time = parseVTTTimestamp(buffer);
    // The spec does not range-check timestamps; renderers simply treat them as past or future.
    if (time !== null) {
      // Timestamps do not nest: a new timestamp ends the previous timed segment.
      if (node?.type === 'timestamp') node = stack.pop();
      buffer = 'timestamp';
      addNode();
      (node as VTTTimestampNode).time = time;
    }
    buffer = '';
  }

  function setAnnotation() {
    buffer = buffer.replace(MULTI_SPACE_RE, ' ').trim();
    if (node?.type === 'v') node.voice = replaceHTMLEntities(buffer);
    else if (node?.type === 'lang') node.lang = replaceHTMLEntities(buffer);
    buffer = '';
  }

  function addNode() {
    // `<rt>` is only meaningful directly inside `<ruby>`; elsewhere it is an unknown tag. Nesting
    // is capped so hostile input can not overflow the renderer's recursion.
    if (
      BLOCK_TYPES.has(buffer) &&
      (buffer !== 'rt' || node?.type === 'ruby') &&
      stack.length < MAX_DEPTH
    ) {
      const parent = node;
      node = createBlockNode(buffer);
      if (parent) {
        if (stack[stack.length - 1] !== parent) stack.push(parent);
        parent.children.push(node);
      } else result.push(node);
    }

    buffer = '';
    mode = Mode.Data;
  }

  /**
   * Closes the nearest open node matching the end tag name. Unknown or mismatched end tags are
   * ignored so they can not corrupt nesting (e.g., `</font>` from SRT files).
   */
  function closeNode(name: string) {
    if (!node) return;

    // Ancestors first, current node last.
    const chain = [...stack, node];

    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].type === name) {
        node = i > 0 ? chain[i - 1] : undefined;
        stack.length = Math.max(0, i - 1);
        return;
      }
    }
  }

  function addClass() {
    if (node && buffer) {
      const color = buffer.replace('bg_', '');
      // Hex colours are a non-spec extension so other formats (SRT, SSA, TTML) can carry
      // arbitrary colours through cue text.
      const spanKey = buffer.match(SPAN_KEY_RE)?.[1];
      if (spanKey !== undefined && cue.spans?.[spanKey]) {
        // `<c.s-KEY>` references a per-cue span style instead of a CSS class.
        node.span = cue.spans[spanKey];
        node.spanKey = spanKey;
      } else if (COLORS.has(color) || HEX_COLOR_RE.test(color)) {
        node[buffer.startsWith('bg_') ? 'bgColor' : 'color'] = color.toLowerCase();
      } else {
        node.class = !node.class ? buffer : node.class + ' ' + buffer;
      }
    }

    buffer = '';
  }

  function addText() {
    if (!buffer) return;
    const text: VTTextNode = { type: 'text', data: replaceHTMLEntities(buffer) };
    if (node) node.children.push(text);
    else result.push(text);
    buffer = '';
  }

  if (mode === Mode.Data) addText();

  return result;
}

function createBlockNode(type: string): VTTBlockNode {
  return {
    tagName: TAG_NAME[type],
    type,
    children: [],
  } as VTTBlockNode;
}

/**
 * Extends the named character reference table (e.g., with the full HTML table from
 * `media-captions/entities`). Names in `legacy` also decode without a trailing `;`.
 */
export function registerHTMLEntities(entities: Record<string, string>, legacy?: Iterable<string>) {
  Object.assign(HTML_ENTITIES, entities);
  if (legacy) for (const name of legacy) LEGACY_ENTITIES.add(name);
}

/**
 * Decodes named and numeric HTML character references in WebVTT cue text.
 */
export function replaceHTMLEntities(text: string) {
  return text.replace(HTML_ENTITY_RE, (entity, decimal, hex, name, semicolon) => {
    if (decimal) return fromCodePoint(parseInt(decimal, 10));
    if (hex) return fromCodePoint(parseInt(hex, 16));
    if (semicolon && HTML_ENTITIES[name]) return HTML_ENTITIES[name];
    // Unknown or unterminated names still decode a leading legacy reference (`&notit;` -> `¬it;`,
    // `&amp` -> `&`), matching the HTML character reference rules for text.
    for (let end = name.length; end > 0; end--) {
      const prefix = name.slice(0, end);
      if (LEGACY_ENTITIES.has(prefix)) return HTML_ENTITIES[prefix] + name.slice(end) + semicolon;
    }
    return entity;
  });
}

function fromCodePoint(code: number) {
  // Null, surrogates, and out-of-range code points are replaced per the HTML tokenizer rules.
  if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\u{fffd}';
  return String.fromCodePoint(code);
}

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#cue-text-parsing-rules}
 */
export type VTTNode = VTTBlockNode | VTTLeafNode;

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#cue-text-parsing-rules}
 */
export type VTTBlockType = 'c' | 'i' | 'b' | 'u' | 'ruby' | 'rt' | 'v' | 'lang' | 'timestamp';

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#webvtt-internal-node-object}
 */
export type VTTBlockNode =
  | VTTClassNode
  | VTTItalicNode
  | VTTBoldNode
  | VTTUnderlineNode
  | VTTRubyNode
  | VTTRubyTextNode
  | VTTVoiceNode
  | VTTLangNode
  | VTTTimestampNode;

export interface VTTBlock {
  tagName: string;
  class?: string;
  color?: string;
  bgColor?: string;
  /** Per-run style referenced via `<c.s-KEY>` (see `VTTCue.spans`). */
  span?: CueSpanStyle;
  spanKey?: string;
  children: (VTTBlockNode | VTTLeafNode)[];
}

export interface VTTClassNode extends VTTBlock {
  type: 'c';
}

export interface VTTItalicNode extends VTTBlock {
  type: 'i';
}

export interface VTTBoldNode extends VTTBlock {
  type: 'b';
}

export interface VTTUnderlineNode extends VTTBlock {
  type: 'u';
}

export interface VTTRubyNode extends VTTBlock {
  type: 'ruby';
}

export interface VTTRubyTextNode extends VTTBlock {
  type: 'rt';
}

export interface VTTVoiceNode extends VTTBlock {
  type: 'v';
  voice: string;
}

export interface VTTLangNode extends VTTBlock {
  type: 'lang';
  lang: string;
}

export interface VTTTimestampNode extends VTTBlock {
  type: 'timestamp';
  time: number;
}

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#webvtt-leaf-node-object}
 */
export type VTTLeafNode = VTTextNode;

export interface VTTextNode {
  type: 'text';
  data: string;
}
