import type { VTTNode } from '../vtt/tokenize-cue';
import type { CueDrawing, CueSpanStyle } from '../vtt/vtt-cue';
import {
  parseShadow,
  parseStroke,
  parseSweepGradient,
  resolveLength,
  type LengthEnv,
  type Shadow,
} from './css-values';
import type { TextMeasurer } from './text-measurer';

/** Resolved style of one run of text. */
export interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  bgColor: string | null;
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  opacity: number;
  stroke: { width: number; color: string } | null | undefined;
  shadow: Shadow | null | undefined;
  transform?: string;
  transformOrigin?: string;
  drawing?: CueDrawing;
  /** `<c.s-KEY>` span key, the target of span animations. */
  spanKey?: string;
  /** The run follows a `<hh:mm:ss.ttt>` timestamp tag: past or future relative to media time. */
  timestamp?: number;
  /** Karaoke sweep: glyphs fill from `to` (unsung) to `from` (sung) as the span animation runs. */
  sweep?: { from: string; to: string };
}

export interface Run {
  text: string;
  style: RunStyle;
  width: number;
}

export interface Line {
  runs: Run[];
  width: number;
}

export interface CueFlow {
  lines: Line[];
  /** Widest line. */
  width: number;
  height: number;
  lineHeight: number;
}

export interface FlowOptions {
  /** Wrap width in pixels, or `null` for no wrapping. */
  maxWidth: number | null;
  lineHeight: number;
  measurer: TextMeasurer;
  env: LengthEnv;
  /** Colours for `<c.CLASS>` tags. */
  classColors: Record<string, string>;
  /** Even out line lengths like `text-wrap: balance` (applied to 2 to 6 lines). */
  balance?: boolean;
}

interface Segment {
  text: string;
  style: RunStyle;
  width: number;
  /** Whitespace: collapsible at line edges and a break opportunity. */
  space: boolean;
  /** Forced line break. */
  br?: boolean;
}

