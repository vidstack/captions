import type { VTTCue } from './vtt-cue';
import { parseVTTTimestamp } from './vtt-parser';

const DIGIT_RE = /[0-9]/,
  MULTI_SPACE_RE = /[\s\t]+/g,
  TAG_NAME = {
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
  HTML_ENTITIES = {
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
  },
  HTML_ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
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
          buffer = buffer.replace(MULTI_SPACE_RE, ' ').trim();
          if (node?.type === 'v') node.voice = replaceHTMLEntities(buffer);
          else if (node?.type === 'lang') node.lang = replaceHTMLEntities(buffer);
          buffer = '';
          mode = Mode.Data;
        } else {
          buffer += char;
        }
        break;
      case Mode.EndTag:
        if (char === '>') {
          closeNode(buffer.trim());
          buffer = '';
          mode = Mode.Data;
        } else {
          buffer += char;
        }
        break;
      case Mode.Timestamp:
        if (char === '>') {
          const time = parseVTTTimestamp(buffer);

          if (time !== null && time >= cue.startTime && time <= cue.endTime) {
            // Timestamps do not nest: a new timestamp ends the previous timed segment.
            if (node?.type === 'timestamp') node = stack.pop();
            buffer = 'timestamp';
            addNode();
            (node as VTTTimestampNode).time = time;
          }

          buffer = '';
          mode = Mode.Data;
        } else {
          buffer += char;
        }
        break;
    }
  }

  function addNode() {
    if (BLOCK_TYPES.has(buffer)) {
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
      if (COLORS.has(color) || HEX_COLOR_RE.test(color)) {
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
    node ? node.children.push(text) : result.push(text);
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
 * Decodes named and numeric HTML character references in WebVTT cue text.
 */
export function replaceHTMLEntities(text: string) {
  return text.replace(HTML_ENTITY_RE, (entity, decimal, hex, name) => {
    if (decimal) return fromCodePoint(parseInt(decimal, 10));
    if (hex) return fromCodePoint(parseInt(hex, 16));
    return HTML_ENTITIES[name] ?? entity;
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
