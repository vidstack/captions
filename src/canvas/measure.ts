import type { Box } from '../vtt/overlay/box';
import type { CueLayoutInput, RegionLayoutInput } from '../vtt/overlay/layout';
import {
  computeCueLine,
  computeCuePosition,
  computeCuePositionAlignment,
} from '../vtt/overlay/position-cue';
import { tokenizeVTTCue } from '../vtt/tokenize-cue';
import type { VTTCue } from '../vtt/vtt-cue';
import type { VTTRegion } from '../vtt/vtt-region';
import {
  parseImageURL,
  parseShadow,
  parseStroke,
  resolveLength,
  type LengthEnv,
  type Shadow,
} from './css-values';
import { flowCue, type CueFlow, type RunStyle } from './flow';
import type { TextMeasurer } from './text-measurer';
import type { CanvasTheme } from './theme';

/** Cue-level presentation resolved to pixels and plain values. */
export interface ResolvedCueStyle {
  fontSize: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  color: string;
  backgroundColor: string;
  textAlign: 'left' | 'center' | 'right';
  stroke: { width: number; color: string } | null;
  shadow: Shadow | null;
  outline: { width: number; color: string } | null;
  opacity: number;
  transform?: string;
  transformOrigin?: string;
  imageURL: string | null;
  clipPath?: string;
}

/** A cue measured headlessly: its text flow, boxes, and layout input. */
export interface MeasuredCue {
  cue: VTTCue;
  flow: CueFlow;
  /** Display box in container pixels before layout (regions: relative to the region). */
  box: Box;
  /** The painted text box within the display box. */
  textBox: { left: number; top: number; width: number; height: number };
  input: CueLayoutInput;
  style: ResolvedCueStyle;
  /** The region this cue renders in, when it applies. */
  region: VTTRegion | null;
}

const POSITION_KEYS = ['left', 'top', 'right', 'bottom', 'transform', 'translate'];

/** Whether a region applies to a cue (the WebVTT rule the DOM regions feature uses). */
export function regionOf(cue: VTTCue): VTTRegion | null {
  return cue.region && cue.size === 100 && cue.vertical === '' && cue.line === 'auto'
    ? cue.region
    : null;
}

/**
 * MEASURE phase without a DOM: resolves the cue's presentation, flows its text, and produces the
 * same `CueLayoutInput` the DOM measurer would, so the pure layout engine positions both alike.
 * Vertical cues are laid out horizontally (a known limitation of the canvas writer).
 */
