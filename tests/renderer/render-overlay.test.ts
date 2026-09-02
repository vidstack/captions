// @vitest-environment jsdom
import { CaptionsRenderer, CueTrack, VTTCue, VTTRegion } from 'media-captions';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  if (!globalThis.requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0);
  }
});

function setup() {
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const renderer = new CaptionsRenderer(overlay);
  return { overlay, renderer };
}

function displayed(overlay: HTMLElement) {
  return Array.from(overlay.querySelectorAll<HTMLElement>('[data-part="cue-display"]'));
}

function texts(overlay: HTMLElement) {
  return displayed(overlay).map((el) => el.textContent);
}

const tick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

afterEach(() => {
  document.body.textContent = '';
});

test('falls back to the internal cue class when VTTCue is not native', () => {
  expect(typeof (globalThis as any).VTTCue).toBe('undefined');
  const cue = new VTTCue(0, 1, 'x');
  expect(cue.startTime).toBe(0);
  expect(cue.align).toBe('center');
});

test('initializes overlay attributes', () => {
  const { overlay } = setup();
  expect(overlay.getAttribute('data-part')).toBe('captions');
  expect(overlay.getAttribute('part')).toBe('captions');
  expect(overlay.getAttribute('aria-live')).toBe('off');
  expect(overlay.getAttribute('translate')).toBe('yes');
  expect(overlay.getAttribute('data-dir')).toBe('ltr');
});

test('renders active cues in start order and removes inactive ones', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({
    cues: [new VTTCue(5, 10, 'B'), new VTTCue(0, 10, 'A'), new VTTCue(20, 30, 'C')],
  });

  renderer.currentTime = 6;
  expect(texts(overlay)).toEqual(['A', 'B']);
  expect(renderer.activeCues.map((cue) => cue.text)).toEqual(['A', 'B']);

  renderer.currentTime = 2;
  expect(texts(overlay)).toEqual(['A']);

  renderer.currentTime = 25;
  expect(texts(overlay)).toEqual(['C']);

  renderer.currentTime = 40;
  expect(texts(overlay)).toEqual([]);
});

test('finds long cues that started well before the current time', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({
    cues: [new VTTCue(0, 100, 'A'), new VTTCue(50, 51, 'B'), new VTTCue(60, 61, 'C')],
  });
  renderer.currentTime = 60.5;
  expect(texts(overlay)).toEqual(['A', 'C']);
});

test('renders cue text as escaped HTML', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({
    cues: [new VTTCue(0, 10, '&lt;img src=x onerror=alert(1)&gt; <b>ok</b>')],
  });
  renderer.currentTime = 1;
  expect(overlay.querySelector('img')).toBeNull();
  expect(overlay.querySelector('b')?.textContent).toBe('ok');
  expect(overlay.querySelector('[data-part="cue"]')?.textContent).toBe(
    '<img src=x onerror=alert(1)> ok',
  );
});

test('reuses cue elements and keeps DOM order when cues become active out of order', () => {
  const { overlay, renderer } = setup();
  const a = new VTTCue(0, 10, 'A'),
    b = new VTTCue(0, 12, 'B');
  renderer.changeTrack({ cues: [a, b] });

  renderer.currentTime = 11;
  expect(texts(overlay)).toEqual(['B']);
  const bEl = displayed(overlay)[0];

  renderer.currentTime = 5;
  expect(texts(overlay)).toEqual(['A', 'B']);
  expect(displayed(overlay)[1]).toBe(bEl);

  renderer.currentTime = 6;
  expect(displayed(overlay)[1]).toBe(bEl);
});

test('applies the track language to the overlay', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({ cues: [], metadata: { Language: 'en-US' } });
  expect(overlay.getAttribute('lang')).toBe('en-US');
  renderer.changeTrack({ cues: [] });
  expect(overlay.hasAttribute('lang')).toBe(false);
});

