import { IS_SERVER } from '../utils/env';
import { setDataAttr } from '../utils/style';
import { tokenizeVTTCue, type VTTBlockNode, type VTTNode } from './tokenize-cue';
import type { CueDrawing, CueSpanStyle, VTTCue } from './vtt-cue';

const SPAN_STYLE_PROPS: Record<string, string> = {
  color: 'color',
  backgroundColor: 'background-color',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  fontStyle: 'font-style',
  textDecoration: 'text-decoration',
  letterSpacing: 'letter-spacing',
  textStroke: '-webkit-text-stroke',
  textShadow: 'text-shadow',
  transform: 'transform',
  transformOrigin: 'transform-origin',
  display: 'display',
  opacity: 'opacity',
  filter: 'filter',
  animation: 'animation',
  backgroundImage: 'background-image',
  backgroundSize: 'background-size',
  backgroundPosition: 'background-position',
  backgroundClip: '-webkit-background-clip',
};

const SVG_NS = 'http://www.w3.org/2000/svg',
  PATH_DATA_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9,.\-+eE\s]*$/;

const CLASS_TOKEN_RE = /[^\w-]+/g;

export function createVTTCueTemplate(cue: VTTCue): VTTCueTemplate {
  if (IS_SERVER) {
    throw Error(
      '[media-captions] called `createVTTCueTemplate` on the server - use `renderVTTCueString`',
    );
  }

  const template = document.createElement('template');
  template.content.append(renderVTTTokensDOM(tokenizeVTTCue(cue)));
  return { cue, content: template.content };
}

export interface VTTCueTemplate {
  readonly cue: VTTCue;
  readonly content: DocumentFragment;
}

export function renderVTTCueString(cue: VTTCue, currentTime = 0): string {
  return renderVTTTokensString(tokenizeVTTCue(cue), currentTime);
}

/**
 * Attributes for a block token, shared by the string and DOM renderers. Values are raw (not
 * escaped); `''` means a boolean attribute.
 */
export function getVTTTokenAttributes(
  token: VTTBlockNode,
  currentTime = 0,
): Record<string, string> {
  const attrs: Record<string, string> = {};

  if (token.class) {
    const classList = sanitizeClassList(token.class);
    if (classList) attrs.class = classList;
  }

  if (token.type === 'v' && token.voice) {
    attrs.title = token.voice;
    attrs['data-part'] = 'voice';
  } else if (token.type === 'lang' && token.lang) {
    attrs.lang = token.lang;
  } else if (token.type === 'timestamp') {
    attrs['data-part'] = 'timed';
    attrs['data-time'] = token.time + '';
    if (token.time > currentTime) attrs['data-future'] = '';
    if (token.time < currentTime) attrs['data-past'] = '';
  }

  let style = `${token.color ? `color: ${token.color};` : ''}${
    token.bgColor ? `background-color: ${token.bgColor};` : ''
  }`;

  if (token.span) {
    if (token.spanKey) attrs['data-span'] = token.spanKey;
    if (token.span.className)
      attrs.class = [attrs.class, token.span.className].filter(Boolean).join(' ');
    style += spanStyleToCSS(token.span);
  }

  if (style) attrs.style = style;

  return attrs;
}

/** Serialises a `CueSpanStyle` to inline CSS declarations. */
export function spanStyleToCSS(span: CueSpanStyle): string {
  let css = '';
  for (const key of Object.keys(span)) {
    const prop = SPAN_STYLE_PROPS[key],
      value = span[key as keyof CueSpanStyle];
    if (prop && typeof value === 'string') css += `${prop}: ${value};`;
  }
  return css;
}

function drawingToSVGString(drawing: CueDrawing): string {
  if (!PATH_DATA_RE.test(drawing.path)) return '';
  const [x, y, w, h] = drawing.viewBox;
  return (
    `<svg xmlns="${SVG_NS}" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none" ` +
    `style="display:block;width:calc(var(--overlay-width) * ${drawing.width / 100});` +
    `height:calc(var(--overlay-height) * ${drawing.height / 100})">` +
    `<path d="${escapeAttribute(drawing.path)}" fill="${escapeAttribute(drawing.fill ?? 'currentColor')}"` +
    (drawing.stroke ? ` stroke="${escapeAttribute(drawing.stroke)}"` : '') +
    (drawing.strokeWidth ? ` stroke-width="${drawing.strokeWidth}"` : '') +
    ' /></svg>'
  );
}

