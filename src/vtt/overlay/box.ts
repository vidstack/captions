// Adapted from: https://github.com/videojs/vtt.js

import { setCSSVar } from '../../utils/style';

export const STARTING_BOX = Symbol(__DEV__ ? 'STARTING_BOX' : 0);

export type DirectionalAxis = '-x' | '+x' | '-y' | '+y';

export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function createBox(box: Box | Element): Box {
  if (box instanceof Element) {
    const rect = box.getBoundingClientRect() as unknown as Box;
    return {
      top: rect.top,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    };
  }

  return { ...box };
}

export function updateBoxDimensions(container: Box, box: Box, el: Element) {
  box.width = el.clientWidth;
  box.height = el.clientHeight;
  box.right = Math.min(container.right, box.left + box.width);
  box.bottom = Math.min(container.bottom, box.top + box.height);
}

export function moveBox(box: Box, axis: DirectionalAxis, delta: number): void {
  switch (axis) {
    case '+x':
      box.left += delta;
      box.right += delta;
      break;
    case '-x':
      box.left -= delta;
      box.right -= delta;
      break;
    case '+y':
      box.top += delta;
      box.bottom += delta;
      break;
    case '-y':
      box.top -= delta;
      box.bottom -= delta;
      break;
  }
}

export function isBoxCollision(boxA: Box, boxB: Box): boolean {
  return (
    boxA.left <= boxB.right &&
    boxA.right >= boxB.left &&
    boxA.top <= boxB.bottom &&
    boxA.bottom >= boxB.top
  );
}

export function isAnyBoxCollision(box: Box, boxes: Box[]): Box | null {
  for (let i = 0; i < boxes.length; i++) if (isBoxCollision(box, boxes[i])) return boxes[i];
  return null;
}

export function isWithinBox(container: DOMRect | Box, box: Box): boolean {
  return (
    box.top >= container.top &&
    box.bottom <= container.bottom &&
    box.left >= container.left &&
    box.right <= container.right
  );
}

export function isBoxOutOfBounds(container: Box, box: Box, axis: DirectionalAxis): boolean {
  switch (axis) {
    case '+x':
      return box.left < container.left;
    case '-x':
      return box.right > container.right;
    case '+y':
      return box.top < container.top;
    case '-y':
      return box.bottom > container.bottom;
  }
}

export function calcBoxIntersectPercentage(boxA: Box, boxB: Box): number {
  const x = Math.max(0, Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left)),
    y = Math.max(0, Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top)),
    intersectArea = x * y;
  return intersectArea / (boxA.height * boxA.width);
}

export function createCSSBox(container: Box, box: Box) {
  return {
    top: (box.top - container.top) / container.height,
    left: (box.left - container.left) / container.width,
    right: (container.right - box.right) / container.width,
    bottom: (container.bottom - box.bottom) / container.height,
  };
}

export const BOX_SIDES = ['top', 'left', 'right', 'bottom'] as const;

export function setBoxCSSVars(el: HTMLElement, container: Box, box: Box, prefix: string) {
  const cssBox = createCSSBox(container, box);
  for (const side of BOX_SIDES) {
    setCSSVar(el, `${prefix}-${side}`, Math.abs(cssBox[side]) * 100 + '%');
  }
}

export function avoidBoxCollisions(
  container: Box,
  box: Box,
  boxes: Box[],
  axis: DirectionalAxis[],
): Box {
  let percentage = 1,
    positionedBox: Box | undefined,
    startBox = { ...box };

  for (let i = 0; i < axis.length; i++) {
    while (
      isBoxOutOfBounds(container, box, axis[i]) ||
      (isWithinBox(container, box) && isAnyBoxCollision(box, boxes))
    ) {
      moveBox(box, axis[i], 1);
    }

    if (isWithinBox(container, box)) return box;

    const intersection = calcBoxIntersectPercentage(container, box);
    if (percentage > intersection) {
      positionedBox = { ...box };
      percentage = intersection;
    }

    box = { ...startBox };
  }

  return positionedBox || startBox;
}
