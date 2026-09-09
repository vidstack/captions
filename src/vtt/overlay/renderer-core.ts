import { setCSSVar, setDataAttr, setPartAttr } from '../../utils/style';
import { debounce } from '../../utils/timing';
import { CueTrack } from '../cue-track';
import { renderVTTTokensDOM, updateTimedVTTCueNodes } from '../render-cue';
import { tokenizeVTTCue } from '../tokenize-cue';
import type { VTTCue } from '../vtt-cue';
import type { VTTHeaderMetadata } from '../vtt-header';
import type { VTTRegion } from '../vtt-region';
import { createBox, LAYOUT_CACHE, type Box } from './box';
import type { LayoutTarget, RendererCapability, RendererContext, RendererFeature } from './feature';
import { layoutItems, type LayoutInput } from './layout';
import { orderForPositioning, type StackingMode } from './ordering';
import {
  computeCuePosition,
  computeCuePositionAlignment,
  measureCue,
  writeCueBox,
} from './position-cue';

/**
 * The composable captions renderer. On its own it renders WebVTT cues per the rendering spec
 * (line snapping, percentage lines, position/size/align, vertical text, collision avoidance,
 * timed text, `enter`/`exit` events) and follows a {@link CueTrack}. Regions, SSA/TTML
 * typesetting, media-synced animations, screen reader announcements, and `STYLE` blocks are
 * {@link RendererFeature}s passed through `init.features`, so an SRT player never ships them.
 *
 * `CaptionsRenderer` is this class with every feature installed; `createRenderer` is the
 * function form.
 */
export class CaptionsRendererCore {
  readonly overlay: HTMLElement;
  private _overlayBox!: Box;

  private _currentTime = 0;
  private _dir: 'ltr' | 'rtl' = 'ltr';
  private _activeCues: VTTCue[] = [];

  private readonly _resizeObserver: ResizeObserver;
  private readonly _cues = new Map<VTTCue, HTMLElement>();
  /** Resolved container per rendered cue (`null` = the overlay). */
  private readonly _containers = new Map<VTTCue, HTMLElement | null>();
  private readonly _retention: number | undefined;

  private _track = new CueTrack();
  private _unsubscribe: (() => void) | null = null;

  private _stacking: StackingMode | undefined;
  private _metadataStacking: StackingMode | undefined;
  private readonly _lineStep: 'line-height' | 'box';
  private _reducedMotion: boolean;

  private readonly _features: RendererFeature[];
  private readonly _ctx: RendererContext;
  private readonly _capabilities = new Set<RendererCapability>();
  private _warned: Set<RendererCapability> | undefined;

  /* Text direction. */
  get dir() {
    return this._dir;
  }

