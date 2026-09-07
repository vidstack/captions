import { VTTRegion } from 'media-captions';

import {
  contains,
  createFixture,
  cue,
  cueBoxes,
  cueDisplays,
  intersects,
  nextFrame,
  rect,
  sleep,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  type Fixture,
} from './helpers';

let fixture: Fixture;

beforeEach(() => {
  fixture = createFixture();
});

afterEach(() => {
  fixture.destroy();
});

async function show(cues: ReturnType<typeof cue>[], time = 1, regions?: VTTRegion[]) {
  fixture.renderer.changeTrack({ cues, regions });
  fixture.renderer.currentTime = time;
  await nextFrame();
}

test('default cue renders bottom-centred inside the overlay', async () => {
  await show([cue(0, 10, 'Hello world')]);

  const overlay = rect(fixture.overlay),
    box = rect(cueBoxes(fixture.overlay)[0]);

  expect(contains(overlay, box)).toBe(true);
  // Bottom aligned (within one line height of the bottom edge).
  expect(overlay.bottom - box.bottom).toBeLessThan(box.height);
  // Horizontally centred.
  const centre = (box.left + box.right) / 2,
    overlayCentre = (overlay.left + overlay.right) / 2;
  expect(Math.abs(centre - overlayCentre)).toBeLessThan(2);
});

test('simultaneous cues stack upwards without overlapping', async () => {
  await show([cue(0, 10, 'First cue'), cue(0.5, 10, 'Second cue'), cue(1, 10, 'Third cue')], 2);

  const boxes = cueDisplays(fixture.overlay).map(rect),
    overlay = rect(fixture.overlay);

  expect(boxes).toHaveLength(3);
  for (const box of boxes) expect(contains(overlay, box)).toBe(true);

  // Later cues sit lower, earlier cues are pushed up.
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 1);
  expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].top + 1);

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(intersects(boxes[i], boxes[j])).toBe(false);
    }
  }
});

test('snap-to-lines line:0 renders at the top, line:-1 at the bottom', async () => {
  await show([cue(0, 10, 'Top', { line: 0 }), cue(0, 10, 'Bottom', { line: -1 })]);

  const [top, bottom] = cueDisplays(fixture.overlay).map(rect),
    overlay = rect(fixture.overlay);

  expect(top.top - overlay.top).toBeLessThan(2);
  expect(overlay.bottom - bottom.bottom).toBeLessThan(2);
});

test('percentage line positions the cue relative to the overlay height', async () => {
  await show([
    cue(0, 10, 'Start', { snapToLines: false, line: 50, size: 40, position: 25, align: 'center' }),
    cue(0, 10, 'Center', {
      snapToLines: false,
      line: 50,
      lineAlign: 'center',
      size: 40,
      position: 75,
      align: 'center',
    }),
    cue(0, 10, 'End', {
      snapToLines: false,
      line: 90,
      lineAlign: 'end',
      size: 40,
      position: 25,
      align: 'center',
    }),
  ]);

  const [start, center, end] = cueDisplays(fixture.overlay).map(rect),
    overlay = rect(fixture.overlay),
    middle = overlay.top + overlay.height / 2;

  // lineAlign start: top edge on the line; center: box centred on the line; end: bottom on it.
  expect(Math.abs(start.top - middle)).toBeLessThan(2);
  expect(Math.abs((center.top + center.bottom) / 2 - middle)).toBeLessThan(2);
  expect(Math.abs(end.bottom - (overlay.top + overlay.height * 0.9))).toBeLessThan(2);
});

test('position, size, and align control the horizontal box', async () => {
  await show([cue(0, 10, 'Left aligned cue', { position: 10, size: 30, align: 'start' })]);

  const display = rect(cueDisplays(fixture.overlay)[0]),
    overlay = rect(fixture.overlay);

  expect(Math.abs(display.left - (overlay.left + overlay.width * 0.1))).toBeLessThan(2);
  expect(Math.abs(display.width - overlay.width * 0.3)).toBeLessThan(2);
});

test('right aligned cues anchor their position to the right edge', async () => {
  await show([cue(0, 10, 'Right', { position: 90, size: 40, align: 'end' })]);

  const display = rect(cueDisplays(fixture.overlay)[0]),
    overlay = rect(fixture.overlay);

  expect(Math.abs(display.right - (overlay.left + overlay.width * 0.9))).toBeLessThan(2);
});

test('vertical cues use a vertical writing mode and hug the edge', async () => {
  await show([cue(0, 10, 'Vertical text here', { vertical: 'rl' })]);

  const display = cueDisplays(fixture.overlay)[0],
    box = rect(display),
    overlay = rect(fixture.overlay);

  expect(getComputedStyle(display).writingMode).toBe('vertical-rl');
  expect(box.height).toBeGreaterThan(box.width);
  expect(contains(overlay, box)).toBe(true);
});

