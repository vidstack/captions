import type { ParseErrorBuilder } from '../parse/errors';
import type { ParseError } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, EmbeddedFont } from '../parse/types';
import {
  VTTCue,
  type CueAnimation,
  type CueDrawing,
  type CueLayout,
  type CueSpanStyle,
  type CueTextStyle,
} from '../vtt/vtt-cue';
import { parseVTTTimestamp } from '../vtt/vtt-parser';
import { decodeUUEncodedFont } from './fonts';

const FORMAT_START_RE = /^Format:[\s\t]*/,
  STYLE_START_RE = /^Style:[\s\t]*/,
  DIALOGUE_START_RE = /^Dialogue:[\s\t]*/,
  COMMENT_START_RE = /^Comment:/,
  FONT_NAME_RE = /^fontname:[\s\t]*(.+)$/i,
  FORMAT_SPLIT_RE = /(?<![\s\t])[\s\t]*,[\s\t]*/,
  SECTION_RE = /^\[(.*)\]$/,
  SCRIPT_INFO_SECTION_RE = /^\[Script Info\]$/i,
  STYLES_SECTION_RE = /^\[.*Styles\]$/i,
  EVENTS_SECTION_RE = /^\[.*Events\]$/i,
  FONTS_SECTION_RE = /^\[Fonts\]$/i,
  OVERRIDE_BLOCK_RE = /\{([^}]*)\}/g,
  GENERIC_TAG_RE = /^[1-4]?[a-zA-Z]+/,
  COLOR_TAG_RE = /&H([0-9a-fA-F]{2,8})&?/i,
  ALPHA_TAG_RE = /^&?H?([0-9a-fA-F]{1,2})&?$/i,
  CLIP_DRAWING_RE = /^(?:(\d+)\s*,)?\s*([mnlbspc][\s\d.-].*)$/is,
  NEW_LINE_RE = /\\N/g,
  SOFT_LINE_RE = /\\n/g,
  HARD_SPACE_RE = /\\h/g,
  KEY_VALUE_RE = /^([^:]+):[\s\t]*(.*)$/,
  ANGLE_BRACKET_RE = /[<>]/g,
  WHITESPACE_RE = /\s+/;

/**
 * Known override tag names, longest first so `\fscx` is not read as `\fs` + `cx` and `\fnArial`
 * is `\fn` + `Arial`.
 */
const TAG_NAMES = [
  'alpha',
  'iclip',
  'xbord',
  'ybord',
  'xshad',
  'yshad',
  'blur',
  'bord',
  'clip',
  'fade',
  'fscx',
  'fscy',
  'fsvp',
  'move',
  'shad',
  'fad',
  'fax',
  'fay',
  'frx',
  'fry',
  'frz',
  'fsc',
  'fsp',
  'org',
  'pbo',
  'pos',
  'an',
  'be',
  'fe',
  'fn',
  'fr',
  'fs',
  'kf',
  'ko',
  'kt',
  '1a',
  '2a',
  '3a',
  '4a',
  '1c',
  '2c',
  '3c',
  '4c',
  'a',
  'b',
  'c',
  'i',
  'k',
  'K',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
];

/** Number of samples used to approximate `\t` acceleration curves. */
const ACCEL_SAMPLES = 8,
  /** Line segments used to flatten a Bézier segment for `\clip` polygons. */
  FLATTEN_STEPS = 8;

const enum Section {
  None = 0,
  Info = 1,
  Style = 2,
  Event = 3,
  Fonts = 4,
  Other = 5,
}

/** `[r, g, b, a]` with `a` in 0..1. */
type RGBA = [number, number, number, number];

const WHITE: RGBA = [255, 255, 255, 1],
  BLACK: RGBA = [0, 0, 0, 1],
  DEFAULT_SHADOW: RGBA = [0, 0, 0, 0.8];

interface SSAStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: RGBA;
  secondaryColor?: RGBA;
  outlineColor?: RGBA;
  backColor?: RGBA;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeOut?: boolean;
  scaleX?: number;
  scaleY?: number;
  spacing?: number;
  angle?: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  /** Numpad alignment (1-9). */
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  alpha?: number;
  /** `\pos(x, y)` (or the start of `\move`) in script pixels. */
  pos?: { x: number; y: number };
  /** `\\org(x, y)` rotation origin in script pixels. */
  org?: { x: number; y: number };
  /** `\move` end point; the animation itself is emitted while transforming the text. */
  move?: { x: number; y: number };
  /** `\clip` rectangle or flattened drawing contours in script pixels. */
  clip?: SSAClip;
  /** Parsed `Effect` field. */
  effect?: SSAEffect;
  /** `\q` per-dialogue wrap style override. */
  wrapStyle?: number;
  /** The dialogue contains a `\p` drawing. */
  drawing?: boolean;
}

type SSAClip = { rect: [number, number, number, number] } | { contours: number[][] };

type SSAEffect =
  | { type: 'scroll'; up: boolean; y1: number; y2: number; delay: number }
  | { type: 'banner'; delay: number; ltr: boolean };

/**
 * Per-run typesetting state driven by override tags. Values are script units (pixels, percent,
 * degrees); the emitted span style only contains what differs from the dialogue's style.
 */
interface SpanState {
  fontSize: number;
  fontName: string;
  scaleX: number;
  scaleY: number;
  frx: number;
  fry: number;
  frz: number;
  bord: number;
  shad: number;
  blur: number;
  /** Opacity 0..1 (from `\alpha` / `\1a`). */
  alpha: number;
  spacing: number;
  strike: boolean;
  color: RGBA;
  secondaryColor: RGBA;
  outlineColor: RGBA;
  shadowColor: RGBA;
  /** Karaoke sweep for the current syllable (`\kf`, `\K`, `\ko`); forces a span. */
  sweep?: { kind: 'fill' | 'outline'; delay: number; duration: number };
  /** Bumped to force a fresh span run (e.g., `\t` targets). */
  run: number;
}

type AnimatableProp =
  | 'color'
  | 'webkitTextStrokeColor'
  | 'opacity'
  | 'transform'
  | 'webkitTextStrokeWidth'
  | 'filter'
  | 'fontSize'
  | 'letterSpacing'
  | 'textShadow';

interface OverrideTag {
  name: string;
  /** Argument with any surrounding parentheses removed. */
  arg: string;
}

interface ParsedDrawing {
  path: string;
  /** `[minX, minY, maxX, maxY]` including control points, or `null` when empty. */
  bbox: [number, number, number, number] | null;
  /** Flattened contours as `[x, y, x, y, ...]`. */
  contours: number[][];
}

/** Open inline formatting tags, innermost last. `s` is a `<c.s-KEY>` span. */
type OpenTags = {
  key: 'i' | 'b' | 'u' | 'c' | 's';
  open: string;
  close: string;
  emitted: boolean;
}[];