  set dir(dir) {
    this._dir = dir;
    setDataAttr(this.overlay, 'dir', dir);
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(time) {
    this._currentTime = time;
    this.update();
  }

  /** Cues currently displayed, in render order. */
  get activeCues(): readonly VTTCue[] {
    return this._activeCues;
  }

  /** The track being rendered. Add, update, or remove cues on it directly for live content. */
  get track(): CueTrack {
    return this._track;
  }

  /** Installed features, in phase-independent order. */
  get features(): readonly RendererFeature[] {
    return this._features;
  }

  /**
   * When true, cue animations jump to their final state instead of playing, and the stylesheet
   * disables transitions (`data-reduced-motion`). Defaults to the user's OS preference.
   */
  get reducedMotion() {
    return this._reducedMotion;
  }

  set reducedMotion(value: boolean) {
    this._reducedMotion = value;
    if (value) setDataAttr(this.overlay, 'reduced-motion');
    else this.overlay.removeAttribute('data-reduced-motion');
    this.update(true);
  }

  constructor(overlay: HTMLElement, init?: CaptionsRendererInit) {
    this.overlay = overlay;
    this._features = dedupeFeatures(init?.features ?? []);
    for (const feature of this._features) {
      for (const capability of feature.capabilities ?? []) this._capabilities.add(capability);
    }

    this._ctx = {
      renderer: this,
      overlay,
      get overlayBox() {
        return this.renderer._overlayBox;
      },
    };

    this.dir = init?.dir ?? 'ltr';
    this._retention = init?.retention;
    this._stacking = init?.stacking;
    this._lineStep = init?.lineStep ?? 'line-height';
    if (init?.safeArea !== undefined) setCSSVar(overlay, 'overlay-padding', init.safeArea + '%');
    this._reducedMotion =
      init?.reducedMotion === 'auto' || init?.reducedMotion === undefined
        ? typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
        : init.reducedMotion;
    if (this._reducedMotion) setDataAttr(overlay, 'reduced-motion');
    overlay.setAttribute('translate', 'yes');
    overlay.setAttribute('aria-live', 'off');
    overlay.setAttribute('aria-atomic', 'true');
    setPartAttr(overlay, 'captions');
    this._updateOverlay();

    for (const feature of this._features) feature.setup?.(this._ctx);

    this._resizeObserver = new ResizeObserver(this._resizing.bind(this));
    this._resizeObserver.observe(overlay);
  }

  changeTrack(track: CaptionsRendererTrack) {
    const { regions, cues, metadata, styles } = track;
    this.reset();
    this._applyMetadata(metadata);

    if (__DEV__) {
      if (regions?.length) this._require('regions', 'the track has regions');
      if (styles?.length) this._require('styles', 'the track has STYLE blocks');
    }

    for (const feature of this._features) feature.changeTrack?.(this._ctx, track);

    this.attachTrack(
      cues instanceof CueTrack ? cues : new CueTrack(cues, { retention: this._retention }),
    );
  }

  /**
   * Renders cues from the given track and follows its changes. Cues added, updated (e.g., a live
   * cue whose end time becomes known), or removed on the track are reflected on the next update.
   */
  attachTrack(track: CueTrack) {
    this._unsubscribe?.();
    this._disposeCues();
    this._activeCues = [];

    this._track = track;
    this._unsubscribe = track.on((cue, type) => {
      if (type === 'clear') {
        this._disposeCues();
      } else if (type === 'remove' || type === 'update') {
        // Drop the element so updated cues are re-rendered with their new content.
        this._disposeCue(cue!);
      }
      this.update(true);
    });

    this.update();
  }

  addCue(cue: VTTCue) {
    this._track.add(cue);
  }

  removeCue(cue: VTTCue) {
    this._track.remove(cue);
  }

  update(forceUpdate = false) {
    this._render(forceUpdate);
  }

  reset() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._track = new CueTrack();
    this._disposeCues();
    this._metadataStacking = undefined;
    this._activeCues = [];
    for (const feature of this._features) feature.reset?.(this._ctx);
    this.overlay.textContent = '';
    this.overlay.removeAttribute('lang');
  }

  destroy() {
    this.reset();
    this._resizeObserver.disconnect();
    for (const feature of this._features) feature.destroy?.(this._ctx);
  }

  private _resizing() {
    this._resize();
  }

  // Debounced so a continuous resize (e.g., entering fullscreen) re-lays out once. Cue changes in
  // the meantime still render against the last known overlay size rather than being dropped.
  protected _resize = debounce(() => {
    this._updateOverlay();
    for (const el of this._cues.values()) el[LAYOUT_CACHE] = null;
    for (const feature of this._features) feature.resize?.(this._ctx);
    this._render(true);
  }, 50);

  private _updateOverlay() {
    this._overlayBox = createBox(this.overlay);
    setCSSVar(this.overlay, 'overlay-width', this._overlayBox.width + 'px');
    setCSSVar(this.overlay, 'overlay-height', this._overlayBox.height + 'px');
  }

  private _applyMetadata(metadata?: VTTHeaderMetadata) {
    // WebVTT header `Language: en-US` (also lower-cased variants). Setting `lang` enables correct
    // hyphenation, quotes, and font fallback for the cue text.
    const lang = metadata?.Language ?? metadata?.language ?? metadata?.lang;
    if (lang) this.overlay.setAttribute('lang', lang);

    // SSA `Collisions: Normal` keeps earlier lines in place and pushes newer ones away (the WebVTT
    // spec's rule); `Reverse` matches our reading-order default.
    const collisions = metadata?.Collisions?.toLowerCase();
    this._metadataStacking =
      collisions === 'normal' ? 'spec' : collisions === 'reverse' ? 'reading-order' : undefined;
  }

