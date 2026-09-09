import type {
  CueAnimation,
  CueClip,
  CueKeyframe,
  CueLength,
  CueShadow,
  CueTransform,
} from '../vtt/vtt-cue';
import { formatColor, parseColor } from './values';

type Keyframe = CueKeyframe & { offset: number };

/**
 * Evaluates a cue animation at a media time, the way the DOM writer's Web Animation would at
 * `animation.currentTime`. Numbers, lengths of the same unit, `rgb()`/hex colours, transforms,
 * shadows, and clips interpolate; anything else steps at the keyframe.
 */
export function sampleAnimation(
  spec: CueAnimation,
  time: number,
  cueStart: number,
  reducedMotion = false,
): CueKeyframe {
  const frames = withOffsets(spec.keyframes);
  if (!frames.length) return {};

  const duration = Math.max(spec.duration, 0.001),
    local = reducedMotion ? duration : time - cueStart - (spec.delay ?? 0),
    progress = Math.min(Math.max(local / duration, 0), 1),
    eased = ease(progress, spec.easing);

  let next = frames.findIndex((frame) => frame.offset >= eased);
  if (next === -1) next = frames.length - 1;
  const prev = Math.max(0, next - 1),
    a = frames[prev],
    b = frames[next],
    span = b.offset - a.offset,
    t = span > 0 ? (eased - a.offset) / span : 1;

  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof CueKeyframe)[]);
  keys.delete('offset');
  for (const key of keys) {
    const from = a[key] ?? nearest(frames, prev, key, -1),
      to = b[key] ?? nearest(frames, next, key, 1);
    if (from === undefined && to === undefined) continue;
    result[key] = interpolate<Value>(from ?? to, to ?? from, t);
  }
  return result as CueKeyframe;
}

function nearest(frames: Keyframe[], index: number, key: keyof CueKeyframe, dir: -1 | 1) {
  for (let i = index; i >= 0 && i < frames.length; i += dir) {
    if (frames[i][key] !== undefined) return frames[i][key];
  }
  return undefined;
}

/** Fills in missing `offset`s evenly, as the Web Animations API does. */
function withOffsets(keyframes: CueKeyframe[]): Keyframe[] {
  const frames = keyframes.map((frame) => ({ ...frame })) as Keyframe[];
  if (!frames.length) return frames;
  const has = (i: number) => typeof frames[i].offset === 'number';
  if (!has(0)) frames[0].offset = 0;
  if (!has(frames.length - 1)) frames[frames.length - 1].offset = 1;
  let last = 0;
  for (let i = 1; i < frames.length; i++) {
    if (!has(i)) continue;
    const gap = i - last,
      from = frames[last].offset,
      to = frames[i].offset;
    for (let j = last + 1; j < i; j++) frames[j].offset = from + ((to - from) * (j - last)) / gap;
    last = i;
  }
  return frames;
}

type Bezier = [x1: number, y1: number, x2: number, y2: number];

/** The CSS easing keywords as the cubic Béziers the browser uses. */
const EASINGS: Record<string, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Applies a CSS easing (`linear`, the keywords, `steps`' `step-start`/`step-end`, or `cubic-bezier(...)`). */
export function ease(t: number, easing: string | undefined): number {
  if (!easing || easing === 'linear') return t;
  if (easing === 'step-end') return t >= 1 ? 1 : 0;
  if (easing === 'step-start') return t > 0 ? 1 : 0;
  let curve = EASINGS[easing];
  if (!curve) {
    const match = /^cubic-bezier\(([^)]*)\)$/.exec(easing);
    if (match) {
      const n = match[1].split(',').map(Number);
      if (n.length === 4 && n.every(Number.isFinite)) curve = n as Bezier;
    }
  }
  return curve ? cubicBezier(curve, t) : t;
}

/** `y` at `x` on a CSS cubic Bézier (P0 = (0,0), P3 = (1,1)), solving for the parameter by Newton. */
function cubicBezier([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const at = (s: number, p1: number, p2: number) =>
      3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3,
    slope = (s: number) =>
      3 * (1 - s) ** 2 * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
  let s = x;
  for (let i = 0; i < 8; i++) {
    const error = at(s, x1, x2) - x;
    if (Math.abs(error) < 1e-5) break;
    const d = slope(s);
    if (Math.abs(d) < 1e-6) break;
    s -= error / d;
  }
  return at(Math.min(Math.max(s, 0), 1), y1, y2);
}

type Value =
  | number
  | string
  | CueLength
  | CueTransform
  | CueShadow
  | CueClip
  | { x?: number; y?: number }
  | null
  | undefined;

/** Interpolates two keyframe values of the same kind; mismatched kinds step at the midpoint. */
export function interpolate<T extends Value>(from: T, to: T, t: number): T {
  if (t <= 0 || from === to) return from;
  if (t >= 1) return to;
  if (from == null || to == null) return t < 0.5 ? from : to;

  if (typeof from === 'number' && typeof to === 'number') {
    return (from + (to - from) * t) as T;
  }

  if (typeof from === 'string' && typeof to === 'string') {
    const ca = parseColor(from),
      cb = parseColor(to);
    if (ca && cb) {
      return formatColor(
        ca.map((v, i) => v + (cb[i] - v) * t) as [number, number, number, number],
      ) as T;
    }
    return (t < 0.5 ? from : to) as T;
  }

  if (typeof from === 'object' && typeof to === 'object') {
    // Lengths: same unit only.
    if ('unit' in from && 'unit' in to) {
      if (from.unit !== to.unit) return (t < 0.5 ? from : to) as T;
      return { unit: from.unit, value: from.value + (to.value - from.value) * t } as T;
    }
    // Clips of the same shape.
    if ('rect' in from && 'rect' in to) {
      return { rect: from.rect.map((v, i) => v + (to.rect[i] - v) * t) } as T;
    }
    if ('inset' in from && 'inset' in to) {
      return { inset: from.inset.map((v, i) => v + (to.inset[i] - v) * t) } as T;
    }
    if ('polygon' in from && 'polygon' in to && from.polygon.length === to.polygon.length) {
      return {
        polygon: from.polygon.map(([x, y], i) => [
          x + (to.polygon[i][0] - x) * t,
          y + (to.polygon[i][1] - y) * t,
        ]),
        evenOdd: from.evenOdd,
      } as T;
    }
    if ('rect' in from || 'inset' in from || 'polygon' in from) {
      return (t < 0.5 ? from : to) as T;
    }
    // Transforms and shadows: field by field.
    const out: Record<string, unknown> = { ...from, ...to };
    for (const key of Object.keys(out)) {
      out[key] = interpolate(
        (from as Record<string, Value>)[key] ?? defaultFor(key),
        (to as Record<string, Value>)[key] ?? defaultFor(key),
        t,
      );
    }
    return out as T;
  }

  return (t < 0.5 ? from : to) as T;
}

/** Neutral values for transform fields missing on one side. */
function defaultFor(key: string): Value {
  return key === 'scaleX' || key === 'scaleY' ? 1 : key.startsWith('rotate') ? 0 : undefined;
}