export class SSAParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _section = Section.None;
  protected _cue: VTTCue | null = null;
  protected _cueStyle: SSAStyle | null = null;
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _format: string[] | null = null;
  protected _errorBuilder?: typeof ParseErrorBuilder;
  protected _styles: Record<string, SSAStyle> = {};
  protected _metadata: Record<string, string> = {};
  protected _fonts: EmbeddedFont[] = [];
  protected _font: { name: string; data: string } | null = null;
  protected _playResX = 384;
  protected _playResY = 288;
  protected _hasPlayRes = false;
  protected _isASS = true;
  protected _wrapStyle = 0;

  async init(init: CaptionsParserInit) {
    this._init = init;
    if (init.errors) this._errorBuilder = (await import('../parse/errors')).ParseErrorBuilder;
  }

  parse(line: string, lineCount: number) {
    if (SECTION_RE.test(line)) {
      this._commitCue();
      this._commitFont();
      this._format = null;

      if (SCRIPT_INFO_SECTION_RE.test(line)) {
        this._section = Section.Info;
      } else if (STYLES_SECTION_RE.test(line)) {
        this._section = Section.Style;
        // Legacy SSA `[V4 Styles]` uses a different alignment scheme than ASS `[V4+ Styles]`.
        if (/v4[\s\t]*styles/i.test(line)) this._isASS = false;
        else if (/v4\+/i.test(line)) this._isASS = true;
      } else if (EVENTS_SECTION_RE.test(line)) {
        this._section = Section.Event;
      } else if (FONTS_SECTION_RE.test(line)) {
        this._section = Section.Fonts;
      } else {
        this._section = Section.Other;
      }

      return;
    }

    switch (this._section) {
      case Section.Info:
        this._parseInfo(line);
        break;
      case Section.Style:
        if (STYLE_START_RE.test(line)) {
          if (this._format) {
            this._parseStyle(line.replace(STYLE_START_RE, '').split(FORMAT_SPLIT_RE));
          } else {
            this._handleError(this._errorBuilder?._missingFormat('Style', lineCount));
          }
        } else if (FORMAT_START_RE.test(line)) {
          this._format = line.replace(FORMAT_START_RE, '').split(FORMAT_SPLIT_RE);
        }
        break;
      case Section.Event:
        if (line === '') {
          this._commitCue();
        } else if (DIALOGUE_START_RE.test(line)) {
          this._commitCue();
          if (this._format) {
            const values = splitFields(line.replace(DIALOGUE_START_RE, ''), this._format.length),
              cue = this._parseDialogue(values, lineCount);
            if (cue) this._cue = cue;
          } else {
            this._handleError(this._errorBuilder?._missingFormat('Dialogue', lineCount));
          }
        } else if (FORMAT_START_RE.test(line)) {
          this._format = line.replace(FORMAT_START_RE, '').split(FORMAT_SPLIT_RE);
        } else if (COMMENT_START_RE.test(line)) {
          this._commitCue();
        } else if (this._cue && this._cueStyle) {
          // Non-standard: plain lines following a dialogue are treated as continuation text.
          this._cue.text += '\n' + this._transformText(this._cue, this._cueStyle, line);
        }
        break;
      case Section.Fonts:
        this._parseFontLine(line);
        break;
    }
  }

  done() {
    this._commitCue();
    this._commitFont();
    return {
      metadata: this._metadata,
      cues: this._cues,
      regions: [],
      errors: this._errors,
      fonts: this._fonts,
    };
  }

  protected _commitCue() {
    if (!this._cue) return;
    this._cues.push(this._cue);
    this._init.onCue?.(this._cue);
    this._cue = null;
    this._cueStyle = null;
  }

  protected _parseInfo(line: string) {
    const match = line.match(KEY_VALUE_RE);
    if (!match || line.startsWith(';') || line.startsWith('!')) return;

    const key = match[1].trim(),
      value = match[2].trim();

    this._metadata[key] = value;

    switch (key) {
      case 'PlayResX':
        this._playResX = parseFloat(value) || this._playResX;
        this._hasPlayRes = true;
        break;
      case 'PlayResY':
        this._playResY = parseFloat(value) || this._playResY;
        this._hasPlayRes = true;
        break;
      case 'WrapStyle':
        this._wrapStyle = parseInt(value, 10) || 0;
        break;
      case 'ScriptType':
        this._isASS = /v4\.00\+/i.test(value);
        break;
    }
  }

  protected _parseStyle(values: string[]) {
    let name = 'Default';

    const style = this._parseStyleDefaults();

    for (let i = 0; i < this._format!.length; i++) {
      const field = this._format![i],
        value = values[i];

      if (value === undefined) continue;

      switch (field) {
        case 'Name':
          name = value;
          break;
        case 'Fontname':
          style.fontName = value;
          break;
        case 'Fontsize':
          style.fontSize = parseFloat(value);
          break;
        case 'PrimaryColour':
          style.primaryColor = parseColorRGBA(value) ?? undefined;
          break;
        case 'SecondaryColour':
          style.secondaryColor = parseColorRGBA(value) ?? undefined;
          break;
        case 'OutlineColour':
        case 'TertiaryColour':
          style.outlineColor = parseColorRGBA(value) ?? undefined;
          break;
        case 'BackColour':
          style.backColor = parseColorRGBA(value) ?? undefined;
          break;
        case 'Bold':
          style.bold = isTruthyFlag(value);
          break;
        case 'Italic':
          style.italic = isTruthyFlag(value);
          break;
        case 'Underline':
          style.underline = isTruthyFlag(value);
          break;
        case 'StrikeOut':
          style.strikeOut = isTruthyFlag(value);
          break;
        case 'ScaleX':
          style.scaleX = parseFloat(value);
          break;
        case 'ScaleY':
          style.scaleY = parseFloat(value);
          break;
        case 'Spacing':
          style.spacing = parseFloat(value);
          break;
        case 'Angle':
          style.angle = parseFloat(value);
          break;
        case 'BorderStyle':
          style.borderStyle = parseInt(value, 10) || 1;
          break;
        case 'Outline':
          style.outline = parseFloat(value) || 0;
          break;
        case 'Shadow':
          style.shadow = parseFloat(value) || 0;
          break;
        case 'Alignment':
          style.alignment = this._isASS
            ? parseInt(value, 10) || 2
            : toNumpadAlignment(parseInt(value, 10) || 2);
          break;
        case 'MarginL':
          style.marginL = parseFloat(value) || 0;
          break;
        case 'MarginR':
          style.marginR = parseFloat(value) || 0;
          break;
        case 'MarginV':
          style.marginV = parseFloat(value) || 0;
          break;
        case 'AlphaLevel':
          const alpha = parseFloat(value);
          if (!Number.isNaN(alpha)) style.alpha = alpha > 1 ? 1 - alpha / 255 : alpha;
          break;
      }
    }

    this._styles[name] = style;
  }

  protected _parseDialogue(values: string[], lineCount: number) {
    const fields = this._buildFields(values);

    const timestamp = this._parseTimestamp(fields.Start ?? '', fields.End ?? '', lineCount);
    if (!timestamp) return;

    const cue = new VTTCue(timestamp[0], timestamp[1], ''),
      baseStyle = fields.Style ? this._styles[fields.Style.replace(/^\*/, '')] : undefined,
      style: SSAStyle = { ...(baseStyle || this._parseStyleDefaults()) },
      initialAlignment = style.alignment;

    const marginL = parseFloat(fields.MarginL),
      marginR = parseFloat(fields.MarginR),
      marginV = parseFloat(fields.MarginV);

    if (marginL) style.marginL = marginL;
    if (marginR) style.marginR = marginR;
    if (marginV) style.marginV = marginV;

    const layer = parseInt(fields.Layer ?? fields.Marked?.replace(/^Marked=/i, ''), 10);
    if (layer) cue.layer = layer;

    const effect = fields.Effect?.trim();
    if (effect) style.effect = parseEffect(effect, this._playResY);

    const text = this._transformText(cue, style, fields.Text ?? '');
    if (!text) return;

    const voice = fields.Name?.replace(ANGLE_BRACKET_RE, '').trim();
    cue.text = (voice ? `<v ${voice}>` : '') + text;

    // Only emit styles when the dialogue resolved to a defined style or used positioning
    // override tags, otherwise leave rendering to the WebVTT defaults.
    const hasOverrides =
      style.alignment !== initialAlignment ||
      style.pos !== undefined ||
      style.effect !== undefined ||
      style.wrapStyle !== undefined ||
      style.drawing === true;
    if (baseStyle || hasOverrides) this._applyStyle(cue, style);
    this._cueStyle = style;

    return cue;
  }

  protected _parseStyleDefaults(): SSAStyle {
    return {
      borderStyle: 1,
      outline: 2,
      shadow: 2,
      alignment: 2,
      marginL: 10,
      marginR: 10,
      marginV: 10,
    };
  }

  /** Script pixels to a percentage of the play resolution width. */
  protected _pctX(px: number) {
    return round((px / this._playResX) * 100);
  }

  /** Script pixels to a percentage of the play resolution height. */
  protected _pctY(px: number) {
    return round((px / this._playResY) * 100);
  }

  /** Script pixels to a CSS length relative to the overlay height so it scales like the video. */
  protected _lenY(px: number) {
    return `calc(var(--overlay-height) * ${round(px / this._playResY, 5)})`;
  }

  /** The per-run state implied by a style; spans only emit values that differ from it. */
  protected _spanDefaults(style: SSAStyle): SpanState {
    return {
      // The stylesheet's default cue font size is 5% of the overlay height.
      fontSize: style.fontSize || this._playResY * 0.05,
      fontName: style.fontName ?? '',
      scaleX: style.scaleX || 100,
      scaleY: style.scaleY || 100,
      frx: 0,
      fry: 0,
      frz: style.angle || 0,
      bord: style.outline,
      shad: style.shadow,
      blur: 0,
      alpha: style.alpha ?? 1,
      spacing: style.spacing || 0,
      strike: style.strikeOut ?? false,
      color: style.primaryColor ?? WHITE,
      secondaryColor: style.secondaryColor ?? style.primaryColor ?? WHITE,
      outlineColor: style.outlineColor ?? BLACK,
      shadowColor: style.backColor ?? DEFAULT_SHADOW,
      run: 0,
    };
  }

  /**
   * Builds the `CueSpanStyle` for a run, emitting only what differs from the dialogue style so
   * runs without overrides produce no span at all.
   */
  protected _spanStyle(s: SpanState, d: SpanState): CueSpanStyle | null {
    const css: CueSpanStyle = {};

    if (s.fontSize !== d.fontSize) css.fontSize = this._lenY(s.fontSize);
    if (s.fontName !== d.fontName) css.fontFamily = toFontFamily(s.fontName);

    // Transforms are relative to the style's, which already sit on the cue box.
    const transform: string[] = [];
    if (s.scaleX !== d.scaleX) transform.push(`scaleX(${round(s.scaleX / d.scaleX)})`);
    if (s.scaleY !== d.scaleY) transform.push(`scaleY(${round(s.scaleY / d.scaleY)})`);
    // ASS rotates counter-clockwise, CSS rotates clockwise.
    if (s.frz !== d.frz) transform.push(`rotate(${round(-(s.frz - d.frz))}deg)`);
    if (s.frx !== d.frx) transform.push(`rotateX(${round(-(s.frx - d.frx))}deg)`);
    if (s.fry !== d.fry) transform.push(`rotateY(${round(-(s.fry - d.fry))}deg)`);
    if (transform.length) {
      css.transform = transform.join(' ');
      // Transforms do not apply to inline boxes.
      css.display = 'inline-block';
    }

    if (s.bord !== d.bord || !sameColor(s.outlineColor, d.outlineColor)) {
      // Stroke is centered on the glyph edge so it needs to be twice the outline width.
      css.textStroke = s.bord ? `${this._lenY(s.bord * 2)} ${toRGBA(s.outlineColor)}` : '0';
    }
    if (s.shad !== d.shad || !sameColor(s.shadowColor, d.shadowColor)) {
      css.textShadow = s.shad
        ? `${this._lenY(s.shad)} ${this._lenY(s.shad)} 0 ${toRGBA(s.shadowColor)}`
        : 'none';
    }
    if (s.blur !== d.blur) css.filter = s.blur ? `blur(${this._lenY(s.blur)})` : 'none';
    if (s.alpha !== d.alpha) css.opacity = round(s.alpha) + '';
    if (s.spacing !== d.spacing) css.letterSpacing = this._lenY(s.spacing);
    if (s.strike !== d.strike) css.textDecoration = s.strike ? 'line-through' : 'none';

    if (s.sweep?.kind === 'fill') {
      // Karaoke sweep: a two-tone gradient clipped to the glyphs slides from the secondary colour
      // to the primary colour (see `_sweepAnimation`).
      css.backgroundImage = `linear-gradient(90deg, ${toRGBA(s.color)} 50%, ${toRGBA(
        s.secondaryColor,
      )} 50%)`;
      css.backgroundSize = '200% 100%';
      css.backgroundPosition = '100% 0';
      css.backgroundClip = 'text';
      css.color = 'transparent';
    }

    return Object.keys(css).length ? css : null;
  }

  /** A keyframe holding the given animatable properties for a state. */
  protected _keyframe(s: SpanState, d: SpanState, props: AnimatableProp[]) {
    const frame: Record<string, string | number> = {};
    for (const prop of props) {
      switch (prop) {
        case 'color':
          frame.color = toRGBA(s.color);
          break;
        case 'webkitTextStrokeColor':
          frame.webkitTextStrokeColor = toRGBA(s.outlineColor);
          break;
        case 'opacity':
          frame.opacity = round(s.alpha);
          break;
        case 'transform':
          frame.transform =
            `scaleX(${round(s.scaleX / d.scaleX)}) scaleY(${round(s.scaleY / d.scaleY)}) ` +
            `rotate(${round(-(s.frz - d.frz))}deg)`;
          break;
        case 'webkitTextStrokeWidth':
          frame.webkitTextStrokeWidth = this._lenY(s.bord * 2);
          break;
        case 'filter':
          frame.filter = `blur(${this._lenY(s.blur)})`;
          break;
        case 'fontSize':
          frame.fontSize = this._lenY(s.fontSize);
          break;
        case 'letterSpacing':
          frame.letterSpacing = this._lenY(s.spacing);
          break;
        case 'textShadow':
          frame.textShadow = `${this._lenY(s.shad)} ${this._lenY(s.shad)} 0 ${toRGBA(
            s.shadowColor,
          )}`;
          break;
      }
    }
    return frame;
  }

  /**
   * Keyframes for a `\t` transition. Linear transitions need two keyframes; accelerated ones are
   * sampled at `progress^accel` so the curve survives as piecewise-linear keyframes.
   */
  protected _transitionKeyframes(from: SpanState, to: SpanState, d: SpanState, accel: number) {
    const props = diffProps(from, to);
    if (!props.length) return null;
    if (accel === 1) {
      return [
        { offset: 0, ...this._keyframe(from, d, props) },
        { offset: 1, ...this._keyframe(to, d, props) },
      ];
    }
    const frames: Record<string, string | number>[] = [];
    for (let i = 0; i <= ACCEL_SAMPLES; i++) {
      const offset = i / ACCEL_SAMPLES,
        progress = offset ** accel;
      frames.push({ offset, ...this._keyframe(lerpState(from, to, progress), d, props) });
    }
    return frames;
  }

  protected _sweepAnimation(s: SpanState, key: string): CueAnimation {
    const sweep = s.sweep!;
    return {
      target: { span: key },
      delay: sweep.delay,
      duration: Math.max(sweep.duration, 0.001),
      fill: 'both',
      keyframes:
        sweep.kind === 'fill'
          ? [{ backgroundPosition: '100% 0' }, { backgroundPosition: '0 0' }]
          : [
              { webkitTextStrokeColor: toRGBA(s.secondaryColor) },
              { webkitTextStrokeColor: toRGBA(s.color) },
            ],
    };
  }

  protected _addSpan(cue: VTTCue, css: CueSpanStyle) {
    const spans = (cue.spans ??= {}),
      key = Object.keys(spans).length + '';
    spans[key] = css;
    return key;
  }

  protected _addAnimation(cue: VTTCue, animation: CueAnimation) {
    (cue.animations ??= []).push(animation);
  }

  /**
   * Converts dialogue text with SSA/ASS override tags into WebVTT cue text. Positioning tags
   * (`\an`, `\a`, `\pos`, `\move`) mutate the style/cue, formatting tags map to WebVTT tags,
   * per-run typesetting tags (`\fs`, `\fn`, `\fsc*`, `\fr*`, `\bord`, `\shad`, `\blur`,
   * `\alpha`, `\3c`, `\4c`, `\fsp`) become `<c.s-KEY>` spans, karaoke tags become timestamp tags
   * (plus sweep animations for `\kf`/`\K`/`\ko`), `\fad`/`\fade`/`\move`/`\t` become
   * `cue.animations`, and `\p` drawings become inline SVG spans.
   */
  protected _transformText(cue: VTTCue, style: SSAStyle, text: string): string {
    const defaults = this._spanDefaults(style),
      duration = cue.endTime - cue.startTime,
      durationMs = duration * 1000;

    let result = '',
      open: OpenTags = [],
      state: SpanState = { ...defaults },
      // End state of the last `\t`, so chained transitions start where the previous one ended.
      tState: SpanState | null = null,
      // Signature of the currently open span run.
      spanSig = '',
      // Span-target animations waiting for the next span run to open.
      pendingAnims: CueAnimation[] = [],
      karaokeTime = cue.startTime,
      // Current `\p` drawing scale (0 = text mode) and the collected drawing commands.
      drawingScale = 0,
      drawingText = '',
      lastIndex = 0,
      match: RegExpExecArray | null;

    /** Opens/closes the `<c.s-KEY>` span so the run matches the current per-span state. */
    const syncSpan = () => {
      let css = this._spanStyle(state, defaults);
      // Animation targets need an element even when nothing differs statically.
      if (!css && (pendingAnims.length || state.sweep)) css = {};

      const sig = css ? JSON.stringify(css) + '|' + state.run : '';
      if (sig === spanSig) return;

      result += closeTag(open, 's');
      spanSig = sig;
      if (!css) return;

      const key = this._addSpan(cue, css);
      result += openTag(open, 's', `<c.s-${key}>`, '</c>');

      for (const anim of pendingAnims) {
        anim.target = { span: key };
        this._addAnimation(cue, anim);
      }
      pendingAnims = [];

      if (state.sweep) this._addAnimation(cue, this._sweepAnimation(state, key));
    };

    const appendText = (raw: string) => {
      if (!raw) return;
      if (drawingScale) {
        drawingText += raw;
        return;
      }
      syncSpan();
      // Tags are opened lazily, right before the text they wrap, so toggling formatting with no
      // text in between never produces empty `<b></b>` pairs.
      result += flushOpenTags(open);
      result += escapeText(raw);
    };

    /** Emits the collected drawing commands as an inline SVG span. */
    const endDrawing = () => {
      if (!drawingScale) return;
      const drawing = this._createDrawing(drawingText, drawingScale, state);
      drawingText = '';
      drawingScale = 0;
      if (!drawing) return;

      const css = this._spanStyle(state, defaults) ?? {};
      css.drawing = drawing;
      result += closeTag(open, 's');
      spanSig = '';
      result += `<c.s-${this._addSpan(cue, css)}></c>`;
      style.drawing = true;
    };

    const applyTag = (name: string, arg: string) => {
      switch (name) {
        case 'i':
          result += toggleTag(open, 'i', '<i>', '</i>', arg);
          break;
        case 'b':
          result += toggleTag(open, 'b', '<b>', '</b>', arg);
          break;
        case 'u':
          result += toggleTag(open, 'u', '<u>', '</u>', arg);
          break;
        case 'c':
        case '1c': {
          const color = parseColorRGBA(arg);
          result += closeTag(open, 'c');
          state.color = color ?? defaults.color;
          if (color) result += openTag(open, 'c', `<c.${toHex(color)}>`, '</c>');
          break;
        }
        case 'r': {
          // `\r` resets to the dialogue style, `\rName` to another style.
          const base = arg ? this._styles[arg.replace(/^\*/, '')] : undefined;
          result += closeTags(open);
          spanSig = '';
          state = base ? this._spanDefaults(base) : { ...defaults };
          tState = null;
          if (base?.bold) result += openTag(open, 'b', '<b>', '</b>');
          if (base?.italic) result += openTag(open, 'i', '<i>', '</i>');
          if (base?.underline) result += openTag(open, 'u', '<u>', '</u>');
          break;
        }
        case 'an':
          style.alignment = parseInt(arg, 10) || style.alignment;
          break;
        case 'a':
          style.alignment = toNumpadAlignment(parseInt(arg, 10) || 2);
          break;
        case 'q':
          style.wrapStyle = parseInt(arg, 10) || 0;
          break;
        case 'pos': {
          const [x, y] = parseNumbers(arg);
          if (x !== undefined && y !== undefined) style.pos = { x, y };
          break;
        }

        case 'org': {
          const [x, y] = parseNumbers(arg);
          if (x !== undefined && y !== undefined) style.org = { x, y };
          break;
        }
        case 'move': {
          const nums = parseNumbers(arg);
          if (nums.length < 4) break;
          const [x1, y1, x2, y2] = nums;
          let t1 = 0,
            t2 = durationMs;
          // `t1`/`t2` are milliseconds from the cue start; omitted (or 0,0) means the whole cue.
          if (nums.length >= 6 && nums[5] > nums[4]) [t1, t2] = [nums[4], nums[5]];
          style.pos = { x: x1, y: y1 };
          style.move = { x: x2, y: y2 };
          this._addAnimation(cue, {
            target: 'display',
            delay: round(t1 / 1000),
            duration: round((t2 - t1) / 1000),
            fill: 'both',
            keyframes: [
              { left: `${this._pctX(x1)}%`, top: `${this._pctY(y1)}%` },
              { left: `${this._pctX(x2)}%`, top: `${this._pctY(y2)}%` },
            ],
          });
          break;
        }
        case 'fad': {
          const [fadeIn, fadeOut] = parseNumbers(arg);
          if (fadeIn === undefined || fadeOut === undefined || !(fadeIn > 0 || fadeOut > 0)) break;
          const inEnd = clamp(fadeIn / durationMs, 0, 1),
            outStart = clamp(1 - fadeOut / durationMs, inEnd, 1);
          this._addAnimation(cue, {
            target: 'display',
            duration,
            fill: 'both',
            keyframes: [
              { offset: 0, opacity: fadeIn > 0 ? 0 : 1 },
              { offset: round(inEnd, 4), opacity: 1 },
              { offset: round(outStart, 4), opacity: 1 },
              { offset: 1, opacity: fadeOut > 0 ? 0 : 1 },
            ],
          });
          break;
        }
        case 'fade': {
          const nums = parseNumbers(arg);
          if (nums.length < 7) break;
          // Alphas are 0 (opaque) to 255 (transparent); times are milliseconds from the start.
          const [a1, a2, a3, t1, t2, t3, t4] = nums,
            op = (alpha: number) => round(1 - clamp(alpha, 0, 255) / 255),
            steps: [number, number][] = [
              [0, op(a1)],
              [t1, op(a1)],
              [t2, op(a2)],
              [t3, op(a2)],
              [t4, op(a3)],
              [durationMs, op(a3)],
            ];
          let last = 0;
          const keyframes = steps.map(([time, opacity]) => {
            last = clamp(time / durationMs, last, 1);
            return { offset: round(last, 4), opacity };
          });
          this._addAnimation(cue, { target: 'display', duration, fill: 'both', keyframes });
          break;
        }
        case 't':
          applyTransition(arg);
          break;
        case 'k':
        case 'K':
        case 'kf':
        case 'ko': {
          const syllable = parseFloat(arg);
          if (Number.isNaN(syllable)) break;
          // Timestamp tags do not nest inside spans, so close the current run first.
          result += closeTag(open, 's');
          spanSig = '';
          const start = Math.min(karaokeTime, cue.endTime);
          result += toTimestampTag(start);
          state.sweep =
            name === 'k'
              ? undefined
              : {
                  kind: name === 'ko' ? 'outline' : 'fill',
                  delay: round(start - cue.startTime),
                  duration: syllable / 100,
                };
          // Negative durations appear in broken files; never move the karaoke clock backwards.
          karaokeTime += Math.max(0, syllable) / 100;
          break;
        }
        case 'p': {
          endDrawing();
          drawingScale = Math.max(0, parseInt(arg, 10) || 0);
          break;
        }
        case 'clip': {
          const nums = parseNumbers(arg);
          if (nums.length >= 4) {
            style.clip = { rect: [nums[0], nums[1], nums[2], nums[3]] };
            break;
          }
          const drawing = arg.match(CLIP_DRAWING_RE);
          if (drawing) {
            const { contours } = parseDrawing(
              drawing[2],
              drawing[1] ? parseInt(drawing[1], 10) : 1,
            );
            if (contours.length) style.clip = { contours };
          }
          break;
        }
        // `\iclip` (inverse clip) has no CSS equivalent without `clip-path` boolean ops; skipped.
        case 'iclip':
          break;
        default:
          applySpanTag(state, name, arg, defaults);
      }
    };

    /**
     * `\t([t1,t2,][accel,]tags)`: animates the supported tags from the current state to the new
     * state. Targets the cue box when no text has been emitted yet and no span is needed,
     * otherwise a fresh span run wrapping the following text. Tags that can not be animated are
     * applied immediately as their end state.
     */
    const applyTransition = (arg: string) => {
      const slash = arg.indexOf('\\'),
        params = parseNumbers(slash === -1 ? arg : arg.slice(0, slash)),
        tags = slash === -1 ? [] : parseOverrideTags(arg.slice(slash));

      let t1 = 0,
        t2 = durationMs,
        accel = 1;
      if (params.length === 1) accel = params[0];
      else if (params.length >= 2) {
        [t1, t2] = params;
        if (params.length > 2) accel = params[2];
      }
      if (!(t2 > t1)) [t1, t2] = [0, durationMs];
      if (!(accel > 0)) accel = 1;

      // Decide the target before the inner tags run so a formatting toggle inside `\t` (applied
      // immediately) does not change it.
      const needsSpan =
        result !== '' ||
        open.some((tag) => tag.key === 'c') ||
        state.sweep !== undefined ||
        this._spanStyle(state, defaults) !== null;

      const from = { ...(tState ?? state) },
        to = { ...from };
      for (const tag of tags) {
        if (!applySpanTag(to, tag.name, tag.arg, defaults)) applyTag(tag.name, tag.arg);
      }

      // Per-run values that can not be animated take their end value immediately.
      state.fontName = to.fontName;
      state.frx = to.frx;
      state.fry = to.fry;
      state.strike = to.strike;
      state.secondaryColor = to.secondaryColor;

      const keyframes = this._transitionKeyframes(from, to, defaults, accel);
      if (!keyframes) return;
      tState = to;

      const animation: CueAnimation = {
        delay: round(t1 / 1000),
        duration: round((t2 - t1) / 1000),
        fill: 'both',
        keyframes,
      };

      if (needsSpan) {
        state.run++;
        pendingAnims.push(animation);
      } else {
        animation.target = 'cue';
        this._addAnimation(cue, animation);
      }
    };

    // Only scan up to the last `}`: a `{` with no closing brace after it is plain text, and
    // stopping there keeps `[^}]*` from rescanning to the end of the line at every such `{`.
    const overrides = text.slice(0, text.lastIndexOf('}') + 1);
    OVERRIDE_BLOCK_RE.lastIndex = 0;

    while ((match = OVERRIDE_BLOCK_RE.exec(overrides))) {
      appendText(text.slice(lastIndex, match.index));
      lastIndex = match.index + match[0].length;
      for (const tag of parseOverrideTags(match[1])) applyTag(tag.name, tag.arg);
    }

    appendText(text.slice(lastIndex));
    endDrawing();
    result += closeTags(open);

    const wrapStyle = style.wrapStyle ?? this._wrapStyle;

    return result
      .replace(NEW_LINE_RE, '\n')
      .replace(SOFT_LINE_RE, wrapStyle === 2 ? '\n' : ' ')
      .replace(HARD_SPACE_RE, '&nbsp;')
      .trim();
  }

  /**
   * Converts `\p` drawing commands into a `CueDrawing`. The drawing is positioned by its bounding
   * box like a glyph (matching libass/VSFilter), sized as overlay percentages, filled with the
   * primary colour and stroked with the outline when `\bord` is in effect.
   */
  protected _createDrawing(text: string, scale: number, s: SpanState): CueDrawing | null {
    const { path, bbox } = parseDrawing(text, scale);
    if (!path || !bbox) return null;

    // Half of the (doubled) stroke sits outside the shape; grow the box so it is not clipped.
    const inset = s.bord > 0 ? s.bord : 0,
      x = bbox[0] - inset,
      y = bbox[1] - inset,
      width = bbox[2] - bbox[0] + inset * 2,
      height = bbox[3] - bbox[1] + inset * 2;

    const drawing: CueDrawing = {
      path,
      viewBox: [round(x), round(y), round(width), round(height)],
      width: this._pctX(width),
      height: this._pctY(height),
      fill: toRGBA(s.color),
    };
    if (inset) {
      drawing.stroke = toRGBA(s.outlineColor);
      drawing.strokeWidth = round(s.bord * 2);
    }
    return drawing;
  }

  /**
   * Maps a resolved SSA style onto the cue's structured `layout` and `textStyle`. Script pixel
   * values are converted to percentages of the play resolution so they scale with the overlay.
   */
  protected _applyStyle(cue: VTTCue, style: SSAStyle) {
    const layout: CueLayout = {},
      text: CueTextStyle = {},
      transform: string[] = [],
      effect = style.effect,
      lenY = (px: number) => this._lenY(px);

    if (style.fontName) text.fontFamily = toFontFamily(style.fontName);
    if (style.fontSize) text.fontSize = lenY(style.fontSize);
    if (style.primaryColor) text.color = toRGBA(style.primaryColor);
    if (style.bold) text.fontWeight = 'bold';
    if (style.italic) text.fontStyle = 'italic';

    const decorations = [style.underline && 'underline', style.strikeOut && 'line-through'].filter(
      Boolean,
    );
    if (decorations.length) text.textDecoration = decorations.join(' ');

    if (style.spacing) text.letterSpacing = lenY(style.spacing);
    if (style.alpha !== undefined) text.opacity = style.alpha + '';
    if (style.scaleX && style.scaleX !== 100) transform.push(`scaleX(${style.scaleX / 100})`);
    if (style.scaleY && style.scaleY !== 100) transform.push(`scaleY(${style.scaleY / 100})`);
    // ASS rotates counter-clockwise, CSS rotates clockwise.
    if (style.angle) transform.push(`rotate(${-style.angle}deg)`);

    // WrapStyle 0/3 (smart) and 1 (end-of-line) wrap; 2 never wraps. Balanced wrapping is what the
    // stylesheet already does, greedy is what browsers do, so both map to `pre-wrap`. Banners are
    // single lines by definition.
    const wrapStyle = style.wrapStyle ?? this._wrapStyle;
    text.whiteSpace = wrapStyle === 2 || effect?.type === 'banner' ? 'pre' : 'pre-wrap';
    text.lineHeight = 'normal';
    // Boxes hug the text like libass so unrelated cues do not collide across the whole width.
    layout.width = 'max-content';

    const horizontal = (style.alignment - 1) % 3, // 0 left, 1 center, 2 right
      vertical = Math.floor((style.alignment - 1) / 3); // 0 bottom, 1 middle, 2 top

    text.textAlign = horizontal === 0 ? 'left' : horizontal === 2 ? 'right' : 'center';

    if (style.pos) {
      layout.left = this._pctX(style.pos.x);
      layout.top = this._pctY(style.pos.y);
      layout.translate = {};
      if (horizontal === 1) layout.translate.x = -0.5;
      else if (horizontal === 2) layout.translate.x = -1;
      if (vertical === 0) layout.translate.y = -1;
      else if (vertical === 1) layout.translate.y = -0.5;
      // Explicitly positioned cues are not subject to collision avoidance (matches libass).
      layout.fixed = true;
    } else {
      const left = (style.marginL / this._playResX) * 100,
        right = (style.marginR / this._playResX) * 100;

      if (effect?.type === 'banner') {
        // Banners start off-screen; the animation carries them across (see `_applyEffect`).
        layout.left = effect.ltr ? 0 : 100;
      } else {
        layout.maxWidth = round(Math.max(0, 100 - left - right));

        if (horizontal === 0) {
          layout.left = round(left);
        } else if (horizontal === 2) {
          layout.right = round(right);
        } else {
          layout.left = round((left + (100 - right)) / 2);
          layout.translate = { x: -0.5 };
        }
      }

      if (effect?.type === 'scroll') {
        layout.top = this._pctY(effect.up ? effect.y2 : effect.y1);
      } else if (vertical === 2) {
        layout.top = this._pctY(style.marginV);
      } else if (vertical === 1) {
        layout.top = 50;
        layout.translate = { ...layout.translate, y: -0.5 };
      } else {
        layout.bottom = this._pctY(style.marginV);
      }

      // Effects animate the box position; collision avoidance must not fight them.
      if (effect) layout.fixed = true;
    }

    if (style.borderStyle === 3) {
      // Opaque box.
      if (style.backColor) text.backgroundColor = toRGBA(style.backColor);
      if (style.outline && style.outlineColor) {
        text.outline = `${lenY(style.outline)} solid ${toRGBA(style.outlineColor)}`;
      }
    } else {
      // Outline + drop shadow.
      text.backgroundColor = 'transparent';
      text.paddingY = '0';
      if (style.outline && style.outlineColor) {
        // Stroke is centered on the glyph edge so it needs to be twice the outline width.
        text.textStroke = `${lenY(style.outline * 2)} ${toRGBA(style.outlineColor)}`;
      }
      if (style.shadow) {
        const shadowColor = style.backColor ? toRGBA(style.backColor) : toRGBA(DEFAULT_SHADOW);
        text.textShadow = `${lenY(style.shadow)} ${lenY(style.shadow)} 0 ${shadowColor}`;
      }
    }

    // libass rotates and scales around `\\org`, or the alignment anchor by default; CSS defaults to
    // the box centre, which grows a bottom-anchored `\\fscy` line downwards off screen. Inline
    // `\\fr*`/`\\fsc*` runs are transformed as spans, so the pivot goes on those too.
    let origin: string | undefined;
    if (transform.length) text.transform = transform.join(' ');
    if (transform.length || this._animatesTransform(cue)) {
      text.transformOrigin = origin = this._transformOrigin(style, layout, horizontal, vertical);
    }
    for (const span of Object.values(cue.spans ?? {})) {
      if (span.transform) {
        span.transformOrigin = origin ??= this._transformOrigin(
          style,
          layout,
          horizontal,
          vertical,
        );
      }
    }

    // `\clip` on positioned cues is expressed in the box's own coordinate space (the origin is
    // known from `\pos`). Without `\pos` the box is placed by the layout engine, so rectangular
    // clips are handed over as overlay percentages and resolved against the final box at write
    // time; vector clips need a known origin and are only applied to positioned cues. `\move` cues
    // keep the clip attached to the moving box (approximation).
    if (style.clip && !effect) {
      if (style.pos) {
        layout.clipPath = this._clipPath(style.clip, layout);
      } else if ('rect' in style.clip) {
        const [x1, y1, x2, y2] = style.clip.rect;
        layout.clipRect = {
          left: this._pctX(Math.min(x1, x2)),
          top: this._pctY(Math.min(y1, y2)),
          right: this._pctX(Math.max(x1, x2)),
          bottom: this._pctY(Math.max(y1, y2)),
        };
      }
    }

    if (effect) this._applyEffect(cue, effect, layout);

    // Drawings sit exactly at their anchor; the text box's horizontal padding would offset them.
    if (style.drawing) cue.style = { ...cue.style, '--cue-padding-x': '0' };

    cue.layout = layout;
    cue.textStyle = text;
  }

  /** Transform origin: `\\org` when the box origin is known (positioned cues), else the anchor. */
  /** Whether a `\\t` animates the cue box's transform (span-targeted ones carry their own pivot). */
  protected _animatesTransform(cue: VTTCue) {
    return !!cue.animations?.some(
      (anim) =>
        typeof anim.target !== 'object' && anim.keyframes.some((frame) => 'transform' in frame),
    );
  }

  protected _transformOrigin(
    style: SSAStyle,
    layout: CueLayout,
    horizontal: number,
    vertical: number,
  ): string {
    if (style.org && style.pos) {
      const left = (layout.left ?? 0) / 100,
        top = (layout.top ?? 0) / 100,
        tx = -(layout.translate?.x ?? 0) * 100,
        ty = -(layout.translate?.y ?? 0) * 100;
      return (
        `calc(var(--overlay-width) * ${round(style.org.x / this._playResX - left, 5)} + ${round(tx)}%) ` +
        `calc(var(--overlay-height) * ${round(style.org.y / this._playResY - top, 5)} + ${round(ty)}%)`
      );
    }
    const x = horizontal === 0 ? '0%' : horizontal === 2 ? '100%' : '50%',
      y = vertical === 2 ? '0%' : vertical === 1 ? '50%' : '100%';
    return `${x} ${y}`;
  }

  /**
   * A `\clip` as a `polygon()` in the display box's coordinate space. The box origin is known from
   * `layout.left/top` (overlay percentages) and its anchor translation (a fraction of its own size),
   * so each script pixel maps to `calc(var(--overlay-width) * k + t%)`.
   */
  protected _clipPath(clip: SSAClip, layout: CueLayout): string {
    const left = (layout.left ?? 0) / 100,
      top = (layout.top ?? 0) / 100,
      tx = -(layout.translate?.x ?? 0) * 100,
      ty = -(layout.translate?.y ?? 0) * 100,
      x = (px: number) =>
        `calc(var(--overlay-width) * ${round(px / this._playResX - left, 5)} + ${round(tx)}%)`,
      y = (px: number) =>
        `calc(var(--overlay-height) * ${round(px / this._playResY - top, 5)} + ${round(ty)}%)`;

    const points: string[] = [];
    if ('rect' in clip) {
      const [x1, y1, x2, y2] = clip.rect;
      points.push(
        `${x(x1)} ${y(y1)}`,
        `${x(x2)} ${y(y1)}`,
        `${x(x2)} ${y(y2)}`,
        `${x(x1)} ${y(y2)}`,
      );
    } else {
      for (const contour of clip.contours) {
        for (let i = 0; i + 1 < contour.length; i += 2) {
          points.push(`${x(contour[i])} ${y(contour[i + 1])}`);
        }
      }
    }

    return `polygon(${'rect' in clip ? '' : 'evenodd, '}${points.join(', ')})`;
  }

  /**
   * `Effect` field animations. Speed is `1000 / delay` script pixels per second (VSFilter), clamped
   * so the travel never exceeds the cue duration; `delay` 0 spreads the travel over the whole cue.
   * The box's own size is unknown at parse time, so the travel adds a `translate` of the box size
   * to start/end fully outside the band or overlay.
   */
  protected _applyEffect(cue: VTTCue, effect: SSAEffect, layout: CueLayout) {
    const duration = cue.endTime - cue.startTime,
      speed = effect.delay > 0 ? 1000 / effect.delay : 0;

    if (effect.type === 'scroll') {
      const { y1, y2, up } = effect,
        travel = speed ? Math.min(duration, (y2 - y1) / speed) : duration,
        band = (progress: number) => this._scrollBand(effect, progress);

      layout.clipPath = band(0);
      this._addAnimation(cue, {
        target: 'display',
        duration: round(travel),
        fill: 'both',
        keyframes: up
          ? [
              { top: `${this._pctY(y2)}%`, translate: '0 0', clipPath: band(0) },
              { top: `${this._pctY(y1)}%`, translate: '0 -100%', clipPath: band(1) },
            ]
          : [
              { top: `${this._pctY(y1)}%`, translate: '0 -100%', clipPath: band(0) },
              { top: `${this._pctY(y2)}%`, translate: '0 0', clipPath: band(1) },
            ],
      });
    } else {
      const travel = speed ? Math.min(duration, this._playResX / speed) : duration;
      this._addAnimation(cue, {
        target: 'display',
        duration: round(travel),
        fill: 'both',
        keyframes: effect.ltr
          ? [
              { left: '0%', translate: '-100% 0' },
              { left: '100%', translate: '0 0' },
            ]
          : [
              { left: '100%', translate: '0 0' },
              { left: '0%', translate: '-100% 0' },
            ],
      });
    }
  }

  /**
   * The visible scroll band `[y1, y2]` in the moving box's coordinate space at the given progress.
   * Both the box offset (overlay percentage) and the box-size translation are linear in progress,
   * so the two end polygons interpolate exactly.
   */
  protected _scrollBand(effect: Extract<SSAEffect, { type: 'scroll' }>, progress: number) {
    const height = (effect.y2 - effect.y1) / this._playResY,
      k = effect.up ? -height * (1 - progress) : -height * progress,
      shift = round(effect.up ? progress * 100 : (1 - progress) * 100),
      top = `calc(var(--overlay-height) * ${round(k, 5)} + ${shift}%)`,
      bottom = `calc(var(--overlay-height) * ${round(k + height, 5)} + ${shift}%)`;
    return `polygon(-100% ${top}, 200% ${top}, 200% ${bottom}, -100% ${bottom})`;
  }

  protected _buildFields(values: string[]) {
    const fields: Record<string, string> = {};
    for (let i = 0; i < this._format!.length; i++) {
      fields[this._format![i]] = values[i];
    }
    return fields;
  }

  protected _parseTimestamp(startTimeText: string, endTimeText: string, lineCount: number) {
    const startTime = parseVTTTimestamp(startTimeText),
      endTime = parseVTTTimestamp(endTimeText);
    if (startTime !== null && endTime !== null && endTime > startTime) {
      return [startTime, endTime];
    } else {
      if (startTime === null) {
        this._handleError(this._errorBuilder?._badStartTimestamp(startTimeText, lineCount));
      }
      if (endTime === null) {
        this._handleError(this._errorBuilder?._badEndTimestamp(endTimeText, lineCount));
      }
      if (startTime !== null && endTime !== null && endTime <= startTime) {
        this._handleError(this._errorBuilder?._badRangeTimestamp(startTime, endTime, lineCount));
      }
    }
  }

  protected _parseFontLine(line: string) {
    const name = line.match(FONT_NAME_RE);
    if (name) {
      this._commitFont();
      this._font = { name: name[1].trim(), data: '' };
    } else if (this._font && line) {
      this._font.data += line;
    }
  }

  protected _commitFont() {
    if (!this._font) return;
    const data = decodeUUEncodedFont(this._font.data);
    if (data.length) this._fonts.push({ name: this._font.name, data });
    this._font = null;
  }

  protected _handleError(error?: ParseError) {
    if (!error) return;
    this._errors.push(error);
    if (this._init.strict) {
      this._init.cancel();
      throw error;
    } else {
      this._init.onError?.(error);
    }
  }
}

