import { getLineHeight } from '../../utils/style';
import type { VTTCue } from '../vtt-cue';
import {
  avoidBoxCollisions,
  BOX_SIDES,
  createBox,
  createCSSBox,
  moveBox,
  resolveRelativeBox,
  setBoxCSSVars,
  STARTING_BOX,
  type Box,
  type DirectionalAxis,
} from './box';

const POSITION_OVERRIDE = Symbol(__DEV__ ? 'POSITION_OVERRIDE' : 0);

// Adapted from: https://github.com/videojs/vtt.js
export function positionCue(
  container: Box,
  cue: VTTCue,
  displayEl: HTMLElement,
  boxes: Box[],
): Box {
  let cueEl = displayEl.firstElementChild!,
    line = computeCueLine(cue),
    displayBox: Box,
    axis: DirectionalAxis[] = [];

  if (!displayEl[STARTING_BOX]) {
    displayEl[STARTING_BOX] = createStartingBox(container, displayEl);
  }

  displayBox = resolveRelativeBox(container, { ...displayEl[STARTING_BOX] });

  if (displayEl[POSITION_OVERRIDE]) {
    axis = [displayEl[POSITION_OVERRIDE] === 'top' ? '+y' : '-y', '+x', '-x'];
  } else if (cue.snapToLines) {
    let size: string;
    switch (cue.vertical) {
      case '':
        axis = ['+y', '-y'];
        size = 'height';
        break;
      case 'rl':
        axis = ['+x', '-x'];
        size = 'width';
        break;
      case 'lr':
        axis = ['-x', '+x'];
        size = 'width';
        break;
    }

    let step = getLineHeight(cueEl),
      position = step * Math.round(line),
      maxPosition = container[size] + step,
      initialAxis = axis[0];

    if (Math.abs(position) > maxPosition) {
      position = position < 0 ? -1 : 1;
      position *= Math.ceil(maxPosition / step) * step;
    }

    if (line < 0) {
      position += cue.vertical === '' ? container.height : container.width;
      axis = axis.reverse();
    }

    moveBox(displayBox, initialAxis, position);
  } else {
    const isHorizontal = cue.vertical === '',
      posAxis = isHorizontal ? '+y' : '+x',
      size = isHorizontal ? displayBox.height : displayBox.width;

    moveBox(
      displayBox,
      posAxis,
      ((isHorizontal ? container.height : container.width) * line) / 100,
    );

    moveBox(
      displayBox,
      posAxis,
      cue.lineAlign === 'center' ? size / 2 : cue.lineAlign === 'end' ? size : 0,
    );

    axis = isHorizontal ? ['-y', '+y', '-x', '+x'] : ['-x', '+x', '-y', '+y'];
  }

  displayBox = avoidBoxCollisions(container, displayBox, boxes, axis);
  setBoxCSSVars(displayEl, container, displayBox, 'cue');

  return displayBox;
}

function createStartingBox(container: Box, cueEl: HTMLElement) {
  const box = createBox(cueEl),
    pos = getStyledPositions(cueEl);

  cueEl[POSITION_OVERRIDE] = false;

  if (pos.top) {
    const top = (pos.top / 100) * container.height;
    box.top = top;
    box.bottom = top + box.height;
    cueEl[POSITION_OVERRIDE] = 'top';
  }

  if (pos.bottom) {
    const bottom = container.height - (pos.bottom / 100) * container.height;
    box.top = bottom - box.height;
    box.bottom = bottom;
    cueEl[POSITION_OVERRIDE] = 'bottom';
  }

  if (pos.left) box.left = (pos.left / 100) * container.width;
  if (pos.right) box.right = container.width - (pos.right / 100) * container.width;

  return createCSSBox(container, box);
}

/* Assuming percentage only here. */
function getStyledPositions(el: HTMLElement) {
  const positions = {};
  for (const side of BOX_SIDES) {
    positions[side] = parseFloat(el.style.getPropertyValue(`--cue-${side}`));
  }
  return positions as Omit<Box, 'width' | 'height'>;
}

export function computeCueLine(cue: VTTCue): number {
  if (cue.line === 'auto') {
    if (!cue.snapToLines) {
      return 100;
    } else {
      return -1;
    }
  }

  return cue.line;
}

export function computeCuePosition(cue: VTTCue): number {
  if (cue.position === 'auto') {
    switch (cue.align) {
      case 'start':
      case 'left':
        return 0;
      case 'right':
      case 'end':
        return 100;
      default:
        return 50;
    }
  }

  return cue.position;
}

export function computeCuePositionAlignment(cue: VTTCue, dir: 'ltr' | 'rtl'): PositionAlignSetting {
  if (cue.positionAlign === 'auto') {
    switch (cue.align) {
      case 'start':
        return dir === 'ltr' ? 'line-left' : 'line-right';
      case 'end':
        return dir === 'ltr' ? 'line-right' : 'line-left';
      case 'center':
        return 'center';
      default:
        return `line-${cue.align}`;
    }
  }

  return cue.positionAlign;
}
