import { setCSSVar } from '../../utils/style';
import type { VTTRegion } from '../vtt-region';
import {
  createBox,
  createCSSBox,
  LAYOUT_CACHE,
  resolveRelativeBox,
  setBoxCSSVars,
  type Box,
} from './box';
import type { RegionLayoutInput } from './layout';

/**
 * MEASURE (part 1): the region height is the sum of its visible cue lines. This must be written
 * before the region box can be measured because the region's anchor position depends on it.
 */
export function measureRegionHeight(region: VTTRegion, regionEl: HTMLElement): number {
  const cues = regionEl.querySelectorAll<HTMLElement>('[data-part="cue-display"]'),
    limit = Math.max(0, cues.length - region.lines);

  let height = 0;
  for (let i = cues.length - 1; i >= limit; i--) height += cues[i].offsetHeight;
  return height;
}

export function writeRegionHeight(regionEl: HTMLElement, height: number) {
  setCSSVar(regionEl, 'region-height', height + 'px');
}

/** MEASURE (part 2): the region box, cached as container fractions until the next resize. */
export function measureRegion(
  container: Box,
  regionEl: HTMLElement,
  height: number,
): RegionLayoutInput {
  if (!regionEl[LAYOUT_CACHE]) {
    regionEl[LAYOUT_CACHE] = createCSSBox(container, createBox(regionEl));
  }

  const box = resolveRelativeBox(container, { ...regionEl[LAYOUT_CACHE] } as Box);
  box.width = regionEl.clientWidth;
  box.height = height;
  box.right = box.left + box.width;
  box.bottom = box.top + height;

  return { kind: 'region', box };
}

/** WRITE phase. */
export function writeRegionBox(container: Box, regionEl: HTMLElement, box: Box) {
  setBoxCSSVars(regionEl, container, box, 'region');
}
