import { CaptionsRenderer } from 'media-captions';

import {
  createFixture,
  cue,
  cueBoxes,
  cueDisplays,
  intersects,
  nextFrame,
  rect,
  type Fixture,
} from './helpers';

let fixture: Fixture;

beforeEach(() => {
  fixture = createFixture();
});

afterEach(() => {
  fixture.destroy();
});

async function show(cues: ReturnType<typeof cue>[], time: number) {
  fixture.renderer.changeTrack({ cues });
  fixture.renderer.currentTime = time;
  await nextFrame();
}

const opacityOf = (el: Element) => parseFloat(getComputedStyle(el).opacity);

test('animations follow media time, including seeking backwards and pausing', async () => {
  const fading = cue(10, 20, 'Fade');
  fading.animations = [{ duration: 4, keyframes: [{ opacity: 0 }, { opacity: 1 }] }];
  await show([fading], 12);

  const display = cueDisplays(fixture.overlay)[0];
  expect(opacityOf(display)).toBeCloseTo(0.5, 1);

  fixture.renderer.currentTime = 11;
  await nextFrame();
  expect(opacityOf(display)).toBeCloseTo(0.25, 1);

  fixture.renderer.currentTime = 18; // past the animation: fill both keeps the end state
  await nextFrame();
  expect(opacityOf(display)).toBeCloseTo(1, 1);

  // Paused media: the value must not drift with wall-clock time.
  fixture.renderer.currentTime = 12;
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(opacityOf(display)).toBeCloseTo(0.5, 1);
});

test('delay and duration are relative to the cue start', async () => {
  const later = cue(0, 10, 'Delayed');
  later.animations = [{ delay: 2, duration: 2, keyframes: [{ opacity: 0 }, { opacity: 1 }] }];
  await show([later], 1);
  const display = cueDisplays(fixture.overlay)[0];
  expect(opacityOf(display)).toBeCloseTo(0, 1);
  fixture.renderer.currentTime = 3;
  await nextFrame();
  expect(opacityOf(display)).toBeCloseTo(0.5, 1);
});

test('moving cues animate position and are exempt from collision avoidance', async () => {
  const moving = cue(0, 10, 'Move');
  moving.layout = { left: 10, top: 20, width: 'max-content' };
  moving.animations = [
    {
      duration: 10,
      keyframes: [
        { left: '10%', top: '20%' },
        { left: '60%', top: '20%' },
      ],
    },
  ];
  const blocker = cue(0, 10, 'Blocker', { snapToLines: false, line: 20 });
  await show([moving, blocker], 5);

  const [moveBox] = cueDisplays(fixture.overlay).map(rect),
    overlay = rect(fixture.overlay);
  expect(cueDisplays(fixture.overlay)[0].hasAttribute('data-fixed')).toBe(true);
  expect(Math.abs(moveBox.left - (overlay.left + overlay.width * 0.35))).toBeLessThan(3);
});

test('span-targeted animations affect only that run', async () => {
  const c = cue(0, 10, 'Plain <c.s-hot>hot</c>');
  c.spans = { hot: { color: 'rgb(255, 255, 255)' } };
  c.animations = [
    {
      target: { span: 'hot' },
      duration: 10,
      keyframes: [{ color: 'rgb(0, 0, 0)' }, { color: 'rgb(255, 0, 0)' }],
    },
  ];
  await show([c], 5);
  const span = fixture.overlay.querySelector<HTMLElement>('[data-span="hot"]')!;
  const [r, g] = getComputedStyle(span).color.match(/\d+/g)!.map(Number);
  expect(r).toBeGreaterThan(100);
  expect(g).toBe(0);
  expect(getComputedStyle(cueBoxes(fixture.overlay)[0]).color).toBe('rgb(255, 255, 255)');
});

test('collision boxes use the painted box, so rotated cues do not overlap', async () => {
  const a = cue(0, 10, 'A rather long rotated caption line'),
    b = cue(0, 10, 'Another rather long caption line');
  a.textStyle = { transform: 'rotate(90deg)' };
  a.layout = { left: 50, top: 50, width: 'max-content', translate: { x: -0.5, y: -0.5 } };
  b.layout = { left: 50, top: 50, width: 'max-content', translate: { x: -0.5, y: -0.5 } };
  await show([a, b], 1);
  const [boxA, boxB] = cueDisplays(fixture.overlay).map(rect);
  expect(boxA.height).toBeGreaterThan(boxA.width); // rotated
  expect(intersects(boxA, boxB)).toBe(false);
});

