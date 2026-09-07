import type { VTTCue } from './vtt-cue';

export type CueTrackEventType = 'add' | 'remove' | 'update' | 'clear';

export interface CueTrackListener {
  (cue: VTTCue | null, type: CueTrackEventType): void;
}

export interface CueTrackOptions {
  /**
   * Seconds after a cue has ended before `evict()` may drop it. Use with live streams so the
   * track does not grow without bound.
   *
   * @defaultValue Infinity (never evict)
   */
  retention?: number;
  /**
   * Hard cap on the number of cues kept; the earliest-ending cues are evicted first.
   *
   * @defaultValue Infinity
   */
  maxCues?: number;
  /**
   * Ignore `add()` of a cue that duplicates an existing one (same start, end, id, and text).
   * HLS WebVTT segments repeat cues that straddle segment boundaries, and HLS/DASH players
   * frequently re-request segments; enable this when feeding a track from segments.
   *
   * @defaultValue false
   */
  dedupe?: boolean;
}

/**
 * A sorted, incrementally maintained list of cues with fast active-cue lookup. Designed for both
 * whole-file tracks and live streams where cues arrive continuously and end times change
 * (e.g., CEA-608/708 decoders emitting open-ended cues).
 *
 * Cues are kept sorted by start time, then end time. Lookup is O(log n + active) using a running
 * maximum of end times, so a cue that started long ago but is still showing is found without a
 * full scan.
 */
export class CueTrack {
  private _cues: VTTCue[] = [];
  private _maxEnd: number[] = [];
  private _listeners = new Set<CueTrackListener>();
  private _retention: number;
  private _maxCues: number;
  private _dedupe: boolean;

  constructor(cues?: Iterable<VTTCue>, options: CueTrackOptions = {}) {
    this._retention = options.retention ?? Infinity;
    this._maxCues = options.maxCues ?? Infinity;
    this._dedupe = options.dedupe ?? false;
    if (cues) for (const cue of cues) this._insert(cue);
  }

  /** Cues in start-time order. Do not mutate. */
  get cues(): readonly VTTCue[] {
    return this._cues;
  }

  get size() {
    return this._cues.length;
  }

  has(cue: VTTCue) {
    return this._cues.includes(cue);
  }

  add(cue: VTTCue) {
    if (this.has(cue)) return this.update(cue);
    if (this._dedupe && this.findDuplicate(cue)) return;
    this._insert(cue);
    this._emit(cue, 'add');
    this._enforceLimit();
  }

  addAll(cues: Iterable<VTTCue>) {
    for (const cue of cues) this.add(cue);
  }

  remove(cue: VTTCue): boolean {
    const index = this._cues.indexOf(cue);
    if (index === -1) return false;
    this._cues.splice(index, 1);
    this._rebuildMaxEnd(index);
    this._emit(cue, 'remove');
    return true;
  }

  /**
   * Re-indexes a cue whose `startTime`, `endTime`, or content changed. Renderers listening for
   * `update` re-render it in place.
   */
  update(cue: VTTCue) {
    const index = this._cues.indexOf(cue);
    if (index === -1) return this.add(cue);
    this._cues.splice(index, 1);
    const insertAt = this._insert(cue, false);
    this._rebuildMaxEnd(Math.min(index, insertAt));
    this._emit(cue, 'update');
  }

  clear() {
    this._cues = [];
    this._maxEnd = [];
    this._emit(null, 'clear');
  }

  /**
   * Finds an existing cue with the same start, end, id, and text, using the sorted index so the
   * scan only touches cues sharing the start time.
   */
  findDuplicate(cue: VTTCue): VTTCue | null {
    const cues = this._cues;
    let lo = 0,
      hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].startTime < cue.startTime) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < cues.length && cues[i].startTime === cue.startTime; i++) {
      const other = cues[i];
      if (
        other !== cue &&
        other.endTime === cue.endTime &&
        other.id === cue.id &&
        other.text === cue.text
      ) {
        return other;
      }
    }
    return null;
  }

  /** Cues active at `time`, in start-time order. */
  activeAt(time: number): VTTCue[] {
    const cues = this._cues,
      maxEnd = this._maxEnd;

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

    const active: VTTCue[] = [];
    for (let i = last; i >= 0 && maxEnd[i] >= time; i--) {
      if (cues[i].endTime >= time) active.push(cues[i]);
    }

    return active.reverse();
  }

  /**
   * Drops cues that ended more than `retention` seconds before `time`. Returns how many were
   * removed. Call this periodically for live streams.
   */
  evict(time: number): number {
    if (!Number.isFinite(this._retention)) return 0;
    const cutoff = time - this._retention;
    let removed = 0;
    for (let i = this._cues.length - 1; i >= 0; i--) {
      if (this._cues[i].endTime < cutoff) {
        const [cue] = this._cues.splice(i, 1);
        this._emit(cue, 'remove');
        removed++;
      }
    }
    if (removed) this._rebuildMaxEnd(0);
    return removed;
  }

  /** Subscribes to changes. Returns an unsubscribe function. */
  on(listener: CueTrackListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _insert(cue: VTTCue, rebuild = true): number {
    const cues = this._cues;
    let lo = 0,
      hi = cues.length;

    // Upper bound so equal keys keep insertion order (stable).
    while (lo < hi) {
      const mid = (lo + hi) >> 1,
        other = cues[mid];
      if (
        other.startTime < cue.startTime ||
        (other.startTime === cue.startTime && other.endTime <= cue.endTime)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    cues.splice(lo, 0, cue);
    if (rebuild) this._rebuildMaxEnd(lo);
    return lo;
  }

  private _rebuildMaxEnd(from: number) {
    const cues = this._cues,
      maxEnd = this._maxEnd;
    maxEnd.length = cues.length;
    let running = from > 0 ? maxEnd[from - 1] : -Infinity;
    for (let i = from; i < cues.length; i++) {
      running = Math.max(running, cues[i].endTime);
      maxEnd[i] = running;
    }
  }

  private _enforceLimit() {
    if (!Number.isFinite(this._maxCues)) return;
    while (this._cues.length > this._maxCues) {
      // Evict the cue that ends earliest.
      let victim = 0;
      for (let i = 1; i < this._cues.length; i++) {
        if (this._cues[i].endTime < this._cues[victim].endTime) victim = i;
      }
      const [cue] = this._cues.splice(victim, 1);
      this._emit(cue, 'remove');
    }
    this._rebuildMaxEnd(0);
  }

  private _emit(cue: VTTCue | null, type: CueTrackEventType) {
    for (const listener of this._listeners) listener(cue, type);
  }
}
