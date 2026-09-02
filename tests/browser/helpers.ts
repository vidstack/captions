import '../../styles/captions.css';
import '../../styles/regions.css';

import { CaptionsRenderer, VTTCue } from 'media-captions';

export interface Fixture {
  viewport: HTMLElement;
  overlay: HTMLElement;
  renderer: CaptionsRenderer;
  destroy(): void;
}

export const VIEWPORT_WIDTH = 640,
  VIEWPORT_HEIGHT = 360;

/**
 * Creates a fixed-size "video" viewport with a captions overlay attached, mirroring how a player
 * would embed the renderer.
 */
export function createFixture(width = VIEWPORT_WIDTH, height = VIEWPORT_HEIGHT): Fixture {
  const viewport = document.createElement('div');
  viewport.style.cssText = `position: relative; width: ${width}px; height: ${height}px; background: #333; overflow: hidden;`;

  const overlay = document.createElement('div');
  viewport.append(overlay);
  document.body.append(viewport);

  const renderer = new CaptionsRenderer(overlay);

  return {
    viewport,
    overlay,
    renderer,
    destroy() {
      renderer.destroy();
      viewport.remove();
    },
  };
}

export function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function cueDisplays(overlay: HTMLElement) {
  return Array.from(overlay.querySelectorAll<HTMLElement>('[data-part="cue-display"]'));
}

export function cueBoxes(overlay: HTMLElement) {
  return Array.from(overlay.querySelectorAll<HTMLElement>('[data-part="cue"]'));
}

export function rect(el: Element) {
  return el.getBoundingClientRect();
}

export function intersects(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function contains(outer: DOMRect, inner: DOMRect, tolerance = 1) {
  return (
    inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

export function cue(start: number, end: number, text: string, settings: Partial<VTTCue> = {}) {
  const cue = new VTTCue(start, end, text);
  Object.assign(cue, settings);
  return cue;
}
