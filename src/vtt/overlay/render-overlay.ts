import { setCSSVar, setDataAttr } from '../../utils/style';
import { createVTTCueTemplate, updateTimedVTTCueNodes } from '../render-cue';
import type { VTTCue } from '../vtt-cue';
import type { VTTRegion } from '../vtt-region';
import { Box, createBox, updateBoxDimensions } from './box';
import { computeCuePosition, computeCuePositionAlignment, positionCue } from './position-cue';
import { positionRegion } from './position-region';

export class CaptionsOverlayRenderer {
  readonly overlay: HTMLElement;
  private _overlayBox!: Box;

  private _currentTime = 0;
  private _dir: 'ltr' | 'rtl' = 'ltr';
  private _activeCues: VTTCue[] = [];

  private _resizeRafID = -1;
  private _updateRafID = -1;

  private readonly _resizeObserver: ResizeObserver;
  private readonly _regions = new Map<string, HTMLElement>();
  private readonly _cues = new Map<VTTCue, HTMLElement | null>();

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

  constructor(overlay: HTMLElement, init?: CaptionsOverlayRendererInit) {
    this.overlay = overlay;
    this.dir = init?.dir ?? 'ltr';
    setDataAttr(overlay, 'captions');
    this._updateOverlay();
    this._resizeObserver = new ResizeObserver(this._resize.bind(this));
    this._resizeObserver.observe(overlay);
  }

  setup(regions: VTTRegion[], cues: VTTCue[]) {
    this.reset();

    for (const region of regions) {
      const el = this._createRegionElement(region);
      if (el) {
        this._regions.set(region.id, el);
        this.overlay.append(el);
      }
    }

    for (const cue of cues) {
      this._cues.set(cue, null);
    }

    this.update();
  }

  addCue(cue: VTTCue) {
    this._cues.set(cue, null);
    this.update();
  }

  removeCue(cue: VTTCue) {
    this._cues.delete(cue);
    this.update();
  }

  update(forceUpdate = false) {
    if (this._updateRafID >= 0) return;
    this._updateRafID = requestAnimationFrame(() => {
      this._render(forceUpdate);
      this._updateRafID = -1;
    });
  }

  reset() {
    cancelAnimationFrame(this._updateRafID);
    this._updateRafID = -1;
    this._cues.clear();
    this._regions.clear();
    this._activeCues = [];
    this.overlay.textContent = '';
  }

  destroy() {
    this.reset();
    this._resizeObserver.disconnect();
  }

  private _resize() {
    cancelAnimationFrame(this._resizeRafID);
    this._resizeRafID = requestAnimationFrame(() => {
      this._updateOverlay();
      this.update(true);
      this._resizeRafID = -1;
    });
  }

  private _updateOverlay() {
    const rect = this.overlay.getBoundingClientRect();
    setCSSVar(this.overlay, 'overlay-width', rect.width + 'px');
    setCSSVar(this.overlay, 'overlay-height', rect.height + 'px');
    if (!this._overlayBox) this._overlayBox = createBox(this.overlay);
    else updateBoxDimensions(this._overlayBox, this.overlay);
  }

  private _render(forceUpdate = false) {
    if (!this._cues.size) return;

    let cue: VTTCue,
      activeCues = [...this._cues.keys()]
        .filter((cue) => this._currentTime >= cue.startTime && this._currentTime <= cue.endTime)
        .sort((cueA, cueB) =>
          cueA.startTime !== cueB.startTime
            ? cueA.startTime - cueB.startTime
            : cueA.endTime - cueB.endTime,
        ),
      activeRegions = activeCues.map((cue) => cue.region);

    // Remove old or out of position cues.
    for (let i = 0; i < this._activeCues.length; i++) {
      cue = this._activeCues[i];
      if (activeCues[i] === cue) continue;

      // Set inactive regions.
      if (cue.region && !activeRegions.includes(cue.region)) {
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
        requestAnimationFrame(() => {
          setDataAttr(regionEl, 'active');
        });
        forceUpdate = true;
      }

      if (!cueEl.isConnected) {
        (regionEl || this.overlay).append(cueEl);
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

  private _createRegionElement(region: VTTRegion): HTMLElement | null {
    const el = document.createElement('div');

    setDataAttr(el, 'region');
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

    setDataAttr(display, 'cue-display');
    if (cue.vertical !== '') setDataAttr(display, 'vertical');
    setCSSVar(display, 'cue-text-align', cue.align);

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
    setDataAttr(el, 'cue');
    if (cue.id) setDataAttr(el, 'id', cue.id);

    const template = createVTTCueTemplate(cue);
    el.append(template.content);
    display.append(el);

    return display;
  }

  private _hasRegion(cue: VTTCue) {
    return cue.region && cue.size === 100 && cue.vertical === '' && cue.line === 'auto';
  }
}

export interface CaptionsOverlayRendererInit {
  /* Text direction. */
  dir?: 'ltr' | 'rtl';
}
