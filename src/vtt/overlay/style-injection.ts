import { setDataAttr, setPartAttr } from '../../utils/style';
import { transformVTTStyle } from '../vtt-style';

let scopeId = 0;

/**
 * Applies WebVTT `STYLE` blocks. Selectors are rewritten to the overlay DOM and scoped to this
 * overlay via a unique `data-scope` attribute so multiple renderers never leak styles.
 * Returns the injected style element, or null when nothing survived sanitisation.
 */
export function injectCueStyles(overlay: HTMLElement, styles?: string[]): HTMLStyleElement | null {
  if (!styles?.length) return null;

  if (!overlay.hasAttribute('data-scope')) setDataAttr(overlay, 'scope', `mc${++scopeId}`);

  const scope = `[data-scope="${overlay.getAttribute('data-scope')}"]`,
    css = styles
      .map((style) => transformVTTStyle(style, scope))
      .filter(Boolean)
      .join('\n');

  if (!css) return null;

  const el = document.createElement('style');
  setPartAttr(el, 'style');
  el.textContent = css;
  overlay.append(el);
  return el;
}