/**
 * Splits a dialogue/style line into at most `count` fields. The last field (Text) may contain
 * commas so it is never split.
 */
function splitFields(line: string, count: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < count - 1; i++) {
    const index = line.indexOf(',', start);
    if (index === -1) break;
    fields.push(line.slice(start, index).trim());
    start = index + 1;
  }
  fields.push(line.slice(start));
  return fields;
}

/**
 * Converts legacy SSA (v4.00) alignment to ASS numpad alignment. SSA uses 1-3 for bottom
 * left/center/right, +4 for top, +8 for middle.
 */
export function toNumpadAlignment(alignment: number): number {
  const horizontal = alignment & 3 || 2;
  if (alignment & 4) return 6 + horizontal;
  if (alignment & 8) return 3 + horizontal;
  return horizontal;
}

/**
 * Tokenizes an override block (`{...}` contents) into tags. Parenthesised arguments are read to
 * their matching `)` so nested tags (`\t(\fs40)`) and drawings (`\clip(m 0 0 l ...)`) stay whole.
 */
function parseOverrideTags(block: string): OverrideTag[] {
  const tags: OverrideTag[] = [];
  let i = 0;

  while (i < block.length) {
    if (block[i] !== '\\') {
      i++;
      continue;
    }
    i++;

    let name = TAG_NAMES.find((candidate) => block.startsWith(candidate, i)) ?? '';
    if (!name) {
      const generic = GENERIC_TAG_RE.exec(block.slice(i));
      if (!generic) continue;
      name = generic[0];
    }
    i += name.length;

    let arg: string;
    if (block[i] === '(') {
      let depth = 0,
        j = i;
      for (; j < block.length; j++) {
        if (block[j] === '(') depth++;
        else if (block[j] === ')' && --depth === 0) break;
      }
      arg = block.slice(i + 1, j);
      i = j + 1;
    } else {
      const next = block.indexOf('\\', i),
        end = next === -1 ? block.length : next;
      arg = block.slice(i, end);
      i = end;
    }

    tags.push({ name, arg: arg.trim() });
  }

  return tags;
}

