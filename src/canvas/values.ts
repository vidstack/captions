/**
 * Resolves the typed cue style model to pixels and plain numbers for the canvas writer. The DOM
 * writer's counterpart is `src/vtt/style-css.ts`.
 */
import type { CueClip, CueLength, CueTransform } from '../vtt/vtt-cue';

/** Everything a relative length can refer to. */
export interface LengthEnv {
  /** Overlay (container) size in pixels. */
  width: number;
  height: number;
  /** Current font size in pixels, for `em`. */
  em: number;
  /** Reference size for `%` (a box dimension). */
  percent?: number;
}

export function lengthToPx(length: CueLength | undefined, env: LengthEnv): number | null {
  if (length === undefined) return null;
  if (typeof length === 'number') return length;
  switch (length.unit) {
    case 'vw':
      return (length.value / 100) * env.width;
    case 'vh':
      return (length.value / 100) * env.height;
    case 'em':
      return length.value * env.em;
    case '%':
      return (length.value / 100) * (env.percent ?? 0);
  }
}

/**
 * A transform flattened to a 2D affine matrix, `[a, b, c, d]` as `ctx.transform()` takes it
 * (`x' = a·x + c·y`, `y' = b·x + d·y`). 3D rotations are projected orthographically, which is what
 * CSS does without `perspective`: `rotateX` squashes the box vertically, `rotateY` horizontally,
 * and both together shear it.
 */
export type Transform2D = [a: number, b: number, c: number, d: number];

export const IDENTITY: Transform2D = [1, 0, 0, 1];

const RAD = Math.PI / 180;

/** Flattens a cue transform in the CSS order `scaleX() scaleY() rotate() rotateX() rotateY()`. */
export function transform2D(transform: CueTransform | undefined): Transform2D {
  if (!transform) return IDENTITY;
  const sx = transform.scaleX ?? 1,
    sy = transform.scaleY ?? 1,
    z = (transform.rotate ?? 0) * RAD,
    x = (transform.rotateX ?? 0) * RAD,
    y = (transform.rotateY ?? 0) * RAD;
  if (sx === 1 && sy === 1 && !z && !x && !y) return IDENTITY;
  // Top-left 2x2 of Rx·Ry: [[cos y, 0], [sin x·sin y, cos x]], then Rz, then the scales.
  const cz = Math.cos(z),
    sz = Math.sin(z),
    m00 = Math.cos(y),
    m10 = Math.sin(x) * Math.sin(y),
    m11 = Math.cos(x);
  return [
    sx * (cz * m00 - sz * m10),
    sy * (sz * m00 + cz * m10),
    -(sx * sz * m11) || 0, // `|| 0` folds -0 away
    sy * cz * m11,
  ];
}

export function isIdentity(t: Transform2D): boolean {
  return t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1;
}

/** Multiplies transforms so the first applies outermost, like a CSS `transform` list. */
export function combineTransforms(...transforms: Transform2D[]): Transform2D {
  return transforms.reduce(([a1, b1, c1, d1], [a2, b2, c2, d2]) => [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
  ]);
}

/**
 * The pivot of a transform in box pixels: `originAt` is a point on the overlay (the box's
 * position in container pixels is needed), `origin` a percentage of the box, default the centre.
 */
export function transformOriginPx(
  transform: CueTransform | undefined,
  container: { width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
): [number, number] {
  if (transform?.originAt) {
    return [
      (transform.originAt[0] / 100) * container.width - box.left,
      (transform.originAt[1] / 100) * container.height - box.top,
    ];
  }
  const [x, y] = transform?.origin ?? [50, 50];
  return [(x / 100) * box.width, (y / 100) * box.height];
}

/** A clip as a polygon in box pixels. */
export function clipToPolygon(
  clip: CueClip,
  container: { width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
): { points: [number, number][]; evenOdd: boolean } {
  if ('inset' in clip) {
    const [t, r, b, l] = clip.inset.map((v, i) => (v / 100) * (i % 2 ? box.width : box.height));
    return {
      points: [
        [l, t],
        [box.width - r, t],
        [box.width - r, box.height - b],
        [l, box.height - b],
      ],
      evenOdd: false,
    };
  }
  const x = (p: number) => (p / 100) * container.width - box.left,
    y = (p: number) => (p / 100) * container.height - box.top;
  if ('rect' in clip) {
    const [l, t, r, b] = clip.rect;
    return {
      points: [
        [x(l), y(t)],
        [x(r), y(t)],
        [x(r), y(b)],
        [x(l), y(b)],
      ],
      evenOdd: false,
    };
  }
  return { points: clip.polygon.map(([px, py]) => [x(px), y(py)]), evenOdd: !!clip.evenOdd };
}

/** RGBA components of `rgb()`, `rgba()`, and hex colours; null for anything else (names). */
export function parseColor(value: string): [number, number, number, number] | null {
  const text = value.trim();
  let match = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
    const n = parseInt(hex.padEnd(8, 'f'), 16);
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, (n & 255) / 255];
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    const alpha =
      match[4] === undefined
        ? 1
        : match[4].endsWith('%')
          ? parseFloat(match[4]) / 100
          : parseFloat(match[4]);
    return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), alpha];
  }
  if (text === 'transparent') return [0, 0, 0, 0];
  return null;
}

export function formatColor([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 1000) / 1000})`;
}
