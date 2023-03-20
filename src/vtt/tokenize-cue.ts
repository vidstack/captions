import { parseTimestamp } from './parse';
import type { VTTCue } from './vtt-cue';

const DIGIT_RE = /*#__PURE__*/ /[0-9]/,
  MULTI_SPACE_RE = /*#__PURE__*/ /[\s\t]+/,
  TAG_NAME = /*#__PURE__*/ {
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
  HTML_ENTITIES = /*#__PURE__*/ {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': '\u{a0}',
    '&lrm;': '\u{200e}',
    '&rlm;': '\u{200f}',
  },
  HTML_ENTITY_RE = /*#__PURE__*/ /&(?:amp|lt|gt|quot|#(0+)?39|nbsp|lrm|rlm);/g,
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
  BLOCK_TYPES = /*#__PURE__*/ new Set(Object.keys(TAG_NAME));

const enum Mode {
  Data = 1,
  Tag = 2,
  Class = 3,
  Annotation = 4,
  EndTag = 5,
  Timestamp = 6,
}

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
            if (node) node.class?.trim();
            mode = Mode.Annotation;
            break;
          case '.':
            addClass();
            break;
          case '>':
            addClass();
            if (node) node.class?.trim();
            mode = Mode.Data;
            break;
          default:
            buffer += char;
        }
        break;
      case Mode.Annotation:
        if (char === '>') {
          buffer = buffer.replace(MULTI_SPACE_RE, ' ');
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
          buffer = '';
          node = stack.pop();
          mode = Mode.Data;
        }
        break;
      case Mode.Timestamp:
        if (char === '>') {
          const time = parseTimestamp(buffer);

          if (time !== null && time >= cue.startTime && time <= cue.endTime) {
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

  function addClass() {
    if (node && buffer) {
      const color = buffer.replace('bg_', '');
      if (COLORS.has(color)) {
        node[buffer.startsWith('bg_') ? 'bgColor' : 'color'] = color;
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

function replaceHTMLEntities(text: string) {
  return text.replace(HTML_ENTITY_RE, (entity) => HTML_ENTITIES[entity] || "'");
}

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#cue-text-parsing-rules}
 */
export type VTTNode = VTTBlockNode | VTTLeafNode;

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#cue-text-parsing-rules}
 */
export type VTTBlockType = 'c' | 'i' | 'b' | 'u' | 'ruby' | 'rt' | 'v' | 'lang' | 'ts';

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