/**
 * Applies a per-run typesetting tag to a span state. Returns `false` for tags that are not
 * per-run typesetting (positioning, formatting toggles, karaoke, ...).
 */
function applySpanTag(s: SpanState, name: string, arg: string, d: SpanState): boolean {
  const num = parseFloat(arg),
    has = !Number.isNaN(num);

  switch (name) {
    case 'fs':
      s.fontSize = has && num > 0 ? num : d.fontSize;
      break;
    case 'fn':
      s.fontName = arg || d.fontName;
      break;
    case 'fscx':
      s.scaleX = has ? num : d.scaleX;
      break;
    case 'fscy':
      s.scaleY = has ? num : d.scaleY;
      break;
    case 'fsc':
      s.scaleX = has ? num : d.scaleX;
      s.scaleY = has ? num : d.scaleY;
      break;
    case 'frx':
      s.frx = has ? num : d.frx;
      break;
    case 'fry':
      s.fry = has ? num : d.fry;
      break;
    case 'frz':
    case 'fr':
      s.frz = has ? num : d.frz;
      break;
    case 'bord':
    case 'xbord':
    case 'ybord':
      s.bord = has ? Math.max(0, num) : d.bord;
      break;
    case 'shad':
    case 'xshad':
    case 'yshad':
      s.shad = has ? Math.max(0, num) : d.shad;
      break;
    case 'blur':
      s.blur = has ? Math.max(0, num) : d.blur;
      break;
    case 'be':
      // Edge blur is a light box blur; roughly half a pixel per pass.
      s.blur = (has ? Math.max(0, num) : 1) * 0.5;
      break;
    case 'alpha':
    case '1a':
      s.alpha = parseAlpha(arg) ?? d.alpha;
      break;
    case '2a':
      s.secondaryColor = withAlpha(s.secondaryColor, parseAlpha(arg) ?? d.secondaryColor[3]);
      break;
    case '3a':
      s.outlineColor = withAlpha(s.outlineColor, parseAlpha(arg) ?? d.outlineColor[3]);
      break;
    case '4a':
      s.shadowColor = withAlpha(s.shadowColor, parseAlpha(arg) ?? d.shadowColor[3]);
      break;
    case 'c':
    case '1c':
      s.color = parseColorRGBA(arg) ?? d.color;
      break;
    case '2c':
      s.secondaryColor = parseColorRGBA(arg) ?? d.secondaryColor;
      break;
    case '3c':
      s.outlineColor = parseColorRGBA(arg) ?? d.outlineColor;
      break;
    case '4c':
      s.shadowColor = parseColorRGBA(arg) ?? d.shadowColor;
      break;
    case 'fsp':
      s.spacing = has ? num : d.spacing;
      break;
    case 's':
      s.strike = arg === '' ? !s.strike : num > 0;
      break;
    default:
      return false;
  }

  return true;
}