export function measureCue(
  cue: VTTCue,
  theme: CanvasTheme,
  measurer: TextMeasurer,
  region: VTTRegion | null = regionOf(cue),
): MeasuredCue {
  const { container } = theme,
    text = cue.textStyle,
    layout = cue.layout,
    env: LengthEnv = { width: container.width, height: container.height, em: theme.fontSize };

  const fontSize = resolveLength(text?.fontSize, env) || theme.fontSize,
    fontEnv = { ...env, em: fontSize },
    lineHeight =
      text?.lineHeight && text.lineHeight !== 'normal'
        ? (resolveLength(text.lineHeight, fontEnv) ?? fontSize * 1.2)
        : text?.lineHeight === 'normal'
          ? fontSize * 1.2
          : theme.lineHeight,
    paddingX = resolveLength(cue.style?.['--cue-padding-x'], env) ?? theme.paddingX,
    paddingY =
      resolveLength(text?.paddingY ?? cue.style?.['--cue-padding-y'], env) ?? theme.paddingY;

  const style: ResolvedCueStyle = {
    fontSize,
    lineHeight,
    paddingX,
    paddingY,
    color: text?.color ?? theme.color,
    backgroundColor: text?.backgroundColor ?? theme.backgroundColor,
    textAlign: resolveAlign(text?.textAlign ?? cue.align, theme.dir),
    stroke: text?.textStroke ? parseStroke(text.textStroke, fontEnv) : themeStroke(theme, fontSize),
    shadow: text?.textShadow ? parseShadow(text.textShadow, fontEnv) : themeShadow(theme, fontSize),
    outline: parseStroke(text?.outline, fontEnv),
    opacity: text?.opacity !== undefined ? parseFloat(text.opacity) : 1,
    transform: text?.transform,
    transformOrigin: text?.transformOrigin,
    imageURL: parseImageURL(text?.backgroundImage),
    clipPath: layout?.clipPath,
  };

  // --- Width and horizontal position -------------------------------------------------------
  const pct = (v: number | undefined, size: number) =>
    v === undefined ? undefined : (v / 100) * size;
  let width: number | null = null,
    left = 0,
    regionOffset = 0;

  if (region) {
    width = pct(region.width, container.width)!;
    const position = computeCuePosition(cue, theme.dir),
      alignment = computeCuePositionAlignment(cue, theme.dir);
    regionOffset =
      ((position - (alignment === 'line-right' ? 100 : alignment === 'center' ? 50 : 0)) / 100) *
      width;
  } else if (layout?.width !== undefined || cue.style?.['--cue-width']) {
    const raw = cue.style?.['--cue-width'];
    if (typeof layout?.width === 'number') width = pct(layout.width, container.width)!;
    else if (layout?.width === 'auto') {
      width =
        layout.left !== undefined && layout.right !== undefined
          ? container.width -
            pct(layout.left, container.width)! -
            pct(layout.right, container.width)!
          : container.width;
    } else if (raw) width = resolveLength(raw, { ...env, percent: container.width });
    // 'max-content' keeps `width` null: the box hugs the text.
  } else {
    // https://www.w3.org/TR/webvtt1/#processing-cue-settings
    const position = computeCuePosition(cue, theme.dir),
      alignment = computeCuePositionAlignment(cue, theme.dir);
    let maxSize = position;
    if (alignment === 'line-left') maxSize = 100 - position;
    else if (alignment === 'center' && position <= 50) maxSize = position * 2;
    else if (alignment === 'center' && position > 50) maxSize = (100 - position) * 2;
    const size = cue.size < maxSize ? cue.size : maxSize;
    width = (size / 100) * container.width;
    left =
      ((position - (alignment === 'line-right' ? size : alignment === 'center' ? size / 2 : 0)) /
        100) *
      container.width;
  }

  const maxWidth = pct(layout?.maxWidth, container.width),
    noWrap = text?.whiteSpace === 'pre' || text?.whiteSpace === 'nowrap',
    wrapWidth = noWrap
      ? null
      : width !== null
        ? Math.max(0, Math.min(width, maxWidth ?? Infinity) - 2 * paddingX)
        : maxWidth !== undefined
          ? Math.max(0, maxWidth - 2 * paddingX)
          : null;

  // --- Text flow ---------------------------------------------------------------------------
  const base: RunStyle = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: style.color,
    bgColor: null,
    fontFamily: text?.fontFamily ?? theme.fontFamily,
    fontSize,
    letterSpacing: resolveLength(text?.letterSpacing, fontEnv) ?? 0,
    opacity: 1,
    stroke: undefined,
    shadow: undefined,
  };
  if (text?.fontWeight) base.bold = text.fontWeight === 'bold' || parseInt(text.fontWeight) >= 600;
  if (text?.fontStyle) base.italic = text.fontStyle === 'italic' || text.fontStyle === 'oblique';
  if (text?.textDecoration) {
    base.underline = text.textDecoration.includes('underline');
    base.strike = text.textDecoration.includes('line-through');
  }

  const flow = flowCue(tokenizeVTTCue(cue), base, {
    maxWidth: wrapWidth,
    lineHeight,
    measurer,
    env: fontEnv,
    classColors: theme.classColors,
    balance: !region,
  });

  // --- Boxes -------------------------------------------------------------------------------
  const hasText = flow.width > 0 || flow.lines.some((line) => line.runs.length),
    textWidth = hasText ? flow.width + 2 * paddingX : 0,
    textHeight = hasText ? flow.height + 2 * paddingY : 0,
    displayWidth = Math.max(width ?? textWidth, textWidth),
    displayHeight =
      layout?.height !== undefined ? pct(layout.height, container.height)! : textHeight;

  const textBox = {
    left:
      style.textAlign === 'left'
        ? 0
        : style.textAlign === 'right'
          ? displayWidth - textWidth
          : (displayWidth - textWidth) / 2,
    top: 0,
    width: style.imageURL && !hasText ? displayWidth : textWidth,
    height: style.imageURL && !hasText ? displayHeight : textHeight,
  };

  let top = 0,
    positionOverride: CueLayoutInput['positionOverride'] = false;
  if (!region) {
    if (layout?.left !== undefined) left = pct(layout.left, container.width)!;
    else if (layout?.right !== undefined) {
      left = container.width - pct(layout.right, container.width)! - displayWidth;
    }
    if (layout?.top !== undefined) {
      top = pct(layout.top, container.height)!;
      positionOverride = 'top';
    } else if (layout?.bottom !== undefined) {
      top = container.height - pct(layout.bottom, container.height)! - displayHeight;
      positionOverride = 'bottom';
    }
    // The anchor translation is a fraction of the box itself; fold it in.
    left += (layout?.translate?.x ?? 0) * displayWidth;
    top += (layout?.translate?.y ?? 0) * displayHeight;
  } else {
    left = regionOffset;
  }

  const box: Box = {
    left,
    top,
    width: displayWidth,
    height: displayHeight,
    right: left + displayWidth,
    bottom: top + displayHeight,
  };

  const fixed =
    !!layout?.fixed ||
    !!cue.animations?.some(
      (anim) =>
        (anim.target ?? 'display') === 'display' &&
        anim.keyframes.some((frame) => POSITION_KEYS.some((key) => key in frame)),
    );

  return {
    cue,
    flow,
    box,
    textBox,
    style,
    region,
    input: {
      kind: 'cue',
      box: { ...box },
      lineHeight: theme.lineStep === 'box' ? displayHeight : lineHeight,
      snapToLines: cue.snapToLines,
      line: computeCueLine(cue),
      lineAlign: cue.lineAlign,
      vertical: '',
      fixed,
      positionOverride,
    },
  };
}

