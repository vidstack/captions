import type { RendererFeature } from '../feature';
import { injectCueStyles } from '../style-injection';

/**
 * WebVTT `STYLE` blocks: `::cue`, `::cue(.class)`, `::cue(v[voice="Bob"])`, and `::cue-region`
 * selectors are rewritten to the rendered DOM, scoped to the overlay, and restricted to
 * presentational properties.
 */
export function vttStyles(): RendererFeature {
  return {
    name: 'styles',
    capabilities: ['styles'],

    changeTrack(ctx, track) {
      injectCueStyles(ctx.overlay, track.styles);
    },
  };
}