/** CSS properties whose values differ between two states (the animatable set for `\t`). */
function diffProps(a: SpanState, b: SpanState): AnimatableProp[] {
  const props: AnimatableProp[] = [];
  if (!sameColor(a.color, b.color)) props.push('color');
  if (!sameColor(a.outlineColor, b.outlineColor)) props.push('webkitTextStrokeColor');
  if (a.alpha !== b.alpha) props.push('opacity');
  if (a.scaleX !== b.scaleX || a.scaleY !== b.scaleY || a.frz !== b.frz) props.push('transform');
  if (a.bord !== b.bord) props.push('webkitTextStrokeWidth');
  if (a.blur !== b.blur) props.push('filter');
  if (a.fontSize !== b.fontSize) props.push('fontSize');
  if (a.spacing !== b.spacing) props.push('letterSpacing');
  if (a.shad !== b.shad || !sameColor(a.shadowColor, b.shadowColor)) props.push('textShadow');
  return props;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
    round(lerp(a[3], b[3], t)),
  ];
}

function lerpState(a: SpanState, b: SpanState, t: number): SpanState {
  return {
    ...b,
    fontSize: lerp(a.fontSize, b.fontSize, t),
    scaleX: lerp(a.scaleX, b.scaleX, t),
    scaleY: lerp(a.scaleY, b.scaleY, t),
    frz: lerp(a.frz, b.frz, t),
    bord: lerp(a.bord, b.bord, t),
    shad: lerp(a.shad, b.shad, t),
    blur: lerp(a.blur, b.blur, t),
    alpha: lerp(a.alpha, b.alpha, t),
    spacing: lerp(a.spacing, b.spacing, t),
    color: lerpColor(a.color, b.color, t),
    outlineColor: lerpColor(a.outlineColor, b.outlineColor, t),
    shadowColor: lerpColor(a.shadowColor, b.shadowColor, t),
  };
}

