/**
 * Rendering conformance against https://www.w3.org/TR/webvtt1/#processing-cue-settings and
 * https://www.w3.org/TR/webvtt1/#apply-webvtt-cue-settings, measured in a real layout engine.
 */
import { VTTRegion } from 'media-captions';

import {
  contains,
  createFixture,
  cue,
  cueDisplays,
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

async function show(cues: ReturnType<typeof cue>[], regions?: VTTRegion[]) {
  fixture.renderer.changeTrack({ cues, regions });
  fixture.renderer.currentTime = 1;
  await nextFrame();
  return cueDisplays(fixture.overlay).map(rect);
}

const near = (a: number, b: number, tolerance = 2) => Math.abs(a - b) < tolerance;

function lineHeight() {
  const cueEl = fixture.overlay.querySelector('[data-part="cue"]')!;
  return parseFloat(getComputedStyle(cueEl).lineHeight);
}

test('size is clamped so the cue box never leaves the overlay (maximum size rule)', async () => {
  const [box] = await show([cue(0, 10, 'Clamped', { position: 30, align: 'start', size: 100 })]),
    overlay = rect(fixture.overlay);
  expect(near(box.left, overlay.left + overlay.width * 0.3)).toBe(true);
  expect(near(box.width, overlay.width * 0.7)).toBe(true);
});

test('centre position alignment clamps size to twice the distance to the nearest edge', async () => {
  const [box] = await show([cue(0, 10, 'Centre', { position: 20, align: 'center', size: 100 })]),
    overlay = rect(fixture.overlay);
  expect(near(box.width, overlay.width * 0.4)).toBe(true);
  expect(near((box.left + box.right) / 2, overlay.left + overlay.width * 0.2)).toBe(true);
});

test('explicit positionAlign overrides the alignment-derived anchor', async () => {
  const [box] = await show([
      cue(0, 10, 'Right anchored', {
        position: 90,
        positionAlign: 'line-right',
        size: 40,
        align: 'start',
      }),
    ]),
    overlay = rect(fixture.overlay);
  expect(near(box.right, overlay.left + overlay.width * 0.9)).toBe(true);
});

test('negative snap-to-lines counts from the bottom in line heights', async () => {
  const [minusOne, minusTwo] = await show([
      cue(0, 10, 'line -1', { line: -1, size: 40, position: 25, align: 'center' }),
      cue(0, 10, 'line -2', { line: -2, size: 40, position: 75, align: 'center' }),
    ]),
    overlay = rect(fixture.overlay);
  const debug = JSON.stringify({
    minusOne: minusOne.toJSON(),
    minusTwo: minusTwo.toJSON(),
    overlay: overlay.toJSON(),
    lineHeight: lineHeight(),
  });
  expect(near(minusOne.bottom, overlay.bottom), debug).toBe(true);
  expect(near(minusTwo.bottom, overlay.bottom - lineHeight(), 3), debug).toBe(true);
});

test('positive snap-to-lines counts from the top', async () => {
  const [zero, two] = await show([
      cue(0, 10, 'line 0', { line: 0, size: 40, position: 25, align: 'center' }),
      cue(0, 10, 'line 2', { line: 2, size: 40, position: 75, align: 'center' }),
    ]),
    overlay = rect(fixture.overlay);
  expect(near(zero.top, overlay.top)).toBe(true);
  expect(near(two.top, overlay.top + lineHeight() * 2, 3)).toBe(true);
});

test('RTL base direction mirrors start and end positions', async () => {
  fixture.renderer.dir = 'rtl';
  const [start, end] = await show([
      cue(0, 10, 'התחלה', { align: 'start', size: 30, line: 0 }),
      cue(0, 10, 'סוף', { align: 'end', size: 30, line: 3 }),
    ]),
    overlay = rect(fixture.overlay);
  expect(near(start.right, overlay.right)).toBe(true);
  expect(near(end.left, overlay.left)).toBe(true);
});

test('vertical cues snap lines from the right for rl and from the left for lr', async () => {
  const [rl, lr] = await show([
      cue(0, 10, 'RL', { vertical: 'rl', line: 0 }),
      cue(0, 10, 'LR', { vertical: 'lr', line: 0 }),
    ]),
    overlay = rect(fixture.overlay);
  const debug = JSON.stringify(
    cueDisplays(fixture.overlay).map((el) => ({
      cssText: el.style.cssText,
      writingMode: getComputedStyle(el).writingMode,
      rect: rect(el).toJSON(),
    })),
  );
  expect(near(rl.right, overlay.right), debug).toBe(true);
  expect(near(lr.left, overlay.left), debug).toBe(true);
});

test('region cues are offset by position within the region', async () => {
  const region = new VTTRegion();
  region.id = 'r';
  region.width = 50;
  region.viewportAnchorX = 25;
  region.regionAnchorX = 0;
  const offset = cue(0, 10, 'Offset', { position: 20, positionAlign: 'line-left' });
  offset.region = region;
  await show([offset], [region]);

  const regionBox = rect(fixture.overlay.querySelector('[data-part="region"]')!),
    display = rect(cueDisplays(fixture.overlay)[0]),
    overlay = rect(fixture.overlay);

  expect(near(regionBox.width, overlay.width * 0.5)).toBe(true);
  expect(near(display.left, regionBox.left + regionBox.width * 0.2)).toBe(true);
  expect(contains(overlay, regionBox)).toBe(true);
});

test('regions default to the bottom-left of the overlay', async () => {
  const region = new VTTRegion();
  region.id = 'default';
  const c = cue(0, 10, 'In region');
  c.region = region;
  await show([c], [region]);

  const regionBox = rect(fixture.overlay.querySelector('[data-part="region"]')!),
    overlay = rect(fixture.overlay);
  expect(near(regionBox.left, overlay.left)).toBe(true);
  expect(near(regionBox.bottom, overlay.bottom)).toBe(true);
  expect(near(regionBox.width, overlay.width)).toBe(true);
});
