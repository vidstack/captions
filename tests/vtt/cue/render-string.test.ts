// @vitest-environment jsdom
import {
  renderVTTCueString,
  renderVTTTokensDOM,
  renderVTTTokensText,
  tokenizeVTTCue,
  VTTCue,
} from 'media-captions';

test('voices', () => {
  const cue = new VTTCue(
    0,
    100,
    '<b.foo.bar><v John>This is the way, right?</v></b>, <v.baz Jane>Sure.</v>',
  );
  expect(renderVTTCueString(cue)).toMatchInlineSnapshot(
    `"<b class="foo bar"><span title="John" data-part="voice">This is the way, right?</span></b>, <span class="baz" title="Jane" data-part="voice">Sure.</span>"`,
  );
});

test('timestamp', () => {
  const cue = new VTTCue(0, 100, '<01:10>Go this way!');
  expect(renderVTTCueString(cue, 0)).toMatchInlineSnapshot(
    `"<span data-part="timed" data-time="70" data-future="">Go this way!</span>"`,
  );
  expect(renderVTTCueString(cue, 85)).toMatchInlineSnapshot(
    `"<span data-part="timed" data-time="70" data-past="">Go this way!</span>"`,
  );
});

test('color', () => {
  const cue = new VTTCue(0, 100, '<c.lime.bg_white>Go this way!');
  expect(renderVTTCueString(cue)).toMatchInlineSnapshot(
    `"<span style="color: lime;background-color: white;">Go this way!</span>"`,
  );
});

test('DOM renderer matches the string renderer', () => {
  const cue = new VTTCue(
    0,
    100,
    '<b.foo.bar><v John>This &amp; that</v></b>, <c.lime.bg_white>go</c> <00:01:10.000>now',
  );
  const div = document.createElement('div');
  div.append(renderVTTTokensDOM(tokenizeVTTCue(cue), 80));
  // The DOM serialises inline styles with a space after each semicolon.
  expect(div.innerHTML).toBe(renderVTTCueString(cue, 80).replace(/;(?=[a-z-]+:)/g, '; '));
  expect(renderVTTTokensText(tokenizeVTTCue(cue))).toBe('This & that, go now');
});

test('DOM renderer never interprets markup in text', () => {
  const div = document.createElement('div');
  div.append(
    renderVTTTokensDOM(tokenizeVTTCue(new VTTCue(0, 1, '&lt;img src=x onerror=alert(1)&gt;'))),
  );
  expect(div.querySelector('img')).toBeNull();
  expect(div.textContent).toBe('<img src=x onerror=alert(1)>');
});