/**
 * Parses ASS drawing commands (`m`, `n`, `l`, `b`, `s`, `p`, `c`) into SVG path data scaled by
 * `1 / 2^(scale - 1)`. B-splines are converted to cubic Béziers (uniform B-spline to Bézier
 * basis change), and every segment is also flattened into polyline contours for `\clip`.
 */
function parseDrawing(text: string, scale: number): ParsedDrawing {
  const factor = 1 / 2 ** (Math.max(1, scale) - 1),
    tokens = text.trim().split(WHITESPACE_RE),
    groups: { cmd: string; args: number[] }[] = [];

  for (const token of tokens) {
    if (/^[mnlbspc]$/i.test(token)) {
      groups.push({ cmd: token.toLowerCase(), args: [] });
    } else if (groups.length) {
      const value = parseFloat(token);
      if (!Number.isNaN(value)) groups[groups.length - 1].args.push(value * factor);
    }
  }

  let path = '',
    x = 0,
    y = 0,
    minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    contour: number[] = [],
    spline: number[] | null = null,
    closeSpline = false;

  const contours: number[][] = [];

  const track = (px: number, py: number) => {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  };

  const endContour = () => {
    if (contour.length >= 6) contours.push(contour);
    contour = [];
  };

  const moveTo = (px: number, py: number, close: boolean) => {
    flushSpline();
    if (path && close) path += 'Z';
    endContour();
    x = px;
    y = py;
    path += `M${fmt(x)} ${fmt(y)}`;
    track(x, y);
    contour.push(x, y);
  };

  const lineTo = (px: number, py: number) => {
    x = px;
    y = py;
    path += `L${fmt(x)} ${fmt(y)}`;
    track(x, y);
    contour.push(x, y);
  };

  const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    path += `C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x3)} ${fmt(y3)}`;
    track(x1, y1);
    track(x2, y2);
    track(x3, y3);
    for (let i = 1; i <= FLATTEN_STEPS; i++) {
      const t = i / FLATTEN_STEPS,
        mt = 1 - t,
        a = mt * mt * mt,
        b = 3 * mt * mt * t,
        c = 3 * mt * t * t,
        d = t * t * t;
      contour.push(a * x + b * x1 + c * x2 + d * x3, a * y + b * y1 + c * y2 + d * y3);
    }
    x = x3;
    y = y3;
  };

  /** Converts the pending B-spline control points to Bézier segments. */
  const flushSpline = () => {
    if (!spline) return;
    const pts = spline;
    spline = null;
    if (closeSpline) {
      closeSpline = false;
      // Wrap around so the curve returns to where it started.
      pts.push(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
    }
    for (let i = 0; i + 7 < pts.length; i += 2) {
      const [p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y] = pts.slice(i, i + 8),
        b0x = (p0x + 4 * p1x + p2x) / 6,
        b0y = (p0y + 4 * p1y + p2y) / 6;
      if (i === 0) lineTo(b0x, b0y);
      curveTo(
        (2 * p1x + p2x) / 3,
        (2 * p1y + p2y) / 3,
        (p1x + 2 * p2x) / 3,
        (p1y + 2 * p2y) / 3,
        (p1x + 4 * p2x + p3x) / 6,
        (p1y + 4 * p2y + p3y) / 6,
      );
    }
  };

  for (const { cmd, args } of groups) {
    switch (cmd) {
      case 'm':
      case 'n':
        if (args.length >= 2) moveTo(args[0], args[1], cmd === 'm');
        break;
      case 'l':
        flushSpline();
        if (!path) moveTo(args[0] ?? 0, args[1] ?? 0, false);
        for (let i = 0; i + 1 < args.length; i += 2) lineTo(args[i], args[i + 1]);
        break;
      case 'b':
        flushSpline();
        if (!path) moveTo(args[0] ?? 0, args[1] ?? 0, false);
        for (let i = 0; i + 5 < args.length; i += 6) {
          curveTo(args[i], args[i + 1], args[i + 2], args[i + 3], args[i + 4], args[i + 5]);
        }
        break;
      case 's':
        flushSpline();
        if (!path) moveTo(args[0] ?? 0, args[1] ?? 0, false);
        spline = [x, y, ...args];
        break;
      case 'p':
        if (spline) spline.push(...args);
        break;
      case 'c':
        if (spline) {
          closeSpline = true;
          flushSpline();
        }
        break;
    }
  }

  flushSpline();
  if (path) path += 'Z';
  endContour();

  return {
    path,
    bbox: path ? [minX, minY, maxX, maxY] : null,
    contours,
  };
}

