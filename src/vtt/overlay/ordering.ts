import type { VTTCue } from '../vtt-cue';

export type StackingMode = 'reading-order' | 'spec';

/**
 * Cues are positioned so they read top-down in cue order. Bottom anchored cues are positioned
 * last-to-first (the newest cue takes the default slot and older cues are pushed up), while top
 * anchored cues are positioned first-to-last so older cues stay on top and newer ones are pushed
 * down. Fixed cues go first so everything else avoids them.
 */
export function orderForPositioning(cues: VTTCue[], stacking: StackingMode): VTTCue[] {
  const fixed: VTTCue[] = [],
    top: VTTCue[] = [],
    bottom: VTTCue[] = [];

  for (const cue of cues) {
    if (cue.layout?.fixed) fixed.push(cue);
    else if (isTopAnchored(cue)) top.push(cue);
    else bottom.push(cue);
  }

  // Spec stacking: the earliest cue keeps its slot and later cues are pushed away from the edge.
  if (stacking === 'spec') return [...fixed, ...top, ...bottom];

  return [...fixed, ...top, ...bottom.reverse()];
}

export function isTopAnchored(cue: VTTCue): boolean {
  if (cue.line === 'auto') {
    const top = cue.layout?.top ?? cue.style?.['--cue-top'],
      bottom = cue.layout?.bottom ?? cue.style?.['--cue-bottom'];
    return top !== undefined && bottom === undefined;
  }
  if (cue.snapToLines) return cue.line >= 0;
  return cue.lineAlign === 'end' ? cue.line <= 50 : cue.line < 50;
}
