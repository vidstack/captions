/**
 * Visual regression: renders representative scenarios in Chromium and compares against committed
 * screenshots. Baselines are stored per browser and platform under `__screenshots__`, so the first
 * run on a new platform records them instead of failing. Font rendering varies slightly between
 * Chromium builds, hence the small mismatch allowance.
 */
import { parseText, VTTRegion } from 'media-captions';
import { page } from 'vitest/browser';

import { createFixture, cue, nextFrame, sleep, type Fixture } from './helpers';

let fixture: Fixture;

beforeEach(() => {
  fixture = createFixture(640, 360);
  // Deterministic typography for screenshots.
  fixture.overlay.style.fontFamily = 'Arial, Helvetica, sans-serif';
});

afterEach(() => {
  fixture.destroy();
});

async function snapshot(name: string) {
  await nextFrame();
  await expect(page.elementLocator(fixture.viewport)).toMatchScreenshot(name, {
    comparatorName: 'pixelmatch',
    comparatorOptions: { allowedMismatchedPixelRatio: 0.005 },
  });
}

test('default cue with formatting', async () => {
  fixture.renderer.changeTrack({
    cues: [cue(0, 10, 'Default cue with <b>bold</b>, <i>italic</i>, and <c.yellow>colour</c>')],
  });
  fixture.renderer.currentTime = 1;
  await snapshot('default-cue');
});

test('positioned and stacked cues', async () => {
  fixture.renderer.changeTrack({
    cues: [
      cue(0, 10, 'line:0', { line: 0 }),
      cue(0, 10, 'line:50% position:10% size:35%', {
        snapToLines: false,
        line: 50,
        position: 10,
        size: 35,
        align: 'start',
      }),
      cue(0, 10, 'position:90% size:35% align:end', {
        position: 90,
        size: 35,
        align: 'end',
        line: -4,
      }),
      cue(0, 10, 'First of three'),
      cue(0.5, 10, 'Second of three'),
      cue(1, 10, 'Third of three'),
    ],
  });
  fixture.renderer.currentTime = 2;
  await snapshot('positioned-and-stacked');
});

test('roll-up region', async () => {
  const region = new VTTRegion();
  Object.assign(region, {
    id: 'r',
    width: 70,
    lines: 3,
    viewportAnchorX: 15,
    regionAnchorX: 0,
    scroll: 'up',
  });
  const cues = [
    'Roll-up line one',
    'Roll-up line two',
    'Roll-up line three',
    'Line four scrolls out line one',
  ].map((text, i) => cue(i, 20, text));
  for (const c of cues) c.region = region;
  fixture.renderer.changeTrack({ regions: [region], cues });
  fixture.renderer.currentTime = 3.5;
  await sleep(600); // scroll transition
  await snapshot('roll-up-region');
});

test('SSA styles', async () => {
  const result = await parseText(
    `[Script Info]
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,40,40,40,1
Style: Sign,Arial,40,&H0000FFFF,&H000000FF,&H00203040,&H00000000,-1,0,0,0,100,100,0,0,3,4,0,8,40,40,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,Outlined dialogue with {\\i1}italics{\\i0} and {\\c&H00A5FF&}colour{\\r}
Dialogue: 1,0:00:00.00,0:00:10.00,Sign,,0,0,0,,Opaque box sign
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\pos(640,400)\\an5}Positioned
`,
    { type: 'ass' },
  );
  fixture.renderer.changeTrack(result);
  fixture.renderer.currentTime = 1;
  await snapshot('ssa-styles');
});

test('edge styles', async () => {
  fixture.overlay.setAttribute('data-edge-style', 'uniform');
  fixture.overlay.style.setProperty('--cue-bg-color', 'transparent');
  fixture.renderer.changeTrack({
    cues: [cue(0, 10, 'Uniform edge style', { line: 1 }), cue(0, 10, 'Bottom uniform edge style')],
  });
  fixture.renderer.currentTime = 1;
  await snapshot('edge-style-uniform');
});