/** Parses the `Effect` field (`Scroll up;y1;y2;delay[;fadeaway]`, `Banner;delay[;ltr][;fadeaway]`). */
function parseEffect(effect: string, playResY: number): SSAEffect | undefined {
  const parts = effect.split(';').map((part) => part.trim()),
    name = parts[0].toLowerCase();

  if (name === 'scroll up' || name === 'scroll down') {
    let y1 = parseFloat(parts[1]) || 0,
      y2 = parseFloat(parts[2]) || playResY;
    if (y1 > y2) [y1, y2] = [y2, y1];
    return { type: 'scroll', up: name === 'scroll up', y1, y2, delay: parseFloat(parts[3]) || 0 };
  }

  if (name === 'banner') {
    return { type: 'banner', delay: parseFloat(parts[1]) || 0, ltr: parts[2] === '1' };
  }
}

function toggleTag(open: OpenTags, key: 'i' | 'b' | 'u', start: string, end: string, arg: string) {
  const isOpen = open.some((tag) => tag.key === key),
    enabled = arg === '' ? !isOpen : parseInt(arg, 10) > 0;
  if (enabled && !isOpen) return openTag(open, key, start, end);
  if (!enabled && isOpen) return closeTag(open, key);
  return '';
}

/** Registers an open tag. Nothing is emitted until text follows (see `flushOpenTags`). */
function openTag(open: OpenTags, key: OpenTags[number]['key'], start: string, end: string) {
  open.push({ key, open: start, close: end, emitted: false });
  return '';
}

