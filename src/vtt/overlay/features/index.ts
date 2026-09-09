import type { RendererFeature } from '../feature';
import { animations } from './animations';
import { regions } from './regions';
import { typesetting } from './typesetting';
import { vttStyles } from './vtt-styles';

export { animations } from './animations';
export { announcer } from './announcer';
export { regions } from './regions';
export { typesetting } from './typesetting';
export { vttStyles } from './vtt-styles';

/**
 * Every rendering feature (what `CaptionsRenderer` installs): regions, typesetting, animations,
 * and STYLE blocks. The announcer is opt-in because it changes what assistive technology hears.
 */
export function defaultFeatures(): RendererFeature[] {
  return [regions(), typesetting(), animations(), vttStyles()];
}
