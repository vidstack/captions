import type { Box } from '../vtt/overlay/box';
import type { CueAnimation } from '../vtt/vtt-cue';
import { sampleAnimation, type SampledFrame } from './animate';
import {
  parseClipPath,
  parseTransform,
  parseTransformOrigin,
  resolveLength,
  type LengthEnv,
  type Transform2D,
} from './css-values';
import { fontString, type Run } from './flow';
import type { MeasuredCue, MeasuredRegion } from './measure';
import type { CanvasTheme } from './theme';

/** The subset of `CanvasRenderingContext2D` the painter uses (also satisfied by offscreen contexts). */
export type PaintContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Loads and caches `background-image` URLs; `onLoad` asks for a repaint. */
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
    env: LengthEnv = { width: container.width, height: container.height, em: cue.style.fontSize };

  const display = sampleTarget(cue, 'display', options),
    inner = sampleTarget(cue, 'cue', options);

  let left = box.left,
    top = box.top;
  const animatedLeft = resolveLength(display.left as string, { ...env, percent: container.width }),
    animatedTop = resolveLength(display.top as string, { ...env, percent: container.height });
  if (animatedLeft !== null) left = animatedLeft + (cue.cue.layout?.translate?.x ?? 0) * box.width;
  if (animatedTop !== null) top = animatedTop + (cue.cue.layout?.translate?.y ?? 0) * box.height;

  ctx.save();
  ctx.translate(container.left + left, container.top + top);
  ctx.globalAlpha *= cue.style.opacity * alphaOf(display) * alphaOf(inner);

  // Screen-fixed clip rectangles and box-relative clip paths (SSA `\clip`).
  const clipRect = cue.cue.layout?.clipRect;
  if (clipRect) {
    ctx.beginPath();
    ctx.rect(
      (clipRect.left / 100) * container.width - left,
      (clipRect.top / 100) * container.height - top,
      ((clipRect.right - clipRect.left) / 100) * container.width,
      ((clipRect.bottom - clipRect.top) / 100) * container.height,
    );
    ctx.clip();
  }
  const polygon = parseClipPath(cue.style.clipPath, env, box);
  if (polygon) {
    ctx.beginPath();
    polygon.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
  }

  // Cue transforms (SSA rotation/scale, `\t`) pivot on the alignment anchor or `\org`.
  const transform = combine(
    parseTransform(cue.style.transform, { ...env, percentX: box.width, percentY: box.height }),
    parseTransform(display.transform as string, {
      ...env,
      percentX: box.width,
      percentY: box.height,
    }),
    parseTransform(inner.transform as string, {
      ...env,
      percentX: box.width,
      percentY: box.height,
    }),
  );
  applyTransform(ctx, transform, parseTransformOrigin(cue.style.transformOrigin, env, box));

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
  inner: SampledFrame,
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
      // `background-size: contain`, centred.
      const scale = Math.min(textBox.width / image.width, textBox.height / image.height),
        w = image.width * scale,
        h = image.height * scale;
      ctx.drawImage(
        image,
        textBox.left + (textBox.width - w) / 2,
        textBox.top + (textBox.height - h) / 2,
        w,
        h,
      );
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

  const innerColor = typeof inner.color === 'string' ? inner.color : null,
    innerStrokeColor =
      typeof inner.webkitTextStrokeColor === 'string' ? inner.webkitTextStrokeColor : null,
    contentWidth = textBox.width - 2 * style.paddingX;

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  flow.lines.forEach((line, index) => {
    const y = textBox.top + style.paddingY + index * flow.lineHeight,
      slack = contentWidth - line.width;
    let x =
      textBox.left +
      style.paddingX +
      (style.textAlign === 'center' ? slack / 2 : style.textAlign === 'right' ? slack : 0);

    for (const run of line.runs) {
      const span = run.style.spanKey ? sampleTarget(cue, { span: run.style.spanKey }, options) : {};
      paintRun(ctx, run, x, y, flow.lineHeight, cue, theme, {
        color: (span.color as string) ?? (run.style.color === style.color ? innerColor : null),
        strokeColor: innerStrokeColor,
        alpha: alphaOf(span),
        transform: span.transform as string | undefined,
        backgroundPosition: span.backgroundPosition as string | undefined,
        time: options.time,
      });
      x += run.width;
    }
  });
}

interface RunOverrides {
  color: string | null;
  strokeColor: string | null;
  alpha: number;
  transform?: string;
  backgroundPosition?: string;
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

  const transformValue = [style.transform, over.transform].filter(Boolean).join(' ');
  if (transformValue) {
    const runBox = { width: run.width, height: lineHeight };
    ctx.translate(x, y);
    applyTransform(
      ctx,
      parseTransform(transformValue, { ...env, percentX: runBox.width, percentY: runBox.height }),
      parseTransformOrigin(style.transformOrigin, env, runBox),
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

  ctx.font = fontString(style);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${style.letterSpacing}px`;
  const middle = y + lineHeight / 2,
    stroke = style.stroke === undefined ? cue.style.stroke : style.stroke,
    shadow = style.shadow === undefined ? cue.style.shadow : style.shadow;

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
  if (stroke) {
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = over.strokeColor ?? (stroke.color === 'currentColor' ? fill : stroke.color);
    ctx.strokeText(run.text, x, middle);
    // The shadow is painted once, with the stroke.
    ctx.shadowColor = 'transparent';
  }
  if (style.sweep) {
    // Karaoke: the sung part in the primary colour, the rest in the secondary, split at the
    // animated `background-position` (100% = nothing sung, 0% = all sung).
    const position = String(over.backgroundPosition ?? '100% 0').split(' ')[0],
      progress = Math.min(Math.max(1 - (parseFloat(position) || 0) / 100, 0), 1),
      split = x + run.width * progress,
      pad = stroke ? stroke.width : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - pad, y - lineHeight, split - x + pad, lineHeight * 3);
    ctx.clip();
    ctx.fillStyle = style.sweep.from;
    ctx.fillText(run.text, x, middle);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(split, y - lineHeight, x + run.width + pad - split, lineHeight * 3);
    ctx.clip();
    ctx.fillStyle = style.sweep.to;
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

/** Samples every animation aimed at a target and merges the frames (later ones win). */
function sampleTarget(
  cue: MeasuredCue,
  target: NonNullable<CueAnimation['target']>,
  options: PaintOptions,
): SampledFrame {
  const frame: SampledFrame = {};
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

function alphaOf(frame: SampledFrame): number {
  const opacity = frame.opacity;
  if (opacity === undefined) return 1;
  const n = typeof opacity === 'number' ? opacity : parseFloat(opacity);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 1;
}

function combine(...transforms: Transform2D[]): Transform2D {
  return transforms.reduce((a, b) => ({
    translateX: a.translateX + b.translateX,
    translateY: a.translateY + b.translateY,
    scaleX: a.scaleX * b.scaleX,
    scaleY: a.scaleY * b.scaleY,
    rotate: a.rotate + b.rotate,
  }));
}

function applyTransform(ctx: PaintContext, t: Transform2D, [ox, oy]: [number, number]) {
  if (!t.translateX && !t.translateY && t.scaleX === 1 && t.scaleY === 1 && !t.rotate) return;
  ctx.translate(ox + t.translateX, oy + t.translateY);
  if (t.rotate) ctx.rotate((t.rotate * Math.PI) / 180);
  if (t.scaleX !== 1 || t.scaleY !== 1) ctx.scale(t.scaleX, t.scaleY);
  ctx.translate(-ox, -oy);
}
