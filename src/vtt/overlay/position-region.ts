import { setCSSVar } from '../../utils/style';
import type { VTTRegion } from '../vtt-region';
import { setBoxCSSVars, type Box } from './box';
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

/**
 * MEASURE (part 2): the region box from its anchors, in container pixels (the same arithmetic as
 * the stylesheet's default `top`/`left`). Computed rather than read back from the element: the
 * element's `top` follows the region height and transitions, so a rect read once and cached pinned
 * a bottom-anchored roll-up region where its first row put it and later rows pushed it off the
 * overlay.
 */
export function measureRegion(
  container: Box,
  region: VTTRegion,
  height: number,
): RegionLayoutInput {
  const width = (region.width / 100) * container.width,
    left = (region.viewportAnchorX / 100) * container.width - (region.regionAnchorX / 100) * width,
    top = (region.viewportAnchorY / 100) * container.height - (region.regionAnchorY / 100) * height;
  return {
    kind: 'region',
    box: { left, top, width, height, right: left + width, bottom: top + height },
  };
}

/** WRITE phase. */
export function writeRegionBox(container: Box, regionEl: HTMLElement, box: Box) {
  setBoxCSSVars(regionEl, container, box, 'region');
}
