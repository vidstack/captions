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

test('span styles referenced from cue text are applied to that run only', () => {
  const cue = new VTTCue(0, 10, 'Normal <c.s-big>big <c.s-red>red</c></c> normal');
  cue.spans = {
    big: { fontSize: '1.5em', letterSpacing: '0.1em', className: 'shout' },
    red: { color: '#ff0000', textStroke: '2px black' },
  };
  expect(renderVTTCueString(cue)).toBe(
    'Normal <span data-span="big" class="shout" style="font-size: 1.5em;letter-spacing: 0.1em;">big ' +
      '<span data-span="red" style="color: #ff0000;-webkit-text-stroke: 2px black;">red</span></span> normal',
  );

  const div = document.createElement('div');
  div.append(renderVTTTokensDOM(tokenizeVTTCue(cue)));
  const big = div.querySelector<HTMLElement>('[data-span="big"]')!;
  expect(big.style.fontSize).toBe('1.5em');
  expect(big.className).toBe('shout');
  expect(div.querySelector<HTMLElement>('[data-span="red"]')!.style.color).toBe('rgb(255, 0, 0)');
});

test('unknown span keys fall back to plain classes', () => {
  const cue = new VTTCue(0, 10, '<c.s-missing>x</c>');
  expect(renderVTTCueString(cue)).toBe('<span class="s-missing">x</span>');
});

test('drawings render as inline SVG', () => {
  const cue = new VTTCue(0, 10, '<c.s-shape></c>');
  cue.spans = {
    shape: {
      drawing: {
        path: 'M 0 0 L 10 0 L 10 10 Z',
        viewBox: [0, 0, 10, 10],
        width: 20,
        height: 10,
        fill: '#00ff00',
      },
    },
  };
  const html = renderVTTCueString(cue);
  expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"');
  expect(html).toContain('width:calc(var(--overlay-width) * 0.2)');
  expect(html).toContain('<path d="M 0 0 L 10 0 L 10 10 Z" fill="#00ff00" />');

  const div = document.createElement('div');
  div.append(renderVTTTokensDOM(tokenizeVTTCue(cue)));
  expect(div.querySelector('svg path')?.getAttribute('d')).toBe('M 0 0 L 10 0 L 10 10 Z');

  cue.spans.shape.drawing!.path = 'M 0 0 <script>';
  expect(renderVTTCueString(cue)).not.toContain('<svg');
});
