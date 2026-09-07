import { getLineHeight } from '../../utils/style';
import type { VTTCue } from '../vtt-cue';
import {
  createBox,
  createCSSBox,
  LAYOUT_CACHE,
  moveBox,
  resolveRelativeBox,
  setBoxCSSVars,
  type Box,
} from './box';
import type { CueLayoutInput } from './layout';

const BOX_SIDES_STYLE = ['top', 'bottom'] as const;

/** Measurements that only change when the cue's content or the overlay size changes. */
export interface CueMeasureCache {
  /** Box CSS positions refer to (offset-based), as container fractions. */
  layoutBox: { top: number; left: number; right: number; bottom: number };
  /**
   * Box the cue is actually painted in (includes CSS transforms such as translate, rotate, and
   * scale), as container fractions. Collisions are computed on this one.
   */
  visualBox: { top: number; left: number; right: number; bottom: number };
  positionOverride: false | 'top' | 'bottom';
  lineHeight: number;
}

export interface CueMeasureOptions {
  /** Use the padded cue box height as the snap-to-lines step instead of the text line height. */
  lineStep?: 'line-height' | 'box';
}

/**
 * MEASURE phase: reads everything the layout needs for a cue. Results are cached on the element
 * until the overlay is resized so repeated renders do not touch layout.
 */
export function measureCue(
  container: Box,
  cue: VTTCue,
  displayEl: HTMLElement,
  options: CueMeasureOptions = {},
): CueLayoutInput {
  let cache: CueMeasureCache | null = displayEl[LAYOUT_CACHE];

  if (!cache) {
    cache = displayEl[LAYOUT_CACHE] = createMeasureCache(container, displayEl, cue, options);
  }

  return {
    kind: 'cue',
    box: resolveRelativeBox(container, { ...cache.visualBox } as Box),
    lineHeight: cache.lineHeight,
    snapToLines: cue.snapToLines,
    line: computeCueLine(cue),
    lineAlign: cue.lineAlign,
    vertical: cue.vertical,
    fixed: displayEl.hasAttribute('data-fixed'),
    positionOverride: cache.positionOverride,
  };
}

/**
 * WRITE phase: applies the laid out (visual) box. The CSS position is the layout box moved by
 * however far collision avoidance moved the visual box, so transforms stay intact.
 */
export function writeCueBox(container: Box, displayEl: HTMLElement, box: Box, cue?: VTTCue) {
  const cache = displayEl[LAYOUT_CACHE] as CueMeasureCache | null;
  let written = box;
  if (cache) {
    const layout = resolveRelativeBox(container, { ...cache.layoutBox } as Box),
      visual = resolveRelativeBox(container, { ...cache.visualBox } as Box);
    written = { ...layout };
    moveBox(written, '+x', box.left - visual.left);
    moveBox(written, '+y', box.top - visual.top);
  }
  setBoxCSSVars(displayEl, container, written, 'cue');

  // Screen-fixed clip rectangles become an inset in the box's own coordinates once its final
  // (painted) position is known.
  const clip = cue?.layout?.clipRect;
  if (clip) {
    const top = (clip.top / 100) * container.height - box.top,
      right = box.right - (clip.right / 100) * container.width,
      bottom = box.bottom - (clip.bottom / 100) * container.height,
      left = (clip.left / 100) * container.width - box.left,
      inset = [top, right, bottom, left].map((v) => Math.max(0, v));
    displayEl.style.setProperty(
      '--cue-clip-path',
      inset.some((v) => v > 0)
        ? `inset(${inset.map((v) => `${Math.round(v * 100) / 100}px`).join(' ')})`
        : 'none',
    );
  }
}

function createMeasureCache(
  container: Box,
  displayEl: HTMLElement,
  cue: VTTCue,
  options: CueMeasureOptions,
): CueMeasureCache {
  const isHorizontal = cue.vertical === '',
    layout = createBox(displayEl),
    cueEl = displayEl.firstElementChild ?? displayEl;

  // Explicit top/bottom positions (via `layout` or raw `--cue-*` styles) turn off line snapping
  // for horizontal cues; vertical cues use top as their position along the line axis.
  let positionOverride: CueMeasureCache['positionOverride'] = false;
  if (isHorizontal) {
    for (const side of BOX_SIDES_STYLE) {
      if (displayEl.style.getPropertyValue(`--cue-${side}`).trim()) positionOverride = side;
    }
  }

  // Painted box relative to the offset parent, corrected for any ancestor scaling. Only needed
  // when a transform is in play; otherwise the layout box is exact and avoids sub-pixel drift
  // between fractional client rects and integer offsets.
  const transformed = getComputedStyle(displayEl).transform !== 'none',
    parent = (displayEl.offsetParent ?? displayEl.parentElement) as HTMLElement | null,
    parentRect = transformed ? parent?.getBoundingClientRect() : undefined,
    rect = transformed ? displayEl.getBoundingClientRect() : undefined,
    scale = parentRect && parent!.clientWidth ? parentRect.width / parent!.clientWidth : 1,
    visual: Box =
      parentRect && rect
        ? {
            left: (rect.left - parentRect.left) / scale,
            top: (rect.top - parentRect.top) / scale,
            right: (rect.right - parentRect.left) / scale,
            bottom: (rect.bottom - parentRect.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          }
        : { ...layout };

  const lineHeight =
    options.lineStep === 'box' ? layout.height || getLineHeight(cueEl) : getLineHeight(cueEl);

  return {
    layoutBox: createCSSBox(container, layout),
    visualBox: createCSSBox(container, visual.width || visual.height ? visual : layout),
    positionOverride,
    lineHeight,
  };
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

export function computeCuePosition(cue: VTTCue, dir: 'ltr' | 'rtl' = 'ltr'): number {
  if (cue.position === 'auto') {
    switch (cue.align) {
      case 'left':
        return 0;
      case 'right':
        return 100;
      case 'start':
        return dir === 'ltr' ? 0 : 100;
      case 'end':
        return dir === 'ltr' ? 100 : 0;
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