  private _disposeCue(cue: VTTCue) {
    const el = this._cues.get(cue);
    if (!el) return;
    el.remove();
    this._cues.delete(cue);
    this._containers.delete(cue);
    for (const feature of this._features) feature.disposeCue?.(this._ctx, cue);
  }

  private _disposeCues() {
    for (const cue of Array.from(this._cues.keys())) this._disposeCue(cue);
  }

  private _render(forceUpdate = false) {
    if (!this._track.size && !this._activeCues.length) return;

    let cue: VTTCue,
      activeCues = this._track.activeAt(this._currentTime),
      activeSet = new Set(activeCues),
      // Containers that may have lost their last cue.
      vacated: HTMLElement[] = [];

    // Remove cues that are no longer active (diffed by identity so unrelated cues are untouched).
    for (let i = 0; i < this._activeCues.length; i++) {
      cue = this._activeCues[i];
      if (activeSet.has(cue)) continue;

      const container = this._containers.get(cue);
      if (container) vacated.push(container);

      const cueEl = this._cues.get(cue);
      if (cueEl?.isConnected) {
        cueEl.remove();
        forceUpdate = true;
      }
    }

    // Add new cues.
    const occupied = new Set<HTMLElement>();
    for (let i = 0; i < activeCues.length; i++) {
      cue = activeCues[i];
      let cueEl = this._cues.get(cue);
      if (!cueEl) this._cues.set(cue, (cueEl = this._createCueElement(cue)));

      const container = this._containers.get(cue);
      if (container) {
        occupied.add(container);
        if (!container.hasAttribute('data-active')) {
          // Deferred a frame so the region's scroll transition starts from its resting state.
          requestAnimationFrame(() => setDataAttr(container, 'active'));
          forceUpdate = true;
        }
      }

      if (!cueEl.isConnected) {
        const parent = container || this.overlay;
        // Keep DOM order equal to cue order so regions roll up correctly after seeking.
        parent.insertBefore(cueEl, this._findNextConnectedCue(activeCues, i, parent));
        forceUpdate = true;
      }
    }

    for (const container of vacated) {
      if (!occupied.has(container) && container.hasAttribute('data-active')) {
        container.removeAttribute('data-active');
        forceUpdate = true;
      }
    }

    if (forceUpdate) this._layout(activeCues);

    updateTimedVTTCueNodes(this.overlay, this._currentTime);

    // Cue lifecycle events (mirrors the native TextTrackCue `enter`/`exit`).
    const previous = this._activeCues;
    this._activeCues = activeCues;
    const entered: VTTCue[] = [],
      exited: VTTCue[] = [];
    for (const old of previous) {
      if (!activeSet.has(old)) {
        exited.push(old);
        old.dispatchEvent(new Event('exit'));
      }
    }
    for (const active of activeCues) {
      if (!previous.includes(active)) {
        entered.push(active);
        active.dispatchEvent(new Event('enter'));
      }
    }

    for (const feature of this._features) {
      feature.update?.(this._ctx, activeCues, entered, exited);
    }

    if (this._retention !== undefined) this._track.evict(this._currentTime);
  }

