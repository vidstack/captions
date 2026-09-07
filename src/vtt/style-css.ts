/**
 * Serialises the typed cue style model to CSS. This is the DOM and string writers' half of the
 * contract; the canvas writer resolves the same values to pixels (`src/canvas/values.ts`).
 * Parsers never produce CSS strings themselves.
 */
import type {
  CueClip,
  CueKeyframe,
  CueLayout,
  CueLength,
  CueShadow,
  CueSpanStyle,
  CueStroke,
  CueTransform,
} from './vtt-cue';

/** A length as CSS: overlay-relative units become `calc()` over the overlay size variables. */
export function lengthToCSS(length: CueLength): string {
  if (typeof length === 'number') return length ? `${round(length)}px` : '0';
  switch (length.unit) {
    case 'vw':
      return `calc(var(--overlay-width) * ${round(length.value / 100, 5)})`;
    case 'vh':
      return `calc(var(--overlay-height) * ${round(length.value / 100, 5)})`;
    case 'em':
      return `${round(length.value)}em`;
    case '%':
      return `${round(length.value)}%`;
  }
}

export function transformToCSS(transform: CueTransform | undefined): string {
  if (!transform) return '';
  const parts: string[] = [];
  if (transform.scaleX !== undefined && transform.scaleX !== 1)
    parts.push(`scaleX(${round(transform.scaleX)})`);
  if (transform.scaleY !== undefined && transform.scaleY !== 1)
    parts.push(`scaleY(${round(transform.scaleY)})`);
  if (transform.rotate) parts.push(`rotate(${round(transform.rotate)}deg)`);
  if (transform.rotateX) parts.push(`rotateX(${round(transform.rotateX)}deg)`);
  if (transform.rotateY) parts.push(`rotateY(${round(transform.rotateY)}deg)`);
  return parts.join(' ');
}

/**
 * `transform-origin`, or an empty string for the default (centre). An overlay point pivot is
 * expressed relative to the box through the overlay size variables (see `clipToCSS`).
 */
export function transformOriginToCSS(
  transform: CueTransform | undefined,
  layout?: CueLayout,
): string {
  if (transform?.originAt) {
    const [x, y] = transform.originAt,
      left = layout?.left ?? 0,
      top = layout?.top ?? 0,
      tx = -(layout?.translate?.x ?? 0) * 100,
      ty = -(layout?.translate?.y ?? 0) * 100;
    return (
      `calc(var(--overlay-width) * ${round((x - left) / 100, 5)} + ${round(tx)}%) ` +
      `calc(var(--overlay-height) * ${round((y - top) / 100, 5)} + ${round(ty)}%)`
    );
  }
  return transform?.origin ? `${round(transform.origin[0])}% ${round(transform.origin[1])}%` : '';
}

/** `<width> <color>` for `-webkit-text-stroke`; `0` for none. */
export function strokeToCSS(stroke: CueStroke | null | undefined): string {
  return stroke ? `${lengthToCSS(stroke.width)} ${stroke.color}` : '0';
}

/** `<width> solid <color>` for `outline`. */
export function outlineToCSS(outline: CueStroke | undefined): string {
  return outline ? `${lengthToCSS(outline.width)} solid ${outline.color}` : 'none';
}

export function shadowToCSS(shadow: CueShadow | null | undefined): string {
  if (!shadow) return 'none';
  return `${lengthToCSS(shadow.x)} ${lengthToCSS(shadow.y)}${
    shadow.blur ? ' ' + lengthToCSS(shadow.blur) : ''
  } ${shadow.color}`;
}

export function fontWeightToCSS(weight: number | undefined): string | undefined {
  return weight === undefined
    ? undefined
    : weight >= 600
      ? 'bold'
      : weight === 400
        ? 'normal'
        : String(weight);
}

export function textDecorationToCSS(underline?: boolean, strike?: boolean): string | undefined {
  if (underline === undefined && strike === undefined) return undefined;
  const parts = [underline && 'underline', strike && 'line-through'].filter(Boolean);
  return parts.length ? parts.join(' ') : 'none';
}

