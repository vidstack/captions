import { setCSSVar, setDataAttr, setPartAttr } from '../../utils/style';
import { debounce } from '../../utils/timing';
import { CueTrack } from '../cue-track';
import { renderVTTTokensDOM, renderVTTTokensText, updateTimedVTTCueNodes } from '../render-cue';
import { tokenizeVTTCue } from '../tokenize-cue';
import type { CueAnimation, VTTCue } from '../vtt-cue';
import type { VTTHeaderMetadata } from '../vtt-header';
import type { VTTRegion } from '../vtt-region';
import { transformVTTStyle } from '../vtt-style';
import { createBox, LAYOUT_CACHE, type Box } from './box';
import { applyCueLayout, applyCueTextStyle, buildCueTransform } from './cue-style';
import { layoutItems, type LayoutInput } from './layout';
import {
  computeCuePosition,
  computeCuePositionAlignment,
  measureCue,
  writeCueBox,
} from './position-cue';
import {
  measureRegion,
  measureRegionHeight,
  writeRegionBox,
  writeRegionHeight,
} from './position-region';

export class CaptionsRenderer {
  readonly overlay: HTMLElement;
  private _overlayBox!: Box;

  private _currentTime = 0;
  private _dir: 'ltr' | 'rtl' = 'ltr';
  private _activeCues: VTTCue[] = [];

  private readonly _resizeObserver: ResizeObserver;
  private readonly _regions = new Map<string, HTMLElement>();
  private readonly _cues = new Map<VTTCue, HTMLElement | null>();
  private readonly _retention: number | undefined;

  private _track = new CueTrack();
  private _unsubscribe: (() => void) | null = null;

