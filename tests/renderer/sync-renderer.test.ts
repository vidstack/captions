import { syncCaptionsRenderer, type CaptionsRenderer } from 'media-captions';

class FakeMedia extends EventTarget {
  paused = true;
  currentTime = 0;
  private _id = 0;
  private _callbacks = new Map<number, (now: number, metadata: any) => void>();

  requestVideoFrameCallback(callback: (now: number, metadata: any) => void) {
    this._callbacks.set(++this._id, callback);
    return this._id;
  }

  cancelVideoFrameCallback(id: number) {
    this._callbacks.delete(id);
  }

  get pendingFrames() {
    return this._callbacks.size;
  }

  frame(time: number) {
    this.currentTime = time;
    const callbacks = [...this._callbacks.values()];
    this._callbacks.clear();
    for (const callback of callbacks) callback(0, { mediaTime: time });
  }

  emit(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

function setup() {
  const media = new FakeMedia(),
    renderer = { currentTime: -1 } as unknown as CaptionsRenderer,
    dispose = syncCaptionsRenderer(renderer, media as unknown as HTMLMediaElement);
  return { media, renderer, dispose };
}

test('syncs immediately and on time updates while paused', () => {
  const { media, renderer } = setup();
  expect(renderer.currentTime).toBe(0);
  media.currentTime = 4;
  media.emit('timeupdate');
  expect(renderer.currentTime).toBe(4);
  media.currentTime = 9;
  media.emit('seeking');
  expect(renderer.currentTime).toBe(9);
  expect(media.pendingFrames).toBe(0);
});

test('uses video frame callbacks while playing', () => {
  const { media, renderer } = setup();
  media.paused = false;
  media.emit('playing');
  expect(media.pendingFrames).toBe(1);

  media.frame(1.5);
  expect(renderer.currentTime).toBe(1.5);
  expect(media.pendingFrames).toBe(1);

  // Coarse timeupdate events are ignored while the frame loop is running.
  media.currentTime = 1.75;
  media.emit('timeupdate');
  expect(renderer.currentTime).toBe(1.5);

  media.paused = true;
  media.emit('pause');
  expect(media.pendingFrames).toBe(0);
  media.emit('timeupdate');
  expect(renderer.currentTime).toBe(1.75);
});

test('dispose stops all syncing', () => {
  const { media, renderer, dispose } = setup();
  media.paused = false;
  media.emit('playing');
  dispose();
  expect(media.pendingFrames).toBe(0);
  media.currentTime = 50;
  media.paused = true;
  media.emit('timeupdate');
  expect(renderer.currentTime).toBe(0);
});

test('event-driven mode uses native text track cue boundaries without a frame loop', () => {
  const media = new FakeMedia(),
    track = Object.assign(new EventTarget(), { mode: 'disabled' as TextTrackMode }),
    renderer = { currentTime: -1 } as unknown as CaptionsRenderer,
    dispose = syncCaptionsRenderer(renderer, media as unknown as HTMLMediaElement, {
      frameAccurate: false,
      track: track as unknown as TextTrack,
    });

  expect(track.mode).toBe('hidden');

  media.paused = false;
  media.emit('playing');
  expect(media.pendingFrames).toBe(0);

  media.currentTime = 2.25;
  track.dispatchEvent(new Event('cuechange'));
  expect(renderer.currentTime).toBe(2.25);

  media.currentTime = 3;
  media.emit('timeupdate');
  expect(renderer.currentTime).toBe(3);

  dispose();
  media.currentTime = 9;
  track.dispatchEvent(new Event('cuechange'));
  expect(renderer.currentTime).toBe(3);
});
