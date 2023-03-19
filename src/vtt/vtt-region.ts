/**
 * @see {@link https://www.w3.org/TR/webvtt1/#regions}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/VTTRegion}
 */
export class VTTRegion {
  /**
   * A string that identifies the region.
   */
  id = '';
  /**
   * A `double` representing the width of the region, as a percentage of the video.
   */
  width = 100;
  /**
   * A `double` representing the height of the region, in number of lines.
   */
  lines = 3;
  /**
   * A `double` representing the region anchor X offset, as a percentage of the region.
   */
  regionAnchorX = 0;
  /**
   * A `double` representing the region anchor Y offset, as a percentage of the region.
   */
  regionAnchorY = 100;
  /**
   * A `double` representing the viewport anchor X offset, as a percentage of the video.
   */
  viewportAnchorX = 0;
  /**
   * A `double` representing the viewport anchor Y offset, as a percentage of the video.
   */
  viewportAnchorY = 100;
  /**
   * An enum representing how adding new cues will move existing cues.
   */
  scroll: 'none' | 'up' = 'none';
}
