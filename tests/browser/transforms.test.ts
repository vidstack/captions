import {
  contains,
  createFixture,
  cue,
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

async function show(cues: ReturnType<typeof cue>[]) {
  fixture.renderer.changeTrack({ cues });
  fixture.renderer.currentTime = 1;
  await nextFrame();
}

test('centred cues using translateX(-50%) stay centred after positioning', async () => {
  const centred = cue(0, 10, 'Centred via transform');
  centred.layout = { left: 50, width: 'max-content', bottom: 5, translate: { x: -0.5 } };
  await show([centred]);

  const box = rect(cueDisplays(fixture.overlay)[0]),
    overlay = rect(fixture.overlay),
    centre = (box.left + box.right) / 2;

  expect(Math.abs(centre - (overlay.left + overlay.width / 2))).toBeLessThan(2);
  expect(Math.abs(box.bottom - (overlay.bottom - overlay.height * 0.05))).toBeLessThan(2);
});

test('fixed cues are anchored exactly and never moved by collisions', async () => {
  const fixed = cue(0, 10, 'Fixed anchor');
  fixed.layout = {
    left: 50,
    top: 50,
    width: 'max-content',
    translate: { x: -0.5, y: -0.5 },
    fixed: true,
  };
  const other = cue(0, 10, 'Other cue', { snapToLines: false, line: 50, lineAlign: 'center' });
  await show([fixed, other]);

  const [fixedBox, otherBox] = cueDisplays(fixture.overlay).map(rect),
    overlay = rect(fixture.overlay),
    centreX = overlay.left + overlay.width / 2,
    centreY = overlay.top + overlay.height / 2;

  expect(Math.abs((fixedBox.left + fixedBox.right) / 2 - centreX)).toBeLessThan(2);
  expect(Math.abs((fixedBox.top + fixedBox.bottom) / 2 - centreY)).toBeLessThan(2);
  // The other cue is the one that moved.
  expect(intersects(fixedBox, otherBox)).toBe(false);
  expect(contains(overlay, otherBox)).toBe(true);
});

test('collision boxes account for translated cues', async () => {
  const a = cue(0, 10, 'Translated A'),
    b = cue(0, 10, 'Translated B');
  for (const c of [a, b]) {
    // Raw `--cue-*` styles remain supported as an escape hatch.
    c.style = {
      '--cue-left': '50%',
      '--cue-width': 'max-content',
      '--cue-bottom': '5%',
      '--cue-transform': 'translateX(-50%)',
    };
  }
  await show([a, b]);
  const [boxA, boxB] = cueDisplays(fixture.overlay).map(rect);
  expect(intersects(boxA, boxB)).toBe(false);
});
