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

export function updateBoxDimensions(box: Box, el: Element) {
  box.width = el.clientWidth;
  box.height = el.clientHeight;
  box.right = box.left + box.width;
  box.bottom = box.top + box.height;
  return box;
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
    top: box.top - container.top,
    left: box.left - container.left,
    right: container.right - box.right,
    bottom: container.bottom - box.bottom,
  };
}

export function setBoxCSSVars(el: HTMLElement, container: Box, box: Box, prefix: string) {
  const cssBox = createCSSBox(container, box);
  for (const pos of ['top', 'left', 'right', 'bottom']) {
    setCSSVar(el, `${prefix}-${pos}`, cssBox[pos] + 'px');
  }
}

export function avoidBoxCollisions(
  container: Box,
  box: Box,
  boxes: Box[],
  axis: DirectionalAxis[],
): Box {
  let percentage = 1,
    collisionBox: Box | null = null,
    positionedBox: Box | undefined,
    startBox = createBox(box);

  for (let i = 0; i < axis.length; i++) {
    collisionBox = null;

    while (
      isBoxOutOfBounds(container, box, axis[i]) ||
      (isWithinBox(container, box) && (collisionBox = isAnyBoxCollision(box, boxes)))
    ) {
      moveBox(box, axis[i], calcBoxMoveDelta(axis[i], box, collisionBox) + 8);
      collisionBox = null;
    }

    if (isWithinBox(container, box)) return box;

    const intersection = calcBoxIntersectPercentage(container, box);
    if (percentage > intersection) {
      positionedBox = createBox(box);
      percentage = intersection;
    }

    box = createBox(startBox);
  }

  return positionedBox || startBox;
}

function calcBoxMoveDelta(axis: DirectionalAxis, box: Box, avoid: Box | null) {
  if (!avoid) return 0;
  switch (axis) {
    case '+x':
      return avoid.right - box.right;
    case '-x':
      return box.left - avoid.left;
    case '+y':
      return avoid.bottom - box.top;
    case '-y':
      return avoid.top - box.top;
  }
}
