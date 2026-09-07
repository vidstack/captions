import { parseText, type CaptionsRenderer } from '../../src';
import type { Sample } from '../samples';
import { fmtTime, h } from './dom';
import { LiveCaptionFeeder } from './live-cea';
import { Stage } from './stage';
import type { Aspect } from './state';

export interface GalleryOptions {
  samples: Sample[];
  time: number;
  aspect: Aspect;
  createRenderer(overlay: HTMLElement): CaptionsRenderer;
  onTime(time: number): void;
  onError(sampleId: string, error: unknown): void;
}

interface Tile {
  stage: Stage;
  renderer: CaptionsRenderer;
  feeder: LiveCaptionFeeder | null;
  duration: number;
}

/** Every sample rendered at once in a grid of small stages, driven by one global time slider. */
export class Gallery {
  readonly el: HTMLDivElement;

  private _tiles: Tile[] = [];
  private _time: number;
  private _slider: HTMLInputElement;
  private _readout: HTMLSpanElement;
  private _destroyed = false;

  constructor({ samples, time, aspect, createRenderer, onTime, onError }: GalleryOptions) {
    this._time = time;
    const maxDuration = Math.max(...samples.map((s) => s.duration));

    this._slider = h('input', {
      type: 'range',
      class: 'scrub',
      min: 0,
      max: maxDuration,
      step: 0.01,
      value: time,
      'aria-label': 'Gallery time',
    });
    this._readout = h('span', { class: 'time mono' }, fmtTime(time));
    this._slider.addEventListener('input', () => {
      this.setTime(this._slider.valueAsNumber);
      onTime(this._time);
    });

    const grid = h('div', { class: 'gallery-grid' });

    this.el = h(
      'div',
      { class: 'gallery' },
      h(
        'div',
        { class: 'transport-row' },
        h('span', null, 'Global time'),
        this._slider,
        this._readout,
      ),
      grid,
    );

    for (const sample of samples) {
      const stage = new Stage({
        label: `${sample.name} (loops at ${sample.duration}s)`,
        mini: true,
      });
      stage.setSize(480, aspect);
      const renderer = createRenderer(stage.overlay!),
        tile: Tile = { stage, renderer, feeder: null, duration: sample.duration };
      this._tiles.push(tile);
      grid.append(stage.el);

      if (sample.kind === 'live') {
        tile.feeder = new LiveCaptionFeeder(sample, { retention: 30 });
        renderer.changeTrack({ cues: tile.feeder.track });
        this._apply(tile);
      } else {
        parseText(sample.text, { type: sample.type, errors: true })
          .then((result) => {
            if (this._destroyed) return;
            renderer.changeTrack(result);
            this._apply(tile);
            if (result.errors.length) onError(sample.id, result.errors);
          })
          .catch((error: unknown) => {
            if (this._destroyed) return;
            stage.label.textContent = `${sample.name}: parse failed`;
            onError(sample.id, error);
          });
      }
    }
  }

  get time() {
    return this._time;
  }

  setTime(time: number) {
    this._time = time;
    this._slider.valueAsNumber = time;
    this._readout.textContent = fmtTime(time);
    for (const tile of this._tiles) this._apply(tile);
  }

  /** Re-applies overlay styling (edge style, variables) through the given callback. */
  eachOverlay(fn: (overlay: HTMLElement, renderer: CaptionsRenderer) => void) {
    for (const tile of this._tiles) fn(tile.renderer.overlay, tile.renderer);
  }

  destroy() {
    this._destroyed = true;
    for (const tile of this._tiles) {
      tile.renderer.destroy();
      tile.feeder?.destroy();
    }
    this._tiles = [];
    this.el.remove();
  }

  private _apply(tile: Tile) {
    // Each sample loops on its own duration so every tile always shows something.
    const local = tile.duration > 0 ? this._time % tile.duration : this._time;
    tile.feeder?.seek(local);
    tile.renderer.currentTime = local;
    tile.stage.setTime(local);
  }
}
