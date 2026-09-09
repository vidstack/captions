import { CueTrack } from '../vtt/cue-track';
import type { Box } from '../vtt/overlay/box';
import { layoutItems, type LayoutInput } from '../vtt/overlay/layout';
import { orderForPositioning, type StackingMode } from '../vtt/overlay/ordering';
import type { CaptionsRendererTrack } from '../vtt/overlay/renderer-core';
import type { VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';
import type { VTTRegion } from '../vtt/vtt-region';
import {
  measureCue,
  measureRegion,
  regionOf,
  type MeasuredCue,
  type MeasuredRegion,
} from './measure';
import { ImageCache, paintCue, paintRegion, type PaintContext } from './paint';
import { canvasTextMeasurer, type TextMeasurer } from './text-measurer';
import { resolveTheme, type CanvasCaptionsOptions, type CanvasTheme } from './theme';

export interface PaintCaptionsOptions extends CanvasCaptionsOptions {
  /** Frame size in canvas pixels (defaults to the context's canvas size). */
  width?: number;
  height?: number;
  /** Text measurer (defaults to the context itself). */
  measurer?: TextMeasurer;
  /** Reused across frames so cues are only flowed once per frame size. */
  cache?: Map<VTTCue, MeasuredCue>;
  images?: ImageCache;
  /** `Collisions` etc. from the parsed track. */
  metadata?: VTTHeaderMetadata;
}

export type LayoutTargetItem =
  | { kind: 'cue'; item: MeasuredCue; box: Box }
  | { kind: 'region'; item: MeasuredRegion; box: Box };

export interface CaptionsLayout {
  theme: CanvasTheme;
  /** Positioned cues and regions in paint order, with their final boxes in container pixels. */
  targets: LayoutTargetItem[];
}

/**
 * MEASURE + LAYOUT without painting: flows every cue (cached per frame size) and runs the pure
 * layout engine the DOM renderer uses. Useful for hit testing, thumbnails, and tests.
 */
export function layoutCaptions(
  cues: readonly VTTCue[],
  measurer: TextMeasurer,
  options: PaintCaptionsOptions & { width: number; height: number },
): CaptionsLayout {
  const theme = resolveTheme(options, options.width, options.height),
    cache = options.cache ?? new Map<VTTCue, MeasuredCue>(),
    stacking = options.stacking ?? stackingFromMetadata(options.metadata) ?? 'reading-order';

  const measured = (cue: VTTCue) => {
    let m = cache.get(cue);
    if (!m) cache.set(cue, (m = measureCue(cue, theme, measurer)));
    return m;
  };

  // Regions group their cues; everything else is positioned on its own.
  const regions = new Map<VTTRegion, MeasuredCue[]>();
  for (const cue of cues) {
    const region = regionOf(cue);
    if (region) (regions.get(region) ?? regions.set(region, []).get(region)!).push(measured(cue));
  }

  const targets: Omit<LayoutTargetItem, 'box'>[] = [],
    inputs: LayoutInput[] = [],
    seen = new Set<VTTRegion>();
  for (const cue of orderForPositioning(cues as VTTCue[], stacking)) {
    const region = regionOf(cue);
    if (region) {
      if (seen.has(region)) continue;
      seen.add(region);
      const item = measureRegion(region, regions.get(region)!, theme);
      targets.push({ kind: 'region', item });
      inputs.push(item.input);
    } else {
      const item = measured(cue);
      targets.push({ kind: 'cue', item });
      inputs.push({ ...item.input, box: { ...item.input.box } });
    }
  }

  const container: Box = {
      ...theme.container,
      right: theme.container.width,
      bottom: theme.container.height,
    },
    boxes = layoutItems(container, inputs);
  return {
    theme,
    targets: targets.map((target, i) => ({ ...target, box: boxes[i] }) as LayoutTargetItem),
  };
}

/**
 * Paints the given cues at `currentTime` onto a 2D context: measure (text flow), layout (the
 * same pure engine the DOM renderer uses), paint. Stateless apart from the optional caches, so
 * it fits any frame loop, `VideoFrame` compositor, or one-off thumbnail.
 */
export function paintCaptions(
  ctx: PaintContext,
  cues: readonly VTTCue[],
  currentTime: number,
  options: PaintCaptionsOptions = {},
) {
  const width = options.width ?? ctx.canvas.width,
    height = options.height ?? ctx.canvas.height,
    measurer = options.measurer ?? canvasTextMeasurer(ctx),
    images = options.images ?? new ImageCache(() => {}),
    { theme, targets } = layoutCaptions(cues, measurer, { ...options, width, height }),
    paint = { time: currentTime, theme, images, measurer };
  for (const target of targets) {
    if (target.kind === 'region') paintRegion(ctx, target.item, target.box, paint);
    else paintCue(ctx, target.item, target.box, paint);
  }
}

function stackingFromMetadata(metadata?: VTTHeaderMetadata): StackingMode | undefined {
  const collisions = metadata?.Collisions?.toLowerCase();
  return collisions === 'normal' ? 'spec' : collisions === 'reverse' ? 'reading-order' : undefined;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * A captions renderer that paints into a canvas instead of the DOM. Same track model and time
 * driving as `CaptionsRenderer` (it works with `syncCaptionsRenderer`), so it can back burn-in,
 * picture-in-picture and iOS fullscreen via `captureStream`, thumbnails, and DOM-less runtimes.
 *
 * Everything scales with the canvas size (fonts are a fraction of the height), so a
 * device-pixel-ratio-sized canvas simply renders sharper.
 */
export class CanvasCaptionsRenderer {
  readonly canvas: AnyCanvas;
  private readonly _ctx: PaintContext;
  private _options: CanvasCaptionsOptions;
  private _track = new CueTrack();
  private _unsubscribe: (() => void) | null = null;
  private _currentTime = 0;
  private _metadata: VTTHeaderMetadata | undefined;
  private readonly _cache = new Map<VTTCue, MeasuredCue>();
  private _cacheKey = '';
  private readonly _images = new ImageCache(() => this.update());
  private _activeCues: VTTCue[] = [];

  constructor(canvas: AnyCanvas, options: CanvasCaptionsOptions = {}) {
    this.canvas = canvas;
    this._options = options;
    const ctx = canvas.getContext('2d') as PaintContext | null;
    if (!ctx) throw new Error('[media-captions] could not get a 2D canvas context');
    this._ctx = ctx;
  }

  get options(): CanvasCaptionsOptions {
    return this._options;
  }

  /** Replaces the presentation options and repaints. */
  set options(options: CanvasCaptionsOptions) {
    this._options = options;
    this._cache.clear();
    this.update();
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(time: number) {
    this._currentTime = time;
    this.update();
  }

  get track(): CueTrack {
    return this._track;
  }

  /** Cues painted by the last update, in cue order. */
  get activeCues(): readonly VTTCue[] {
    return this._activeCues;
  }

  /** The theme as resolved for the current canvas size. */
  get theme(): CanvasTheme {
    return resolveTheme(this._options, this.canvas.width, this.canvas.height);
  }

  changeTrack(track: CaptionsRendererTrack) {
    this.reset();
    this._metadata = track.metadata;
    this.attachTrack(track.cues instanceof CueTrack ? track.cues : new CueTrack(track.cues));
  }

  attachTrack(track: CueTrack) {
    this._unsubscribe?.();
    this._track = track;
    this._unsubscribe = track.on((cue, type) => {
      if (type === 'clear') this._cache.clear();
      else if (cue && type !== 'add') this._cache.delete(cue);
      this.update();
    });
    this.update();
  }

  addCue(cue: VTTCue) {
    this._track.add(cue);
  }

  removeCue(cue: VTTCue) {
    this._track.remove(cue);
  }

  /** Repaints the current time (call after resizing the canvas). */
  update() {
    const { width, height } = this.canvas,
      key = `${width}x${height}`;
    if (key !== this._cacheKey) {
      this._cache.clear();
      this._cacheKey = key;
    }
    this._ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    this._activeCues = this._track.activeAt(this._currentTime);
    paintCaptions(this._ctx, this._activeCues, this._currentTime, {
      ...this._options,
      width,
      height,
      cache: this._cache,
      images: this._images,
      metadata: this._metadata,
    });
  }

  reset() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._track = new CueTrack();
    this._cache.clear();
    this._metadata = undefined;
    this._activeCues = [];
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.reset();
    this._images.clear();
  }
}