test('places region cues inside their region element', async () => {
  const { overlay, renderer } = setup();
  const region = new VTTRegion();
  region.id = 'r1';
  const cue = new VTTCue(0, 10, 'In region');
  cue.region = region;

  renderer.changeTrack({ regions: [region], cues: [cue] });
  renderer.currentTime = 1;

  const regionEl = overlay.querySelector('[data-part="region"]')!;
  expect(regionEl.getAttribute('data-id')).toBe('r1');
  expect(regionEl.querySelector('[data-part="cue"]')?.textContent).toBe('In region');

  await tick();
  expect(regionEl.hasAttribute('data-active')).toBe(true);

  renderer.currentTime = 20;
  expect(regionEl.hasAttribute('data-active')).toBe(false);
  expect(regionEl.querySelector('[data-part="cue"]')).toBeNull();
});

test('maps layout, text style, layer, and raw styles to CSS', () => {
  const { overlay, renderer } = setup();
  const cue = new VTTCue(0, 10, 'Styled');
  cue.layer = 3;
  cue.layout = {
    left: 50,
    bottom: 5,
    width: 'max-content',
    maxWidth: 80,
    translate: { x: -0.5 },
    fixed: true,
  };
  cue.textStyle = {
    color: 'red',
    fontWeight: 'bold',
    textAlign: 'left',
    transform: 'rotate(5deg)',
  };
  cue.style = { '--cue-padding-x': '0' };
  renderer.changeTrack({ cues: [cue] });
  renderer.currentTime = 1;

  const el = displayed(overlay)[0];
  expect(el.style.getPropertyValue('--cue-left')).toBe('50%');
  expect(el.style.getPropertyValue('--cue-bottom')).toBe('5%');
  expect(el.style.getPropertyValue('--cue-width')).toBe('max-content');
  expect(el.style.getPropertyValue('--cue-max-width')).toBe('80%');
  expect(el.style.getPropertyValue('--cue-transform')).toBe('translateX(-50%) rotate(5deg)');
  expect(el.hasAttribute('data-fixed')).toBe(true);
  expect(el.style.getPropertyValue('--cue-color')).toBe('red');
  expect(el.style.getPropertyValue('font-weight')).toBe('bold');
  expect(el.style.getPropertyValue('--cue-text-align')).toBe('left');
  expect(el.style.getPropertyValue('--cue-z-index')).toBe('3');
  expect(el.style.getPropertyValue('--cue-padding-x')).toBe('0');
});

test('cues round-trip through JSON', () => {
  const region = new VTTRegion();
  region.id = 'r';
  const cue = new VTTCue(1, 2, '<b>x</b>');
  Object.assign(cue, { id: 'c1', line: 5, align: 'start', layer: 2 });
  cue.region = region;
  cue.layout = { top: 10, fixed: true };
  cue.textStyle = { color: 'lime' };

  const json = JSON.parse(JSON.stringify(cue));
  expect(json.region).toBe('r');
  const copy = VTTCue.from(json, [region]);
  expect(copy).not.toBe(cue);
  expect(copy.region).toBe(region);
  expect(copy.toJSON()).toEqual(cue.toJSON());
});

test('updates timed text nodes as time advances', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({ cues: [new VTTCue(0, 10, 'now <00:00:05.000>later')] });

  renderer.currentTime = 3;
  const timed = overlay.querySelector('[data-part="timed"]')!;
  expect(timed.hasAttribute('data-future')).toBe(true);
  expect(timed.hasAttribute('data-past')).toBe(false);

  renderer.currentTime = 6;
  expect(timed.hasAttribute('data-future')).toBe(false);
  expect(timed.hasAttribute('data-past')).toBe(true);
});

test('addCue, removeCue, and reset keep the DOM in sync', () => {
  const { overlay, renderer } = setup();
  const a = new VTTCue(0, 10, 'A');
  renderer.changeTrack({ cues: [a] });
  renderer.currentTime = 1;
  expect(texts(overlay)).toEqual(['A']);

  const b = new VTTCue(0, 10, 'B');
  renderer.addCue(b);
  expect(texts(overlay)).toEqual(['A', 'B']);

  renderer.removeCue(a);
  expect(texts(overlay)).toEqual(['B']);

  renderer.reset();
  expect(overlay.children).toHaveLength(0);
  expect(renderer.activeCues).toEqual([]);
});