export function fontString(style: RunStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px ${style.fontFamily}`;
}

/**
 * Lays out cue text into lines: walks the WebVTT token tree applying inline styles, splits into
 * words, wraps greedily at the width (breaking words that do not fit, like `overflow-wrap:
 * anywhere`), optionally balances, and merges same-styled words into runs.
 */
export function flowCue(tokens: VTTNode[], base: RunStyle, options: FlowOptions): CueFlow {
  const segments: Segment[] = [];
  collect(tokens, base, options, segments);

  let lines = wrap(segments, options.maxWidth);

  if (
    options.balance !== false &&
    options.maxWidth !== null &&
    lines.length > 1 &&
    lines.length <= 6
  ) {
    const target = lines.length,
      widest = Math.max(...segments.filter((s) => !s.space).map((s) => s.width), 0);
    let lo = widest,
      hi = options.maxWidth,
      best = lines;
    for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2,
        attempt = wrap(segments, mid);
      if (attempt.length <= target) {
        best = attempt;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    lines = best;
  }

  const merged = lines.map(mergeRuns),
    width = Math.max(0, ...merged.map((line) => line.width));
  return {
    lines: merged,
    width,
    height: merged.length * options.lineHeight,
    lineHeight: options.lineHeight,
  };
}

function collect(tokens: VTTNode[], base: RunStyle, options: FlowOptions, out: Segment[]) {
  // A timestamp tag applies to the siblings that follow it.
  let style = base;
  for (const token of tokens) {
    if (token.type === 'text') {
      pushText(token.data, style, options, out);
      continue;
    }
    // The tokenizer nests the text that follows a timestamp inside the timestamp node.
    if (token.type === 'timestamp') style = { ...style, timestamp: token.time };

    const next = { ...style };
    switch (token.type) {
      case 'b':
        next.bold = true;
        break;
      case 'i':
        next.italic = true;
        break;
      case 'u':
        next.underline = true;
        break;
      case 'rt':
        // Ruby text is drawn inline at a smaller size (a simplification of `ruby-position`).
        next.fontSize = style.fontSize * 0.6;
        break;
    }
    if (token.color) next.color = options.classColors[token.color] ?? token.color;
    if (token.bgColor) next.bgColor = options.classColors[token.bgColor] ?? token.bgColor;
    if (token.class) {
      for (const name of token.class.split(' ')) {
        if (options.classColors[name]) next.color = options.classColors[name];
        if (name === 'pen-small') next.fontSize = style.fontSize * 0.8;
        if (name === 'pen-large') next.fontSize = style.fontSize * 1.25;
      }
    }
    if (token.span) applySpan(next, token.span, options.env, token.spanKey);

    if (token.span?.drawing) {
      const { drawing } = token.span,
        width = (drawing.width / 100) * options.env.width;
      out.push({ text: '', style: next, width, space: false });
    }

    collect(token.children, next, options, out);
  }
}

function applySpan(style: RunStyle, span: CueSpanStyle, env: LengthEnv, spanKey?: string) {
  const local = { ...env, em: style.fontSize };
  if (span.color) style.color = span.color;
  if (span.backgroundColor) style.bgColor = span.backgroundColor;
  if (span.fontFamily) style.fontFamily = span.fontFamily;
  const size = resolveLength(span.fontSize, local);
  if (size) style.fontSize = size;
  if (span.fontWeight) style.bold = span.fontWeight === 'bold' || parseInt(span.fontWeight) >= 600;
  if (span.fontStyle) style.italic = span.fontStyle === 'italic' || span.fontStyle === 'oblique';
  if (span.textDecoration) {
    style.underline = span.textDecoration.includes('underline');
    style.strike = span.textDecoration.includes('line-through');
  }
  const spacing = resolveLength(span.letterSpacing, { ...local, em: style.fontSize });
  if (spacing !== null) style.letterSpacing = spacing;
  if (span.textStroke !== undefined)
    style.stroke = parseStroke(span.textStroke, { ...local, em: style.fontSize });
  if (span.textShadow !== undefined)
    style.shadow = parseShadow(span.textShadow, { ...local, em: style.fontSize });
  if (span.opacity !== undefined) style.opacity *= parseFloat(span.opacity) || 0;
  if (span.transform) style.transform = span.transform;
  if (span.transformOrigin) style.transformOrigin = span.transformOrigin;
  if (span.className) {
    for (const name of span.className.split(' ')) {
      if (name === 'pen-small') style.fontSize *= 0.8;
      if (name === 'pen-large') style.fontSize *= 1.25;
    }
  }
  if (span.drawing) style.drawing = span.drawing;
  if (spanKey) style.spanKey = spanKey;
  if (span.backgroundClip === 'text') {
    const sweep = parseSweepGradient(span.backgroundImage);
    if (sweep) {
      style.sweep = sweep;
      // The gradient is the fill; the transparent `color` only exists to let it show through.
      style.color = sweep.from;
    }
  }
}

const WORD_RE = /(\n)|(\s+)|(\S+)/g;

function pushText(text: string, style: RunStyle, options: FlowOptions, out: Segment[]) {
  const font = fontString(style);
  for (const match of text.matchAll(WORD_RE)) {
    if (match[1]) {
      out.push({ text: '', style, width: 0, space: false, br: true });
    } else if (match[2]) {
      const spaces = match[2].replace(/\n/g, '');
      if (spaces) {
        out.push({
          text: spaces,
          style,
          width: options.measurer.measureText(spaces, font, style.letterSpacing),
          space: true,
        });
      }
    } else {
      out.push({
        text: match[3],
        style,
        width: options.measurer.measureText(match[3], font, style.letterSpacing),
        space: false,
      });
    }
  }
}

function wrap(segments: Segment[], maxWidth: number | null): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [],
    width = 0;

  const flush = () => {
    while (line.length && line[line.length - 1].space) width -= line.pop()!.width;
    lines.push(line);
    line = [];
    width = 0;
  };

  for (const segment of segments) {
    if (segment.br) {
      flush();
      continue;
    }
    if (segment.space && !line.length) continue;

    if (maxWidth !== null && !segment.space && line.length && width + segment.width > maxWidth) {
      flush();
    }

    if (maxWidth !== null && !segment.space && segment.width > maxWidth && !segment.style.drawing) {
      // A word wider than the line: break it wherever it overflows.
      for (const piece of splitToFit(segment, maxWidth)) {
        if (line.length && width + piece.width > maxWidth) flush();
        line.push(piece);
        width += piece.width;
      }
      continue;
    }

    line.push(segment);
    width += segment.width;
  }
  if (line.length || !lines.length) flush();
  return lines;
}

function splitToFit(segment: Segment, maxWidth: number): Segment[] {
  // Widths are proportional to the measured whole; good enough to place the breaks.
  const pieces: Segment[] = [],
    perChar = segment.width / segment.text.length,
    count = Math.max(1, Math.floor(maxWidth / perChar));
  for (let i = 0; i < segment.text.length; i += count) {
    const text = segment.text.slice(i, i + count);
    pieces.push({ ...segment, text, width: text.length * perChar });
  }
  return pieces;
}

function mergeRuns(segments: Segment[]): Line {
  const runs: Run[] = [];
  for (const segment of segments) {
    const last = runs[runs.length - 1];
    if (last && last.style === segment.style && !segment.style.drawing) {
      last.text += segment.text;
      last.width += segment.width;
    } else {
      runs.push({ text: segment.text, style: segment.style, width: segment.width });
    }
  }
  return { runs, width: runs.reduce((sum, run) => sum + run.width, 0) };
}
