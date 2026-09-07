import type { Box } from '../vtt/overlay/box';
import type { CueAnimation, CueKeyframe } from '../vtt/vtt-cue';
import { sampleAnimation } from './animate';
import { fontString, shadowPx, type Run, type RunStyle } from './flow';
import type { MeasuredCue, MeasuredRegion } from './measure';
import type { CanvasTheme } from './theme';
import {
  clipToPolygon,
  combineTransforms,
  isIdentity,
  lengthToPx,
  transform2D,
  transformOriginPx,
  type LengthEnv,
  type Transform2D,
} from './values';

/** The subset of `CanvasRenderingContext2D` the painter uses (also satisfied by offscreen contexts). */
export type PaintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Loads and caches image cue URLs; `onLoad` asks for a repaint. */
export class ImageCache {
  private _images = new Map<string, HTMLImageElement | null>();

  constructor(private _onLoad: () => void) {}

  get(url: string): HTMLImageElement | null {
    if (this._images.has(url)) return this._images.get(url)!;
    this._images.set(url, null);
    if (typeof Image !== 'function') return null;
    const image = new Image();
    image.addEventListener(
      'load',
      () => {
        this._images.set(url, image);
        this._onLoad();
      },
      { once: true },
    );
    image.src = url;
    return null;
  }

  clear() {
    this._images.clear();
  }
}

export interface PaintOptions {
  time: number;
  theme: CanvasTheme;
  images: ImageCache;
}

const NO_COLOR = new Set(['transparent', 'none', 'rgba(0,0,0,0)', 'rgba(0, 0, 0, 0)']);

/** Paints one laid out cue. `box` is its final display box in container pixels. */
export function paintCue(ctx: PaintContext, cue: MeasuredCue, box: Box, options: PaintOptions) {
  const { theme } = options,
    { container } = theme,
    display = sampleTarget(cue, 'display', options),
    inner = sampleTarget(cue, 'cue', options);

  // Animated position (SSA `\move`, scroll and banner effects, CEA-708 marquees).
  let left = box.left,
    top = box.top;
  const translateX = display.translate?.x ?? cue.cue.layout?.translate?.x ?? 0,
    translateY = display.translate?.y ?? cue.cue.layout?.translate?.y ?? 0;
  if (display.left !== undefined)
    left = (display.left / 100) * container.width + translateX * box.width;
  if (display.top !== undefined)
    top = (display.top / 100) * container.height + translateY * box.height;
  if (display.left === undefined && display.translate?.x !== undefined)
    left += display.translate.x * box.width;
  if (display.top === undefined && display.translate?.y !== undefined)
    top += display.translate.y * box.height;
  const painted = { left, top, width: box.width, height: box.height };

  ctx.save();
  ctx.translate(container.left + left, container.top + top);
  ctx.globalAlpha *= cue.style.opacity * (display.opacity ?? 1) * (inner.opacity ?? 1);

  // Clips: screen-fixed rectangles and polygons (SSA `\clip`, scroll bands) or box insets (wipes).
  const clip = display.clip ?? cue.style.clip;
  if (clip) {
    const { points, evenOdd } = clipToPolygon(clip, container, painted);
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip(evenOdd ? 'evenodd' : 'nonzero');
  }

  // Cue transforms (SSA rotation/scale, `\t`) pivot on the alignment anchor or `\org`.
  const transform = combineTransforms(
    transform2D(cue.style.transform),
    transform2D(display.transform),
    transform2D(inner.transform),
  );
  applyTransform(ctx, transform, transformOriginPx(cue.style.transform, container, painted));

  paintCueContent(ctx, cue, options, inner);
  ctx.restore();
}

/** Paints a region: clipped to its box, cues stacked from the bottom (`scroll: up`) or top. */
export function paintRegion(
  ctx: PaintContext,
  region: MeasuredRegion,
  box: Box,
  options: PaintOptions,
) {
  const { container } = options.theme;
  ctx.save();
  ctx.translate(container.left + box.left, container.top + box.top);
  ctx.beginPath();
  ctx.rect(0, 0, box.width, box.height);
  ctx.clip();

  let y =
    region.region.scroll === 'up' ? box.height - region.rowHeights.reduce((s, h) => s + h, 0) : 0;
  region.visible.forEach((cue, i) => {
    ctx.save();
    ctx.translate(cue.box.left, y + 1);
    ctx.globalAlpha *= cue.style.opacity;
    paintCueContent(ctx, cue, options, {});
    ctx.restore();
    y += region.rowHeights[i];
  });
  ctx.restore();
}