export interface MeasuredRegion {
  region: VTTRegion;
  /** Region box in container pixels before layout. */
  box: Box;
  input: RegionLayoutInput;
  /** Cues currently shown, oldest first (the last `region.lines` of them). */
  visible: MeasuredCue[];
  /** Height of each visible cue as stacked (1px gap like the stylesheet). */
  rowHeights: number[];
}

/** Region geometry from its anchors and the cues it currently holds. */
export function measureRegion(
  region: VTTRegion,
  cues: MeasuredCue[],
  theme: CanvasTheme,
): MeasuredRegion {
  const { container } = theme,
    width = (region.width / 100) * container.width,
    visible = cues.slice(Math.max(0, cues.length - region.lines)),
    rowHeights = visible.map((cue) => cue.box.height + 1),
    height = rowHeights.reduce((sum, h) => sum + h, 0),
    left = (region.viewportAnchorX / 100) * container.width - (region.regionAnchorX / 100) * width,
    top = (region.viewportAnchorY / 100) * container.height - (region.regionAnchorY / 100) * height;

  const box: Box = { left, top, width, height, right: left + width, bottom: top + height };
  return { region, box, input: { kind: 'region', box: { ...box } }, visible, rowHeights };
}

function resolveAlign(
  align: 'left' | 'center' | 'right' | 'start' | 'end',
  dir: 'ltr' | 'rtl',
): 'left' | 'center' | 'right' {
  if (align === 'start') return dir === 'ltr' ? 'left' : 'right';
  if (align === 'end') return dir === 'ltr' ? 'right' : 'left';
  return align;
}

function themeStroke(theme: CanvasTheme, fontSize: number) {
  return theme.edgeStyle === 'uniform' ? { width: 0.08 * fontSize, color: theme.edgeColor } : null;
}

function themeShadow(theme: CanvasTheme, fontSize: number): Shadow | null {
  const em = fontSize,
    color = theme.edgeColor;
  switch (theme.edgeStyle) {
    case 'drop-shadow':
      return { x: 0.06 * em, y: 0.06 * em, blur: 0.12 * em, color };
    case 'raised':
      return { x: 0.04 * em, y: 0.04 * em, blur: 0, color };
    case 'depressed':
      return { x: -0.04 * em, y: -0.04 * em, blur: 0, color };
    default:
      return null;
  }
}
