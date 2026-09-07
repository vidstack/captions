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

/** A transform's 2D part (3D rotations have no canvas equivalent and are ignored). */
export interface Transform2D {
  scaleX: number;
  scaleY: number;
  rotate: number;
}

export const IDENTITY: Transform2D = { scaleX: 1, scaleY: 1, rotate: 0 };

export function transform2D(transform: CueTransform | undefined): Transform2D {
  return {
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotate: transform?.rotate ?? 0,
  };
}

export function combineTransforms(...transforms: Transform2D[]): Transform2D {
  return transforms.reduce((a, b) => ({
    scaleX: a.scaleX * b.scaleX,
    scaleY: a.scaleY * b.scaleY,
    rotate: a.rotate + b.rotate,
  }));
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
