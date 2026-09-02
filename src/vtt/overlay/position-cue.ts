import { getLineHeight } from '../../utils/style';
import type { VTTCue } from '../vtt-cue';
import {
  BOX_SIDES,
  createBox,
  createCSSBox,
  LAYOUT_CACHE,
  moveBox,
  resolveRelativeBox,
  setBoxCSSVars,
  type Box,
} from './box';
import type { CueLayoutInput } from './layout';

const TRANSLATE_X_RE = /translateX\(\s*(-?[\d.]+)%\s*\)/,
  TRANSLATE_Y_RE = /translateY\(\s*(-?[\d.]+)%\s*\)/;

/** Measurements that only change when the cue's content or the overlay size changes. */
export interface CueMeasureCache {
  /** Starting box as fractions of the container so it survives resizes until invalidated. */
  box: { top: number; left: number; right: number; bottom: number };
  /** Pixel translation folded into the box (from `--cue-transform`). */
  translate: { x: number; y: number } | null;
  positionOverride: false | 'top' | 'bottom';
  lineHeight: number;
}

/**
 * MEASURE phase: reads everything the layout needs for a cue. Results are cached on the element
 * until the overlay is resized so repeated renders do not touch layout.
 */
export function measureCue(container: Box, cue: VTTCue, displayEl: HTMLElement): CueLayoutInput {
  let cache: CueMeasureCache | null = displayEl[LAYOUT_CACHE];

  if (!cache) {
    cache = displayEl[LAYOUT_CACHE] = createMeasureCache(container, displayEl, cue.vertical === '');
  }

  return {
    kind: 'cue',
    box: resolveRelativeBox(container, { ...cache.box } as Box),
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
 * WRITE phase: applies the laid out box. CSS positions are applied before `transform`, so the
 * written box excludes the translation that was folded into the visual box.
 */
export function writeCueBox(container: Box, displayEl: HTMLElement, box: Box) {
  const translate = (displayEl[LAYOUT_CACHE] as CueMeasureCache | null)?.translate;
  let written = box;
  if (translate) {
    written = { ...box };
    moveBox(written, '+x', -translate.x);
    moveBox(written, '+y', -translate.y);
  }
  setBoxCSSVars(displayEl, container, written, 'cue');
}

function createMeasureCache(
  container: Box,
  displayEl: HTMLElement,
  isHorizontal: boolean,
): CueMeasureCache {
  const box = createBox(displayEl),
    pos = getStyledPositions(container, displayEl),
    cueEl = displayEl.firstElementChild ?? displayEl;

  let positionOverride: CueMeasureCache['positionOverride'] = false;

  if (pos.top !== null) {
    box.top = pos.top;
    box.bottom = pos.top + box.height;
    // For vertical cues the top offset is the cue position, not a line override.
    if (isHorizontal) positionOverride = 'top';
  }

  if (pos.bottom !== null) {
    const bottom = container.height - pos.bottom;
    box.top = bottom - box.height;
    box.bottom = bottom;
    if (isHorizontal) positionOverride = 'bottom';
  }

  if (pos.left !== null) box.left = pos.left;
  if (pos.right !== null) box.right = container.width - pos.right;

  // Fold percentage translations (e.g., `translateX(-50%)` for centred SSA cues) into the visual
  // box so collisions are detected where the cue is actually painted.
  const transform = displayEl.style.getPropertyValue('--cue-transform'),
    tx = parseFloat(transform.match(TRANSLATE_X_RE)?.[1] ?? '0') || 0,
    ty = parseFloat(transform.match(TRANSLATE_Y_RE)?.[1] ?? '0') || 0,
    translate = { x: (tx / 100) * box.width, y: (ty / 100) * box.height };

  moveBox(box, '+x', translate.x);
  moveBox(box, '+y', translate.y);

  return {
    box: createCSSBox(container, box),
    translate: translate.x || translate.y ? translate : null,
    positionOverride,
    lineHeight: getLineHeight(cueEl),
  };
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
