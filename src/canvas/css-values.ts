/**
 * Bridges from the CSS-flavoured strings in the cue model (`CueTextStyle`, `CueSpanStyle`,
 * keyframes) to numbers a canvas can use. The parsers only ever emit a small dialect, listed per
 * function, so this is a resolver for our own output rather than a CSS engine. A typed style
 * model (see docs/design/canvas-and-style-model.md) would make this file unnecessary.
 */

/** Everything a relative length can refer to. */
export interface LengthEnv {
  /** Overlay (container) size in pixels: `var(--overlay-width)` / `var(--overlay-height)`. */
  width: number;
  height: number;
  /** Current font size in pixels, for `em`. */
  em: number;
  /** Reference size for `%` (a box dimension), when percentages are meaningful. */
  percent?: number;
}

// A dot must be followed by digits, so the number can only match one way (no quadratic backtracking).
const NUMBER_UNIT_RE = /^(-?\d+(?:\.\d+)?|-?\.\d+)(px|em|rem|%|vh|vw|cqh|cqw)?$/;

/**
 * Resolves a length to pixels. Handles `Npx`, `Nem`, `N%` (of `env.percent`), `Ncqh`/`Ncqw`,
 * bare numbers (pixels), and `calc()` over those with `var(--overlay-width|height)` and
 * `var(--cue-font-size)`, e.g. `calc(var(--overlay-height) * 0.05 * 0.8)` or
 * `calc(var(--overlay-width) * 0.1 + 50%)`. Returns `null` for anything else.
 */
export function resolveLength(value: string | number | undefined, env: LengthEnv): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') return value;
  const text = value.trim();
  if (text === '0' || text === 'none') return 0;
  if (text.startsWith('calc(') && text.endsWith(')')) return evalCalc(text.slice(5, -1), env);
  return unitToPx(text, env);
}

function unitToPx(text: string, env: LengthEnv): number | null {
  const match = NUMBER_UNIT_RE.exec(text);
  if (!match) return null;
  const n = parseFloat(match[1]);
  switch (match[2]) {
    case undefined:
    case 'px':
      return n;
    case 'em':
    case 'rem':
      return n * env.em;
    case '%':
      return (n / 100) * (env.percent ?? 0);
    case 'vh':
    case 'cqh':
      return (n / 100) * env.height;
    case 'vw':
    case 'cqw':
      return (n / 100) * env.width;
  }
  return null;
}

const CALC_TOKEN_RE = /\s*(var\(--[\w-]+\)|-?\d+(?:\.\d+)?[a-z%]*|-?\.\d+[a-z%]*|[()+*/-])/gy;

