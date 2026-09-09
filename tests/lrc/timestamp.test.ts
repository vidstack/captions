import { parseLRCTimestamp } from '../../src/lrc/lrc-parser';

test('GOOD: parse timestamps', () => {
  expect(parseLRCTimestamp('00:00')).toBe(0);
  expect(parseLRCTimestamp('01:02')).toBe(62);
  expect(parseLRCTimestamp('01:02.5')).toBe(62.5);
  expect(parseLRCTimestamp('01:02.50')).toBe(62.5);
  expect(parseLRCTimestamp('01:02.505')).toBe(62.505);
  expect(parseLRCTimestamp('123:02.50')).toBe(7382.5);
  expect(parseLRCTimestamp('01:02:03.50')).toBe(3723.5);
});

test('BAD: invalid timestamps', () => {
  expect(parseLRCTimestamp('')).toBeNull();
  expect(parseLRCTimestamp('abc')).toBeNull();
  expect(parseLRCTimestamp('00:xx.00')).toBeNull();
  expect(parseLRCTimestamp('00:60')).toBeNull();
  expect(parseLRCTimestamp('01:60:00')).toBeNull();
  expect(parseLRCTimestamp('1:2')).toBeNull();
  expect(parseLRCTimestamp('00:01.0000')).toBeNull();
});
