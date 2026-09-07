import { setPartAttr } from '../../utils/style';
import { renderVTTTokensText } from '../render-cue';
import { tokenizeVTTCue } from '../tokenize-cue';
import type { VTTCue } from '../vtt-cue';

/**
 * The visual overlay is `aria-live="off"` because sighted users read it, and duplicating the
 * audio for screen reader users is usually unwanted. When announcements are enabled a separate
 * visually hidden live region receives the plain text of cues as they appear.
 */
export function createAnnouncer(overlay: HTMLElement, mode: 'polite' | 'assertive'): HTMLElement {
  const el = document.createElement('div');
  setPartAttr(el, 'announcer');
  el.setAttribute('aria-live', mode);
  el.setAttribute('aria-atomic', 'true');
  el.style.cssText =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
  overlay.insertAdjacentElement('afterend', el);
  return el;
}

export function announceCues(announcer: HTMLElement, cues: readonly VTTCue[]) {
  const text = cues.map((cue) => renderVTTTokensText(tokenizeVTTCue(cue)).trim()).filter(Boolean);
  if (text.length) announcer.textContent = text.join('\n');
}
