import { VTTCue } from 'media-captions';

import {
  computeCueLine,
  computeCuePosition,
  computeCuePositionAlignment,
} from '../../src/vtt/overlay/position-cue';

test('auto line depends on snapToLines', () => {
  const cue = new VTTCue(0, 1, 'x');
  expect(computeCueLine(cue)).toBe(-1);
  cue.snapToLines = false;
  expect(computeCueLine(cue)).toBe(100);
  cue.line = 12.5;
  expect(computeCueLine(cue)).toBe(12.5);
});

test('auto position follows text alignment', () => {
  const cue = new VTTCue(0, 1, 'x');
  expect(computeCuePosition(cue)).toBe(50);
  cue.align = 'left';
  expect(computeCuePosition(cue)).toBe(0);
  cue.align = 'end';
  expect(computeCuePosition(cue)).toBe(100);
  cue.position = 33.3;
  expect(computeCuePosition(cue)).toBe(33.3);
});

test('auto position for start/end follows the base direction', () => {
  const cue = new VTTCue(0, 1, 'x');
  cue.align = 'start';
  expect(computeCuePosition(cue, 'rtl')).toBe(100);
  cue.align = 'end';
  expect(computeCuePosition(cue, 'rtl')).toBe(0);
  cue.align = 'left';
  expect(computeCuePosition(cue, 'rtl')).toBe(0);
});

test('auto position alignment respects direction', () => {
  const cue = new VTTCue(0, 1, 'x');
  cue.align = 'start';
  expect(computeCuePositionAlignment(cue, 'ltr')).toBe('line-left');
  expect(computeCuePositionAlignment(cue, 'rtl')).toBe('line-right');
  cue.align = 'right';
  expect(computeCuePositionAlignment(cue, 'ltr')).toBe('line-right');
  cue.positionAlign = 'center';
  expect(computeCuePositionAlignment(cue, 'ltr')).toBe('center');
});
