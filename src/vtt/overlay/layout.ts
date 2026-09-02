// Pure layout engine: no DOM access. Inputs are measured boxes in container pixels, outputs are
// the boxes to paint. Adapted from the WebVTT rendering rules and https://github.com/videojs/vtt.js

import { avoidBoxCollisions, moveBox, type Box, type DirectionalAxis } from './box';

export interface CueLayoutInput {
  kind: 'cue';
  /** Measured starting box in container pixels, with any CSS translation already folded in. */
  box: Box;
  /** Line height of the cue text, used as the snap-to-lines step. */
  lineHeight: number;
  snapToLines: boolean;
  /** Computed line (never `'auto'`). */
  line: number;
  lineAlign: 'start' | 'center' | 'end';
  vertical: '' | 'rl' | 'lr';
  /** Explicitly positioned cues are never moved, but everything else avoids them. */
  fixed: boolean;
  /** Set when an explicit top/bottom position was supplied via styles. */
  positionOverride: false | 'top' | 'bottom';
}

export interface RegionLayoutInput {
  kind: 'region';
  /** Measured region box in container pixels. */
  box: Box;
}

export type LayoutInput = CueLayoutInput | RegionLayoutInput;

const REGION_AXIS: DirectionalAxis[] = ['-y', '+y', '-x', '+x'];

/**
 * Lays out items in order, each avoiding the ones placed before it. Returns the painted boxes in
 * the same order as the inputs.
 */
export function layoutItems(container: Box, items: LayoutInput[]): Box[] {
  const placed: Box[] = [];
  for (const item of items) placed.push(layoutItem(container, item, placed));
  return placed;
}

export function layoutItem(container: Box, item: LayoutInput, placed: Box[]): Box {
  if (item.kind === 'region') {
    return avoidBoxCollisions(container, { ...item.box }, placed, REGION_AXIS);
  }

  const box = { ...item.box };
  if (item.fixed) return box;

  let axis: DirectionalAxis[];

  if (item.positionOverride) {
    axis = [item.positionOverride === 'top' ? '+y' : '-y', '+x', '-x'];
  } else if (item.snapToLines) {
    axis = snapToLine(container, item, box);
  } else {
    axis = positionByPercentage(container, item, box);
  }

  return avoidBoxCollisions(container, box, placed, axis);
}

/**
 * Snap-to-lines: lines count from the top (horizontal), the left (vertical-lr), or the right
 * (vertical-rl); negative lines count from the opposite edge. Negative lines anchor the far edge
 * of the box to the line so line -1 sits flush even though a padded box is taller than a line.
 */
function snapToLine(container: Box, item: CueLayoutInput, box: Box): DirectionalAxis[] {
  const isHorizontal = item.vertical === '',
    isRL = item.vertical === 'rl',
    containerSize = isHorizontal ? container.height : container.width,
    boxSize = isHorizontal ? box.height : box.width,
    step = item.lineHeight,
    maxOffset = containerSize + step,
    fromStart = item.line >= 0;

  let offset = step * Math.round(item.line);

  if (step && Math.abs(offset) > maxOffset) {
    offset = (offset < 0 ? -1 : 1) * Math.ceil(maxOffset / step) * step;
  }

  let position: number, axis: DirectionalAxis[];

  if (isRL) {
    position = fromStart ? containerSize - boxSize - offset : -offset - step;
    axis = fromStart ? ['-x', '+x'] : ['+x', '-x'];
  } else {
    position = fromStart ? offset : containerSize + offset + step - boxSize;
    axis = isHorizontal
      ? fromStart
        ? ['+y', '-y']
        : ['-y', '+y']
      : fromStart
        ? ['+x', '-x']
        : ['-x', '+x'];
  }

  moveBox(box, isHorizontal ? '+y' : '+x', position);
  return axis;
}

/**
 * Percentage line: the line is a percentage of the container along the block axis, and line
 * alignment decides which edge of the box sits on it (start = leading, center, end = trailing).
 */
function positionByPercentage(container: Box, item: CueLayoutInput, box: Box): DirectionalAxis[] {
  const isHorizontal = item.vertical === '',
    posAxis: DirectionalAxis = isHorizontal ? '+y' : '+x',
    size = isHorizontal ? box.height : box.width;

  moveBox(box, posAxis, ((isHorizontal ? container.height : container.width) * item.line) / 100);
  moveBox(
    box,
    posAxis,
    -(item.lineAlign === 'center' ? size / 2 : item.lineAlign === 'end' ? size : 0),
  );

  return isHorizontal ? ['-y', '+y', '-x', '+x'] : ['-x', '+x', '-y', '+y'];
}
