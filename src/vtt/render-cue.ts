import { IS_SERVER } from '../utils/env';
import { setDataAttr } from '../utils/style';
import { tokenizeVTTCue, type VTTNode } from './tokenize-cue';
import type { VTTCue } from './vtt-cue';

export function createVTTCueTemplate(cue: VTTCue): VTTCueTemplate {
  if (IS_SERVER) {
    throw Error(
      '[media-captions] called `createVTTCueTemplate` on the server - use `renderVTTCueString`',
    );
  }

  const template = document.createElement('template');
  template.innerHTML = renderVTTCueString(cue);
  return { cue, content: template.content };
}

export interface VTTCueTemplate {
  readonly cue: VTTCue;
  readonly content: DocumentFragment;
}

export function renderVTTCueString(cue: VTTCue, currentTime = 0): string {
  return renderVTTTokensString(tokenizeVTTCue(cue), currentTime);
}

export function renderVTTTokensString(tokens: VTTNode[], currentTime = 0): string {
  let attrs: Record<string, any>,
    result = '';

  for (const token of tokens) {
    if (token.type === 'text') {
      result += token.data;
    } else {
      const isTimestamp = token.type === 'timestamp';

      attrs = {};
      attrs.class = token.class;
      attrs.title = token.type === 'v' && token.voice;
      attrs.lang = token.type === 'lang' && token.lang;
      attrs['data-part'] = token.type === 'v' && 'voice';

      if (isTimestamp) {
        attrs['data-part'] = 'timed';
        attrs['data-time'] = token.time;
        attrs['data-future'] = token.time > currentTime;
        attrs['data-past'] = token.time < currentTime;
      }

      attrs.style = `${token.color ? `color: ${token.color};` : ''}${
        token.bgColor ? `background-color: ${token.bgColor};` : ''
      }`;

      const attributes = Object.entries(attrs)
        .filter((v) => v[1])
        .map((v) => `${v[0]}="${v[1] === true ? '' : v[1]}"`)
        .join(' ');

      result += `<${token.tagName}${attributes ? ' ' + attributes : ''}>${renderVTTTokensString(
        token.children,
      )}</${token.tagName}>`;
    }
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