/** A tiny `calc()` evaluator: `+ - * /` with precedence and parentheses over lengths and vars. */
function evalCalc(expr: string, env: LengthEnv): number | null {
  const tokens: string[] = [];
  CALC_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null,
    consumed = 0;
  while ((match = CALC_TOKEN_RE.exec(expr))) {
    tokens.push(match[1]);
    consumed = CALC_TOKEN_RE.lastIndex;
  }
  if (consumed < expr.trimEnd().length) return null;

  let i = 0;
  const atom = (): number | null => {
    const token = tokens[i++];
    if (token === undefined) return null;
    if (token === '(') {
      const inner = sum();
      return tokens[i++] === ')' ? inner : null;
    }
    if (token === '-') {
      const inner = atom();
      return inner === null ? null : -inner;
    }
    if (token.startsWith('var(')) {
      switch (token) {
        case 'var(--overlay-width)':
          return env.width;
        case 'var(--overlay-height)':
          return env.height;
        case 'var(--cue-font-size)':
          return env.em;
        default:
          return null;
      }
    }
    return unitToPx(token, env);
  };
  const product = (): number | null => {
    let left = atom();
    while (left !== null && (tokens[i] === '*' || tokens[i] === '/')) {
      const op = tokens[i++],
        right = atom();
      if (right === null) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };
  const sum = (): number | null => {
    let left = product();
    while (left !== null && (tokens[i] === '+' || tokens[i] === '-')) {
      const op = tokens[i++],
        right = product();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const result = sum();
  return i === tokens.length ? result : null;
}

/** `linear-gradient(90deg, C1 50%, C2 50%)` (the SSA karaoke sweep) as its two colours. */
export function parseSweepGradient(value: string | undefined): { from: string; to: string } | null {
  const match = value && /^linear-gradient\((.*)\)$/s.exec(value.trim());
  if (!match) return null;
  const stops = splitTopLevel(match[1], ',').filter((part) => !/^\d+deg$|^to\b/.test(part));
  if (stops.length !== 2) return null;
  const color = (stop: string) =>
    splitTopLevel(stop)
      .filter((part) => !part.endsWith('%'))
      .join(' ');
  return { from: color(stops[0]), to: color(stops[1]) };
}

/** A parsed 2D transform. Angles in degrees, translations in pixels. */
export interface Transform2D {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}

export const IDENTITY: Transform2D = {
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
};

/**
 * Parses the transform functions the parsers emit (`translateX/Y`, `translate`, `scale`,
 * `scaleX/Y`, `rotate`) into one 2D transform. `rotateX`/`rotateY` (SSA `\frx`/`\fry`) have no 2D
 * equivalent and are ignored. Percent translations refer to `env.percentX/Y` (the box size).
 */
export function parseTransform(
  value: string | undefined,
  env: LengthEnv & { percentX: number; percentY: number },
): Transform2D {
  const t = { ...IDENTITY };
  if (!value || value === 'none') return t;
  for (const fn of splitTopLevel(value)) {
    const open = fn.indexOf('('),
      close = fn.lastIndexOf(')');
    if (open === -1 || close < open) continue;
    const args = fn
      .slice(open + 1, close)
      .split(',')
      .map((arg) => arg.trim());
    switch (fn.slice(0, open)) {
      case 'translateX':
        t.translateX += resolveLength(args[0], { ...env, percent: env.percentX }) ?? 0;
        break;
      case 'translateY':
        t.translateY += resolveLength(args[0], { ...env, percent: env.percentY }) ?? 0;
        break;
      case 'translate':
        t.translateX += resolveLength(args[0], { ...env, percent: env.percentX }) ?? 0;
        t.translateY += resolveLength(args[1] ?? '0', { ...env, percent: env.percentY }) ?? 0;
        break;
      case 'scale':
        t.scaleX *= parseFloat(args[0]);
        t.scaleY *= parseFloat(args[1] ?? args[0]);
        break;
      case 'scaleX':
        t.scaleX *= parseFloat(args[0]);
        break;
      case 'scaleY':
        t.scaleY *= parseFloat(args[0]);
        break;
      case 'rotate':
        t.rotate += parseAngle(args[0]);
        break;
    }
  }
  return t;
}

function parseAngle(value: string): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 0;
  if (value.endsWith('rad')) return (n * 180) / Math.PI;
  if (value.endsWith('turn')) return n * 360;
  return n;
}

/** `transform-origin` as pixels within a box (`50% 0%`, or the `calc()` form for SSA `\org`). */
export function parseTransformOrigin(
  value: string | undefined,
  env: LengthEnv,
  box: { width: number; height: number },
): [number, number] {
  if (!value) return [box.width / 2, box.height / 2];
  const parts = splitTopLevel(value);
  return [
    resolveLength(parts[0], { ...env, percent: box.width }) ?? box.width / 2,
    resolveLength(parts[1] ?? '50%', { ...env, percent: box.height }) ?? box.height / 2,
  ];
}

/** A text stroke or box outline: `<width> <color>`. */
export function parseStroke(
  value: string | undefined,
  env: LengthEnv,
): { width: number; color: string } | null {
  if (!value || value === '0' || value === 'none') return null;
  const parts = splitTopLevel(value);
  const width = resolveLength(parts[0], env);
  if (!width) return null;
  return { width, color: parts.slice(1).join(' ') || 'currentColor' };
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

/** The first shadow of a `text-shadow` list: `<x> <y> [blur] <color>`. */
export function parseShadow(value: string | undefined, env: LengthEnv): Shadow | null {
  if (!value || value === 'none') return null;
  const first = splitTopLevel(value, ',')[0],
    parts = splitTopLevel(first),
    lengths: number[] = [],
    colors: string[] = [];
  for (const part of parts) {
    const length = resolveLength(part, env);
    if (length !== null) lengths.push(length);
    else colors.push(part);
  }
  if (lengths.length < 2) return null;
  return {
    x: lengths[0],
    y: lengths[1],
    blur: lengths[2] ?? 0,
    color: colors.join(' ') || 'black',
  };
}

/**
 * `clip-path` as a polygon in box pixels. Handles the two shapes the parsers emit: `polygon()`
 * with `calc(var(--overlay-*) * K + T%)` or `%` points, and `inset(t r b l)`.
 */
export function parseClipPath(
  value: string | undefined,
  env: LengthEnv,
  box: { width: number; height: number },
): [number, number][] | null {
  if (!value || value === 'none') return null;
  const match = /^(polygon|inset)\((.*)\)$/s.exec(value.trim());
  if (!match) return null;
  if (match[1] === 'inset') {
    const sides = splitTopLevel(match[2]).map((side, i) =>
      resolveLength(side, { ...env, percent: i % 2 ? box.width : box.height }),
    );
    if (sides.some((side) => side === null)) return null;
    const [top, right = top!, bottom = top!, left = right] = sides as number[];
    return [
      [left, top!],
      [box.width - right, top!],
      [box.width - right, box.height - bottom],
      [left, box.height - bottom],
    ];
  }
  const points: [number, number][] = [];
  for (const pair of splitTopLevel(match[2], ',')) {
    const [x, y] = splitTopLevel(pair);
    const px = resolveLength(x, { ...env, percent: box.width }),
      py = resolveLength(y, { ...env, percent: box.height });
    if (px === null || py === null) return null;
    points.push([px, py]);
  }
  return points.length >= 3 ? points : null;
}

/** `url(...)` contents of a `background-image`, or null. */
export function parseImageURL(value: string | undefined): string | null {
  const match = value && /^url\((['"]?)(.*)\1\)$/s.exec(value.trim());
  return match ? match[2] : null;
}

/** Splits on a separator at parenthesis depth 0, trimming and dropping empties. */
export function splitTopLevel(value: string, separator = ' '): string[] {
  const parts: string[] = [];
  let depth = 0,
    current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (separator === ' ' ? /\s/.test(ch) : ch === separator)) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
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
