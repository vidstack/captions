import type { VTTNode } from '../vtt/tokenize-cue';
import type {
  CueDrawing,
  CueShadow,
  CueSpanStyle,
  CueStroke,
  CueSweep,
  CueTransform,
} from '../vtt/vtt-cue';
import type { TextMeasurer } from './text-measurer';
import { lengthToPx, type LengthEnv } from './values';

/** A stroke or shadow resolved to pixels. */
export interface PxStroke {
  width: number;
  color: string;
}

export interface PxShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

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
  /** `undefined` inherits the cue's; `null` is none. */
  stroke: PxStroke | null | undefined;
  shadow: PxShadow | null | undefined;
  transform?: CueTransform;
  drawing?: CueDrawing;
  /** `<c.s-KEY>` span key, the target of span animations. */
  spanKey?: string;
  /** The run follows a `<hh:mm:ss.ttt>` timestamp tag: past or future relative to media time. */
  timestamp?: number;
  /** Karaoke sweep: glyphs fill from `unsung` to `sung` as the span animation runs. */
  sweep?: CueSweep;
}

/** `<rt>` text drawn over (horizontal) or beside (vertical) its ruby base. */
export interface RubyAnnotation {
  text: string;
  /** Advance along the line at the annotation's (halved) font size. */
  width: number;
  style: RunStyle;
  upright?: boolean;
}

export interface Run {
  text: string;
  style: RunStyle;
  /**
   * Advance along the line: horizontal width, or the column advance for vertical text. A ruby run
   * advances by the wider of its base and its annotation; the narrower one is centred.
   */
  width: number;
  /** Vertical text: glyphs stand upright (CJK) rather than rotated sideways (Latin). */
  upright?: boolean;
  ruby?: RubyAnnotation;
  /** Advance of the base text alone when `ruby` is set. */
  baseWidth?: number;
}

export interface Line {
  runs: Run[];
  width: number;
  /**
   * Line box height: the line height, grown for the largest run like the browser grows a line box
   * around a larger inline span (`line-height` is a factor, so a `\fs` span scales it).
   */
  height: number;
  /**
   * Height of the ruby annotation band drawn above the line (beside the column for vertical text),
   * 0 without `<ruby>`. Chromium lets annotations overflow the line box rather than grow it (with
   * the default half-size annotations the box grows by about a pixel), so this does not add to
   * `CueFlow.height`; the band lands in the cue's padding. Firefox and WebKit grow the line box by
   * about the band instead.
   */
  rubyHeight: number;
}

export interface CueFlow {
  lines: Line[];
  /** Widest line. */
  width: number;
  /** Lines times the line height; for vertical text the width of all columns. */
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
  /**
   * Vertical writing: lines are columns, advances run down the column. CJK glyphs stand upright
   * one em each; other scripts are rotated sideways and advance by their horizontal width
   * (`text-orientation: mixed`).
   */
  vertical?: boolean;
}

interface Segment {
  text: string;
  style: RunStyle;
  width: number;
  upright?: boolean;
  ruby?: RubyAnnotation;
  baseWidth?: number;
  /** Whitespace: collapsible at line edges and a break opportunity. */
  space: boolean;
  /** Forced line break. */
  br?: boolean;
}

/** Ruby annotation size relative to its base (browser default `font-size: 50%`). */
const RUBY_SCALE = 0.5;

