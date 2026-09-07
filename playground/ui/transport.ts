import type { VTTCue } from '../../src';
import { button, clamp, fmtTime, h, select } from './dom';
import { FRAME_DURATION, type FakeMediaElement } from './media';

export interface TransportOptions {
  media: FakeMediaElement;
  /** Cues used by the jump to next / previous cue buttons. */
  getCues(): readonly VTTCue[];
  /** Called after any user interaction so URL state can be persisted. */
  onChange(): void;
}

const RATES = ['0.25', '0.5', '0.75', '1', '1.25', '1.5', '2', '3', '4'];

/** Play/pause, scrub bar, time readout, rate, stepping, loop, and cue jumping for the mock clock. */
export class Transport {
  readonly el: HTMLDivElement;

  private _media: FakeMediaElement;
  private _getCues: () => readonly VTTCue[];
  private _onChange: () => void;
  private _scrub: HTMLInputElement;
  private _time: HTMLSpanElement;
  private _duration: HTMLSpanElement;
  private _play: HTMLButtonElement;
  private _rate: HTMLSelectElement;
  private _loop: HTMLInputElement;
  private _scrubbing = false;

  constructor({ media, getCues, onChange }: TransportOptions) {
    this._media = media;
    this._getCues = getCues;
    this._onChange = onChange;

    this._play = button('Play', () => this.togglePlay(), {
      class: 'primary',
      title: 'Play / pause (space)',
      'aria-label': 'Play',
    });

    this._scrub = h('input', {
      type: 'range',
      class: 'scrub',
      min: 0,
      max: media.duration,
      step: 0.001,
      value: media.currentTime,
      'aria-label': 'Seek',
    });
    this._scrub.addEventListener('pointerdown', () => (this._scrubbing = true));
    this._scrub.addEventListener('pointerup', () => (this._scrubbing = false));
    this._scrub.addEventListener('input', () => {
      this._media.seek(this._scrub.valueAsNumber);
      this._onChange();
    });
    this._scrub.addEventListener('change', () => {
      this._scrubbing = false;
      this._onChange();
    });

    this._time = h('span', { class: 'time mono' }, fmtTime(0));
    this._duration = h('span', { class: 'time mono dim' }, fmtTime(media.duration));

    this._rate = select(
      RATES.map((r) => ({ value: r, label: `${r}×` })),
      String(media.playbackRate),
      (value) => {
        this.setRate(Number(value));
        this._onChange();
      },
      { title: 'Playback rate', 'aria-label': 'Playback rate' },
    );

    this._loop = h('input', { type: 'checkbox', checked: media.loop });
    this._loop.addEventListener('change', () => {
      this._media.loop = this._loop.checked;
      this._onChange();
    });

    this.el = h(
      'div',
      { class: 'transport' },
      h(
        'div',
        { class: 'transport-row' },
        this._play,
        button('⏮ cue', () => this.jumpCue(-1), { title: 'Previous cue (shift+←)' }),
        button('−1f', () => this.stepFrames(-1), { title: 'Back one frame at 29.97 (alt+←)' }),
        button('−0.1s', () => this.stepTime(-0.1), { title: 'Back 0.1 s (←)' }),
        button('+0.1s', () => this.stepTime(0.1), { title: 'Forward 0.1 s (→)' }),
        button('+1f', () => this.stepFrames(1), { title: 'Forward one frame at 29.97 (alt+→)' }),
        button('cue ⏭', () => this.jumpCue(1), { title: 'Next cue (shift+→)' }),
        h('span', { class: 'spacer' }),
        this._time,
        h('span', { class: 'dim' }, '/'),
        this._duration,
        h('span', { class: 'spacer' }),
        h('label', { class: 'inline' }, 'Rate ', this._rate),
        h(
          'label',
          { class: 'inline', title: 'Loop at the end of the sample' },
          this._loop,
          ' Loop',
        ),
      ),
      this._scrub,
    );
  }

  /** Reflects the media state; call once per frame. */
  update() {
    const media = this._media;
    if (!this._scrubbing) {
      if (this._scrub.max !== String(media.duration)) this._scrub.max = String(media.duration);
      this._scrub.valueAsNumber = media.currentTime;
    }
    this._time.textContent = fmtTime(media.currentTime);
    this._duration.textContent = fmtTime(media.duration);
    const label = media.paused ? 'Play' : 'Pause';
    if (this._play.textContent !== label) {
      this._play.textContent = label;
      this._play.setAttribute('aria-label', label);
    }
    if (this._loop.checked !== media.loop) this._loop.checked = media.loop;
    if (this._rate.value !== String(media.playbackRate)) {
      this._rate.value = String(media.playbackRate);
    }
  }

  togglePlay() {
    if (this._media.paused) void this._media.play();
    else this._media.pause();
    this._onChange();
  }

  setRate(rate: number) {
    this._media.playbackRate = clamp(rate, 0.25, 4);
  }

  stepTime(delta: number) {
    this._media.pause();
    this._media.seek(this._media.currentTime + delta);
    this._onChange();
  }

  stepFrames(frames: number) {
    // Land in the middle of the target frame so rounding never skips or repeats one.
    const current = Math.round(this._media.currentTime / FRAME_DURATION),
      target = (current + frames + 0.5) * FRAME_DURATION;
    this._media.pause();
    this._media.seek(target);
    this._onChange();
  }

  /** Seeks to the start of the next (`1`) or previous (`-1`) cue boundary. */
  jumpCue(direction: 1 | -1) {
    const time = this._media.currentTime,
      epsilon = 0.0005,
      starts = [...new Set(this._getCues().map((cue) => cue.startTime))].sort((a, b) => a - b);
    let target: number | undefined;
    if (direction > 0) target = starts.find((start) => start > time + epsilon);
    else target = [...starts].reverse().find((start) => start < time - epsilon);
    if (target === undefined) return;
    this._media.seek(target + epsilon);
    this._onChange();
  }
}