test('applies STYLE blocks scoped to the overlay', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({
    cues: [new VTTCue(0, 10, '<b>Styled</b>')],
    styles: ['::cue { color: red }', '::cue(b) { color: lime }', 'body { display: none }'],
  });

  const scope = overlay.getAttribute('data-scope');
  expect(scope).toMatch(/^mc\d+$/);

  const style = overlay.querySelector('style')!;
  expect(style.getAttribute('data-part')).toBe('style');
  expect(style.textContent).toContain(`[data-scope="${scope}"] [data-part="cue"] {`);
  expect(style.textContent).toContain(`[data-scope="${scope}"] [data-part="cue"] b {`);
  expect(style.textContent).not.toContain('display: none');

  // A second renderer gets its own scope.
  const other = setup();
  other.renderer.changeTrack({ cues: [], styles: ['::cue { color: blue }'] });
  expect(other.overlay.getAttribute('data-scope')).not.toBe(scope);

  // Resetting removes the style element.
  renderer.reset();
  expect(overlay.querySelector('style')).toBeNull();
});

test('follows an attached track: adds, live updates, removals, and clear', () => {
  const { overlay, renderer } = setup();
  const track = new CueTrack();
  renderer.changeTrack({ cues: track });
  expect(renderer.track).toBe(track);

  const live = new VTTCue(0, Infinity, 'Live');
  renderer.currentTime = 5;
  track.add(live);
  expect(texts(overlay)).toEqual(['Live']);

  live.text = 'Live (edited)';
  live.endTime = 10;
  track.update(live);
  expect(texts(overlay)).toEqual(['Live (edited)']);

  renderer.currentTime = 11;
  expect(texts(overlay)).toEqual([]);

  renderer.currentTime = 5;
  expect(texts(overlay)).toEqual(['Live (edited)']);
  track.remove(live);
  expect(texts(overlay)).toEqual([]);

  track.add(new VTTCue(0, 10, 'A'));
  expect(texts(overlay)).toEqual(['A']);
  track.clear();
  expect(texts(overlay)).toEqual([]);
});

test('evicts ended cues after the retention window', () => {
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const renderer = new CaptionsRenderer(overlay, { retention: 2 });
  renderer.changeTrack({ cues: [new VTTCue(0, 1, 'old'), new VTTCue(5, 6, 'recent')] });
  renderer.currentTime = 5.5;
  expect(renderer.track.cues.map((c) => c.text)).toEqual(['recent']);
});

test('renders cue content as DOM nodes without HTML parsing', () => {
  const { overlay, renderer } = setup();
  renderer.changeTrack({
    cues: [new VTTCue(0, 10, '<v Bob>Hi <b.x>there</b> <00:00:05.000>later')],
  });
  renderer.currentTime = 1;
  const cueEl = overlay.querySelector('[data-part="cue"]')!;
  const voice = cueEl.firstElementChild!;
  expect(voice.tagName).toBe('SPAN');
  expect(voice.getAttribute('title')).toBe('Bob');
  expect(voice.querySelector('b')?.className).toBe('x');
  expect(voice.querySelector('[data-part="timed"]')?.hasAttribute('data-future')).toBe(true);
});

test('dispatches enter and exit events on cues', () => {
  const { renderer } = setup();
  const a = new VTTCue(0, 5, 'A'),
    b = new VTTCue(3, 8, 'B'),
    events: string[] = [];
  for (const cue of [a, b]) {
    cue.addEventListener('enter', () => events.push(`enter:${cue.text}`));
    cue.addEventListener('exit', () => events.push(`exit:${cue.text}`));
  }
  renderer.changeTrack({ cues: [a, b] });
  renderer.currentTime = 1;
  renderer.currentTime = 4;
  renderer.currentTime = 6;
  renderer.currentTime = 9;
  expect(events).toEqual(['enter:A', 'enter:B', 'exit:A', 'exit:B']);
});

test('announces entering cues in a hidden live region when enabled', () => {
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const renderer = new CaptionsRenderer(overlay, { announce: true });
  renderer.changeTrack({ cues: [new VTTCue(0, 5, '<b>Hello</b> &amp; welcome')] });
  renderer.currentTime = 1;

  const announcer = overlay.nextElementSibling as HTMLElement;
  expect(announcer.getAttribute('data-part')).toBe('announcer');
  expect(announcer.getAttribute('aria-live')).toBe('polite');
  expect(announcer.textContent).toBe('Hello & welcome');
  renderer.destroy();
  expect(document.querySelector('[data-part="announcer"]')).toBeNull();
});
