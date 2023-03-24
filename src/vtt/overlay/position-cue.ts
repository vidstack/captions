import { getLineHeight, setCSSVar } from '../../utils/style';
import type { VTTCue } from '../vtt-cue';
import {
  avoidBoxCollisions,
  Box,
  createBox,
  DirectionalAxis,
  moveBox,
  setBoxCSSVars,
  STARTING_BOX,
  updateBoxDimensions,
} from './box';

// Adapted from: https://github.com/videojs/vtt.js
export function positionCue(container: Box, cue: VTTCue, cueEl: HTMLElement, boxes: Box[]): Box {
  let line = computeCueLine(cue),
    cueBox: Box = { ...(cueEl[STARTING_BOX] ??= createBox(cueEl)) },
    axis: DirectionalAxis[] = [];

  updateBoxDimensions(cueBox, cueEl);

  if (cue.snapToLines) {
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

    let step = getLineHeight(cueEl.firstElementChild!),
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

    moveBox(cueBox, initialAxis, position);
  } else {
    const lineHeight = getLineHeight(cueEl.firstElementChild!),
      percentage = (lineHeight / container.height) * 100;

    switch (cue.lineAlign) {
      case 'center':
        line -= percentage / 2;
        break;
      case 'end':
        line -= percentage;
        break;
    }

    let position: string;
    switch (cue.vertical) {
      case '':
        position = 'top';
        break;
      case 'rl':
        position = 'left';
        break;
      case 'lr':
        position = 'right';
        break;
    }

    setCSSVar(cueEl, `cue-${position}`, line + '%');
    axis = ['+y', '-x', '+x', '-y'];
    cueBox = createBox(cueEl);
  }

  avoidBoxCollisions(container, cueBox, boxes, axis);
  setBoxCSSVars(cueEl, container, cueBox, 'cue');

  return updateBoxDimensions(cueBox, cueEl.firstElementChild!);
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
      case 'left':
        return 0;
      case 'right':
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
