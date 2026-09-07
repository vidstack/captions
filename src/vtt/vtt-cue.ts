import { IS_SERVER } from '../utils/env';
import { TextCue } from './text-cue';
import type { VTTRegion } from './vtt-region';

// Fall back to our own implementation on the server and in DOM environments that do not ship a
// native `VTTCue` (e.g., jsdom, happy-dom, some WebViews).
const IS_NATIVE = !IS_SERVER && typeof window.VTTCue === 'function',
  CueBase: typeof TextCue = IS_NATIVE ? (window.VTTCue as any) : TextCue,
  // Native cues reject non-finite times; open-ended (live) cues store this internally and report
  // `Infinity`.
  OPEN_END_SENTINEL = Number.MAX_VALUE,
  OPEN_END = Symbol(__DEV__ ? 'OPEN_END' : 0);

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#model-cues}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue}
 */
export class VTTCue extends CueBase {
  /** Set when the cue is open-ended on the native base (see `OPEN_END_SENTINEL`). */
  declare [OPEN_END]?: boolean;

  constructor(startTime: number, endTime: number, text: string) {
    // Only the native base rejects non-finite times; the fallback stores Infinity directly.
    const open = IS_NATIVE && !Number.isFinite(endTime);
    super(startTime, open ? OPEN_END_SENTINEL : endTime, text);
    if (open) this[OPEN_END] = true;
  }

  /**
   * A `VTTRegion` object describing the video's sub-region that the cue will be drawn onto,
   * or `null` if none is assigned.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/region}
   */
  region: VTTRegion | null = null;
  /**
   * The cue writing direction.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/vertical}
   */
  vertical: '' | 'rl' | 'lr' = '';
  /**
   * Returns `true` if the `VTTCue.line` attribute is an integer number of lines or a percentage
   * of the video size.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/snapToLines}
   */
  snapToLines = true;
  /**
   * Returns the line positioning of the cue. This can be the string `'auto'` or a number whose
   * interpretation depends on the value of `VTTCue.snapToLines`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/line}
   */
  line: number | 'auto' = 'auto';
  /**
   * Returns an enum representing the alignment of the `VTTCue.line`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/lineAlign}
   */
  lineAlign: 'start' | 'center' | 'end' = 'start';
  /**
   * Returns the indentation of the cue within the line. This can be the string `'auto'` or a
   * number representing the percentage of the `VTTCue.region`, or the video size if `VTTCue`.region`
   * is `null`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/position}
   */
  position: number | 'auto' = 'auto';
  /**
   * Returns an enum representing the alignment of the cue. This is used to determine what
   * the `VTTCue.position` is anchored to. The default is `'auto'`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/positionAlign}
   */
  positionAlign: 'line-left' | 'center' | 'line-right' | 'auto' = 'auto';
  /**
   * Returns a double representing the size of the cue, as a percentage of the video size.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/size}
   */
  size = 100;
  /**
   * Returns an enum representing the alignment of all the lines of text within the cue box.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/align}
   */
  align: 'start' | 'center' | 'end' | 'left' | 'right' = 'center';
  /**
   * Explicit box placement produced by parsers of formats with absolute positioning (SSA/ASS,
   * TTML). Overrides the WebVTT line/position algorithm where set.
   */
  layout?: CueLayout;
  /**
   * Presentational styling produced by parsers (SSA/ASS styles, TTML `tts:*`). The renderer maps
   * these to CSS; custom renderers can read them directly.
   */
  textStyle?: CueTextStyle;
  /**
   * Styles for individual runs of text. Cue text references them with `<c.s-KEY>`; the token for
   * that span carries the style and the renderer applies it to the span element. Lets formats
   * with per-run typography (SSA `\\fs`, TTML span `tts:fontSize`, CEA-708 pen backgrounds) map
   * onto WebVTT cue text.
   */
  spans?: Record<string, CueSpanStyle>;
  /**
   * Time-based animations synchronised to media time by the renderer (Web Animations API, driven
   * by `currentTime` so they scrub, pause, and seek with the video). Used for SSA `\\move`,
   * `\\fad`, `\\t`, karaoke sweeps, scroll/banner effects, and 708 display effects.
   */
  animations?: CueAnimation[];
  /**
   * Raw CSS declarations (properties or `--cue-*` custom properties) applied to the cue display
   * element. Escape hatch for consumers; parsers use `layout` and `textStyle` instead.
   */
  style?: Record<string, string>;
  /**
   * Stacking order hint used when cues overlap (e.g., SSA/ASS `Layer`). Higher values render on
   * top.
   */
  layer?: number;