  /**
   * Positions all active cues and containers in three phases so the browser lays out at most
   * twice per render: measure (reads), layout (pure math), write (CSS variables).
   */
  private _layout(activeCues: VTTCue[]) {
    const container = this._overlayBox;
    // Hidden or unmeasured overlays have no size; skip until the next resize gives us one.
    if (!container.width || !container.height) return;

    const seen = new Set<HTMLElement>(),
      targets: LayoutTarget[] = [];

    for (const cue of orderForPositioning(
      activeCues,
      this._stacking ?? this._metadataStacking ?? 'reading-order',
    )) {
      const containerEl = this._containers.get(cue),
        el = containerEl ?? this._cues.get(cue)!;
      if (seen.has(el)) continue;
      seen.add(el);
      targets.push({ el, cue, container: !!containerEl });
    }

    // Measure 1 + write: dependent measurements (e.g., region heights from their cue lines).
    for (const feature of this._features) feature.beforeMeasure?.(this._ctx, targets);

    // Measure 2: every box, cached until the next resize.
    const inputs: LayoutInput[] = targets.map((target) =>
      target.container
        ? this._measureContainer(target)
        : measureCue(container, target.cue, target.el, { lineStep: this._lineStep }),
    );

    // Layout: pure.
    const boxes = layoutItems(container, inputs);

    // Write.
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (target.container) {
        for (const feature of this._features) {
          if (feature.writeContainer?.(this._ctx, target, boxes[i])) break;
        }
      } else {
        writeCueBox(container, target.el, boxes[i]);
        for (const feature of this._features) {
          feature.writeCue?.(this._ctx, target.cue, target.el, boxes[i]);
        }
      }
    }
  }

  private _measureContainer(target: LayoutTarget): LayoutInput {
    for (const feature of this._features) {
      const input = feature.measureContainer?.(this._ctx, target);
      if (input) return input;
    }
    return { kind: 'region', box: createBox(target.el) };
  }

  private _findNextConnectedCue(activeCues: VTTCue[], index: number, parent: Element) {
    for (let i = index + 1; i < activeCues.length; i++) {
      const el = this._cues.get(activeCues[i]);
      if (el && el.parentNode === parent) return el;
    }
    return null;
  }

  private _resolveContainer(cue: VTTCue): HTMLElement | null {
    for (const feature of this._features) {
      const container = feature.containerFor?.(this._ctx, cue);
      if (container !== undefined) return container;
    }
    return null;
  }

  private _createCueElement(cue: VTTCue): HTMLElement {
    const display = document.createElement('div'),
      position = computeCuePosition(cue, this._dir),
      positionAlignment = computeCuePositionAlignment(cue, this._dir);

    setPartAttr(display, 'cue-display');
    if (cue.vertical !== '') setDataAttr(display, 'vertical');
    setCSSVar(display, 'cue-text-align', cue.align);

    const el = document.createElement('div');
    setPartAttr(el, 'cue');
    if (cue.id) setDataAttr(el, 'id', cue.id);
    el.append(renderVTTTokensDOM(tokenizeVTTCue(cue), this._currentTime, document, cue.layout));
    display.append(el);

    if (__DEV__) {
      if (cue.region) this._require('regions', 'a cue has a region');
      if (cue.layout || cue.textStyle)
        this._require('typesetting', 'a cue has layout or text style');
      if (cue.animations?.length) this._require('animations', 'a cue has animations');
    }

    const container = this._resolveContainer(cue);
    this._containers.set(cue, container);

    for (const feature of this._features) feature.createCue?.(this._ctx, cue, { display, cue: el });

    // Raw CSS escape hatch (properties or `--cue-*` custom properties).
    if (cue.style) {
      for (const prop of Object.keys(cue.style)) display.style.setProperty(prop, cue.style[prop]);
    }

    // https://www.w3.org/TR/webvtt1/#processing-cue-settings
    if (!container) {
      setCSSVar(
        display,
        'cue-writing-mode',
        cue.vertical === ''
          ? 'horizontal-tb'
          : cue.vertical === 'lr'
            ? 'vertical-lr'
            : 'vertical-rl',
      );

      // A feature (typesetting) or the raw style escape hatch may have sized the box already.
      if (!display.style.getPropertyValue('--cue-width')) {
        let maxSize = position;
        if (positionAlignment === 'line-left') {
          maxSize = 100 - position;
        } else if (positionAlignment === 'center' && position <= 50) {
          maxSize = position * 2;
        } else if (positionAlignment === 'center' && position > 50) {
          maxSize = (100 - position) * 2;
        }

        const size = cue.size < maxSize ? cue.size : maxSize;
        if (cue.vertical === '') setCSSVar(display, 'cue-width', size + '%');
        else setCSSVar(display, 'cue-height', size + '%');

        // https://www.w3.org/TR/webvtt1/#processing-cue-settings (position + position alignment)
        const offset =
          position -
          (positionAlignment === 'line-right'
            ? size
            : positionAlignment === 'center'
              ? size / 2
              : 0);
        setCSSVar(display, cue.vertical === '' ? 'cue-left' : 'cue-top', offset + '%');
      }
    } else {
      setCSSVar(
        display,
        'cue-offset',
        `${
          position -
          (positionAlignment === 'line-right' ? 100 : positionAlignment === 'center' ? 50 : 0)
        }%`,
      );
    }

    return display;
  }

  /** Development-only: warns once per missing capability. */
  private _require(capability: RendererCapability, because: string) {
    if (this._capabilities.has(capability) || this._warned?.has(capability)) return;
    (this._warned ??= new Set()).add(capability);
    const factory = capability === 'styles' ? 'vttStyles' : capability;
    console.warn(
      `[media-captions] ${because} but this renderer has no "${capability}" feature, so it is ` +
        `ignored. Add \`${factory}()\` from 'media-captions/renderer' to \`features\`, or use ` +
        '`CaptionsRenderer`.',
    );
  }
}