test('explicit percentage positions from cue styles are honoured', async () => {
  const styled = cue(0, 10, 'Styled');
  styled.style = {
    '--cue-left': '10%',
    '--cue-right': '10%',
    '--cue-bottom': '5%',
    '--cue-width': 'auto',
  };
  await show([styled]);

  const display = rect(cueDisplays(fixture.overlay)[0]),
    overlay = rect(fixture.overlay);

  expect(Math.abs(display.left - (overlay.left + overlay.width * 0.1))).toBeLessThan(2);
  expect(Math.abs(display.right - (overlay.right - overlay.width * 0.1))).toBeLessThan(2);
  expect(Math.abs(display.bottom - (overlay.bottom - overlay.height * 0.05))).toBeLessThan(2);
});

test('styled cues that collide are moved apart', async () => {
  const a = cue(0, 10, 'A'),
    b = cue(0, 10, 'B');
  a.style = { '--cue-top': '40%' };
  b.style = { '--cue-top': '40%' };
  await show([a, b]);

  const [boxA, boxB] = cueDisplays(fixture.overlay).map(rect);
  expect(intersects(boxA, boxB)).toBe(false);
});

test('regions clip to the configured number of lines and roll up', async () => {
  const region = new VTTRegion();
  region.id = 'r';
  region.lines = 2;
  region.scroll = 'up';

  const cues = [cue(0, 10, 'Line one'), cue(1, 10, 'Line two'), cue(2, 10, 'Line three')];
  for (const c of cues) c.region = region;

  await show(cues, 3, [region]);
  await sleep(500); // scroll transition

  const regionEl = fixture.overlay.querySelector<HTMLElement>('[data-part="region"]')!,
    regionBox = rect(regionEl),
    displays = cueDisplays(fixture.overlay),
    lineHeight = rect(displays[0]).height;

  expect(displays).toHaveLength(3);
  // Region height is two lines.
  expect(Math.abs(regionBox.height - lineHeight * 2)).toBeLessThan(lineHeight * 0.5);
  // The oldest line has scrolled out of the visible region.
  expect(rect(displays[0]).top).toBeLessThan(regionBox.top);
  expect(contains(regionBox, rect(displays[2]), 2)).toBe(true);
  expect(regionEl.hasAttribute('data-active')).toBe(true);
});

test('cues stay within bounds after the overlay resizes', async () => {
  await show([cue(0, 10, 'Resizing cue'), cue(0, 10, 'Second resizing cue')]);

  fixture.viewport.style.width = `${VIEWPORT_WIDTH / 2}px`;
  fixture.viewport.style.height = `${VIEWPORT_HEIGHT / 2}px`;
  await sleep(150); // resize observer + debounce
  await nextFrame();

  const overlay = rect(fixture.overlay),
    boxes = cueDisplays(fixture.overlay).map(rect);

  expect(overlay.width).toBeLessThan(VIEWPORT_WIDTH);
  for (const box of boxes) expect(contains(overlay, box)).toBe(true);
  expect(intersects(boxes[0], boxes[1])).toBe(false);
});

test('font size tracks the overlay height', async () => {
  await show([cue(0, 10, 'Sized')]);
  const box = cueBoxes(fixture.overlay)[0],
    fontSize = parseFloat(getComputedStyle(box).fontSize);
  // 5% of the overlay height (overlay has 1% padding on each side).
  expect(Math.abs(fontSize - rect(fixture.overlay).height * 0.05)).toBeLessThan(1);
});

test('cue text uses balanced wrapping', async () => {
  await show([
    cue(0, 10, 'A fairly long caption that will definitely wrap onto two lines', { size: 40 }),
  ]);
  const box = cueBoxes(fixture.overlay)[0],
    style = getComputedStyle(box) as CSSStyleDeclaration & { textWrapStyle?: string };
  expect(style.textWrapStyle ?? style.getPropertyValue('text-wrap')).toContain('balance');
  expect(rect(box).height).toBeGreaterThan(parseFloat(style.lineHeight) * 1.5);
});

test('re-layout after a resize keeps percentage and vertical positions instead of re-applying them', async () => {
  const percent = cue(0, 10, 'Percent', { snapToLines: false, line: 30, lineAlign: 'center' }),
    vertical = cue(0, 10, '縦書き', {
      vertical: 'rl',
      snapToLines: false,
      line: 60,
      lineAlign: 'end',
    }),
    snapped = cue(0, 10, 'Line two', { line: 2 });
  fixture.renderer.changeTrack({ cues: [percent, vertical, snapped] });
  fixture.renderer.currentTime = 1;
  await nextFrame();
  const before = cueDisplays(fixture.overlay).map((el) => rect(el));

  // The initial ResizeObserver callback (debounced) and a real resize both re-measure.
  await sleep(150);
  fixture.viewport.style.width = `${VIEWPORT_WIDTH + 80}px`;
  await sleep(150);
  const after = cueDisplays(fixture.overlay).map((el) => rect(el)),
    frame = rect(fixture.viewport);

  // Percentage line: still centred on 30% of the height.
  expect(
    Math.abs((after[0].top + after[0].height / 2 - frame.top) / frame.height - 0.3),
  ).toBeLessThan(0.02);
  // Vertical: right edge still at 60% of the (new) width, not pushed to the edge.
  expect(Math.abs((after[1].right - frame.left) / frame.width - 0.6)).toBeLessThan(0.03);
  // Snapped: same line as before.
  expect(Math.abs(after[2].top - before[2].top)).toBeLessThan(2);
});
