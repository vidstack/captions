/**
 * `media-captions/canvas`: paint captions into a canvas instead of the DOM, using the same cue
 * model, track, and pure layout engine as the DOM renderer.
 *
 * ```ts
 * import { CanvasCaptionsRenderer } from 'media-captions/canvas';
 * const renderer = new CanvasCaptionsRenderer(canvas, { edgeStyle: 'uniform' });
 * renderer.changeTrack(await parseResponse(fetch('subs.vtt')));
 * syncCaptionsRenderer(renderer, video);
 * ```
 */
export { interpolate, sampleAnimation } from './animate';
export * from './canvas-renderer';
export {
  flowCue,
  fontString,
  type CueFlow,
  type FlowOptions,
  type Line,
  type Run,
  type RunStyle,
} from './flow';
export * from './measure';
export { ImageCache, paintCue, paintRegion, type PaintContext, type PaintOptions } from './paint';
export * from './text-measurer';
export * from './theme';
export * from './values';
