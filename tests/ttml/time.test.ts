import { parseTTMLTime } from '../../src/ttml/ttml-parser';

test('clock-time expressions', () => {
  expect(parseTTMLTime('00:00:00')).toBe(0);
  expect(parseTTMLTime('01:02:03')).toBe(3723);
  expect(parseTTMLTime('00:00:01.500')).toBe(1.5);
  expect(parseTTMLTime('00:01:02,250')).toBe(62.25);
  expect(parseTTMLTime(' 00:00:10.5 ')).toBe(10.5);
  expect(parseTTMLTime('100:00:00')).toBe(360000);
});

test('clock-time with frames', () => {
  // Default frame rate is 30.
  expect(parseTTMLTime('00:00:01:15')).toBe(1.5);
  expect(parseTTMLTime('00:00:01:12', { frameRate: 25 })).toBeCloseTo(1.48);
  expect(
    parseTTMLTime('00:00:00:15', { frameRate: 30, frameRateMultiplier: 1000 / 1001 }),
  ).toBeCloseTo(15 / (30 * (1000 / 1001)));
  // Sub-frames.
  expect(parseTTMLTime('00:00:00:01.1', { frameRate: 10, subFrameRate: 2 })).toBeCloseTo(0.15);
});

test('drop-frame timecodes', () => {
  const ntsc = { frameRate: 30, dropMode: 'dropNTSC' } as const;
  // 18000 nominal frames minus 2 dropped per minute except every tenth (9 minutes).
  expect(parseTTMLTime('00:10:00:00', ntsc)).toBeCloseTo((17982 * 1001) / 30000, 6);
  expect(parseTTMLTime('00:00:01:00', ntsc)).toBeCloseTo(1.001, 6);
  // Frame 2 is the first real frame of a dropped minute.
  expect(parseTTMLTime('00:01:00:02', ntsc)).toBeCloseTo((1800 * 1001) / 30000, 6);
  // An explicit multiplier wins over the implied 1000/1001.
  expect(parseTTMLTime('00:00:01:00', { ...ntsc, frameRateMultiplier: 1 })).toBe(1);
  // Non-drop and the (unsupported) PAL rule count frames linearly.
  expect(parseTTMLTime('00:10:00:00', { frameRate: 30, dropMode: 'nonDrop' })).toBe(600);
  expect(parseTTMLTime('00:10:00:00', { frameRate: 25, dropMode: 'dropPAL' })).toBe(600);
});

test('offset-time expressions', () => {
  expect(parseTTMLTime('1h')).toBe(3600);
  expect(parseTTMLTime('1.5m')).toBe(90);
  expect(parseTTMLTime('12.345s')).toBe(12.345);
  expect(parseTTMLTime('250ms')).toBe(0.25);
  expect(parseTTMLTime('.5s')).toBe(0.5);
  expect(parseTTMLTime('50f', { frameRate: 25 })).toBe(2);
  expect(parseTTMLTime('50f')).toBeCloseTo(50 / 30);
  expect(parseTTMLTime('10t')).toBe(10);
  expect(parseTTMLTime('10t', { tickRate: 10000000 })).toBe(0.000001);
});

test('invalid expressions', () => {
  expect(parseTTMLTime('')).toBeNull();
  expect(parseTTMLTime('abc')).toBeNull();
  expect(parseTTMLTime('10')).toBeNull();
  expect(parseTTMLTime('10x')).toBeNull();
  expect(parseTTMLTime('00:00')).toBeNull();
  expect(parseTTMLTime('00:00:00:')).toBeNull();
  expect(parseTTMLTime('1s2s')).toBeNull();
});
