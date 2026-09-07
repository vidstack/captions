import { setCSSVar } from '../../../utils/style';
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
      applyCueTextStyle(display, cue.textStyle);
      const transform = buildCueTransform(cue.layout, cue.textStyle);
      if (transform) setCSSVar(display, 'cue-transform', transform);
      if (cue.textStyle?.className) el.className = cue.textStyle.className;
    },

    writeCue(ctx, cue, display, box) {
      // Screen-fixed clip rectangles (SSA `\clip` on layout-positioned cues) become an inset in the
      // box's own coordinates once its final (painted) position is known.
      const clip = cue.layout?.clipRect;
      if (!clip) return;
      const container = ctx.overlayBox,
        top = (clip.top / 100) * container.height - box.top,
        right = box.right - (clip.right / 100) * container.width,
        bottom = box.bottom - (clip.bottom / 100) * container.height,
        left = (clip.left / 100) * container.width - box.left,
        inset = [top, right, bottom, left].map((v) => Math.max(0, v));
      display.style.setProperty(
        '--cue-clip-path',
        inset.some((v) => v > 0)
          ? `inset(${inset.map((v) => `${Math.round(v * 100) / 100}px`).join(' ')})`
          : 'none',
      );
    },
  };
}
