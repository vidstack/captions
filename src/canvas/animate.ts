import type { CueAnimation } from '../vtt/vtt-cue';
import { formatColor, parseColor, splitTopLevel } from './css-values';

export type SampledFrame = Record<string, string | number>;

type Keyframe = SampledFrame & { offset: number };

/**
 * Evaluates a cue animation at a media time, the way the DOM writer's Web Animation would at
 * `animation.currentTime`. Interpolates numbers, lengths with a unit, `rgb()`/hex colours, and
 * transform lists with matching function shapes; anything else steps at the keyframe.
 */
export function sampleAnimation(
  spec: CueAnimation,
  time: number,
  cueStart: number,
  reducedMotion = false,
): SampledFrame {
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

  const result: SampledFrame = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('offset');
  keys.delete('easing');
  for (const key of keys) {
    const from = a[key] ?? nearest(frames, prev, key, -1),
      to = b[key] ?? nearest(frames, next, key, 1);
    if (from === undefined && to === undefined) continue;
    result[key] = interpolate(from ?? to!, to ?? from!, t);
  }
  return result;
}

function nearest(frames: Keyframe[], index: number, key: string, dir: -1 | 1) {
  for (let i = index; i >= 0 && i < frames.length; i += dir) {
    if (frames[i][key] !== undefined) return frames[i][key];
  }
  return undefined;
}

/** Fills in missing `offset`s evenly, as the Web Animations API does. */
function withOffsets(keyframes: Record<string, string | number>[]): Keyframe[] {
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

function ease(t: number, easing: string | undefined): number {
  switch (easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'step-end':
      return t >= 1 ? 1 : 0;
    default:
      return t;
  }
}

// A dot must be followed by digits, so the number can only match one way (no quadratic backtracking).
const NUMBER_UNIT_RE = /^(-?\d+(?:\.\d+)?|-?\.\d+)([a-z%]*)$/;

export function interpolate(
  from: string | number,
  to: string | number,
  t: number,
): string | number {
  if (t <= 0) return from;
  if (t >= 1) return to;
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t;

  const a = String(from),
    b = String(to);

  const na = NUMBER_UNIT_RE.exec(a),
    nb = NUMBER_UNIT_RE.exec(b);
  if (na && nb && (na[2] === nb[2] || parseFloat(na[1]) === 0 || parseFloat(nb[1]) === 0)) {
    return `${parseFloat(na[1]) + (parseFloat(nb[1]) - parseFloat(na[1])) * t}${na[2] ?? nb[2] ?? ''}`;
  }

  const ca = parseColor(a),
    cb = parseColor(b);
  if (ca && cb) {
    return formatColor(ca.map((v, i) => v + (cb[i] - v) * t) as [number, number, number, number]);
  }

  const ta = splitTopLevel(a),
    tb = splitTopLevel(b);
  if (ta.length > 1 && ta.length === tb.length && ta.every((v, i) => numericPair(v, tb[i]))) {
    // Lists of lengths such as `background-position: 100% 0`.
    return ta.map((v, i) => interpolate(v, unitLike(tb[i], v), t)).join(' ');
  }
  if (ta.length && ta.length === tb.length && ta.every((fn, i) => fnName(fn) === fnName(tb[i]))) {
    return ta
      .map((fn, i) => {
        const argsA = fnArgs(fn),
          argsB = fnArgs(tb[i]);
        if (argsA.length !== argsB.length) return fn;
        return `${fnName(fn)}(${argsA.map((arg, j) => interpolate(arg, argsB[j], t)).join(', ')})`;
      })
      .join(' ');
  }

  return t < 0.5 ? from : to;
}

function numericPair(a: string, b: string) {
  const na = NUMBER_UNIT_RE.exec(a),
    nb = NUMBER_UNIT_RE.exec(b);
  return !!na && !!nb && (na[2] === nb[2] || parseFloat(na[1]) === 0 || parseFloat(nb[1]) === 0);
}

/** Gives a unitless zero the unit of its partner so `0` and `100%` interpolate. */
function unitLike(value: string, partner: string) {
  const nv = NUMBER_UNIT_RE.exec(value),
    np = NUMBER_UNIT_RE.exec(partner);
  return nv && np && !nv[2] && np[2] ? `${nv[1]}${np[2]}` : value;
}

function fnName(fn: string) {
  return fn.slice(0, fn.indexOf('('));
}

function fnArgs(fn: string) {
  return fn
    .slice(fn.indexOf('(') + 1, fn.lastIndexOf(')'))
    .split(',')
    .map((arg) => arg.trim());
}