/** `background-position` for a karaoke sweep progress (0 = nothing sung, 1 = all sung). */
export function sweepPositionToCSS(progress: number): string {
  return `${round((1 - Math.min(Math.max(progress, 0), 1)) * 100)}% 0`;
}

/**
 * A clip as `clip-path` for a box whose position is known. Overlay-relative clips (`rect`,
 * `polygon`, in overlay percentages) are expressed relative to the box through the overlay size
 * variables: each overlay percentage `p` becomes `calc(var(--overlay-*) * (p - boxEdge) + t%)`,
 * where `t` undoes the box's anchor translation. Box-relative `inset` clips are percentages of
 * the box itself.
 *
 * @param box The box's overlay-percentage position and anchor translation (fraction of the box).
 */
export function clipToCSS(
  clip: CueClip,
  box: { left: number; top: number; translateX?: number; translateY?: number },
): string {
  if ('inset' in clip) {
    return `inset(${clip.inset.map((v) => `${round(v)}%`).join(' ')})`;
  }
  const tx = -(box.translateX ?? 0) * 100,
    ty = -(box.translateY ?? 0) * 100,
    x = (p: number) =>
      `calc(var(--overlay-width) * ${round((p - box.left) / 100, 5)} + ${round(tx)}%)`,
    y = (p: number) =>
      `calc(var(--overlay-height) * ${round((p - box.top) / 100, 5)} + ${round(ty)}%)`;

  if ('rect' in clip) {
    const [l, t, r, b] = clip.rect;
    return `polygon(${x(l)} ${y(t)}, ${x(r)} ${y(t)}, ${x(r)} ${y(b)}, ${x(l)} ${y(b)})`;
  }
  return `polygon(${clip.evenOdd ? 'evenodd, ' : ''}${clip.polygon
    .map(([px, py]) => `${x(px)} ${y(py)}`)
    .join(', ')})`;
}

/**
 * A clip as `clip-path` when the box's pixel geometry is known (the write phase): overlay
 * percentages resolve to pixels relative to the box, so no variables are needed.
 */