/** Creates a renderer with exactly the given features (none by default). */
export function createRenderer(
  overlay: HTMLElement,
  init?: CaptionsRendererInit,
): CaptionsRendererCore {
  return new CaptionsRendererCore(overlay, init);
}

/** Later features with the same name win, so presets can be overridden by appending. */
function dedupeFeatures(features: readonly RendererFeature[]): RendererFeature[] {
  const byName = new Map<string, RendererFeature>();
  for (const feature of features) byName.set(feature.name, feature);
  return Array.from(byName.values());
}

export interface CaptionsRendererInit {
  /**
   * Renderer features (regions, typesetting, animations, announcer, STYLE blocks). The core alone
   * renders WebVTT positioning and text. `CaptionsRenderer` defaults to every feature;
   * `createRenderer` to none.
   */
  features?: readonly RendererFeature[];
  /* Text direction. */
  dir?: 'ltr' | 'rtl';
  /**
   * Seconds to keep cues after they end before evicting them from the track. Set this for live
   * streams so memory stays bounded; leave unset for whole-file tracks.
   */
  retention?: number;
  /**
   * Announce cue text to assistive technology through a visually hidden live region placed after
   * the overlay. `true` is `'polite'`. Handled by the `announcer` feature, which
   * `CaptionsRenderer` installs when this is set; with `createRenderer` add `announcer()` instead.
   */
  announce?: boolean | 'polite' | 'assertive';
  /**
   * How simultaneous cues stack. `reading-order` (default) keeps the newest cue in the default
   * slot and pushes older ones away so lines read top-down in cue order; `spec` follows the WebVTT
   * rendering rules (and SSA `Collisions: Normal`) where the earliest cue keeps its slot. A track's
   * `Collisions` metadata sets this when the option is omitted.
   */
  stacking?: 'reading-order' | 'spec';
  /**
   * Snap-to-lines step. `line-height` (default) is the spec's text line height; `box` uses the
   * padded cue box height so stacked lines never overlap and need no collision nudging.
   */
  lineStep?: 'line-height' | 'box';
  /**
   * Inset from the overlay edges as a percentage (sets `--overlay-padding`). Broadcast content
   * typically assumes a title-safe area of about 10%.
   */
  safeArea?: number;
  /**
   * Disable cue animations and transitions. `'auto'` (default) follows the
   * `prefers-reduced-motion` media query.
   */
  reducedMotion?: boolean | 'auto';
}

export interface CaptionsRendererTrack {
  id?: string;
  regions?: VTTRegion[];
  /** Cues to render, or a `CueTrack` to follow (for live content). */
  cues: VTTCue[] | CueTrack;
  /**
   * Header metadata from the parsed track. The `Language` value is applied as the `lang`
   * attribute on the overlay.
   */
  metadata?: VTTHeaderMetadata;
  /**
   * CSS from WebVTT `STYLE` blocks. Selectors such as `::cue`, `::cue(.class)`,
   * `::cue(v[voice="Bob"])`, and `::cue-region` are rewritten to the rendered DOM, scoped to this
   * overlay, and restricted to presentational properties.
   */
  styles?: string[];
}
