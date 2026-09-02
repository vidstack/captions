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

const POSITION_OVERRIDE = Symbol(__DEV__ ? 'POSITION_OVERRIDE' : 0),
  TRANSLATE = Symbol(__DEV__ ? 'TRANSLATE' : 0),
  TRANSLATE_X_RE = /translateX\(\s*(-?[\d.]+)%\s*\)/,
  TRANSLATE_Y_RE = /translateY\(\s*(-?[\d.]+)%\s*\)/;

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
    displayEl[STARTING_BOX] = createStartingBox(container, displayEl, cue.vertical === '');
  }

  displayBox = resolveRelativeBox(container, { ...displayEl[STARTING_BOX] });

  // Explicitly positioned cues (e.g., SSA `\pos`) are never moved, but other cues avoid them.
  if (displayEl.hasAttribute('data-fixed')) {
    setBoxCSSVars(displayEl, container, untranslateBox(displayEl, displayBox), 'cue');
    return displayBox;
  }

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
  setBoxCSSVars(displayEl, container, untranslateBox(displayEl, displayBox), 'cue');

  return displayBox;
}

/**
 * CSS positions are applied before `transform`, so the written box must exclude the translation
 * that was folded into the visual box for collision detection.
 */
function untranslateBox(el: HTMLElement, box: Box): Box {
  const translate = el[TRANSLATE];
  if (!translate) return box;
  const result = { ...box };
  moveBox(result, '+x', -translate.x);
  moveBox(result, '+y', -translate.y);
  return result;
}

function createStartingBox(container: Box, cueEl: HTMLElement, isHorizontal: boolean) {
  const box = createBox(cueEl),
    pos = getStyledPositions(container, cueEl);

  cueEl[POSITION_OVERRIDE] = false;

  if (pos.top !== null) {
    box.top = pos.top;
    box.bottom = pos.top + box.height;
    // For vertical cues the top offset is the cue position, not a line override.
    if (isHorizontal) cueEl[POSITION_OVERRIDE] = 'top';
  }

  if (pos.bottom !== null) {
    const bottom = container.height - pos.bottom;
    box.top = bottom - box.height;
    box.bottom = bottom;
    if (isHorizontal) cueEl[POSITION_OVERRIDE] = 'bottom';
  }

  if (pos.left !== null) box.left = pos.left;
  if (pos.right !== null) box.right = container.width - pos.right;

  // Fold percentage translations (e.g., `translateX(-50%)` for centred SSA cues) into the visual
  // box so collisions are detected where the cue is actually painted.
  const transform = cueEl.style.getPropertyValue('--cue-transform'),
    tx = parseFloat(transform.match(TRANSLATE_X_RE)?.[1] ?? '0') || 0,
    ty = parseFloat(transform.match(TRANSLATE_Y_RE)?.[1] ?? '0') || 0,
    translate = { x: (tx / 100) * box.width, y: (ty / 100) * box.height };

  cueEl[TRANSLATE] = translate.x || translate.y ? translate : null;
  moveBox(box, '+x', translate.x);
  moveBox(box, '+y', translate.y);

  return createCSSBox(container, box);
}

/**
 * Reads explicit `--cue-{side}` positions set via `VTTCue.style` (e.g., SSA/ASS margins).
 * Percentages are resolved against the container, anything else is treated as pixels.
 */
function getStyledPositions(container: Box, el: HTMLElement) {
  const positions: Record<string, number | null> = {};
  for (const side of BOX_SIDES) {
    const value = el.style.getPropertyValue(`--cue-${side}`).trim(),
      num = parseFloat(value);
    if (!value || Number.isNaN(num)) {
      positions[side] = null;
    } else if (value.endsWith('%')) {
      const size = side === 'top' || side === 'bottom' ? container.height : container.width;
      positions[side] = (num / 100) * size;
    } else {
      positions[side] = num;
    }
  }
  return positions as Record<(typeof BOX_SIDES)[number], number | null>;
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
