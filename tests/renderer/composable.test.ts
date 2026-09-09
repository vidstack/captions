// @vitest-environment jsdom
import { CaptionsRenderer, VTTCue, VTTRegion } from 'media-captions';
import {
  animations,
  announcer,
  createRenderer,
  defaultFeatures,
  regions,
  typesetting,
  vttStyles,
  type RendererFeature,
} from 'media-captions/renderer';

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

afterEach(() => {
  document.body.textContent = '';
  vi.restoreAllMocks();
});

function overlay() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

function displays(el: HTMLElement) {
  return Array.from(el.querySelectorAll<HTMLElement>('[data-part="cue-display"]'));
}

function styledCue() {
  const cue = new VTTCue(0, 10, 'Styled');
  cue.layer = 2;
  cue.layout = { left: 50, bottom: 5, width: 'max-content', translate: { x: -0.5 }, fixed: true };
  cue.textStyle = { color: 'red', transform: { rotate: 5 }, className: 'fancy' };
  cue.animations = [{ duration: 1, keyframes: [{ opacity: 0 }, { opacity: 1 }] }];
  return cue;
}

test('the core alone renders WebVTT cues and positioning', () => {
  const el = overlay(),
    renderer = createRenderer(el);
  expect(renderer.features).toEqual([]);

  const cue = new VTTCue(0, 10, '<b>Plain</b>');
  cue.line = 2;
  cue.position = 20;
  cue.size = 40;
  cue.align = 'start';
  renderer.changeTrack({ cues: [cue] });
  renderer.currentTime = 1;

  const [display] = displays(el);
  expect(display.querySelector('b')?.textContent).toBe('Plain');
  expect(display.style.getPropertyValue('--cue-width')).toBe('40%');
  expect(display.style.getPropertyValue('--cue-left')).toBe('20%');
  expect(display.style.getPropertyValue('--cue-text-align')).toBe('start');
  expect(display.style.getPropertyValue('--cue-writing-mode')).toBe('horizontal-tb');
  expect(el.getAttribute('data-part')).toBe('captions');
});

test('without typesetting, layout and text style are ignored (with a dev warning)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const el = overlay(),
    renderer = createRenderer(el);
  renderer.changeTrack({ cues: [styledCue()] });
  renderer.currentTime = 1;

  const [display] = displays(el);
  // WebVTT sizing applies (centre, full width) instead of the layout model.
  expect(display.style.getPropertyValue('--cue-width')).toBe('100%');
  expect(display.style.getPropertyValue('--cue-left')).toBe('0%');
  expect(display.style.getPropertyValue('--cue-bottom')).toBe('');
  expect(display.style.getPropertyValue('--cue-color')).toBe('');
  expect(display.style.getPropertyValue('--cue-z-index')).toBe('');
  expect(display.hasAttribute('data-fixed')).toBe(false);
  expect(display.querySelector('[data-part="cue"]')?.className).toBe('');

  const messages = warn.mock.calls.map((call) => String(call[0]));
  expect(messages.some((m) => m.includes('"typesetting"') && m.includes('typesetting()'))).toBe(
    true,
  );
  expect(messages.some((m) => m.includes('"animations"'))).toBe(true);
  // Once per capability, not per cue.
  renderer.addCue(styledCue());
  expect(warn).toHaveBeenCalledTimes(2);
});

test('typesetting applies the layout and text style model', () => {
  const el = overlay(),
    renderer = createRenderer(el, { features: [typesetting()] });
  renderer.changeTrack({ cues: [styledCue()] });
  renderer.currentTime = 1;

  const [display] = displays(el);
  expect(display.style.getPropertyValue('--cue-left')).toBe('50%');
  expect(display.style.getPropertyValue('--cue-bottom')).toBe('5%');
  expect(display.style.getPropertyValue('--cue-width')).toBe('max-content');
  expect(display.style.getPropertyValue('--cue-transform')).toBe('translateX(-50%) rotate(5deg)');
  expect(display.style.getPropertyValue('--cue-color')).toBe('red');
  expect(display.style.getPropertyValue('--cue-z-index')).toBe('2');
  expect(display.hasAttribute('data-fixed')).toBe(true);
  expect(display.querySelector('[data-part="cue"]')?.className).toBe('fancy');
});

test('regions are only rendered with the regions feature', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const region = new VTTRegion();
  region.id = 'r1';
  const track = () => {
    const cue = new VTTCue(0, 10, 'In region');
    cue.region = region;
    return { regions: [region], cues: [cue] };
  };

  const bare = createRenderer(overlay());
  bare.changeTrack(track());
  bare.currentTime = 1;
  expect(bare.overlay.querySelector('[data-part="region"]')).toBeNull();
  expect(displays(bare.overlay)[0].parentElement).toBe(bare.overlay);
  expect(displays(bare.overlay)[0].style.getPropertyValue('--cue-width')).toBe('100%');
  expect(warn.mock.calls.some((call) => String(call[0]).includes('"regions"'))).toBe(true);

  const withRegions = createRenderer(overlay(), { features: [regions()] });
  withRegions.changeTrack(track());
  withRegions.currentTime = 1;
  const regionEl = withRegions.overlay.querySelector('[data-part="region"]')!;
  expect(regionEl.getAttribute('data-id')).toBe('r1');
  expect(regionEl.querySelector('[data-part="cue"]')?.textContent).toBe('In region');
  expect(displays(withRegions.overlay)[0].style.getPropertyValue('--cue-offset')).toBe('0%');
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  expect(regionEl.hasAttribute('data-active')).toBe(true);
  withRegions.currentTime = 20;
  expect(regionEl.hasAttribute('data-active')).toBe(false);
});

