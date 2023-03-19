import type { VTTCue } from './vtt-cue';

export function renderCue(cue: VTTCue, options?: RenderCueOptions): DocumentFragment {
  if (__SERVER__) {
    throw Error('[media-captions] called `renderCue` on the server.');
  }

  const fragment = document.createDocumentFragment();

  // ...

  return fragment;
}

export interface RenderCueOptions {
  //
}

export function renderVideoOverlay(
  cues: VTTCue[],
  options?: RenderVideoOverlayOptions,
): DocumentFragment {
  if (__SERVER__) {
    throw Error('[media-captions] called `renderVideoOverlay` on the server.');
  }

  const fragment = document.createDocumentFragment();

  // ...

  return fragment;
}

export interface RenderVideoOverlayOptions {
  //
}
