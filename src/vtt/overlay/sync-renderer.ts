import type { CaptionsRenderer } from './render-overlay';

export interface SyncCaptionsRendererOptions {
  /**
   * Whether to use `requestVideoFrameCallback` when available so cue and karaoke timing is
   * frame-accurate. Falls back to `requestAnimationFrame` while playing.
   *
   * @defaultValue true
   */
  frameAccurate?: boolean;
}

/**
 * Keeps a `CaptionsRenderer` in sync with a media element. The `timeupdate` event only fires a
 * few times per second which makes short cues and karaoke timed text visibly late, so while the
 * media is playing this uses `requestVideoFrameCallback` (or `requestAnimationFrame`) instead and
 * only relies on events while paused or seeking.
 *
 * Returns a function that stops syncing.
 */
export function syncCaptionsRenderer(
  renderer: CaptionsRenderer,
  media: HTMLMediaElement,
  options: SyncCaptionsRendererOptions = {},
): () => void {
  const video = media as HTMLVideoElement,
    useVideoFrames =
      options.frameAccurate !== false && typeof video.requestVideoFrameCallback === 'function';

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
    if (media.paused) return;
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
    // Covers paused seeking, `currentTime` assignment, and browsers throttling frame callbacks.
    if (media.paused || !frameId) setTime(media.currentTime);
  }

  media.addEventListener('playing', start);
  media.addEventListener('pause', stop);
  media.addEventListener('ended', stop);
  media.addEventListener('emptied', stop);
  media.addEventListener('seeking', onTimeUpdate);
  media.addEventListener('seeked', onTimeUpdate);
  media.addEventListener('timeupdate', onTimeUpdate);

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
  };
}
