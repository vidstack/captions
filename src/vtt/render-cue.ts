export function renderVTTCue(cue: VTTCue, options?: RenderVTTCueOptions): DocumentFragment {
  if (__SERVER__) {
    throw Error('[media-captions] called `renderCue` on the server.');
  }

  const fragment = document.createDocumentFragment();

  // ...

  return fragment;
}

export interface RenderVTTCueOptions {
  //
}
