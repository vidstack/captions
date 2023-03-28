import { getLineHeight, getPaddingY, setCSSVar } from '../../utils/style';
import type { VTTRegion } from '../vtt-region';
import {
  avoidBoxCollisions,
  Box,
  createBox,
  DirectionalAxis,
  setBoxCSSVars,
  STARTING_BOX,
  updateBoxDimensions,
} from './box';

const REGION_AXIS: DirectionalAxis[] = ['+y', '-y', '-x', '+x'];

export function positionRegion(
  container: Box,
  region: VTTRegion,
  regionEl: HTMLElement,
  boxes: Box[],
) {
  let height = 0,
    cueEl = regionEl.querySelector('[part="cue"]')!,
    cueLineHeight = getLineHeight(cueEl),
    cuePaddingY = getPaddingY(cueEl),
    cueMarginTop = parseFloat(getComputedStyle(cueEl).marginTop) || 0,
    cues = Array.from(regionEl.querySelectorAll('[part="cue"]')),
    remainingLines = region.lines;

  for (let i = cues.length - 1; i >= 0; i--) {
    const newLines = Math.round((cues[i].clientHeight - cuePaddingY) / cueLineHeight);
    remainingLines -= newLines;
    if (remainingLines >= 0) height += cues[i].clientHeight + cueMarginTop;
    else break;
  }

  setCSSVar(regionEl, 'region-height', height + 'px');
  let box = { ...(regionEl[STARTING_BOX] ??= createBox(regionEl)) };
  updateBoxDimensions(box, regionEl);
  box = avoidBoxCollisions(container, box, boxes, REGION_AXIS);
  setBoxCSSVars(regionEl, container, box, 'region');
  return box;
}
