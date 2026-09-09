import { parseText } from 'media-captions';

import {
  contains,
  createFixture,
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
Style: Sign,Arial,40,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,4,0,8,64,64,36,1
Style: Note,Arial,30,&H00FFD0A0,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,0,7,64,64,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,Bottom centre dialogue
Dialogue: 0,0:00:00.00,0:00:10.00,Sign,,0,0,0,,Top centre sign
Dialogue: 0,0:00:00.00,0:00:10.00,Note,,0,0,0,,Top left note
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\pos(640,360)\\an5}Centred anchor
`;

async function show() {
  const result = await parseText(ASS, { type: 'ass', errors: true });
  expect(result.errors.map((e) => e.message)).toEqual([]);
  expect(result.cues.map((c) => c.text)).toEqual([
    'Bottom centre dialogue',
    'Top centre sign',
    'Top left note',
    'Centred anchor',
  ]);
  fixture.renderer.changeTrack(result);
  fixture.renderer.currentTime = 1;
  await nextFrame();
  return cueDisplays(fixture.overlay);
}

test('style alignment places cues within the play resolution margins', async () => {
  const [bottom, top, note] = (await show()).map(rect),
    overlay = rect(fixture.overlay),
    centreX = overlay.left + overlay.width / 2,
    marginX = overlay.width * (64 / 1280),
    marginY = overlay.height * (36 / 720);

  // Default: bottom centre, MarginV from the bottom.
  expect(Math.abs((bottom.left + bottom.right) / 2 - centreX)).toBeLessThan(2);
  expect(Math.abs(bottom.bottom - (overlay.bottom - marginY))).toBeLessThan(2);

  // Sign (an8): top centre, MarginV from the top.
  expect(Math.abs((top.left + top.right) / 2 - centreX)).toBeLessThan(2);
  expect(Math.abs(top.top - (overlay.top + marginY))).toBeLessThan(2);

  // Note (an7): top left at MarginL.
  expect(Math.abs(note.left - (overlay.left + marginX))).toBeLessThan(2);
  expect(Math.abs(note.top - (overlay.top + marginY))).toBeLessThan(2);
});

test('\\pos with \\an5 centres the cue on the given point', async () => {
  const displays = await show(),
    fixed = rect(displays[3]),
    overlay = rect(fixture.overlay);

  expect(displays[3].hasAttribute('data-fixed')).toBe(true);
  expect(
    Math.abs((fixed.left + fixed.right) / 2 - (overlay.left + overlay.width / 2)),
  ).toBeLessThan(2);
  expect(
    Math.abs((fixed.top + fixed.bottom) / 2 - (overlay.top + overlay.height / 2)),
  ).toBeLessThan(2);
  expect(contains(overlay, fixed)).toBe(true);
});

test('font size, outline, and opaque box scale with the play resolution', async () => {
  await show();
  const [dialogue, sign] = cueBoxes(fixture.overlay),
    overlay = rect(fixture.overlay),
    dialogueStyle = getComputedStyle(dialogue),
    signStyle = getComputedStyle(sign);

  expect(Math.abs(parseFloat(dialogueStyle.fontSize) - overlay.height * (40 / 720))).toBeLessThan(
    1,
  );
  // Outline 3px at 720p -> stroke of 6px scaled.
  expect(
    Math.abs(parseFloat(dialogueStyle.webkitTextStrokeWidth) - overlay.height * (6 / 720)),
  ).toBeLessThan(1);
  expect(dialogueStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(signStyle.backgroundColor).toBe('rgb(0, 0, 0)');
  expect(signStyle.color).toBe('rgb(255, 255, 0)');
  expect(signStyle.fontWeight).toBe('700');
});