test('STYLE blocks need the vttStyles feature', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const styles = ['::cue { color: red }'];

  const bare = createRenderer(overlay());
  bare.changeTrack({ cues: [], styles });
  expect(bare.overlay.querySelector('style')).toBeNull();

  const styled = createRenderer(overlay(), { features: [vttStyles()] });
  styled.changeTrack({ cues: [], styles });
  expect(styled.overlay.querySelector('style')?.textContent).toContain('[data-part="cue"]');
});

test('the announcer feature mirrors entering cues', () => {
  const el = overlay(),
    renderer = createRenderer(el, { features: [announcer('assertive')] });
  renderer.changeTrack({ cues: [new VTTCue(0, 5, '<b>Hello</b>')] });
  renderer.currentTime = 1;
  const live = el.nextElementSibling!;
  expect(live.getAttribute('aria-live')).toBe('assertive');
  expect(live.textContent).toBe('Hello');
  renderer.destroy();
  expect(document.querySelector('[data-part="announcer"]')).toBeNull();
});

test('CaptionsRenderer installs every feature, plus the announcer when asked', () => {
  const names = (features: readonly RendererFeature[]) => features.map((f) => f.name).sort();
  expect(names(new CaptionsRenderer(overlay()).features)).toEqual(names(defaultFeatures()));
  expect(names(new CaptionsRenderer(overlay(), { announce: true }).features)).toContain(
    'announcer',
  );
  // An explicit list wins.
  const custom = new CaptionsRenderer(overlay(), { features: [regions()] });
  expect(names(custom.features)).toEqual(['regions']);
});

test('features with the same name are replaced, later wins', () => {
  const calls: string[] = [];
  const a: RendererFeature = { name: 'x', setup: () => calls.push('a') },
    b: RendererFeature = { name: 'x', setup: () => calls.push('b') };
  const renderer = createRenderer(overlay(), { features: [a, b] });
  expect(renderer.features).toEqual([b]);
  expect(calls).toEqual(['b']);
});

test('hooks run in phase order across the lifecycle', () => {
  const calls: string[] = [];
  const spy: RendererFeature = {
    name: 'spy',
    capabilities: ['typesetting', 'animations'],
    setup: () => calls.push('setup'),
    changeTrack: () => calls.push('changeTrack'),
    createCue: (_, cue) => calls.push(`createCue:${cue.text}`),
    disposeCue: (_, cue) => calls.push(`disposeCue:${cue.text}`),
    containerFor: () => {
      calls.push('containerFor');
      return undefined;
    },
    writeCue: (_, cue) => calls.push(`writeCue:${cue.text}`),
    update: (_, active, entered, exited) =>
      calls.push(
        `update:${active.map((c) => c.text)}|${entered.map((c) => c.text)}|${exited.map((c) => c.text)}`,
      ),
    reset: () => calls.push('reset'),
    destroy: () => calls.push('destroy'),
  };

  const renderer = createRenderer(overlay(), { features: [spy, animations()] });
  const a = new VTTCue(0, 5, 'A');
  renderer.changeTrack({ cues: [a, new VTTCue(3, 8, 'B')] });
  renderer.currentTime = 1;
  renderer.currentTime = 4;
  renderer.currentTime = 6;
  renderer.track.remove(a);
  renderer.destroy();

  // jsdom has no layout, so the overlay box is empty and the write phase is skipped. Attaching
  // the track renders once at time 0 (A is already active), then each time change renders again.
  expect(calls).toEqual([
    'setup',
    'reset',
    'changeTrack',
    'containerFor',
    'createCue:A',
    'update:A|A|',
    'update:A||',
    'containerFor',
    'createCue:B',
    'update:A,B|B|',
    'update:B||A',
    'disposeCue:A',
    'update:B||',
    'disposeCue:B',
    'reset',
    'destroy',
  ]);
});

test('disposed cues are re-created with their new content', () => {
  const el = overlay(),
    renderer = createRenderer(el, { features: [animations()] });
  const live = new VTTCue(0, Infinity, 'Live');
  renderer.changeTrack({ cues: [live] });
  renderer.currentTime = 1;
  live.text = 'Edited';
  renderer.track.update(live);
  expect(displays(el).map((d) => d.textContent)).toEqual(['Edited']);
});