test('clip paths apply to the cue box', async () => {
  const clipped = cue(0, 10, 'Clipped');
  clipped.layout = { clipPath: 'inset(0 50% 0 0)' };
  await show([clipped], 1);
  expect(getComputedStyle(cueDisplays(fixture.overlay)[0]).clipPath).toBe('inset(0px 50% 0px 0px)');
});

test('stacking: spec keeps the earliest cue in the default slot', async () => {
  fixture.destroy();
  const viewport = document.createElement('div');
  viewport.style.cssText = 'position: relative; width: 640px; height: 360px;';
  const overlay = document.createElement('div');
  viewport.append(overlay);
  document.body.append(viewport);
  const renderer = new CaptionsRenderer(overlay, { stacking: 'spec' });
  renderer.changeTrack({ cues: [cue(0, 10, 'First'), cue(1, 10, 'Second')] });
  renderer.currentTime = 2;
  await nextFrame();
  const [first, second] = Array.from(overlay.querySelectorAll('[data-part="cue-display"]')).map(
    rect,
  );
  expect(first.bottom).toBeGreaterThan(second.bottom);
  renderer.destroy();
  viewport.remove();
  fixture = createFixture();
});

test('lineStep: box stacks negative lines by the padded box height', async () => {
  fixture.destroy();
  const viewport = document.createElement('div');
  viewport.style.cssText = 'position: relative; width: 640px; height: 360px;';
  const overlay = document.createElement('div');
  viewport.append(overlay);
  document.body.append(viewport);
  const renderer = new CaptionsRenderer(overlay, { lineStep: 'box', safeArea: 10 });
  renderer.changeTrack({
    cues: [
      cue(0, 10, 'line -1', { line: -1, size: 40, position: 25 }),
      cue(0, 10, 'line -2', { line: -2, size: 40, position: 75 }),
    ],
  });
  renderer.currentTime = 1;
  await nextFrame();
  const [one, two] = Array.from(overlay.querySelectorAll('[data-part="cue-display"]')).map(rect);
  expect(Math.abs(two.bottom - one.top)).toBeLessThan(2);
  // safeArea sets the overlay padding (10% of the viewport width on each side).
  expect(Math.abs(rect(overlay).left - (rect(viewport).left + 64))).toBeLessThan(1);
  renderer.destroy();
  viewport.remove();
  fixture = createFixture();
});

test('reduced motion holds animations at their final state', async () => {
  fixture.destroy();
  const viewport = document.createElement('div');
  viewport.style.cssText = 'position: relative; width: 640px; height: 360px;';
  const overlay = document.createElement('div');
  viewport.append(overlay);
  document.body.append(viewport);
  const renderer = new CaptionsRenderer(overlay, { reducedMotion: true });
  const fading = cue(0, 10, 'Fade');
  fading.animations = [{ duration: 8, keyframes: [{ opacity: 0 }, { opacity: 1 }] }];
  renderer.changeTrack({ cues: [fading] });
  renderer.currentTime = 1;
  await nextFrame();
  expect(opacityOf(overlay.querySelector('[data-part="cue-display"]')!)).toBeCloseTo(1, 1);
  renderer.destroy();
  viewport.remove();
  fixture = createFixture();
});

test('user presets change size, background, and font via data attributes', async () => {
  await show([cue(0, 10, 'Preset')], 1);
  const box = cueBoxes(fixture.overlay)[0],
    base = parseFloat(getComputedStyle(box).fontSize);
  fixture.overlay.setAttribute('data-text-size', 'x-large');
  fixture.overlay.setAttribute('data-background', 'none');
  fixture.overlay.setAttribute('data-font', 'mono');
  await nextFrame();
  expect(parseFloat(getComputedStyle(box).fontSize)).toBeGreaterThan(base * 1.4);
  expect(getComputedStyle(box).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(box).fontFamily.toLowerCase()).toContain('courier');
});