export function fontString(style: RunStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px ${style.fontFamily}`;
}

export function strokePx(
  stroke: CueStroke | null | undefined,
  env: LengthEnv,
): PxStroke | null | undefined {
  if (stroke === undefined) return undefined;
  if (stroke === null) return null;
  const width = lengthToPx(stroke.width, env) ?? 0;
  return width > 0 ? { width, color: stroke.color } : null;
}

export function shadowPx(
  shadow: CueShadow | null | undefined,
  env: LengthEnv,
): PxShadow | null | undefined {
  if (shadow === undefined) return undefined;
  if (shadow === null) return null;
  return {
    x: lengthToPx(shadow.x, env) ?? 0,
    y: lengthToPx(shadow.y, env) ?? 0,
    blur: lengthToPx(shadow.blur, env) ?? 0,
    color: shadow.color,
  };
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

  const merged = lines.map((line) => mergeRuns(line, options.lineHeight, base.fontSize)),
    width = Math.max(0, ...merged.map((line) => line.width));
  return {
    lines: merged,
    width,
    height: merged.reduce((sum, line) => sum + line.height, 0),
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

    if (token.type === 'ruby') {
      pushRuby(token, style, options, out);
      continue;
    }

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
        // Only meaningful inside `<ruby>` (handled by `pushRuby`); the tokenizer drops it elsewhere.
        continue;
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

/**
 * `<ruby>base<rt>annotation</rt></ruby>`: the base is one unbreakable segment (its first style
 * wins) carrying the annotation, which is flowed at half size. Without `<rt>` the children flow
 * normally.
 */
function pushRuby(
  token: Extract<VTTNode, { type: 'ruby' }>,
  style: RunStyle,
  options: FlowOptions,
  out: Segment[],
) {
  const base: Segment[] = [],
    annotation: Segment[] = [],
    rtStyle: RunStyle = { ...style, fontSize: style.fontSize * RUBY_SCALE };
  for (const child of token.children) {
    if (child.type === 'rt') collect(child.children, rtStyle, options, annotation);
    else collect([child], style, options, base);
  }
  const bases = base.filter((s) => !s.br),
    rts = annotation.filter((s) => !s.br);
  if (!rts.length || !bases.length) {
    out.push(...bases);
    return;
  }
  const sum = (segments: Segment[]) => segments.reduce((total, s) => total + s.width, 0),
    text = (segments: Segment[]) => segments.map((s) => s.text).join(''),
    baseWidth = sum(bases),
    ruby: RubyAnnotation = { text: text(rts), width: sum(rts), style: rts[0].style },
    segment: Segment = {
      text: text(bases),
      style: bases[0].style,
      width: Math.max(baseWidth, ruby.width),
      baseWidth,
      ruby,
      space: false,
    };
  if (options.vertical) {
    if (bases.every((s) => s.upright)) segment.upright = true;
    if (rts.every((s) => s.upright)) ruby.upright = true;
  }
  out.push(segment);
}

function applySpan(style: RunStyle, span: CueSpanStyle, env: LengthEnv, spanKey?: string) {
  const local = { ...env, em: style.fontSize };
  if (span.color) style.color = span.color;
  if (span.backgroundColor) style.bgColor = span.backgroundColor;
  if (span.fontFamily) style.fontFamily = span.fontFamily;
  const size = lengthToPx(span.fontSize, local);
  if (size) style.fontSize = size;
  const runEnv = { ...local, em: style.fontSize };
  if (span.fontWeight !== undefined) style.bold = span.fontWeight >= 600;
  if (span.italic !== undefined) style.italic = span.italic;
  if (span.underline !== undefined) style.underline = span.underline;
  if (span.strike !== undefined) style.strike = span.strike;
  const spacing = lengthToPx(span.letterSpacing, runEnv);
  if (spacing !== null) style.letterSpacing = spacing;
  if (span.stroke !== undefined) style.stroke = strokePx(span.stroke, runEnv);
  if (span.shadow !== undefined) style.shadow = shadowPx(span.shadow, runEnv);
  if (span.opacity !== undefined) style.opacity *= span.opacity;
  if (span.transform) style.transform = span.transform;
  if (span.className) {
    for (const name of span.className.split(' ')) {
      if (name === 'pen-small') style.fontSize *= 0.8;
      if (name === 'pen-large') style.fontSize *= 1.25;
    }
  }
  if (span.drawing) style.drawing = span.drawing;
  if (spanKey) style.spanKey = spanKey;
  if (span.sweep) {
    style.sweep = span.sweep;
    style.color = span.sweep.sung;
  }
}

// A line break, a run of other whitespace, or a word. Newlines are matched on their own so
// `a \n b` breaks the line (`white-space: pre-line`) instead of collapsing into one space.
const WORD_RE = /(\n)|([^\S\n]+)|(\S+)/g,
  // Vertical text: a line break, whitespace, one upright (CJK / fullwidth) glyph, or a run of
  // anything else, which is drawn sideways.
  UPRIGHT =
    '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3000-\\u303F\\uFF00-\\uFFEF',
  VERTICAL_RE = new RegExp(`(\\n)|([^\\S\\n]+)|([${UPRIGHT}])|([^\\s${UPRIGHT}]+)`, 'gu');

function pushText(text: string, style: RunStyle, options: FlowOptions, out: Segment[]) {
  const font = fontString(style);
  if (options.vertical) {
    for (const match of text.matchAll(VERTICAL_RE)) {
      if (match[1]) {
        out.push({ text: '', style, width: 0, space: false, br: true });
      } else if (match[2]) {
        out.push({
          text: match[2],
          style,
          width: options.measurer.measureText(match[2], font, style.letterSpacing),
          space: true,
        });
      } else if (match[3]) {
        out.push({ text: match[3], style, width: style.fontSize, space: false, upright: true });
      } else {
        out.push({
          text: match[4],
          style,
          width: options.measurer.measureText(match[4], font, style.letterSpacing),
          space: false,
        });
      }
    }
    return;
  }
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

    if (
      maxWidth !== null &&
      !segment.space &&
      segment.width > maxWidth &&
      !segment.style.drawing &&
      !segment.ruby
    ) {
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

function mergeRuns(segments: Segment[], lineHeight: number, baseFontSize: number): Line {
  const runs: Run[] = [];
  let rubyHeight = 0,
    height = lineHeight;
  for (const segment of segments) {
    const last = runs[runs.length - 1];
    if (
      last &&
      !last.ruby &&
      !segment.ruby &&
      last.style === segment.style &&
      !!last.upright === !!segment.upright &&
      !segment.style.drawing
    ) {
      last.text += segment.text;
      last.width += segment.width;
    } else {
      const run: Run = { text: segment.text, style: segment.style, width: segment.width };
      if (segment.upright) run.upright = true;
      if (segment.ruby) {
        run.ruby = segment.ruby;
        run.baseWidth = segment.baseWidth;
        rubyHeight = Math.max(rubyHeight, segment.ruby.style.fontSize);
      }
      if (!segment.style.drawing && baseFontSize > 0) {
        height = Math.max(height, (segment.style.fontSize / baseFontSize) * lineHeight);
      }
      runs.push(run);
    }
  }
  return { runs, width: runs.reduce((sum, run) => sum + run.width, 0), height, rubyHeight };
}
