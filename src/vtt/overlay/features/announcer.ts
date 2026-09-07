import { announceCues, createAnnouncer } from '../announcer';
import type { RendererFeature } from '../feature';

/**
 * Announces the plain text of cues as they appear through a visually hidden `aria-live` region
 * placed after the overlay. The overlay itself stays `aria-live="off"` because sighted users read
 * it and the audio already carries the words.
 */
export function announcer(mode: 'polite' | 'assertive' = 'polite'): RendererFeature {
  let el: HTMLElement | null = null;

  return {
    name: 'announcer',

    setup(ctx) {
      el = createAnnouncer(ctx.overlay, mode);
    },

    update(_, __, entered) {
      if (el && entered.length) announceCues(el, entered);
    },

    destroy() {
      el?.remove();
      el = null;
    },
  };
}
