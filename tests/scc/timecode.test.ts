import { parseSCCFrames, parseSCCTimecode, sccWordsToBytes } from '../../src/scc/scc-parser';

const FPS = 29.97;

test('non-drop timecode', () => {
  expect(parseSCCFrames('00:00:00:00')).toBe(0);
  expect(parseSCCFrames('00:00:01:15')).toBe(45);
  expect(parseSCCTimecode('00:00:01:15')).toBeCloseTo(45 / FPS, 10);
  expect(parseSCCFrames('01:02:03:04')).toBe(((1 * 60 + 2) * 60 + 3) * 30 + 4);
  // Non-drop at 29.97 drifts from wall-clock time.
  expect(parseSCCTimecode('01:00:00:00')).toBeCloseTo(108000 / FPS, 10);
});

test('drop-frame timecode', () => {
  // 2 frames dropped every minute except every 10th: 10 minutes = 18000 - 2 * 9 = 17982 frames.
  expect(parseSCCFrames('00:10:00;00')).toBe(17982);
  expect(parseSCCTimecode('00:10:00;00')).toBeCloseTo(600, 10);
  // One hour of drop-frame is exactly one hour of wall-clock time.
  expect(parseSCCFrames('01:00:00;00')).toBe(107892);
  expect(parseSCCTimecode('01:00:00;00')).toBeCloseTo(3600, 10);
  // First minute has no dropped frames.
  expect(parseSCCFrames('00:00:30;15')).toBe(915);
  // Second minute drops two frames.
  expect(parseSCCFrames('00:01:00;02')).toBe(1800);
  // Alternate drop-frame separators.
  expect(parseSCCFrames('00:10:00.00')).toBe(17982);
  expect(parseSCCFrames('00:10:00,00')).toBe(17982);
});

test('invalid timecode', () => {
  expect(parseSCCTimecode('')).toBeNull();
  expect(parseSCCTimecode('abc')).toBeNull();
  expect(parseSCCTimecode('00:00:01')).toBeNull();
  expect(parseSCCTimecode('00:00:01:30')).toBeNull();
  expect(parseSCCTimecode('00:60:01:00')).toBeNull();
  expect(parseSCCTimecode('00:00:60:00')).toBeNull();
  expect(parseSCCTimecode('00:00:01.500')).toBeNull();
});

test('hex words to bytes strips parity', () => {
  expect(sccWordsToBytes('9420 94ae c8e5 80')).toEqual([
    [0x14, 0x20],
    [0x14, 0x2e],
    [0x48, 0x65],
  ]);
  expect(sccWordsToBytes('  94F2\t9137 ')).toEqual([
    [0x14, 0x72],
    [0x11, 0x37],
  ]);
});
