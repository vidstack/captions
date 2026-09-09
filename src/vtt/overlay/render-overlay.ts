import { announcer, defaultFeatures } from './features';
import { CaptionsRendererCore, type CaptionsRendererInit } from './renderer-core';

/**
 * The full captions renderer: {@link CaptionsRendererCore} with every feature installed (regions,
 * SSA/TTML typesetting, media-synced animations, WebVTT `STYLE` blocks, and the screen reader
 * announcer when `announce` is set). Pass `features` to choose your own set, or use
 * `createRenderer` from `media-captions/renderer` to start from nothing.
 */
export class CaptionsRenderer extends CaptionsRendererCore {
  constructor(overlay: HTMLElement, init?: CaptionsRendererInit) {
    super(overlay, {
      ...init,
      features: init?.features ?? [
        ...defaultFeatures(),
        ...(init?.announce ? [announcer(init.announce === true ? 'polite' : init.announce)] : []),
      ],
    });
  }
}
