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
    cueEl = regionEl.querySelector('[data-cue]')!,
    cueLineHeight = getLineHeight(cueEl),
    cuePaddingY = getPaddingY(cueEl),
    cueMarginTop = parseFloat(getComputedStyle(cueEl).marginTop) || 0,
    cues = Array.from(regionEl.querySelectorAll('[data-cue]')),
    activeLines = 0;

  for (let i = cues.length - 1; i >= 0; i--) {
    let newLines = Math.round((cues[i].clientHeight - cuePaddingY) / cueLineHeight),
      lineCount = region.lines - activeLines;

    if (newLines <= lineCount) {
      height += cues[i].clientHeight + cueMarginTop;
    } else if (lineCount > 0) {
      height += cuePaddingY / 2 + cueMarginTop + 1;
      while (lineCount > 0) {
        height += cueLineHeight;
        lineCount--;
      }
    }

    activeLines += newLines;
    if (activeLines > region.lines) break;
  }

  setCSSVar(regionEl, 'region-height', height + 'px');
  let box = { ...(regionEl[STARTING_BOX] ??= createBox(regionEl)) };
  updateBoxDimensions(box, regionEl);
  box = avoidBoxCollisions(container, box, boxes, REGION_AXIS);
  setBoxCSSVars(regionEl, container, box, 'region');
  return box;
}
