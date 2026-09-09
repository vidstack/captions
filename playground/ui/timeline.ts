import type { VTTCue } from '../../src';
import { fmtTime, h, preview } from './dom';

export interface TimelineOptions {
  onSeek(time: number): void;
}

interface Bar {
  cue: VTTCue;
  lane: number;
}

const LANE_HEIGHT = 10,
  LANE_GAP = 2,
  MAX_LANES = 8,
  PAD_TOP = 4;

/** A strip under the scrub bar drawing every cue as a bar; hover shows the text, click seeks. */
export class Timeline {
  readonly el: HTMLDivElement;

  private _canvas: HTMLCanvasElement;
  private _tip: HTMLDivElement;
  private _bars: Bar[] = [];
  private _lanes = 1;
  private _duration = 1;
  private _hover: Bar | null = null;
  private _onSeek: (time: number) => void;

  constructor({ onSeek }: TimelineOptions) {
    this._onSeek = onSeek;
    this._canvas = h('canvas', { class: 'timeline-canvas', 'aria-label': 'Cue timeline' });
    this._tip = h('div', { class: 'timeline-tip', hidden: true });
    this.el = h('div', { class: 'timeline' }, this._canvas, this._tip);

    this._canvas.addEventListener('pointermove', (event) => this._onPointerMove(event));
    this._canvas.addEventListener('pointerleave', () => {
      this._hover = null;
      this._tip.hidden = true;
    });
    this._canvas.addEventListener('click', (event) => {
      const rect = this._canvas.getBoundingClientRect(),
        x = event.clientX - rect.left;
      if (this._hover) this._onSeek(this._hover.cue.startTime + 0.0005);
      else this._onSeek((x / rect.width) * this._duration);
    });
  }

  setCues(cues: readonly VTTCue[], duration: number) {
    this._duration = Math.max(0.001, duration);
    const sorted = [...cues].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime),
      laneEnds: number[] = [],
      bars: Bar[] = [];

    for (const cue of sorted) {
      let lane = laneEnds.findIndex((end) => end <= cue.startTime);
      if (lane === -1) {
        if (laneEnds.length < MAX_LANES) lane = laneEnds.length;
        else {
          // All lanes busy: reuse the one that frees up first.
          lane = laneEnds.indexOf(Math.min(...laneEnds));
        }
      }
      laneEnds[lane] = Math.min(cue.endTime, this._duration);
      bars.push({ cue, lane });
    }

    this._bars = bars;
    this._lanes = Math.max(1, laneEnds.length);
    const height = PAD_TOP * 2 + this._lanes * (LANE_HEIGHT + LANE_GAP);
    this.el.style.height = `${height}px`;
  }

  draw(time: number, active: readonly VTTCue[]) {
    const canvas = this._canvas,
      rect = canvas.getBoundingClientRect(),
      dpr = devicePixelRatio || 1,
      width = Math.max(1, Math.round(rect.width)),
      height = Math.max(1, Math.round(rect.height));

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const scale = width / this._duration,
      activeSet = new Set(active);

    // Second ticks.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const step = this._duration > 120 ? 30 : this._duration > 40 ? 10 : this._duration > 12 ? 5 : 1;
    for (let s = 0; s <= this._duration; s += step) {
      ctx.fillRect(Math.round(s * scale), 0, 1, height);
    }

    for (const bar of this._bars) {
      const { cue, lane } = bar,
        start = cue.startTime * scale,
        end = (Number.isFinite(cue.endTime) ? cue.endTime : this._duration) * scale,
        y = PAD_TOP + lane * (LANE_HEIGHT + LANE_GAP),
        isActive = activeSet.has(cue),
        isHover = bar === this._hover;
      ctx.fillStyle = isActive
        ? '#ffd166'
        : isHover
          ? '#9cc4ff'
          : Number.isFinite(cue.endTime)
            ? 'rgba(124, 158, 255, 0.55)'
            : 'rgba(255, 140, 90, 0.7)';
      ctx.fillRect(start, y, Math.max(2, end - start), LANE_HEIGHT);
    }

    // Playhead.
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(Math.round(time * scale) - 0.5, 0, 1.5, height);
  }

  private _onPointerMove(event: PointerEvent) {
    const rect = this._canvas.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top,
      time = (x / rect.width) * this._duration,
      lane = Math.floor((y - PAD_TOP) / (LANE_HEIGHT + LANE_GAP));

    let hit: Bar | null = null;
    for (const bar of this._bars) {
      if (bar.lane !== lane) continue;
      const end = Number.isFinite(bar.cue.endTime) ? bar.cue.endTime : this._duration;
      if (time >= bar.cue.startTime && time <= Math.max(end, bar.cue.startTime + 0.05)) {
        hit = bar;
        break;
      }
    }

    this._hover = hit;
    if (hit) {
      const cue = hit.cue;
      this._tip.textContent = `${fmtTime(cue.startTime)} → ${fmtTime(cue.endTime)}${
        cue.id ? ` #${cue.id}` : ''
      }: ${preview(cue.text, 120) || '(empty)'}`;
      this._tip.hidden = false;
      this._tip.style.left = `${Math.min(x, rect.width - 20)}px`;
      this._canvas.style.cursor = 'pointer';
    } else {
      this._tip.hidden = true;
      this._canvas.style.cursor = 'crosshair';
    }
  }
}