  /** Plain, structured-cloneable representation (e.g., for Workers or caching). */
  toJSON(): VTTCueInit {
    return cueToJSON(this);
  }

  /** Rebuilds a cue from `toJSON()` output. Regions are resolved by id from `regions`. */
  static from(init: VTTCueInit, regions?: VTTRegion[] | Record<string, VTTRegion>): VTTCue {
    return cueFromJSON(init, regions);
  }
}

if (IS_NATIVE) {
  // Shadow the native accessor so `endTime = Infinity` works for live cues while the underlying
  // native cue keeps a finite value (required by the constructor and by native text tracks).
  const native =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(CueBase.prototype), 'endTime') ??
    Object.getOwnPropertyDescriptor(CueBase.prototype, 'endTime');
  if (native?.get && native.set) {
    Object.defineProperty(VTTCue.prototype, 'endTime', {
      configurable: true,
      get(this: VTTCue) {
        return this[OPEN_END] ? Infinity : native.get!.call(this);
      },
      set(this: VTTCue, value: number) {
        this[OPEN_END] = !Number.isFinite(value);
        native.set!.call(this, this[OPEN_END] ? OPEN_END_SENTINEL : value);
      },
    });
  }
}

/**
 * Explicit cue box placement. Offsets are percentages of the overlay, sizes are percentages or
 * CSS sizing keywords, and the translation is a fraction of the cue box itself (so `x: -0.5`
 * with `left: 50` centres the box).
 */
export interface CueLayout {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  /** `'auto'` fills the span between the edges, `'max-content'` hugs the text. */
  width?: number | 'auto' | 'max-content';
  maxWidth?: number;
  /** Explicit height as a percentage of the overlay (e.g., image cues). */
  height?: number;
  translate?: { x?: number; y?: number };
  /** Never moved by collision avoidance, but other cues avoid it (e.g., SSA `\\pos`). */
  fixed?: boolean;
  /** CSS `clip-path` applied to the cue box (e.g., SSA `\\clip` on positioned cues, scroll bands). */
  clipPath?: string;
  /**
   * Clip rectangle in overlay percentages, resolved against the cue's final box after layout. Use
   * this when the clip is fixed on screen but the cue itself is positioned by the layout engine
   * (e.g., SSA `\\clip` on a dialogue line without `\\pos`).
   */
  clipRect?: { left: number; top: number; right: number; bottom: number };
}

/** Styling for one run of text referenced from cue text via `<c.s-KEY>`. */
export interface CueSpanStyle {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  letterSpacing?: string;
  textStroke?: string;
  textShadow?: string;
  transform?: string;
  /** Needed for `transform` to take effect on a run (`inline-block`). */
  display?: string;
  opacity?: string;
  filter?: string;
  animation?: string;
  className?: string;
  /** Gradient fills clipped to the glyphs (SSA karaoke sweeps). */
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundClip?: string;
  /** Vector drawing rendered inline as SVG in place of text (SSA `\\p` drawings). */
  drawing?: CueDrawing;
}