export function clipToPixelCSS(
  clip: CueClip,
  container: { width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
): string {
  if ('inset' in clip) {
    return `inset(${clip.inset.map((v) => `${round(v)}%`).join(' ')})`;
  }
  const x = (p: number) => `${round((p / 100) * container.width - box.left, 2)}px`,
    y = (p: number) => `${round((p / 100) * container.height - box.top, 2)}px`;
  if ('rect' in clip) {
    const [l, t, r, b] = clip.rect,
      inset = [
        (t / 100) * container.height - box.top,
        box.left + box.width - (r / 100) * container.width,
        box.top + box.height - (b / 100) * container.height,
        (l / 100) * container.width - box.left,
      ].map((v) => Math.max(0, v));
    return inset.some((v) => v > 0)
      ? `inset(${inset.map((v) => `${round(v, 2)}px`).join(' ')})`
      : 'none';
  }
  return `polygon(${clip.evenOdd ? 'evenodd, ' : ''}${clip.polygon
    .map(([px, py]) => `${x(px)} ${y(py)}`)
    .join(', ')})`;
}

/**
 * CSS declarations for a span's typed style, shared by the DOM and string renderers. `layout` is
 * the cue's, needed to place an overlay-point transform origin.
 */
export function spanStyleToDeclarations(
  span: CueSpanStyle,
  layout?: CueLayout,
): [string, string][] {
  const out: [string, string][] = [];
  if (span.sweep) {
    // Karaoke sweep: a two-tone gradient clipped to the glyphs slides from unsung to sung.
    out.push(
      [
        'background-image',
        `linear-gradient(90deg, ${span.sweep.sung} 50%, ${span.sweep.unsung} 50%)`,
      ],
      ['background-size', '200% 100%'],
      ['background-position', sweepPositionToCSS(0)],
      ['-webkit-background-clip', 'text'],
      ['color', 'transparent'],
    );
  } else if (span.color) {
    out.push(['color', span.color]);
  }
  if (span.backgroundColor) out.push(['background-color', span.backgroundColor]);
  if (span.fontFamily) out.push(['font-family', span.fontFamily]);
  if (span.fontSize !== undefined) out.push(['font-size', lengthToCSS(span.fontSize)]);
  const weight = fontWeightToCSS(span.fontWeight);
  if (weight) out.push(['font-weight', weight]);
  if (span.italic !== undefined) out.push(['font-style', span.italic ? 'italic' : 'normal']);
  const decoration = textDecorationToCSS(span.underline, span.strike);
  if (decoration) out.push(['text-decoration', decoration]);
  if (span.letterSpacing !== undefined)
    out.push(['letter-spacing', lengthToCSS(span.letterSpacing)]);
  if (span.stroke !== undefined) out.push(['-webkit-text-stroke', strokeToCSS(span.stroke)]);
  if (span.shadow !== undefined) out.push(['text-shadow', shadowToCSS(span.shadow)]);
  if (span.blur !== undefined) {
    out.push(['filter', isZero(span.blur) ? 'none' : `blur(${lengthToCSS(span.blur)})`]);
  }
  if (span.opacity !== undefined) out.push(['opacity', String(round(span.opacity))]);
  if (span.transform) {
    const transform = transformToCSS(span.transform);
    if (transform) {
      out.push(['transform', transform]);
      // Transforms do not apply to inline boxes.
      out.push(['display', 'inline-block']);
    }
    const origin = transformOriginToCSS(span.transform, layout);
    if (origin) out.push(['transform-origin', origin]);
  }
  return out;
}

/**
 * A typed keyframe as Web Animations keyframe properties. Positions (`left`/`top`) are overlay
 * percentages; `translate` is a fraction of the box; clips are resolved relative to the box at
 * this keyframe's position (falling back to the layout's).
 */
export function keyframeToCSS(
  frame: CueKeyframe,
  layout: CueLayout | undefined,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (frame.offset !== undefined) out.offset = frame.offset;
  if (frame.opacity !== undefined) out.opacity = frame.opacity;
  if (frame.color !== undefined) out.color = frame.color;
  if (frame.strokeColor !== undefined) out.webkitTextStrokeColor = frame.strokeColor;
  if (frame.strokeWidth !== undefined) out.webkitTextStrokeWidth = lengthToCSS(frame.strokeWidth);
  if (frame.fontSize !== undefined) out.fontSize = lengthToCSS(frame.fontSize);
  if (frame.letterSpacing !== undefined) out.letterSpacing = lengthToCSS(frame.letterSpacing);
  if (frame.shadow !== undefined) out.textShadow = shadowToCSS(frame.shadow);
  if (frame.blur !== undefined)
    out.filter = isZero(frame.blur) ? 'none' : `blur(${lengthToCSS(frame.blur)})`;
  if (frame.transform !== undefined) out.transform = transformToCSS(frame.transform) || 'none';
  if (frame.left !== undefined) out.left = `${round(frame.left)}%`;
  if (frame.top !== undefined) out.top = `${round(frame.top)}%`;
  if (frame.translate !== undefined) {
    out.translate = `${round((frame.translate.x ?? 0) * 100)}% ${round((frame.translate.y ?? 0) * 100)}%`;
  }
  if (frame.sweep !== undefined) out.backgroundPosition = sweepPositionToCSS(frame.sweep);
  if (frame.clip !== undefined) {
    out.clipPath = clipToCSS(frame.clip, {
      left: frame.left ?? layout?.left ?? 0,
      top: frame.top ?? layout?.top ?? 0,
      translateX: frame.translate?.x ?? layout?.translate?.x,
      translateY: frame.translate?.y ?? layout?.translate?.y,
    });
  }
  return out;
}

function isZero(length: CueLength) {
  return typeof length === 'number' ? length === 0 : length.value === 0;
}

function round(num: number, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}
