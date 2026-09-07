import type { StackingMode } from '../vtt/overlay/ordering';

/**
 * Presentation defaults, mirroring `styles/captions.css` so the canvas and DOM writers agree on
 * geometry: 5% of the height for the font, 1.2 line height, 0.6em/0.4em padding, a 1% safe area,
 * white on translucent black.
 */
export interface CanvasCaptionsOptions {
  /** CSS font family list. */
  fontFamily?: string;
  /** Font size as a fraction of the frame height (`0.05` = the stylesheet's 5%). */
  fontSize?: number;
  /** Line height as a multiple of the font size. */
  lineHeight?: number;
  /** Horizontal / vertical cue box padding in em. */
  paddingX?: number;
  paddingY?: number;
  /** Inset from the frame edges as a fraction of the frame width (the stylesheet's 1% margin). */
  safeArea?: number;
  color?: string;
  backgroundColor?: string;
  /** FCC / CVAA edge style presets, as `data-edge-style` on the DOM overlay. */
  edgeStyle?: 'none' | 'uniform' | 'drop-shadow' | 'raised' | 'depressed';
  edgeColor?: string;
  /** Colours for `<c.CLASS>` tags (the stylesheet leaves these to the host). */
  classColors?: Record<string, string>;
  /** Colours for text after a `<hh:mm:ss.ttt>` timestamp tag (karaoke), by whether it has passed. */
  timedColors?: { past?: string; future?: string };
  /** Text direction for `start`/`end` alignment. */
  dir?: 'ltr' | 'rtl';
  /** See `CaptionsRendererInit.stacking`. */
  stacking?: StackingMode;
  /** See `CaptionsRendererInit.lineStep`. */
  lineStep?: 'line-height' | 'box';
  /** Hold animations at their final state. */
  reducedMotion?: boolean;
}

/** Options resolved to pixels for one frame size. */
export interface CanvasTheme {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  color: string;
  backgroundColor: string;
  edgeStyle: NonNullable<CanvasCaptionsOptions['edgeStyle']>;
  edgeColor: string;
  classColors: Record<string, string>;
  timedColors: { past?: string; future?: string };
  dir: 'ltr' | 'rtl';
  stacking: StackingMode;
  lineStep: 'line-height' | 'box';
  reducedMotion: boolean;
  /** Container box (frame minus safe area) in frame pixels. */
  container: { left: number; top: number; width: number; height: number };
}

/** CEA-608 / WebVTT class colour names the tokenizer recognises. */
const DEFAULT_CLASS_COLORS: Record<string, string> = {
  white: 'white',
  lime: 'lime',
  cyan: 'cyan',
  red: 'red',
  yellow: 'yellow',
  magenta: 'magenta',
  blue: 'blue',
  black: 'black',
};

export function resolveTheme(
  options: CanvasCaptionsOptions,
  width: number,
  height: number,
): CanvasTheme {
  const safe = (options.safeArea ?? 0.01) * width,
    container = { left: safe, top: safe, width: width - 2 * safe, height: height - 2 * safe },
    fontSize = (options.fontSize ?? 0.05) * container.height;
  return {
    fontFamily: options.fontFamily ?? 'sans-serif',
    fontSize,
    lineHeight: (options.lineHeight ?? 1.2) * fontSize,
    paddingX: (options.paddingX ?? 0.6) * fontSize,
    paddingY: (options.paddingY ?? 0.4) * fontSize,
    color: options.color ?? 'white',
    backgroundColor: options.backgroundColor ?? 'rgba(0, 0, 0, 0.8)',
    edgeStyle: options.edgeStyle ?? 'none',
    edgeColor: options.edgeColor ?? 'black',
    classColors: { ...DEFAULT_CLASS_COLORS, ...options.classColors },
    timedColors: options.timedColors ?? {},
    dir: options.dir ?? 'ltr',
    stacking: options.stacking ?? 'reading-order',
    lineStep: options.lineStep ?? 'line-height',
    reducedMotion: options.reducedMotion ?? false,
    container,
  };
}