function appendDrawing(parent: Element, drawing: CueDrawing, doc: Document) {
  if (!PATH_DATA_RE.test(drawing.path)) return;
  const [x, y, w, h] = drawing.viewBox,
    svg = doc.createElementNS(SVG_NS, 'svg'),
    path = doc.createElementNS(SVG_NS, 'path');
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute(
    'style',
    `display:block;width:calc(var(--overlay-width) * ${drawing.width / 100});` +
      `height:calc(var(--overlay-height) * ${drawing.height / 100})`,
  );
  path.setAttribute('d', drawing.path);
  path.setAttribute('fill', drawing.fill ?? 'currentColor');
  if (drawing.stroke) path.setAttribute('stroke', drawing.stroke);
  if (drawing.strokeWidth) path.setAttribute('stroke-width', drawing.strokeWidth + '');
  svg.appendChild(path);
  parent.appendChild(svg);
}

/**
 * Renders VTT tokens to a HTML string. All text and attribute values are escaped, so the output
 * is safe to assign to `innerHTML` even when the cue text comes from an untrusted captions file.
 */
export function renderVTTTokensString(tokens: VTTNode[], currentTime = 0): string {
  let result = '';

  for (const token of tokens) {
    if (token.type === 'text') {
      result += escapeHTML(token.data);
    } else {
      const attributes = Object.entries(getVTTTokenAttributes(token, currentTime))
        .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
        .join(' ');

      const drawing = token.span?.drawing ? drawingToSVGString(token.span.drawing) : '';
      result += `<${token.tagName}${attributes ? ' ' + attributes : ''}>${drawing}${renderVTTTokensString(
        token.children,
        currentTime,
      )}</${token.tagName}>`;
    }
  }

  return result;
}

/**
 * Renders VTT tokens directly to DOM nodes. No HTML is parsed, so this works under strict CSP and
 * Trusted Types policies that forbid `innerHTML`, and the escaping surface disappears entirely.
 * This is what `CaptionsRenderer` uses.
 */
export function renderVTTTokensDOM(
  tokens: VTTNode[],
  currentTime = 0,
  doc: Document = document,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  appendVTTTokens(fragment, tokens, currentTime, doc);
  return fragment;
}

function appendVTTTokens(parent: Node, tokens: VTTNode[], currentTime: number, doc: Document) {
  for (const token of tokens) {
    if (token.type === 'text') {
      parent.appendChild(doc.createTextNode(token.data));
      continue;
    }

    const el = doc.createElement(token.tagName),
      attrs = getVTTTokenAttributes(token, currentTime);

    for (const name of Object.keys(attrs)) {
      if (name === 'style') {
        if (token.color) el.style.color = token.color;
        if (token.bgColor) el.style.backgroundColor = token.bgColor;
        if (token.span) {
          for (const key of Object.keys(token.span)) {
            const prop = SPAN_STYLE_PROPS[key],
              value = token.span[key as keyof CueSpanStyle];
            if (prop && typeof value === 'string') el.style.setProperty(prop, value);
          }
        }
      } else {
        el.setAttribute(name, attrs[name]);
      }
    }

    if (token.span?.drawing) appendDrawing(el, token.span.drawing, doc);
    appendVTTTokens(el, token.children, currentTime, doc);
    parent.appendChild(el);
  }
}

/** Plain text of the tokens (tags stripped), e.g. for screen reader announcements. */
export function renderVTTTokensText(tokens: VTTNode[]): string {
  let result = '';
  for (const token of tokens) {
    result += token.type === 'text' ? token.data : renderVTTTokensText(token.children);
  }
  return result;
}

export function updateTimedVTTCueNodes(root: Element, currentTime: number) {
  if (IS_SERVER) return;
  for (const el of root.querySelectorAll('[data-part="timed"]')) {
    const time = Number(el.getAttribute('data-time'));
    if (Number.isNaN(time)) continue;
    if (time > currentTime) setDataAttr(el, 'future');
    else el.removeAttribute('data-future');
    if (time < currentTime) setDataAttr(el, 'past');
    else el.removeAttribute('data-past');
  }
}

/**
 * Escapes text so it can be safely inserted as HTML text content.
 */
export function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes text so it can be safely inserted inside a double-quoted HTML attribute value.
 */
export function escapeAttribute(text: string): string {
  return escapeHTML(text).replace(/"/g, '&quot;');
}

/**
 * Restricts class names to word characters and hyphens so a crafted class can never break out
 * of the attribute or introduce CSS selectors it should not.
 */
function sanitizeClassList(classList: string): string {
  return classList
    .split(' ')
    .map((name) => name.replace(CLASS_TOKEN_RE, ''))
    .filter(Boolean)
    .join(' ');
}
