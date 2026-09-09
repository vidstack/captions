/**
 * `media-captions/renderer`: the composable renderer. `createRenderer` gives you the core (WebVTT
 * positioning, collision avoidance, timed text, cue events) and each feature is a separate import
 * so unused ones are never bundled.
 *
 * ```ts
 * import { createRenderer, regions, typesetting } from 'media-captions/renderer';
 * const renderer = createRenderer(overlay, { features: [regions(), typesetting()] });
 * ```
 */
export * from '../vtt/overlay/feature';
export * from '../vtt/overlay/features';
export * from '../vtt/overlay/renderer-core';
export * from '../vtt/overlay/sync-renderer';
