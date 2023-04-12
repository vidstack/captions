import { setCSSVar } from '../../utils/style';
import type { VTTRegion } from '../vtt-region';
import {
  avoidBoxCollisions,
  createBox,
  createCSSBox,
  resolveRelativeBox,
  setBoxCSSVars,
  STARTING_BOX,
  type Box,
  type DirectionalAxis,
} from './box';

const REGION_AXIS: DirectionalAxis[] = ['-y', '+y', '-x', '+x'];

export function positionRegion(
  container: Box,
  region: VTTRegion,
  regionEl: HTMLElement,
  boxes: Box[],
) {
  let cues = Array.from(regionEl.querySelectorAll('[part="cue-display"]')) as HTMLElement[],
    height = 0,
    limit = Math.max(0, cues.length - region.lines);

  for (let i = cues.length - 1; i >= limit; i--) {
    height += cues[i].offsetHeight;
  }

  setCSSVar(regionEl, 'region-height', height + 'px');

  if (!regionEl[STARTING_BOX]) {
    regionEl[STARTING_BOX] = createCSSBox(container, createBox(regionEl));
  }

  let box: Box = { ...regionEl[STARTING_BOX] };
  box = resolveRelativeBox(container, box);
  box.width = regionEl.clientWidth;
  box.height = height;
  box.right = box.left + box.width;
  box.bottom = box.top + height;

  box = avoidBoxCollisions(container, box, boxes, REGION_AXIS);
  setBoxCSSVars(regionEl, container, box, 'region');

  return box;
}
