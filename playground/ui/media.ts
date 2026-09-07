/**
 * A mock media element: an `EventTarget` with the subset of `HTMLMediaElement` that
 * `syncCaptionsRenderer` and `<media-captions>` rely on (`currentTime`, `paused`, `duration`,
 * `playbackRate`, `play()`, `pause()`, the `timeupdate` / `playing` / `pause` / `seeking` /
 * `seeked` / `ended` events, and `requestVideoFrameCallback`). The clock is advanced from the
 * playground's `requestAnimationFrame` loop by accumulating `performance.now()` deltas × rate.
 */
export class FakeMediaElement extends EventTarget {
  readonly videoWidth = 1280;
  readonly videoHeight = 720;
  readonly readyState = 4;
  readonly nodeName = 'FAKE-VIDEO';

  duration = 30;
  loop = true;
  ended = false;
  seeking = false;

  private _time = 0;
  private _paused = true;
  private _rate = 1;
  private _lastNow = 0;
  private _lastTimeUpdate = 0;
  private _frames = 0;
  private _nextFrameId = 1;
  private _frameCallbacks = new Map<number, VideoFrameRequestCallback>();

  get currentTime() {
    return this._time;
  }

  set currentTime(time: number) {
    this.seek(time);
  }

  get paused() {
    return this._paused;
  }

  get playbackRate() {
    return this._rate;
  }

  set playbackRate(rate: number) {
    this._rate = rate;
    this._emit('ratechange');
  }

  /** Seeks and dispatches the seek events like a real element. */
  seek(time: number) {
    const clamped = Math.min(this.duration, Math.max(0, time));
    this._time = clamped;
    this.ended = false;
    this.seeking = true;
    this._emit('seeking');
    this._emit('timeupdate');
    this.seeking = false;
    this._emit('seeked');
  }

  play(): Promise<void> {
    if (!this._paused) return Promise.resolve();
    if (this._time >= this.duration) this._time = 0;
    this._paused = false;
    this.ended = false;
    this._lastNow = performance.now();
    this._emit('play');
    this._emit('playing');
    return Promise.resolve();
  }

  pause() {
    if (this._paused) return;
    this._paused = true;
    this._emit('pause');
  }

  /**
   * Advances the clock. Call once per animation frame with the frame timestamp. Pending video
   * frame callbacks fire synchronously afterwards so frame-accurate consumers see this frame's
   * time. Returns whether the media time changed.
   */
  tick(now: number): boolean {
    let changed = false;

    if (!this._paused) {
      const delta = Math.max(0, (now - this._lastNow) / 1000);
      this._lastNow = now;
      let next = this._time + delta * this._rate;

      if (next >= this.duration) {
        if (this.loop) {
          next = this.duration > 0 ? next % this.duration : 0;
          this._time = next;
          this._emit('seeking');
          this._emit('seeked');
        } else {
          this._time = this.duration;
          this._paused = true;
          this.ended = true;
          this._emit('timeupdate');
          this._emit('pause');
          this._emit('ended');
          return true;
        }
      } else if (next < 0) {
        next = 0;
      }

      changed = next !== this._time;
      this._time = next;

      if (now - this._lastTimeUpdate >= 250) {
        this._lastTimeUpdate = now;
        this._emit('timeupdate');
      }
    }

    if (this._frameCallbacks.size) {
      const callbacks = [...this._frameCallbacks.entries()];
      this._frameCallbacks.clear();
      this._frames++;
      const metadata = {
        presentationTime: now,
        expectedDisplayTime: now,
        width: this.videoWidth,
        height: this.videoHeight,
        mediaTime: this._time,
        presentedFrames: this._frames,
      } as VideoFrameCallbackMetadata;
      for (const [, callback] of callbacks) callback(now, metadata);
    }

    return changed;
  }

  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const id = this._nextFrameId++;
    this._frameCallbacks.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id: number) {
    this._frameCallbacks.delete(id);
  }

  /** Cast helper for APIs typed against `HTMLMediaElement`. */
  asMediaElement(): HTMLMediaElement {
    return this as unknown as HTMLMediaElement;
  }

  private _emit(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

/** One frame at 29.97 fps. */
export const FRAME_DURATION = 1001 / 30000;
