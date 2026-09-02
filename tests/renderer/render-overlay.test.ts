// @vitest-environment jsdom
import { CaptionsRenderer, VTTCue, VTTRegion } from 'media-captions';

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

test('applies cue styles, layer, and skips internal hints', () => {
  const { overlay, renderer } = setup();
  const cue = new VTTCue(0, 10, 'Styled');
  cue.layer = 3;
  cue.style = { '--cue-color': 'red', '--cue-width': 'auto', __posX: '1' };
  renderer.changeTrack({ cues: [cue] });
  renderer.currentTime = 1;

  const el = displayed(overlay)[0];
  expect(el.style.getPropertyValue('--cue-color')).toBe('red');
  expect(el.style.getPropertyValue('--cue-z-index')).toBe('3');
  expect(el.style.getPropertyValue('__posX')).toBe('');
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