/** Emits the opening markup of every registered tag that has not been written yet. */
function flushOpenTags(open: OpenTags) {
  let result = '';
  for (const tag of open) {
    if (!tag.emitted) {
      result += tag.open;
      tag.emitted = true;
    }
  }
  return result;
}

/**
 * Closes the given tag. Tags opened after it are closed first and re-registered afterwards so the
 * output is always properly nested (SSA tags toggle independently, HTML tags nest). Tags that were
 * never emitted close silently.
 */
function closeTag(open: OpenTags, key: OpenTags[number]['key']) {
  const index = open.findIndex((tag) => tag.key === key);
  if (index === -1) return '';

  let result = '';
  const reopen = open.splice(index + 1);
  for (let i = reopen.length - 1; i >= 0; i--) if (reopen[i].emitted) result += reopen[i].close;
  const closed = open.pop()!;
  if (closed.emitted) result += closed.close;
  for (const tag of reopen) open.push({ ...tag, emitted: false });
  return result;
}

function closeTags(open: OpenTags) {
  let result = '';
  while (open.length) {
    const tag = open.pop()!;
    if (tag.emitted) result += tag.close;
  }
  return result;
}

function escapeText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function toTimestampTag(time: number) {
  const hours = Math.floor(time / 3600),
    minutes = Math.floor((time % 3600) / 60),
    seconds = Math.floor(time % 60),
    ms = Math.round((time - Math.floor(time)) * 1000);
  return `<${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}>`;
}

function toFontFamily(name: string) {
  return `"${name.replace(/"/g, '')}", sans-serif`;
}

function pad(num: number, length = 2) {
  return (num + '').padStart(length, '0');
}

function round(num: number, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

/** Formats a path coordinate. */
function fmt(num: number) {
  return round(num) + '';
}

function clamp(num: number, min: number, max: number) {
  return Math.min(Math.max(num, min), max);
}

function isTruthyFlag(value: string) {
  const num = parseInt(value, 10);
  return !Number.isNaN(num) && num !== 0;
}

/** Comma separated numbers (`\pos(640,360)` arguments). */
function parseNumbers(arg: string): number[] {
  return arg
    .split(',')
    .map((value) => parseFloat(value))
    .filter((value) => !Number.isNaN(value));
}

/** `&HAA&` alpha (0 opaque, 255 transparent) to opacity. */
function parseAlpha(arg: string): number | null {
  const match = arg.match(ALPHA_TAG_RE);
  if (!match) return null;
  return round(1 - parseInt(match[1], 16) / 255);
}

function withAlpha(color: RGBA, alpha: number): RGBA {
  return [color[0], color[1], color[2], alpha];
}

function sameColor(a: RGBA, b: RGBA) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function toRGBA(color: RGBA) {
  return 'rgba(' + color.join(',') + ')';
}

function toHex(color: RGBA) {
  return '#' + [color[0], color[1], color[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Parses SSA/ASS colours (`&HAABBGGRR`, `&HBBGGRR&`, or decimal) to `[r, g, b, a]`. */
function parseColorRGBA(color: string): RGBA | null {
  const match = color.match(COLOR_TAG_RE),
    raw = match ? match[1] : color.trim();

  const abgr = match ? parseInt(raw.padStart(8, '0'), 16) : parseInt(raw, 10);
  if (Number.isNaN(abgr) || abgr < 0) return null;

  const a = ((abgr >>> 24) & 0xff) ^ 0xff,
    b = (abgr >> 16) & 0xff,
    g = (abgr >> 8) & 0xff,
    r = abgr & 0xff;

  return [r, g, b, round(a / 255)];
}

/**
 * Parses SSA/ASS colours (`&HAABBGGRR`, `&HBBGGRR&`, or decimal) to CSS. When `hex` is true the
 * result is a `#rrggbb` string suitable for a `<c.#rrggbb>` tag, otherwise an `rgba()` string.
 */
export function parseColor(color: string, hex = false): string | null {
  const rgba = parseColorRGBA(color);
  if (!rgba) return null;
  return hex ? toHex(rgba) : toRGBA(rgba);
}

export default function createSSAParser() {
  return new SSAParser();
}
