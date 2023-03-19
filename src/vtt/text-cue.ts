/**
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/TextTrackCue}
 */
export class TextCue extends EventTarget {
  /**
   * A string that identifies the cue.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/TextTrackCue/id}
   */
  id = '';
  /**
   * A `double` that represents the video time that the cue will start being displayed, in seconds.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/TextTrackCue/startTime}
   */
  startTime: number;
  /**
   * A `double` that represents the video time that the cue will stop being displayed, in seconds.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/TextTrackCue/endTime}
   */
  endTime: number;
  /**
   * Returns a string with the contents of the cue.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/text}
   */
  text: string;
  /**
   * A `boolean` for whether the video will pause when this cue stops being displayed.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/TextTrackCue/pauseOnExit}
   */
  pauseOnExit = false;

  constructor(startTime: number, endTime: number, text: string) {
    super();
    this.startTime = startTime;
    this.endTime = endTime;
    this.text = text;
  }

  override addEventListener<K extends keyof TextCueEventMap>(
    type: K,
    listener: (this: TextTrackCue, ev: TextCueEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  override removeEventListener<K extends keyof TextCueEventMap>(
    type: K,
    listener: (this: TextTrackCue, ev: TextCueEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}

export interface TextCueEventMap {
  enter: Event;
  exit: Event;
}
