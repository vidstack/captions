import { h } from './dom';

/**
 * Composites the (mock) video frame and the captions canvas into one canvas, turns it into a
 * `MediaStream` with `captureStream()`, and plays it in a hidden `<video>` that can enter
 * picture-in-picture or fullscreen. This is the only way custom captions survive those surfaces,
 * which show video pixels only: iOS Safari fullscreen and every browser's PiP window.
 *
 * In a real player the frame source is the `<video>` element itself (`drawImage(video, ...)`),
 * or a `VideoFrame` from WebCodecs.
 */
export class CaptionsCompositor {
  readonly canvas: HTMLCanvasElement;
  readonly video: HTMLVideoElement;
  private _ctx: CanvasRenderingContext2D;
  private _frame = 0;
  private _stream: MediaStream | null = null;

  constructor(
    private _captions: HTMLCanvasElement,
    private _drawFrame: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  ) {
    this.canvas = h('canvas');
    this._ctx = this.canvas.getContext('2d')!;
    this.video = h('video', { playsinline: true, autoplay: true });
    this.video.muted = true;
    this.video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
  }

  static get supported() {
    return (
      typeof HTMLCanvasElement !== 'undefined' &&
      'captureStream' in HTMLCanvasElement.prototype &&
      (('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) ||
        'requestFullscreen' in HTMLVideoElement.prototype ||
        'webkitEnterFullscreen' in HTMLVideoElement.prototype)
    );
  }

  /** Starts compositing and streaming; resolves once the video has frames. */
  async start(): Promise<void> {
    if (this._stream) return;
    document.body.append(this.video);
    this._stream = this.canvas.captureStream(30);
    this.video.srcObject = this._stream;
    this._tick();
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    await this.video.play().catch(() => {});
  }

  async enterPictureInPicture() {
    await this.start();
    await this.video.requestPictureInPicture();
    this.video.addEventListener('leavepictureinpicture', () => this.stop(), { once: true });
  }

  async enterFullscreen() {
    await this.start();
    const video = this.video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (video.requestFullscreen) {
      await video.requestFullscreen();
      document.addEventListener(
        'fullscreenchange',
        () => {
          if (!document.fullscreenElement) this.stop();
        },
        { once: true },
      );
    } else if (video.webkitEnterFullscreen) {
      // iOS Safari: the native fullscreen player shows this video's pixels, captions included.
      video.webkitEnterFullscreen();
      video.addEventListener('webkitendfullscreen', () => this.stop(), { once: true });
    }
  }

  stop() {
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    this._stream?.getTracks().forEach((track) => track.stop());
    this._stream = null;
    this.video.srcObject = null;
    this.video.remove();
  }

  private _tick = () => {
    const { width, height } = this._captions;
    if (width && height) {
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this._drawFrame(this._ctx, width, height);
      this._ctx.drawImage(this._captions, 0, 0);
    }
    this._frame = requestAnimationFrame(this._tick);
  };
}
