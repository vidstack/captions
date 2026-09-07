import { parseText } from 'media-captions';

import {
  createFixture,
  cue,
  cueBoxes,
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

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,64,64,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\fad(2000,0)}Fading in
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\move(100,100,1100,100)}Moving
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\pos(200,400)\\bord0\\p1}m 0 0 l 200 0 200 100 0 100{\\p0}
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an9}Small {\\fs80}Large
`;

async function show(time = 1) {
  const result = await parseText(ASS, { type: 'ass', errors: true });
  expect(result.errors.map((e) => e.message)).toEqual([]);
  expect(result.cues.map((c) => c.text)).toEqual([
    'Fading in',
    'Moving',
    '<c.s-0></c>',
    'Small <c.s-0>Large</c>',
  ]);
  fixture.renderer.changeTrack(result);
  fixture.renderer.currentTime = time;
  await nextFrame();
  return cueDisplays(fixture.overlay);
}

test('drawings render as an inline SVG with the path bounding box as viewBox', async () => {
  const displays = await show(),
    svg = displays[2].querySelector('svg')!,
    overlay = rect(fixture.overlay);

  expect(svg).not.toBeNull();
  expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
  expect(svg.querySelector('path')?.getAttribute('d')).toBe('M0 0L200 0L200 100L0 100Z');

  // 200x100 script pixels of a 1280x720 canvas.
  const box = rect(svg);
  expect(Math.abs(box.width - overlay.width * (200 / 1280))).toBeLessThan(2);
  expect(Math.abs(box.height - overlay.height * (100 / 720))).toBeLessThan(2);
  // Anchored top-left at (200, 400).
  expect(Math.abs(box.left - (overlay.left + overlay.width * (200 / 1280)))).toBeLessThan(2);
  expect(Math.abs(box.top - (overlay.top + overlay.height * (400 / 720)))).toBeLessThan(2);
});

test('per-span \\fs renders the run at the larger size', async () => {
  await show();
  const box = cueBoxes(fixture.overlay)[3],
    span = box.querySelector<HTMLElement>('[data-span="0"]')!,
    overlay = rect(fixture.overlay),
    boxSize = parseFloat(getComputedStyle(box).fontSize),
    spanSize = parseFloat(getComputedStyle(span).fontSize);

  expect(span.textContent).toBe('Large');
  expect(Math.abs(boxSize - overlay.height * (40 / 720))).toBeLessThan(1);
  expect(Math.abs(spanSize - overlay.height * (80 / 720))).toBeLessThan(1);
  expect(spanSize).toBeGreaterThan(boxSize);
});

test('\\fad fades the cue in over media time', async () => {
  const [fading] = await show(1),
    opacity = parseFloat(getComputedStyle(fading).opacity);

  // Half-way through a 2s fade in.
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
});

test('\\move carries the cue between its start and end positions', async () => {
  const displays = await show(1),
    moving = rect(displays[1]),
    overlay = rect(fixture.overlay),
    start = overlay.left + overlay.width * (100 / 1280),
    end = overlay.left + overlay.width * (1100 / 1280);

  expect(displays[1].hasAttribute('data-fixed')).toBe(true);
  expect(moving.left).toBeGreaterThan(start + 1);
  expect(moving.left).toBeLessThan(end - 1);
});

test('transformed text is not clipped by the cue box', async () => {
  const rotated = cue(0, 10, 'Rotated <c.s-r>and scaled</c> text');
  // Transforms only apply to inline-block spans, which is what the SSA parser emits.
  rotated.spans = { r: { display: 'inline-block', transform: 'rotate(15deg) scale(3)' } };
  fixture.renderer.changeTrack({ cues: [rotated] });
  fixture.renderer.currentTime = 1;
  await nextFrame();
  const display = cueDisplays(fixture.overlay)[0],
    span = display.querySelector<HTMLElement>('[data-span="r"]')!,
    containment = getComputedStyle(display).contain;
  expect(containment).not.toMatch(/paint|content|strict/);
  expect(getComputedStyle(fixture.overlay.querySelector('[data-part="cue"]')!).overflow).toBe(
    'visible',
  );
  // The span genuinely extends beyond the display box, so it would be clipped under paint containment.
  expect(rect(span).height).toBeGreaterThan(rect(display).height * 1.5);
});
