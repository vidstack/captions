import type { VTTCue } from './vtt-cue';
import type { VTTRegion } from './vtt-region';

// get region styles/position
// get cue styles/position

export class CaptionsOverlayRenderer {
  private _overlay: HTMLElement;
  private _cues = new Map<VTTCue, HTMLElement>();
  private _regions = new Map<string, HTMLElement>();

  get overlay() {
    return this._overlay;
  }

  constructor(public readonly container: HTMLElement, public readonly regions: VTTRegion[]) {
    this._overlay = document.createElement('div');
    this._overlay.textContent = '';

    // // Set the subtitles text-centered by default.
    // this.textContainer_.style.textAlign = 'center';

    // // Set the captions in the middle horizontally by default.
    // this.textContainer_.style.display = 'flex';
    // this.textContainer_.style.flexDirection = 'column';
    // this.textContainer_.style.alignItems = 'center';

    // // Set the captions at the bottom by default.
    // this.textContainer_.style.justifyContent = 'flex-end';

    // this.videoContainer_.appendChild(this.textContainer_);

    // https://www.w3.org/TR/webvtt1/#applying-css-properties
    // set up regions (create element once and store on object)
    // region must have ID

    //  this.resizeObserver_ = null;
    //  if ('ResizeObserver' in window) {
    //    this.resizeObserver_ = new ResizeObserver(() => {
    //      this.updateCaptions_(/* forceUpdate= */ true);
    //    });
    //    this.resizeObserver_.observe(this.textContainer_);
    //  }
  }

  addCue(cue: VTTCue) {
    //
  }

  removeCue(cue: VTTCue) {
    //
  }

  // call on resize, fullscreenchange, timeupdate?
  update(currentTime: number) {
    // check cues to remove
    // check cues to add
    // update DOM if needed.
  }

  destroy() {
    this._overlay.textContent = '';
    this._overlay.remove();
    this._cues.clear();
    this._regions.clear();
  }

  private _createRegionElement(cue: VTTCue): HTMLElement | null {
    const region = cue.region;

    if (!region?.id) return null;
    if (this._regions.has(region.id)) return this._regions.get(region.id)!;

    const el = document.createElement('span');

    // const percentageUnit = shaka.text.CueRegion.units.PERCENTAGE;
    // const heightUnit = region.heightUnits == percentageUnit ? '%' : 'px';
    // const widthUnit = region.widthUnits == percentageUnit ? '%' : 'px';
    // const viewportAnchorUnit = region.viewportAnchorUnits == percentageUnit ? '%' : 'px';

    // regionElement.id = 'shaka-text-region---' + regionId;
    // regionElement.classList.add('shaka-text-region');

    // regionElement.style.height = region.height + heightUnit;
    // regionElement.style.width = region.width + widthUnit;
    // regionElement.style.position = 'absolute';
    // regionElement.style.top = region.viewportAnchorY + viewportAnchorUnit;
    // regionElement.style.left = region.viewportAnchorX + viewportAnchorUnit;

    // regionElement.style.display = 'flex';
    // regionElement.style.flexDirection = 'column';
    // regionElement.style.alignItems = 'center';

    // if (cue.displayAlign == shaka.text.Cue.displayAlign.BEFORE) {
    //   regionElement.style.justifyContent = 'flex-start';
    // } else if (cue.displayAlign == shaka.text.Cue.displayAlign.CENTER) {
    //   regionElement.style.justifyContent = 'center';
    // } else {
    //   regionElement.style.justifyContent = 'flex-end';
    // }

    this._regions.set(region.id, el);
    return el;
  }
}