  private _styleEl: HTMLStyleElement | null = null;
  private _announcer: HTMLElement | null = null;
  private _stacking: 'reading-order' | 'spec' | undefined;
  private _metadataStacking: 'reading-order' | 'spec' | undefined;
  private readonly _lineStep: 'line-height' | 'box';
  private readonly _animations = new Map<VTTCue, CueAnimationHandle[]>();
  private _reducedMotion: boolean;
  private static _scopeId = 0;

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
    if (init?.announce) this._createAnnouncer(init.announce === true ? 'polite' : init.announce);
    overlay.setAttribute('translate', 'yes');
    overlay.setAttribute('aria-live', 'off');
    overlay.setAttribute('aria-atomic', 'true');
    setPartAttr(overlay, 'captions');
    this._updateOverlay();
    this._resizeObserver = new ResizeObserver(this._resizing.bind(this));
    this._resizeObserver.observe(overlay);
  }

  changeTrack({ regions, cues, metadata, styles }: CaptionsRendererTrack) {
    this.reset();
    this._applyMetadata(metadata);
    this._applyStyles(styles);
    this._buildRegions(regions);
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
    for (const el of this._cues.values()) el?.remove();
    this._cues.clear();
    this._activeCues = [];

    this._track = track;
    this._unsubscribe = track.on((cue, type) => {
      if (type === 'clear') {
        for (const el of this._cues.values()) el?.remove();
        this._cues.clear();
      } else if (type === 'remove' || type === 'update') {
        // Drop the element so updated cues are re-rendered with their new content.
        this._cues.get(cue!)?.remove();
        this._cues.delete(cue!);
        this._animations.delete(cue!);
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
    this._cues.clear();
    this._animations.clear();
    this._metadataStacking = undefined;
    this._regions.clear();
    this._activeCues = [];
    this._styleEl = null;
    this.overlay.textContent = '';
    this.overlay.removeAttribute('lang');
  }

  destroy() {
    this.reset();
    this._resizeObserver.disconnect();
    this._announcer?.remove();
    this._announcer = null;
  }

  private _resizing() {
    this._resize();
  }

  // Debounced so a continuous resize (e.g., entering fullscreen) re-lays out once. Cue changes in
  // the meantime still render against the last known overlay size rather than being dropped.
  protected _resize = debounce(() => {
    this._updateOverlay();

    for (const el of this._regions.values()) {
      el[LAYOUT_CACHE] = null;
    }

    for (const el of this._cues.values()) {
      if (el) el[LAYOUT_CACHE] = null;
    }

    this._render(true);
  }, 50);

  private _updateOverlay() {
    this._overlayBox = createBox(this.overlay);
    setCSSVar(this.overlay, 'overlay-width', this._overlayBox.width + 'px');
    setCSSVar(this.overlay, 'overlay-height', this._overlayBox.height + 'px');
  }

  /**
   * The visual overlay is `aria-live="off"` because sighted users read it, and duplicating the
   * audio for screen reader users is usually unwanted. When announcements are enabled a separate
   * visually hidden live region receives the plain text of cues as they appear.
   */
  private _createAnnouncer(mode: 'polite' | 'assertive') {
    const el = document.createElement('div');
    setPartAttr(el, 'announcer');
    el.setAttribute('aria-live', mode);
    el.setAttribute('aria-atomic', 'true');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
    this.overlay.insertAdjacentElement('afterend', el);
    this._announcer = el;
  }

  private _announce(cues: VTTCue[]) {
    if (!this._announcer) return;
    const text = cues.map((cue) => renderVTTTokensText(tokenizeVTTCue(cue)).trim()).filter(Boolean);
    if (text.length) this._announcer.textContent = text.join('\n');
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

  /**
   * Applies WebVTT `STYLE` blocks. Selectors are rewritten to the overlay DOM and scoped to this
   * overlay via a unique `data-scope` attribute so multiple renderers never leak styles.
   */
  private _applyStyles(styles?: string[]) {
    if (!styles?.length) return;

    if (!this.overlay.hasAttribute('data-scope')) {
      setDataAttr(this.overlay, 'scope', `mc${++CaptionsRenderer._scopeId}`);
    }

    const scope = `[data-scope="${this.overlay.getAttribute('data-scope')}"]`,
      css = styles
        .map((style) => transformVTTStyle(style, scope))
        .filter(Boolean)
        .join('\n');

    if (!css) return;

    this._styleEl = document.createElement('style');
    setPartAttr(this._styleEl, 'style');
    this._styleEl.textContent = css;
    this.overlay.append(this._styleEl);
  }

  private _render(forceUpdate = false) {
    if (!this._track.size && !this._activeCues.length) return;

    let cue: VTTCue,
      activeCues = this._track.activeAt(this._currentTime),
      activeSet = new Set(activeCues),
      activeRegions = new Set<VTTRegion>();

    for (const active of activeCues) if (active.region) activeRegions.add(active.region);

    // Remove cues that are no longer active (diffed by identity so unrelated cues are untouched).
    for (let i = 0; i < this._activeCues.length; i++) {
      cue = this._activeCues[i];
      if (activeSet.has(cue)) continue;

      // Set inactive regions.
      if (cue.region && !activeRegions.has(cue.region)) {
        const regionEl = this._regions.get(cue.region.id);
        if (regionEl) {
          regionEl.removeAttribute('data-active');
          forceUpdate = true;
        }
      }

      const cueEl = this._cues.get(cue);
      if (cueEl) {
        cueEl.remove();
        forceUpdate = true;
      }
    }

    // Add new cues.
    for (let i = 0; i < activeCues.length; i++) {
      cue = activeCues[i];
      let cueEl = this._cues.get(cue);
      if (!cueEl) this._cues.set(cue, (cueEl = this._createCueElement(cue)));

      const regionEl = this._hasRegion(cue) && this._regions.get(cue.region!.id);
      if (regionEl && !regionEl.hasAttribute('data-active')) {
        requestAnimationFrame(() => setDataAttr(regionEl, 'active'));
        forceUpdate = true;
      }

      if (!cueEl.isConnected) {
        const parent = regionEl || this.overlay;
        // Keep DOM order equal to cue order so regions roll up correctly after seeking.
        parent.insertBefore(cueEl, this._findNextConnectedCue(activeCues, i, parent));
        forceUpdate = true;
      }
    }

    if (forceUpdate) this._layout(activeCues);

    updateTimedVTTCueNodes(this.overlay, this._currentTime);
    this._syncAnimations(activeCues);

    // Cue lifecycle events (mirrors the native TextTrackCue `enter`/`exit`).
    const previous = this._activeCues;
    this._activeCues = activeCues;
    const entered: VTTCue[] = [];
    for (const old of previous) if (!activeSet.has(old)) old.dispatchEvent(new Event('exit'));
    for (const active of activeCues) {
      if (!previous.includes(active)) {
        entered.push(active);
        active.dispatchEvent(new Event('enter'));
      }
    }
    if (entered.length) this._announce(entered);

    if (this._retention !== undefined) this._track.evict(this._currentTime);
  }

  /**
   * Positions all active cues and regions in three phases so the browser lays out at most twice
   * per render: measure (reads), layout (pure math), write (CSS variables).
   */
  private _layout(activeCues: VTTCue[]) {
    const container = this._overlayBox;
    // Hidden or unmeasured overlays have no size; skip until the next resize gives us one.
    if (!container.width || !container.height) return;

    const seen = new Set<VTTRegion | VTTCue>(),
      targets: { el: HTMLElement; region: VTTRegion | null; cue: VTTCue }[] = [];

    for (const cue of orderForPositioning(
      activeCues,
      this._stacking ?? this._metadataStacking ?? 'reading-order',
    )) {
      const key = cue.region || cue;
      if (seen.has(key)) continue;
      seen.add(key);
      const isRegion = this._hasRegion(cue),
        el = isRegion ? this._regions.get(cue.region!.id)! : this._cues.get(cue)!;
      targets.push({ el, region: isRegion ? cue.region! : null, cue });
    }

    // Measure 1 + write: region heights depend on their cue lines and feed the region anchor.
    const regionHeights = new Map<HTMLElement, number>();
    for (const target of targets) {
      if (target.region)
        regionHeights.set(target.el, measureRegionHeight(target.region, target.el));
    }
    for (const [el, height] of regionHeights) writeRegionHeight(el, height);

    // Measure 2: every box, cached until the next resize.
    const inputs: LayoutInput[] = targets.map((target) =>
      target.region
        ? measureRegion(container, target.el, regionHeights.get(target.el)!)
        : measureCue(container, target.cue, target.el, { lineStep: this._lineStep }),
    );

    // Layout: pure.
    const boxes = layoutItems(container, inputs);

    // Write.
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].region) writeRegionBox(container, targets[i].el, boxes[i]);
      else writeCueBox(container, targets[i].el, boxes[i]);
    }
  }

  private _findNextConnectedCue(activeCues: VTTCue[], index: number, parent: Element) {
    for (let i = index + 1; i < activeCues.length; i++) {
      const el = this._cues.get(activeCues[i]);
      if (el && el.parentNode === parent) return el;
    }
    return null;
  }

  private _buildRegions(regions?: VTTRegion[]) {
    if (!regions) return;
    for (const region of regions) {
      const el = this._createRegionElement(region);
      this._regions.set(region.id, el);
      this.overlay.append(el);
    }
  }

  private _createRegionElement(region: VTTRegion): HTMLElement {
    const el = document.createElement('div');

    setPartAttr(el, 'region');
    setDataAttr(el, 'id', region.id);
    setDataAttr(el, 'scroll', region.scroll);

    setCSSVar(el, 'region-width', region.width + '%');
    setCSSVar(el, 'region-anchor-x', region.regionAnchorX);
    setCSSVar(el, 'region-anchor-y', region.regionAnchorY);
    setCSSVar(el, 'region-viewport-anchor-x', region.viewportAnchorX);
    setCSSVar(el, 'region-viewport-anchor-y', region.viewportAnchorY);
    setCSSVar(el, 'region-lines', region.lines);

    return el;
  }

  private _createCueElement(cue: VTTCue): HTMLDivElement {
    const display = document.createElement('div'),
      position = computeCuePosition(cue, this._dir),
      positionAlignment = computeCuePositionAlignment(cue, this._dir);

    setPartAttr(display, 'cue-display');
    if (cue.vertical !== '') setDataAttr(display, 'vertical');
    setCSSVar(display, 'cue-text-align', cue.align);
    if (cue.layer) setCSSVar(display, 'cue-z-index', cue.layer);

    applyCueLayout(display, cue.layout);
    applyCueTextStyle(display, cue.textStyle);
    const transform = buildCueTransform(cue.layout, cue.textStyle);
    if (transform) setCSSVar(display, 'cue-transform', transform);

    // Raw CSS escape hatch (properties or `--cue-*` custom properties).
    if (cue.style) {
      for (const prop of Object.keys(cue.style)) display.style.setProperty(prop, cue.style[prop]);
    }

    // https://www.w3.org/TR/webvtt1/#processing-cue-settings
    if (!this._hasRegion(cue)) {
      setCSSVar(
        display,
        'cue-writing-mode',
        cue.vertical === ''
          ? 'horizontal-tb'
          : cue.vertical === 'lr'
            ? 'vertical-lr'
            : 'vertical-rl',
      );

      if (cue.layout?.width === undefined && !cue.style?.['--cue-width']) {
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

    const el = document.createElement('div');
    setPartAttr(el, 'cue');
    if (cue.id) setDataAttr(el, 'id', cue.id);
    if (cue.textStyle?.className) el.className = cue.textStyle.className;

    el.append(renderVTTTokensDOM(tokenizeVTTCue(cue), this._currentTime));
    display.append(el);

    this._attachAnimations(cue, display, el);

    return display;
  }

  /**
   * Creates paused Web Animations for `cue.animations`; `_syncAnimations` drives their current
   * time from media time so they scrub, pause, and seek with playback instead of running on the
   * wall clock.
   */
  private _attachAnimations(cue: VTTCue, display: HTMLElement, cueEl: HTMLElement) {
    if (!cue.animations?.length || typeof display.animate !== 'function') return;

    const handles: CueAnimationHandle[] = [];

    for (const spec of cue.animations) {
      let target: Element | null = display;
      if (spec.target === 'cue') target = cueEl;
      else if (typeof spec.target === 'object') {
        target = display.querySelector(`[data-span="${spec.target.span}"]`);
      }
      if (!target) continue;

      // Animated box positions must not be fought by collision avoidance.
      if ((spec.target ?? 'display') === 'display' && animatesPosition(spec)) {
        setDataAttr(display, 'fixed');
      }

      const animation = target.animate(spec.keyframes, {
        duration: Math.max(1, spec.duration * 1000),
        easing: spec.easing ?? 'linear',
        fill: spec.fill ?? 'both',
      });
      animation.pause();
      handles.push({ animation, delay: spec.delay ?? 0, duration: spec.duration });
    }

    if (handles.length) this._animations.set(cue, handles);
  }

  private _syncAnimations(activeCues: VTTCue[]) {
    if (!this._animations.size) return;
    for (const cue of activeCues) {
      const handles = this._animations.get(cue);
      if (!handles) continue;
      for (const { animation, delay, duration } of handles) {
        // Reduced motion: hold the final state so content is readable without movement.
        const local = this._reducedMotion ? duration : this._currentTime - cue.startTime - delay;
        animation.currentTime = Math.min(Math.max(local, 0), duration) * 1000;
      }
    }
  }

  private _hasRegion(cue: VTTCue) {
    return cue.region && cue.size === 100 && cue.vertical === '' && cue.line === 'auto';
  }
}

/**
 * Cues are positioned so they read top-down in cue order. Bottom anchored cues are positioned
 * last-to-first (the newest cue takes the default slot and older cues are pushed up), while top
 * anchored cues are positioned first-to-last so older cues stay on top and newer ones are pushed
 * down. Fixed cues go first so everything else avoids them.
 */
function orderForPositioning(cues: VTTCue[], stacking: 'reading-order' | 'spec'): VTTCue[] {
  const fixed: VTTCue[] = [],
    top: VTTCue[] = [],
    bottom: VTTCue[] = [];

  for (const cue of cues) {
    if (cue.layout?.fixed) fixed.push(cue);
    else if (isTopAnchored(cue)) top.push(cue);
    else bottom.push(cue);
  }

  // Spec stacking: the earliest cue keeps its slot and later cues are pushed away from the edge.
  if (stacking === 'spec') return [...fixed, ...top, ...bottom];

  return [...fixed, ...top, ...bottom.reverse()];
}

function animatesPosition(spec: CueAnimation) {
  return spec.keyframes.some((frame) =>
    ['left', 'top', 'right', 'bottom', 'transform', 'translate'].some((key) => key in frame),
  );
}

interface CueAnimationHandle {
  animation: Animation;
  delay: number;
  duration: number;
}

function isTopAnchored(cue: VTTCue): boolean {
  if (cue.line === 'auto') {
    const top = cue.layout?.top ?? cue.style?.['--cue-top'],
      bottom = cue.layout?.bottom ?? cue.style?.['--cue-bottom'];
    return top !== undefined && bottom === undefined;
  }
  if (cue.snapToLines) return cue.line >= 0;
  return cue.lineAlign === 'end' ? cue.line <= 50 : cue.line < 50;
}

export interface CaptionsRendererInit {
  /* Text direction. */
  dir?: 'ltr' | 'rtl';
  /**
   * Seconds to keep cues after they end before evicting them from the track. Set this for live
   * streams so memory stays bounded; leave unset for whole-file tracks.
   */
  retention?: number;
  /**
   * Announce cue text to assistive technology through a visually hidden live region placed after
   * the overlay. `true` is `'polite'`.
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
