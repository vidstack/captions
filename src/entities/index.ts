import { registerHTMLEntities } from '../vtt/tokenize-cue';
import { HTML_ENTITIES_FULL, HTML_LEGACY_ENTITIES } from './html-entities';

export { HTML_ENTITIES_FULL, HTML_LEGACY_ENTITIES };

let registered = false;

/**
 * Registers the complete HTML named character reference table (2,231 references) with the WebVTT cue
 * text tokenizer, so references such as `&ClockwiseContourIntegral;` decode exactly as in a
 * browser. The core bundle only ships a Latin-1 subset; call this once at startup when full spec
 * fidelity matters. Registration is global and idempotent.
 */
export function registerFullHTMLEntities() {
  if (registered) return;
  registered = true;
  registerHTMLEntities(HTML_ENTITIES_FULL, HTML_LEGACY_ENTITIES);
}
