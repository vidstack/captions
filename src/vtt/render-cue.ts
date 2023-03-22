import { tokenizeVTTCue, VTTNode } from './tokenize-cue';
import type { VTTCue } from './vtt-cue';

export function renderVTTCueHTML(cue: VTTCue): HTMLDivElement {
  if (__SERVER__) {
    throw Error(
      '[media-captions] called `renderVTTCueHTML` on the server - use `renderVTTCueString`',
    );
  }

  const div = document.createElement('div');
  div.setAttribute('data-id', cue.id);
  div.setAttribute('data-cue', '');
  div.innerHTML = renderVTTCueString(cue);

  return div;
}

export function renderVTTCueString(cue: VTTCue, currentTime = 0): string {
  return stringifyVTTTokens(tokenizeVTTCue(cue), currentTime);
}

function stringifyVTTTokens(tokens: VTTNode[], currentTime = 0): string {
  let result = '';

  for (const token of tokens) {
    if (token.type === 'text') {
      result += token.data;
    } else {
      const isTimestamp = token.type === 'timestamp';

      const attrs = [
        ['class', token.class],
        ['title', token.type === 'v' && token.voice],
        ['lang', token.type === 'lang' && token.lang],
        ['data-voice', token.type === 'v'],
        ['data-timed', isTimestamp],
        ['data-future', isTimestamp && token.time > currentTime],
        ['data-past', isTimestamp && token.time < currentTime],
        ['data-color', token.color],
        ['data-bg-color', token.bgColor],
      ]
        .filter((v) => v[1])
        .map((v) => `${v[0]}="${v[1]}"`)
        .join(' ');

      result += `<${token.tagName}${attrs ? ' ' + attrs : ''}>${stringifyVTTTokens(
        token.children,
      )}</${token.tagName}>`;
    }
  }

  return result;
}
