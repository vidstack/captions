import {
  avoidBoxCollisions,
  isBoxCollision,
  isWithinBox,
  type Box,
} from '../../src/vtt/overlay/box';

const container: Box = { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 };

function box(top: number, left: number, width: number, height: number): Box {
  return { top, left, width, height, right: left + width, bottom: top + height };
}

test('detects collisions inclusively', () => {
  expect(isBoxCollision(box(0, 0, 10, 10), box(10, 10, 10, 10))).toBe(true);
  expect(isBoxCollision(box(0, 0, 10, 10), box(11, 11, 10, 10))).toBe(false);
});

test('moves a colliding cue up past the existing cue', () => {
  const existing = box(80, 0, 100, 20),
    result = avoidBoxCollisions(container, box(85, 0, 100, 10), [existing], ['-y', '+y']);
  expect(result.bottom).toBeLessThan(existing.top);
  expect(result.height).toBe(10);
  expect(isWithinBox(container, result)).toBe(true);
  expect(isBoxCollision(result, existing)).toBe(false);
});

test('chains past multiple stacked cues in one pass', () => {
  const boxes = [box(80, 0, 100, 20), box(59, 0, 100, 20), box(38, 0, 100, 20)],
    result = avoidBoxCollisions(container, box(85, 0, 100, 10), boxes, ['-y', '+y']);
  expect(boxes.some((other) => isBoxCollision(result, other))).toBe(false);
  expect(isWithinBox(container, result)).toBe(true);
});

test('pushes out-of-bounds boxes back inside the container', () => {
  const result = avoidBoxCollisions(container, box(-30, 10, 50, 20), [], ['+y']);
  expect(result.top).toBe(0);
  expect(isWithinBox(container, result)).toBe(true);
});

test('prefers the most visible position when no axis fully resolves', () => {
  const result = avoidBoxCollisions(container, box(-30, -5, 50, 20), [], ['+x', '+y']);
  // Moving down shows 45x20 of the cue, moving right shows nothing.
  expect(result.top).toBe(0);
  expect(result.left).toBe(-5);
});

test('falls back to the opposite axis when the first is blocked', () => {
  const existing = box(0, 0, 100, 60),
    result = avoidBoxCollisions(container, box(50, 0, 100, 20), [existing], ['-y', '+y']);
  expect(result.top).toBeGreaterThanOrEqual(existing.bottom);
  expect(isWithinBox(container, result)).toBe(true);
});

test('returns the least clipped position when no axis resolves the collision', () => {
  const existing = box(0, 0, 100, 100),
    result = avoidBoxCollisions(container, box(40, 0, 100, 20), [existing], ['-y', '+y']);
  expect(result.width).toBe(100);
  expect(result.height).toBe(20);
});
