/** Anything that renders for a media time: `CaptionsRenderer`, `createRenderer()`, or the canvas renderer. */
export interface TimeDrivenRenderer {
  currentTime: number;
}

export interface SyncCaptionsRendererOptions {
  /**
   * Whether to use `requestVideoFrameCallback` when available so cue and karaoke timing is
   * frame-accurate. Falls back to `requestAnimationFrame` while playing. Set to `false` for a
   * low-power mode driven purely by media events (pair it with `track` for exact cue boundaries).
   *
   * @defaultValue true
   */
  frameAccurate?: boolean;
  /**
   * A native `TextTrack` whose cues mirror the renderer's cues (our `VTTCue` extends the native
   * class, so `track.addCue(cue)` works). The browser fires `cuechange` exactly at cue boundaries,
   * which lets the renderer update at the right moment without a frame loop. The track is set to
   * `hidden` so the browser does not render it itself.
   */
  track?: TextTrack | null;
}

/**
 * Keeps a renderer in sync with a media element. The `timeupdate` event only fires a
 * few times per second which makes short cues and karaoke timed text visibly late, so while the
 * media is playing this uses `requestVideoFrameCallback` (or `requestAnimationFrame`) instead and
 * only relies on events while paused or seeking. Provide a `track` and disable `frameAccurate`
 * for an event-driven mode that still updates precisely at cue boundaries.
 *
 * Returns a function that stops syncing.
 */
export function syncCaptionsRenderer(
  renderer: TimeDrivenRenderer,
  media: HTMLMediaElement,
  options: SyncCaptionsRendererOptions = {},
): () => void {
  const video = media as HTMLVideoElement,
    track = options.track ?? null,
    useVideoFrames =
      options.frameAccurate !== false && typeof video.requestVideoFrameCallback === 'function',
    useFrames = options.frameAccurate !== false;

  let frameId = 0,
    disposed = false;

  function setTime(time: number) {
    if (renderer.currentTime !== time) renderer.currentTime = time;
  }

  function onVideoFrame(_: number, metadata: VideoFrameCallbackMetadata) {
    if (disposed) return;
    setTime(metadata.mediaTime);
    frameId = video.requestVideoFrameCallback(onVideoFrame);
  }

  function onAnimationFrame() {
    if (disposed) return;
    setTime(media.currentTime);
    frameId = requestAnimationFrame(onAnimationFrame);
  }

  function start() {
    stop();
    if (media.paused || !useFrames) return;
    frameId = useVideoFrames
      ? video.requestVideoFrameCallback(onVideoFrame)
      : requestAnimationFrame(onAnimationFrame);
  }

  function stop() {
    if (!frameId) return;
    if (useVideoFrames) video.cancelVideoFrameCallback(frameId);
    else cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function onTimeUpdate() {
    // Covers paused seeking, `currentTime` assignment, event-driven mode, and browsers throttling
    // frame callbacks.
    if (media.paused || !frameId) setTime(media.currentTime);
  }

  function onCueChange() {
    // Cue boundaries are exact, so update even while the frame loop is running.
    setTime(media.currentTime);
  }

  media.addEventListener('playing', start);
  media.addEventListener('pause', stop);
  media.addEventListener('ended', stop);
  media.addEventListener('emptied', stop);
  media.addEventListener('seeking', onTimeUpdate);
  media.addEventListener('seeked', onTimeUpdate);
  media.addEventListener('timeupdate', onTimeUpdate);

  if (track) {
    if (track.mode === 'disabled') track.mode = 'hidden';
    track.addEventListener('cuechange', onCueChange);
  }

  setTime(media.currentTime);
  start();

  return () => {
    disposed = true;
    stop();
    media.removeEventListener('playing', start);
    media.removeEventListener('pause', stop);
    media.removeEventListener('ended', stop);
    media.removeEventListener('emptied', stop);
    media.removeEventListener('seeking', onTimeUpdate);
    media.removeEventListener('seeked', onTimeUpdate);
    media.removeEventListener('timeupdate', onTimeUpdate);
    track?.removeEventListener('cuechange', onCueChange);
  };
}
