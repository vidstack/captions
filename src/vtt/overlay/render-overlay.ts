import { setCSSVar, setDataAttr, setPartAttr } from '../../utils/style';
import { debounce } from '../../utils/timing';
import { renderVTTCueString, updateTimedVTTCueNodes } from '../render-cue';
import type { VTTCue } from '../vtt-cue';
import type { VTTHeaderMetadata } from '../vtt-header';
import type { VTTRegion } from '../vtt-region';
import { createBox, STARTING_BOX, type Box } from './box';
import { computeCuePosition, computeCuePositionAlignment, positionCue } from './position-cue';
import { positionRegion } from './position-region';

export class CaptionsRenderer {
  readonly overlay: HTMLElement;
  private _overlayBox!: Box;

  private _currentTime = 0;
  private _dir: 'ltr' | 'rtl' = 'ltr';
  private _activeCues: VTTCue[] = [];
  private _isResizing = false;

  private readonly _resizeObserver: ResizeObserver;
  private readonly _regions = new Map<string, HTMLElement>();
  private readonly _cues = new Map<VTTCue, HTMLElement | null>();

  // Sorted cue index so finding active cues is O(log n + active) instead of a full scan.
  private _sortedCues: VTTCue[] | null = null;
  private _maxEndTimes: number[] = [];

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

  constructor(overlay: HTMLElement, init?: CaptionsRendererInit) {
    this.overlay = overlay;
    this.dir = init?.dir ?? 'ltr';
    overlay.setAttribute('translate', 'yes');
    overlay.setAttribute('aria-live', 'off');
    overlay.setAttribute('aria-atomic', 'true');
    setPartAttr(overlay, 'captions');
    this._updateOverlay();
    this._resizeObserver = new ResizeObserver(this._resizing.bind(this));
    this._resizeObserver.observe(overlay);
  }

  changeTrack({ regions, cues, metadata }: CaptionsRendererTrack) {
    this.reset();
    this._applyMetadata(metadata);
    this._buildRegions(regions);
    for (const cue of cues) this._cues.set(cue, null);
    this._sortedCues = null;
    this.update();
  }

  addCue(cue: VTTCue) {
    this._cues.set(cue, null);
    this._sortedCues = null;
    this.update();
  }

  removeCue(cue: VTTCue) {
    this._cues.get(cue)?.remove();
    this._cues.delete(cue);
    this._sortedCues = null;
    this.update();
  }

  update(forceUpdate = false) {
    this._render(forceUpdate);
  }

  reset() {
    this._cues.clear();
    this._regions.clear();
    this._activeCues = [];
    this._sortedCues = null;
    this.overlay.textContent = '';
    this.overlay.removeAttribute('lang');
  }

  destroy() {
    this.reset();
    this._resizeObserver.disconnect();
  }

  private _resizing() {
    this._isResizing = true;
    this._resize();
  }

  protected _resize = debounce(() => {
    this._isResizing = false;
    this._updateOverlay();

    for (const el of this._regions.values()) {
      el[STARTING_BOX] = null;
    }

    for (const el of this._cues.values()) {
      if (el) el[STARTING_BOX] = null;
    }

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
  }

  private _buildIndex() {
    const sorted = [...this._cues.keys()].sort((cueA, cueB) =>
      cueA.startTime !== cueB.startTime
        ? cueA.startTime - cueB.startTime
        : cueA.endTime - cueB.endTime,
    );

    const maxEndTimes: number[] = new Array(sorted.length);
    let maxEnd = -Infinity;
    for (let i = 0; i < sorted.length; i++) {
      maxEnd = Math.max(maxEnd, sorted[i].endTime);
      maxEndTimes[i] = maxEnd;
    }

    this._sortedCues = sorted;
    this._maxEndTimes = maxEndTimes;
  }

  private _findActiveCues(time: number): VTTCue[] {
    if (!this._sortedCues) this._buildIndex();

    const cues = this._sortedCues!,
      maxEndTimes = this._maxEndTimes;

    // Binary search for the last cue that has started.
    let lo = 0,
      hi = cues.length - 1,
      last = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].startTime <= time) {
        last = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Walk backwards while any earlier cue could still be active.
    const active: VTTCue[] = [];
    for (let i = last; i >= 0 && maxEndTimes[i] >= time; i--) {
      if (cues[i].endTime >= time) active.push(cues[i]);
    }

    return active.reverse();
  }

  private _render(forceUpdate = false) {
    if (!this._cues.size || this._isResizing) return;

    let cue: VTTCue,
      activeCues = this._findActiveCues(this._currentTime),
      activeSet = new Set(activeCues),
      activeRegions = new Set<VTTRegion>();

    for (const cue of activeCues) if (cue.region) activeRegions.add(cue.region);

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

    if (forceUpdate) {
      const boxes: Box[] = [],
        seen = new Set<VTTRegion | VTTCue>();
      for (let i = activeCues.length - 1; i >= 0; i--) {
        cue = activeCues[i];
        if (seen.has(cue.region || cue)) continue;
        const isRegion = this._hasRegion(cue),
          el = isRegion ? this._regions.get(cue.region!.id)! : this._cues.get(cue)!;
        if (isRegion) {
          boxes.push(positionRegion(this._overlayBox, cue.region!, el, boxes));
        } else {
          boxes.push(positionCue(this._overlayBox, cue, el, boxes));
        }
        seen.add(isRegion ? cue.region! : cue);
      }
    }

    updateTimedVTTCueNodes(this.overlay, this._currentTime);
    this._activeCues = activeCues;
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
      position = computeCuePosition(cue),
      positionAlignment = computeCuePositionAlignment(cue, this._dir);

    setPartAttr(display, 'cue-display');
    if (cue.vertical !== '') setDataAttr(display, 'vertical');
    setCSSVar(display, 'cue-text-align', cue.align);
    if (cue.layer) setCSSVar(display, 'cue-z-index', cue.layer);

    if (cue.style) {
      for (const prop of Object.keys(cue.style)) {
        // Internal hints (e.g., SSA `\pos`) are prefixed with `__` and are not CSS.
        if (!prop.startsWith('__')) display.style.setProperty(prop, cue.style[prop]);
      }
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

      if (!cue.style?.['--cue-width']) {
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

    el.innerHTML = renderVTTCueString(cue, this._currentTime);
    display.append(el);

    return display;
  }

  private _hasRegion(cue: VTTCue) {
    return cue.region && cue.size === 100 && cue.vertical === '' && cue.line === 'auto';
  }
}

export interface CaptionsRendererInit {
  /* Text direction. */
  dir?: 'ltr' | 'rtl';
}

export interface CaptionsRendererTrack {
  id?: string;
  regions?: VTTRegion[];
  cues: VTTCue[];
  /**
   * Header metadata from the parsed track. The `Language` value is applied as the `lang`
   * attribute on the overlay.
   */
  metadata?: VTTHeaderMetadata;
}