/** An inline vector drawing. Path data uses SVG syntax in `viewBox` units. */
export interface CueDrawing {
  path: string;
  /** `[x, y, width, height]` in path units. */
  viewBox: [number, number, number, number];
  /** Rendered size as percentages of the overlay width and height. */
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * A media-synchronised animation. `keyframes` follow the Web Animations API (`offset` 0..1 plus
 * CSS properties in camelCase). Times are seconds relative to the cue start.
 */
export interface CueAnimation {
  /** `display` = the positioned cue box (default), `cue` = the text box, or a span key. */
  target?: 'display' | 'cue' | { span: string };
  delay?: number;
  duration: number;
  keyframes: Record<string, string | number>[];
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
}

/** Presentational cue styling. Values are CSS values. */
export interface CueTextStyle {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  letterSpacing?: string;
  lineHeight?: string;
  opacity?: string;
  textAlign?: 'left' | 'center' | 'right' | 'start' | 'end';
  whiteSpace?: string;
  /** `<width> <color>`, painted behind the glyphs. */
  textStroke?: string;
  textShadow?: string;
  /** Box outline for opaque-box styles. */
  outline?: string;
  /** Vertical padding override (e.g., `0` for outline-only styles). */
  paddingY?: string;
  /** Extra transforms (scale/rotate) applied after the layout translation. */
  transform?: string;
  /** CSS `background-image` (e.g., IMSC image cues as data URLs). */
  backgroundImage?: string;
  /** CSS `animation` shorthand; `media-captions-fade-in` and `media-captions-wipe-in` keyframes ship in the stylesheet. */
  animation?: string;
  /** Extra class names for the cue element (e.g., CEA-708 pen sizes `pen-small`, `pen-large`). */
  className?: string;
}

export interface VTTCueInit {
  id?: string;
  startTime: number;
  /** `null` (from JSON) means an open-ended cue (`Infinity`). */
  endTime: number | null;
  text: string;
  /** Region id, resolved by `VTTCue.from`. */
  region?: string | null;
  vertical?: VTTCue['vertical'];
  snapToLines?: boolean;
  line?: VTTCue['line'];
  lineAlign?: VTTCue['lineAlign'];
  position?: VTTCue['position'];
  positionAlign?: VTTCue['positionAlign'];
  size?: number;
  align?: VTTCue['align'];
  layout?: CueLayout;
  textStyle?: CueTextStyle;
  spans?: Record<string, CueSpanStyle>;
  animations?: CueAnimation[];
  style?: Record<string, string>;
  layer?: number;
}

export function cueToJSON(cue: VTTCue): VTTCueInit {
  const init: VTTCueInit = {
    id: cue.id,
    startTime: cue.startTime,
    endTime: cue.endTime,
    text: cue.text,
    region: cue.region ? cue.region.id : null,
    vertical: cue.vertical,
    snapToLines: cue.snapToLines,
    line: cue.line,
    lineAlign: cue.lineAlign,
    position: cue.position,
    positionAlign: cue.positionAlign,
    size: cue.size,
    align: cue.align,
  };
  if (cue.layout) init.layout = cue.layout;
  if (cue.textStyle) init.textStyle = cue.textStyle;
  if (cue.spans) init.spans = cue.spans;
  if (cue.animations) init.animations = cue.animations;
  if (cue.style) init.style = cue.style;
  if (cue.layer !== undefined) init.layer = cue.layer;
  return init;
}

export function cueFromJSON(
  init: VTTCueInit,
  regions?: VTTRegion[] | Record<string, VTTRegion>,
): VTTCue {
  // JSON has no Infinity: open-ended cues serialise their end as `null`.
  const cue = new VTTCue(init.startTime, init.endTime ?? Infinity, init.text);
  if (init.id) cue.id = init.id;
  if (init.vertical !== undefined) cue.vertical = init.vertical;
  if (init.snapToLines !== undefined) cue.snapToLines = init.snapToLines;
  if (init.line !== undefined) cue.line = init.line;
  if (init.lineAlign) cue.lineAlign = init.lineAlign;
  if (init.position !== undefined) cue.position = init.position;
  if (init.positionAlign) cue.positionAlign = init.positionAlign;
  if (init.size !== undefined) cue.size = init.size;
  if (init.align) cue.align = init.align;
  if (init.layout) cue.layout = init.layout;
  if (init.textStyle) cue.textStyle = init.textStyle;
  if (init.spans) cue.spans = init.spans;
  if (init.animations) cue.animations = init.animations;
  if (init.style) cue.style = init.style;
  if (init.layer !== undefined) cue.layer = init.layer;
  if (init.region && regions) {
    cue.region = Array.isArray(regions)
      ? (regions.find((region) => region.id === init.region) ?? null)
      : (regions[init.region] ?? null);
  }
  return cue;
}