/** Background, image, outline, and text of a cue at the current origin (its display box). */
function paintCueContent(
  ctx: PaintContext,
  cue: MeasuredCue,
  options: PaintOptions,
  inner: CueKeyframe,
) {
  const { style, textBox, flow } = cue,
    { theme } = options;

  if (!NO_COLOR.has(style.backgroundColor)) {
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(textBox.left, textBox.top, textBox.width, textBox.height);
  }

  if (style.imageURL) {
    const image = options.images.get(style.imageURL);
    if (image) {
      const scale =
          style.imageFit === 'cover'
            ? Math.max(textBox.width / image.width, textBox.height / image.height)
            : Math.min(textBox.width / image.width, textBox.height / image.height),
        w = style.imageFit === 'fill' ? textBox.width : image.width * scale,
        h = style.imageFit === 'fill' ? textBox.height : image.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(textBox.left, textBox.top, textBox.width, textBox.height);
      ctx.clip();
      ctx.drawImage(
        image,
        textBox.left + (textBox.width - w) / 2,
        textBox.top + (textBox.height - h) / 2,
        w,
        h,
      );
      ctx.restore();
    }
  }

  if (style.outline) {
    ctx.lineWidth = style.outline.width;
    ctx.strokeStyle = style.outline.color;
    ctx.strokeRect(
      textBox.left - style.outline.width / 2,
      textBox.top - style.outline.width / 2,
      textBox.width + style.outline.width,
      textBox.height + style.outline.width,
    );
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  if (cue.vertical) {
    paintColumns(ctx, cue, options, inner);
    return;
  }

  const contentWidth = textBox.width - 2 * style.paddingX;
  let y = textBox.top + style.paddingY;

  for (const line of flow.lines) {
    // Ruby annotations sit in a band above the line, overflowing it as in the browser.
    const slack = contentWidth - line.width;
    let x =
      textBox.left +
      style.paddingX +
      (style.textAlign === 'center' ? slack / 2 : style.textAlign === 'right' ? slack : 0);

    for (const run of line.runs) {
      const span = run.style.spanKey ? sampleTarget(cue, { span: run.style.spanKey }, options) : {},
        over: RunOverrides = {
          color: span.color ?? (run.style.color === style.color ? inner.color : undefined),
          strokeColor: inner.strokeColor ?? span.strokeColor,
          alpha: span.opacity ?? 1,
          frame: span,
          time: options.time,
        };
      if (run.ruby) {
        const { ruby } = run,
          baseWidth = run.baseWidth ?? run.width;
        paintRun(
          ctx,
          { text: ruby.text, style: ruby.style, width: ruby.width },
          x + (run.width - ruby.width) / 2,
          y - line.rubyHeight,
          line.rubyHeight,
          cue,
          theme,
          over,
        );
        paintRun(
          ctx,
          { text: run.text, style: run.style, width: baseWidth },
          x + (run.width - baseWidth) / 2,
          y,
          flow.lineHeight,
          cue,
          theme,
          over,
        );
      } else {
        paintRun(ctx, run, x, y, flow.lineHeight, cue, theme, over);
      }
      x += run.width;
    }
    y += flow.lineHeight;
  }
}

interface RunOverrides {
  color?: string;
  strokeColor?: string;
  alpha: number;
  /** The sampled span animation, for transforms, sizes, and sweeps. */
  frame: CueKeyframe;
  /** Media time, for timed text. */
  time: number;
}

function paintRun(
  ctx: PaintContext,
  run: Run,
  x: number,
  y: number,
  lineHeight: number,
  cue: MeasuredCue,
  theme: CanvasTheme,
  over: RunOverrides,
) {
  const { style } = run,
    { container } = theme,
    env: LengthEnv = { width: container.width, height: container.height, em: style.fontSize };

  ctx.save();
  ctx.globalAlpha *= style.opacity * over.alpha;

  if (style.transform || over.frame.transform) {
    const runBox = { left: x, top: y, width: run.width, height: lineHeight };
    ctx.translate(x, y);
    applyTransform(
      ctx,
      combineTransforms(transform2D(style.transform), transform2D(over.frame.transform)),
      transformOriginPx(style.transform, container, runBox),
    );
    ctx.translate(-x, -y);
  }

  if (style.bgColor && !NO_COLOR.has(style.bgColor)) {
    ctx.fillStyle = style.bgColor;
    ctx.fillRect(x, y, run.width, lineHeight);
  }

  if (style.drawing) {
    const { drawing } = style,
      [vx, vy, vw, vh] = drawing.viewBox,
      width = (drawing.width / 100) * container.width,
      height = (drawing.height / 100) * container.height;
    ctx.translate(x, y);
    ctx.scale(width / (vw || 1), height / (vh || 1));
    ctx.translate(-vx, -vy);
    const path = new Path2D(drawing.path);
    ctx.fillStyle = drawing.fill ?? style.color;
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- canvas fill, not Array#fill
    ctx.fill(path);
    if (drawing.stroke && drawing.strokeWidth) {
      ctx.strokeStyle = drawing.stroke;
      ctx.lineWidth = drawing.strokeWidth;
      ctx.stroke(path);
    }
    ctx.restore();
    return;
  }

  const fontSize = lengthToPx(over.frame.fontSize, env) ?? style.fontSize,
    font = fontSize === style.fontSize ? fontString(style) : fontString({ ...style, fontSize });
  ctx.font = font;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${lengthToPx(over.frame.letterSpacing, env) ?? style.letterSpacing}px`;
  }
  const middle = y + lineHeight / 2,
    stroke =
      over.frame.strokeWidth !== undefined
        ? {
            width: lengthToPx(over.frame.strokeWidth, env) ?? 0,
            color: over.strokeColor ?? style.color,
          }
        : style.stroke === undefined
          ? cue.style.stroke
          : style.stroke,
    shadow =
      over.frame.shadow !== undefined
        ? shadowPx(over.frame.shadow, env)
        : style.shadow === undefined
          ? cue.style.shadow
          : style.shadow,
    blur = lengthToPx(over.frame.blur, env);

  if (blur && 'filter' in ctx) ctx.filter = `blur(${blur}px)`;

  if (shadow) {
    ctx.shadowOffsetX = shadow.x;
    ctx.shadowOffsetY = shadow.y;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowColor = shadow.color;
  }

  let fill = over.color ?? style.color;
  if (style.timestamp !== undefined) {
    const timed = theme.timedColors[over.time >= style.timestamp ? 'past' : 'future'];
    if (timed) fill = timed;
  }
  if (stroke && stroke.width > 0) {
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = over.strokeColor ?? (stroke.color === 'currentColor' ? fill : stroke.color);
    ctx.strokeText(run.text, x, middle);
    // The shadow is painted once, with the stroke.
    ctx.shadowColor = 'transparent';
  }

  if (style.sweep) {
    // Karaoke: the sung part in the primary colour, the rest in the secondary, split at the
    // animated progress (0 = nothing sung, 1 = all sung).
    const progress = Math.min(Math.max(over.frame.sweep ?? 0, 0), 1),
      split = x + run.width * progress,
      pad = stroke ? stroke.width : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - pad, y - lineHeight, split - x + pad, lineHeight * 3);
    ctx.clip();
    ctx.fillStyle = style.sweep.sung;
    ctx.fillText(run.text, x, middle);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(split, y - lineHeight, x + run.width + pad - split, lineHeight * 3);
    ctx.clip();
    ctx.fillStyle = style.sweep.unsung;
    ctx.fillText(run.text, x, middle);
    ctx.restore();
  } else {
    ctx.fillStyle = fill;
    ctx.fillText(run.text, x, middle);
  }
  ctx.shadowColor = 'transparent';

  if (style.underline || style.strike) {
    const thickness = Math.max(1, style.fontSize * 0.06);
    ctx.fillStyle = fill;
    if (style.underline) ctx.fillRect(x, middle + style.fontSize * 0.38, run.width, thickness);
    if (style.strike) ctx.fillRect(x, middle - thickness / 2, run.width, thickness);
  }

  ctx.restore();
}

/**
 * Vertical writing: each line is a column `lineHeight` wide, read right-to-left (`rl`) or
 * left-to-right (`lr`); ruby annotations overflow to the right of their base in both. Upright runs
 * stack one glyph per em; sideways runs are rotated a quarter turn clockwise and read downwards.
 */
function paintColumns(
  ctx: PaintContext,
  cue: MeasuredCue,
  options: PaintOptions,
  inner: CueKeyframe,
) {
  const { style, textBox, flow } = cue,
    { theme } = options,
    // Padding axes are swapped for vertical text (see `measureVerticalCue`).
    padAlong = style.paddingY,
    padAcross = style.paddingX,
    contentHeight = textBox.height - 2 * padAlong;

  flow.lines.forEach((column, index) => {
    const x =
        cue.vertical === 'rl'
          ? textBox.left + textBox.width - padAcross - (index + 1) * flow.lineHeight
          : textBox.left + padAcross + index * flow.lineHeight,
      cx = x + flow.lineHeight / 2,
      rubyCx = x + flow.lineHeight + column.rubyHeight / 2,
      slack = contentHeight - column.width;
    let y =
      textBox.top +
      padAlong +
      (style.textAlign === 'center' ? slack / 2 : style.textAlign === 'right' ? slack : 0);

    for (const run of column.runs) {
      const span = run.style.spanKey ? sampleTarget(cue, { span: run.style.spanKey }, options) : {},
        fill = resolveFill(run, cue, theme, {
          color: span.color ?? (run.style.color === style.color ? inner.color : undefined),
          time: options.time,
        });

      ctx.save();
      ctx.globalAlpha *= run.style.opacity * (span.opacity ?? 1);
      if (run.style.bgColor && !NO_COLOR.has(run.style.bgColor)) {
        ctx.fillStyle = run.style.bgColor;
        ctx.fillRect(x, y, flow.lineHeight, run.width);
      }

      if (run.ruby) {
        const { ruby } = run,
          baseWidth = run.baseWidth ?? run.width;
        paintVerticalText(ctx, cue, ruby, fill, rubyCx, y + (run.width - ruby.width) / 2);
        paintVerticalText(
          ctx,
          cue,
          { text: run.text, style: run.style, width: baseWidth, upright: run.upright },
          fill,
          cx,
          y + (run.width - baseWidth) / 2,
        );
      } else {
        paintVerticalText(ctx, cue, run, fill, cx, y);
      }
      y += run.width;
      ctx.restore();
    }
  });
}

/** Draws one vertical run (or ruby annotation) centred on column `cx`, starting at `y`. */
function paintVerticalText(
  ctx: PaintContext,
  cue: MeasuredCue,
  run: { text: string; style: RunStyle; width: number; upright?: boolean },
  fill: string,
  cx: number,
  y: number,
) {
  const stroke = run.style.stroke === undefined ? cue.style.stroke : run.style.stroke,
    shadow = run.style.shadow === undefined ? cue.style.shadow : run.style.shadow;

  ctx.save();
  ctx.font = fontString(run.style);
  if (shadow) {
    ctx.shadowOffsetX = shadow.x;
    ctx.shadowOffsetY = shadow.y;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowColor = shadow.color;
  }
  const draw = (text: string, tx: number, ty: number) => {
    if (stroke && stroke.width > 0) {
      ctx.lineWidth = stroke.width;
      ctx.strokeStyle = stroke.color === 'currentColor' ? fill : stroke.color;
      ctx.strokeText(text, tx, ty);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, tx, ty);
  };

  if (run.upright) {
    ctx.textAlign = 'center';
    for (const glyph of run.text) {
      draw(glyph, cx, y + run.style.fontSize / 2);
      y += run.style.fontSize;
    }
  } else {
    ctx.textAlign = 'left';
    ctx.translate(cx, y);
    ctx.rotate(Math.PI / 2);
    draw(run.text, 0, 0);
  }
  ctx.restore();
}

/** The fill colour of a run after animation overrides and timed-text colouring. */
function resolveFill(
  run: Run,
  cue: MeasuredCue,
  theme: CanvasTheme,
  over: { color?: string; time: number },
): string {
  let fill = over.color ?? run.style.color;
  if (run.style.timestamp !== undefined) {
    const timed = theme.timedColors[over.time >= run.style.timestamp ? 'past' : 'future'];
    if (timed) fill = timed;
  }
  return fill;
}

/** Samples every animation aimed at a target and merges the frames (later ones win). */
function sampleTarget(
  cue: MeasuredCue,
  target: NonNullable<CueAnimation['target']>,
  options: PaintOptions,
): CueKeyframe {
  const frame: CueKeyframe = {};
  for (const spec of cue.cue.animations ?? []) {
    const specTarget = spec.target ?? 'display';
    const matches =
      typeof target === 'string'
        ? specTarget === target
        : typeof specTarget === 'object' && specTarget.span === target.span;
    if (!matches) continue;
    Object.assign(
      frame,
      sampleAnimation(spec, options.time, cue.cue.startTime, options.theme.reducedMotion),
    );
  }
  return frame;
}

function applyTransform(ctx: PaintContext, t: Transform2D, [ox, oy]: [number, number]) {
  if (isIdentity(t)) return;
  ctx.translate(ox, oy);
  ctx.transform(t[0], t[1], t[2], t[3], 0, 0);
  ctx.translate(-ox, -oy);
}
