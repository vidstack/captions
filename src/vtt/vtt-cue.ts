import { TextCue } from './text-cue';
import type { VTTRegion } from './vtt-region';

/**
 * @see {@link https://www.w3.org/TR/webvtt1/#model-cues}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue}
 */
export class VTTCue extends TextCue {
  /**
   * A `VTTRegion` object describing the video's sub-region that the cue will be drawn onto,
   * or `null` if none is assigned.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/region}
   */
  region: VTTRegion | null = null;
  /**
   * The cue writing direction.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/vertical}
   */
  vertical: '' | 'rl' | 'lr' = '';
  /**
   * Returns `true` if the `VTTCue.line` attribute is an integer number of lines or a percentage
   * of the video size.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/snapToLines}
   */
  snapToLines = true;
  /**
   * Returns the line positioning of the cue. This can be the string `'auto'` or a number whose
   * interpretation depends on the value of `VTTCue.snapToLines`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/line}
   */
  line: number | 'auto' = 'auto';
  /**
   * Returns an enum representing the alignment of the `VTTCue.line`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/lineAlign}
   */
  lineAlign: 'start' | 'center' | 'end' = 'start';
  /**
   * Returns the indentation of the cue within the line. This can be the string `'auto'` or a
   * number representing the percentage of the `VTTCue.region`, or the video size if `VTTCue`.region`
   * is `null`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/position}
   */
  position: number | 'auto' = 'auto';
  /**
   * Returns an enum representing the alignment of the cue. This is used to determine what
   * the `VTTCue.position` is anchored to. The default is `'auto'`.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/positionAlign}
   */
  positionAlign: 'line-left' | 'center' | 'line-right' | 'auto' = 'auto';
  /**
   * Returns a double representing the size of the cue, as a percentage of the video size.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/size}
   */
  size = 100;
  /**
   * Returns an enum representing the alignment of all the lines of text within the cue box.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/align}
   */
  align: 'start' | 'center' | 'end' | 'left' | 'right' = 'center';
}
