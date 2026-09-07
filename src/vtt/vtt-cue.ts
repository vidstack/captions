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
  get region(): VTTRegion | null {
    return this.#region;
  }

  set region(region: VTTRegion | null) {
    this.#region = region;
  }

  // Firefox and WebKit ship a native `region` setter that only accepts their own `VTTRegion`
  // (Chromium has none), so ours lives on this prototype and shadows it.
  #region: VTTRegion | null = null;

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
 * A length. Plain numbers are pixels; `vw`/`vh` are percentages of the overlay width/height,
 * `em` is relative to the cue font size, and `%` is relative to the box (transform origins).
 * Writers serialise these to CSS (`calc(var(--overlay-height) * k)`) or resolve them to pixels.
 */
export type CueLength = number | { unit: 'vw' | 'vh' | 'em' | '%'; value: number };

/** A CSS colour string. Parsers normalise to `rgba(r,g,b,a)` or `#rrggbb`. */
export type CueColor = string;

/** A 2D/3D transform about `origin` (default: the box centre). Angles are degrees, clockwise. */
export interface CueTransform {
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  /** Pivot as percentages of the box (default `[50, 50]`). */
  origin?: [number, number];
  /** Pivot as a point on the overlay, in percentages (SSA `\\org`); wins over `origin`. */
  originAt?: [number, number];
}

/** A text stroke (painted behind the glyphs) or a box outline. */
export interface CueStroke {
  width: CueLength;
  color: CueColor;
}

export interface CueShadow {
  x: CueLength;
  y: CueLength;
  blur?: CueLength;
  color: CueColor;
}

/** Karaoke sweep: glyphs fill from `unsung` to `sung` as the span's `sweep` keyframe runs 0..1. */
export interface CueSweep {
  sung: CueColor;
  unsung: CueColor;
}

/**
 * A clip. `rect` (`[left, top, right, bottom]`) and `polygon` are overlay percentages and stay
 * fixed on screen wherever the box lands; `inset` (`[top, right, bottom, left]`) is a percentage
 * of the box itself (reveal effects).
 */
export type CueClip =
  | { rect: [number, number, number, number] }
  | { polygon: [number, number][]; evenOdd?: boolean }
  | { inset: [number, number, number, number] };

/**
 * Explicit cue box placement. Offsets and sizes are percentages of the overlay; the translation
 * is a fraction of the cue box itself (so `x: -0.5` with `left: 50` centres the box).
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
  /** Never moved by collision avoidance, but other cues avoid it (e.g., SSA `\pos`). */
  fixed?: boolean;
  /** Clip applied to the cue box (SSA `\clip`, scroll bands). Resolved against the final box. */
  clip?: CueClip;
}

/** Styling for one run of text referenced from cue text via `<c.s-KEY>`. */
export interface CueSpanStyle {
  color?: CueColor;
  backgroundColor?: CueColor;
  fontFamily?: string;
  fontSize?: CueLength;
  /** 100..900. */
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  letterSpacing?: CueLength;
  /** `null` removes an inherited stroke. */
  stroke?: CueStroke | null;
  shadow?: CueShadow | null;
  /** Blur radius (`0` = none). */
  blur?: CueLength;
  opacity?: number;
  transform?: CueTransform;
  sweep?: CueSweep;
  className?: string;
  /** Vector drawing rendered in place of text (SSA `\p` drawings). */
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
  fill?: CueColor;
  stroke?: CueColor;
  strokeWidth?: number;
}

/** One keyframe of a cue animation. Positions are overlay percentages; `translate` a box fraction. */
export interface CueKeyframe {
  offset?: number;
  opacity?: number;
  color?: CueColor;
  strokeColor?: CueColor;
  strokeWidth?: CueLength;
  fontSize?: CueLength;
  letterSpacing?: CueLength;
  shadow?: CueShadow | null;
  blur?: CueLength;
  transform?: CueTransform;
  left?: number;
  top?: number;
  translate?: { x?: number; y?: number };
  clip?: CueClip;
  /** Karaoke sweep progress, 0 (nothing sung) to 1. */
  sweep?: number;
}

/** A media-synchronised animation. Times are seconds relative to the cue start. */
export interface CueAnimation {
  /** `display` = the positioned cue box (default), `cue` = the text box, or a span key. */
  target?: 'display' | 'cue' | { span: string };
  delay?: number;
  duration: number;
  keyframes: CueKeyframe[];
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
}

/** Presentational cue styling, as values. Writers turn these into CSS or pixels. */
export interface CueTextStyle {
  color?: CueColor;
  backgroundColor?: CueColor;
  fontFamily?: string;
  fontSize?: CueLength;
  /** 100..900. */
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  letterSpacing?: CueLength;
  /** A length (`em` for multiples of the font size) or `'normal'`. */
  lineHeight?: CueLength | 'normal';
  opacity?: number;
  textAlign?: 'left' | 'center' | 'right' | 'start' | 'end';
  /** `nowrap` keeps the text on one line (SSA WrapStyle 2, banners). */
  wrap?: 'wrap' | 'nowrap';
  /** Stroke painted behind the glyphs; `null` for none. */
  stroke?: CueStroke | null;
  shadow?: CueShadow | null;
  /** Box outline for opaque-box styles. */
  outline?: CueStroke;
  /** Cue box padding overrides (e.g., `y: 0` for outline-only styles, `x: 0` for drawings). */
  padding?: { x?: CueLength; y?: CueLength };
  /** Scale/rotate applied after the layout translation, about `origin`. */
  transform?: CueTransform;
  /** An image painted in the box (IMSC image cues). */
  image?: { url: string; fit?: 'contain' | 'cover' | 'fill' };
  /** Extra class names for the cue element (e.g., CEA-708 `small-caps`, IMSC `forced`). */
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
