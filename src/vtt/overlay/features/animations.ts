import type { VTTCue } from '../../vtt-cue';
import { attachCueAnimations, syncCueAnimations, type CueAnimationHandle } from '../cue-animations';
import type { RendererFeature } from '../feature';

/**
 * `cue.animations` as Web Animations driven by media time, so SSA `\fad`, `\move`, `\t`,
 * karaoke sweeps, and TTML `set` scrub, pause, and seek with playback. Holds the final state
 * under reduced motion.
 */
export function animations(): RendererFeature {
  const handles = new Map<VTTCue, CueAnimationHandle[]>();

  return {
    name: 'animations',
    capabilities: ['animations'],

    createCue(_, cue, { display, cue: el }) {
      const created = attachCueAnimations(cue, display, el);
      if (created) handles.set(cue, created);
    },

    disposeCue(_, cue) {
      handles.delete(cue);
    },

    reset() {
      handles.clear();
    },

    update(ctx, active) {
      const { currentTime, reducedMotion } = ctx.renderer;
      for (const cue of active) {
        const created = handles.get(cue);
        if (created) syncCueAnimations(cue, created, currentTime, reducedMotion);
      }
    },
  };
}
