import { setDataAttr } from '../../utils/style';
import type { CueAnimation, VTTCue } from '../vtt-cue';

export interface CueAnimationHandle {
  animation: Animation;
  delay: number;
  duration: number;
}

/**
 * Creates paused Web Animations for `cue.animations`. `syncCueAnimations` drives their current
 * time from media time so they scrub, pause, and seek with playback instead of running on the
 * wall clock. Returns null when the cue has no animations or the platform lacks WAAPI.
 */
export function attachCueAnimations(
  cue: VTTCue,
  display: HTMLElement,
  cueEl: HTMLElement,
): CueAnimationHandle[] | null {
  if (!cue.animations?.length || typeof display.animate !== 'function') return null;

  const handles: CueAnimationHandle[] = [];

  for (const spec of cue.animations) {
    let target: Element | null = display;
    if (spec.target === 'cue') target = cueEl;
    else if (typeof spec.target === 'object') {
      target = display.querySelector(`[data-span="${spec.target.span}"]`);
    }
    if (!target) continue;

    // Animated box positions must not be fought by collision avoidance.
    if ((spec.target ?? 'display') === 'display' && animatesPosition(spec)) {
      setDataAttr(display, 'fixed');
    }

    const animation = target.animate(spec.keyframes, {
      duration: Math.max(1, spec.duration * 1000),
      easing: spec.easing ?? 'linear',
      fill: spec.fill ?? 'both',
    });
    animation.pause();
    handles.push({ animation, delay: spec.delay ?? 0, duration: spec.duration });
  }

  return handles.length ? handles : null;
}

/** Seeks every animation to the media time. Reduced motion holds the final state. */
export function syncCueAnimations(
  cue: VTTCue,
  handles: CueAnimationHandle[],
  currentTime: number,
  reducedMotion: boolean,
) {
  for (const { animation, delay, duration } of handles) {
    const local = reducedMotion ? duration : currentTime - cue.startTime - delay;
    animation.currentTime = Math.min(Math.max(local, 0), duration) * 1000;
  }
}

function animatesPosition(spec: CueAnimation) {
  return spec.keyframes.some((frame) =>
    ['left', 'top', 'right', 'bottom', 'transform', 'translate'].some((key) => key in frame),
  );
}
