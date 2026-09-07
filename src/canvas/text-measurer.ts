/**
 * The only thing layout needs from a rendering surface: how wide a run of text is in a given
 * font. Canvas provides it through `measureText`; tests use a deterministic monospace stand-in.
 */
export interface TextMeasurer {
  /** Advance width of `text` in `font` (a CSS `font` shorthand), in pixels. */
  measureText(text: string, font: string, letterSpacing?: number): number;
}

type MeasuringContext = Pick<CanvasRenderingContext2D, 'measureText'> & {
  font: string;
  letterSpacing?: string;
};

/** A measurer backed by a 2D context (a `<canvas>` or `OffscreenCanvas`). */
export function canvasTextMeasurer(ctx: MeasuringContext): TextMeasurer {
  return {
    measureText(text, font, letterSpacing = 0) {
      if (ctx.font !== font) ctx.font = font;
      if ('letterSpacing' in ctx) {
        const spacing = `${letterSpacing}px`;
        if (ctx.letterSpacing !== spacing) ctx.letterSpacing = spacing;
        return ctx.measureText(text).width;
      }
      return ctx.measureText(text).width + letterSpacing * text.length;
    },
  };
}

/**
 * A deterministic measurer for tests and servers without a canvas: every glyph is `ratio` em
 * wide (0.5 approximates a typical sans-serif).
 */
export function monospaceTextMeasurer(ratio = 0.5): TextMeasurer {
  return {
    measureText(text, font, letterSpacing = 0) {
      const size = parseFloat(font.split(' ').find((part) => part.endsWith('px')) ?? '16');
      return text.length * (size * ratio + letterSpacing);
    },
  };
}
