import { setCSSVar, setDataAttr, setPartAttr } from '../../../utils/style';
import type { VTTCue } from '../../vtt-cue';
import type { VTTRegion } from '../../vtt-region';
import type { RendererFeature } from '../feature';
import {
  measureRegion,
  measureRegionHeight,
  writeRegionBox,
  writeRegionHeight,
} from '../position-region';

/**
 * WebVTT regions: cues whose region applies are rendered inside a region element that scrolls
 * (rolls up) and is positioned by its anchors, per the rendering spec. Needs `regions.css`.
 */
export function regions(): RendererFeature {
  const els = new Map<string, HTMLElement>(),
    heights = new WeakMap<HTMLElement, number>();

  const regionOf = (cue: VTTCue) => cue.region && els.get(cue.region.id);

  return {
    name: 'regions',
    capabilities: ['regions'],

    changeTrack(ctx, track) {
      for (const region of track.regions ?? []) {
        const el = createRegionElement(region);
        els.set(region.id, el);
        ctx.overlay.append(el);
      }
    },

    reset() {
      els.clear();
    },

    containerFor(_, cue) {
      // https://www.w3.org/TR/webvtt1/#processing-cue-settings: a region only applies to cues
      // that use the defaults for size, vertical, and line.
      if (!cue.region || cue.size !== 100 || cue.vertical !== '' || cue.line !== 'auto') {
        return undefined;
      }
      return regionOf(cue) ?? null;
    },

    beforeMeasure(_, targets) {
      // Region heights depend on their cue lines and feed the region anchor, so they are measured
      // and written before the boxes are read.
      const measured: [HTMLElement, number][] = [];
      for (const target of targets) {
        if (target.container && regionOf(target.cue) === target.el) {
          measured.push([target.el, measureRegionHeight(target.cue.region!, target.el)]);
        }
      }
      for (const [el, height] of measured) {
        heights.set(el, height);
        writeRegionHeight(el, height);
      }
    },

    measureContainer(ctx, target) {
      if (regionOf(target.cue) !== target.el) return;
      return measureRegion(ctx.overlayBox, target.cue.region!, heights.get(target.el) ?? 0);
    },

    writeContainer(ctx, target, box) {
      if (regionOf(target.cue) !== target.el) return false;
      writeRegionBox(ctx.overlayBox, target.el, box);
      return true;
    },
  };
}

function createRegionElement(region: VTTRegion): HTMLElement {
  const el = document.createElement('div');

  setPartAttr(el, 'region');
  setDataAttr(el, 'id', region.id);
  setDataAttr(el, 'scroll', region.scroll);

  setCSSVar(el, 'region-width', region.width + '%');
  setCSSVar(el, 'region-anchor-x', region.regionAnchorX);
  setCSSVar(el, 'region-anchor-y', region.regionAnchorY);
  setCSSVar(el, 'region-viewport-anchor-x', region.viewportAnchorX);
  setCSSVar(el, 'region-viewport-anchor-y', region.viewportAnchorY);
  setCSSVar(el, 'region-lines', region.lines);

  return el;
}
