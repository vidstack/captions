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

export function createBox(box: Box | HTMLElement): Box {
  if (box instanceof HTMLElement) {
    return {
      top: box.offsetTop,
      width: box.clientWidth,
      height: box.clientHeight,
      left: box.offsetLeft,
      right: box.offsetLeft + box.clientWidth,
      bottom: box.offsetTop + box.clientHeight,
    };
  }

  return { ...box };
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

export function isBoxCollision(a: Box, b: Box): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function isAnyBoxCollision(box: Box, boxes: Box[]): Box | null {
  for (let i = 0; i < boxes.length; i++) if (isBoxCollision(box, boxes[i])) return boxes[i];
  return null;
}

export function isWithinBox(container: DOMRect | Box, box: Box): boolean {
  return (
    box.top >= 0 && box.bottom <= container.height && box.left >= 0 && box.right <= container.width
  );
}

export function isBoxOutOfBounds(container: Box, box: Box, axis: DirectionalAxis): boolean {
  switch (axis) {
    case '+x':
      return box.left < 0;
    case '-x':
      return box.right > container.width;
    case '+y':
      return box.top < 0;
    case '-y':
      return box.bottom > container.height;
  }
}

export function calcBoxIntersectPercentage(container: Box, box: Box): number {
  const x = Math.max(0, Math.min(container.width, box.right) - Math.max(0, box.left)),
    y = Math.max(0, Math.min(container.height, box.bottom) - Math.max(0, box.top)),
    intersectArea = x * y;
  return intersectArea / (container.height * container.width);
}

export function createCSSBox(container: Box, box: Box) {
  return {
    top: box.top / container.height,
    left: box.left / container.width,
    right: (container.width - box.right) / container.width,
    bottom: (container.height - box.bottom) / container.height,
  };
}

export function resolveRelativeBox(container: Box, box: Box): Box {
  box.top = box.top * container.height;
  box.left = box.left * container.width;
  box.right = container.width - box.right * container.width;
  box.bottom = container.height - box.bottom * container.height;
  return box;
}

export const BOX_SIDES = ['top', 'left', 'right', 'bottom'] as const;

export function setBoxCSSVars(el: HTMLElement, container: Box, box: Box, prefix: string) {
  const cssBox = createCSSBox(container, box);
  for (const side of BOX_SIDES) {
    setCSSVar(el, `${prefix}-${side}`, cssBox[side] * 100 + '%');
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
