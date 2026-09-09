import { setCSSVar } from '../../../utils/style';
import { clipToPixelCSS } from '../../style-css';
import { applyCueLayout, applyCueTextStyle, buildCueTransform } from '../cue-style';
import type { RendererFeature } from '../feature';

/**
 * The cue layout and text style model produced by the SSA/ASS, TTML/IMSC, and CEA-708 parsers:
 * absolute boxes, anchor translation, clip paths, layers (z-order), colours, fonts, strokes,
 * shadows, transforms, and background images. Without it those cues render as plain WebVTT text.
 */
export function typesetting(): RendererFeature {
  return {
    name: 'typesetting',
    capabilities: ['typesetting'],

    createCue(_, cue, { display, cue: el }) {
      if (cue.layer) setCSSVar(display, 'cue-z-index', cue.layer);
      applyCueLayout(display, cue.layout);
      applyCueTextStyle(display, cue.textStyle, cue.layout);
      const transform = buildCueTransform(cue.layout, cue.textStyle);
      if (transform) setCSSVar(display, 'cue-transform', transform);
      if (cue.textStyle?.className) el.className = cue.textStyle.className;
    },

    writeCue(ctx, cue, display, box) {
      // Clips are overlay-relative (or box-relative insets); with the final box known they become
      // plain pixel clip paths, so no coordinate juggling survives into the DOM.
      const clip = cue.layout?.clip;
      if (clip)
        display.style.setProperty('--cue-clip-path', clipToPixelCSS(clip, ctx.overlayBox, box));
    },
  };
}
