import type { ParseError } from '../parse/parse-error';
import { parseResponse } from '../parse/parse-response';
import type { CaptionsFileFormat, ParsedCaptionsResult } from '../parse/types';
import { loadEmbeddedFonts } from '../ssa/fonts';
import { setDataAttr } from '../utils/style';
import { CaptionsRenderer } from '../vtt/overlay/render-overlay';
import type { CaptionsRendererTrack } from '../vtt/overlay/renderer-core';
import { syncCaptionsRenderer } from '../vtt/overlay/sync-renderer';
import type { VTTCue } from '../vtt/vtt-cue';

export const DEFAULT_MEDIA_CAPTIONS_STYLES = [
  'https://cdn.jsdelivr.net/npm/media-captions/styles/captions.css',
  'https://cdn.jsdelivr.net/npm/media-captions/styles/regions.css',
];

export interface MediaCaptionsCueChangeEventDetail {
  /** Cues currently displayed, in render order. */
  activeCues: readonly VTTCue[];
}

export interface MediaCaptionsElementEventMap extends Omit<HTMLElementEventMap, 'load' | 'error'> {
  /** A track was loaded (from `src` or `load()`) and handed to the renderer. */
  load: CustomEvent<CaptionsRendererTrack>;
  /**
   * Fetching or parsing `src` failed (detail is the `Error`), or the parser reported recoverable
   * errors (detail is the `ParseError[]`; the track still loads and `load` fires afterwards).
   */
  error: CustomEvent<Error | ParseError[]>;
  /** The set of displayed cues changed. */
  cuechange: CustomEvent<MediaCaptionsCueChangeEventDetail>;
}

/**
 * Element-owned renderer. Every state change (`currentTime`, `changeTrack`, `addCue`,
 * `removeCue`, and therefore everything `syncCaptionsRenderer` does) funnels through `update()`,
 * so hooking it is enough to detect active cue changes without polling or a second frame loop.
 */
class ElementCaptionsRenderer extends CaptionsRenderer {
  _onUpdate: (() => void) | null = null;

  override update(forceUpdate = false) {
    super.update(forceUpdate);
    this._onUpdate?.();
  }
}

const HOST_CSS = 'display: block; position: absolute; inset: 0; pointer-events: none;';

// Server-safe: the module can be imported (and the class referenced) where the DOM is missing.
const Base: typeof HTMLElement =
  // oxlint-disable-next-line typescript/no-extraneous-class -- SSR-safe placeholder base
  typeof HTMLElement === 'function' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/**
 * `<media-captions>`: a framework-agnostic captions overlay. Place it inside the positioned
 * container that wraps your media element, point `src` at a captions file (or call `load()` with
 * an already parsed track), and link it to the media element with `for` or the `media` property.
 *
 * By default the overlay renders in the light DOM, so the page must include
 * `media-captions/styles/captions.css` (and `regions.css` for VTT regions). Add the `shadow`
 * attribute to render inside a shadow root that loads its own stylesheets (`styles` attribute,
 * comma-separated URLs; defaults to the jsDelivr CDN). Rendered parts expose `part` attributes so
 * `::part(cue)` etc. work from outside the shadow root.
 *
 * Register with `defineMediaCaptionsElement()`; importing this module has no side effects.
 */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- typed event map on the class
export class MediaCaptionsElement extends Base {
  static readonly observedAttributes = [
    'src',
    'type',
    'for',
    'dir',
    'edge-style',
    'frame-accurate',
  ];

  private _renderer: ElementCaptionsRenderer | null = null;
  private _overlay: HTMLElement | null = null;
  private _track: CaptionsRendererTrack | null = null;
  private _media: HTMLMediaElement | null = null;
  private _stopSync: (() => void) | null = null;
  private _controller: AbortController | null = null;
  // The `src` the current track state belongs to (`null` = needs loading).
  private _loadedSrc: string | null = null;
  private _loadQueued = false;
  private _activeCues: readonly VTTCue[] = [];
  private _hostStyled = false;

  /** The underlying renderer (created on first access). */
  get renderer(): CaptionsRenderer {
    return this._ensureRenderer();
  }

  /** The last loaded track, or `null`. */
  get track(): CaptionsRendererTrack | null {
    return this._track;
  }

  /** URL of the captions file. Changing it aborts any in-flight load and fetches the new file. */
  get src(): string {
    return this.getAttribute('src') ?? '';
  }

  set src(src: string) {
    this._reflect('src', src);
  }

  /** Captions format. When omitted it is inferred from the response content type / extension. */
  get type(): CaptionsFileFormat | '' {
    return (this.getAttribute('type') ?? '') as CaptionsFileFormat | '';
  }

  set type(type: CaptionsFileFormat | '' | null) {
    this._reflect('type', type);
  }

  /** The `id` of the media element to sync with (reflects the `for` attribute). */
  get htmlFor(): string {
    return this.getAttribute('for') ?? '';
  }

  set htmlFor(id: string) {
    this._reflect('for', id);
  }

  /** FCC edge style preset mirrored to `data-edge-style` on the overlay. */
  get edgeStyle(): string {
    return this.getAttribute('edge-style') ?? '';
  }

  set edgeStyle(style: string | null) {
    this._reflect('edge-style', style);
  }

  /** Whether to sync with `requestVideoFrameCallback` / `requestAnimationFrame` while playing. */
  get frameAccurate(): boolean {
    return this.getAttribute('frame-accurate') !== 'false';
  }

  set frameAccurate(enabled: boolean) {
    if (enabled) this.removeAttribute('frame-accurate');
    else this.setAttribute('frame-accurate', 'false');
  }

  /**
   * The media element to sync with. Resolved from the `for` attribute when connected, or set
   * directly (e.g., when the media element has no `id`). Setting it does not reflect to `for`.
   */
  get media(): HTMLMediaElement | null {
    return this._media;
  }

  set media(media: HTMLMediaElement | null) {
    if (this._media === media) return;
    this._media = media;
    this._startSync();
  }

  connectedCallback() {
    this._ensureRenderer();
    this._styleHost();
    if (this.hasAttribute('for')) this._resolveFor();
    this._startSync();
    this._scheduleLoad();
  }

  disconnectedCallback() {
    this._stopSyncing();
    this._abort();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    switch (name) {
      case 'src':
        // Re-setting the same URL after a failure or `clear()` should fetch again.
        this._loadedSrc = null;
        this._scheduleLoad();
        break;
      case 'type':
        this._loadedSrc = null;
        this._scheduleLoad();
        break;
      case 'for':
        if (this.isConnected) this._resolveFor();
        break;
      case 'dir':
        if (this._renderer) this._renderer.dir = this._dir();
        break;
      case 'edge-style':
        if (this._overlay) this._applyEdgeStyle(this._overlay);
        break;
      case 'frame-accurate':
        this._startSync();
        break;
    }
  }

  /** Supplies an already parsed track. Aborts any in-flight `src` load. */
  load(track: CaptionsRendererTrack) {
    this._abort();
    this._loadedSrc = this.src;
    this._setTrack(track);
    this._dispatch('load', track);
  }

  /** Removes the current track and clears the overlay. */
  clear() {
    this._abort();
    this._loadedSrc = this.src;
    this._setTrack(null);
  }

  /** Stops syncing, aborts loading, and destroys the renderer. The element can not be reused. */
  destroy() {
    this._stopSyncing();
    this._abort();
    this._media = null;
    this._track = null;
    this._renderer?.destroy();
    this._renderer = null;
    this._overlay?.remove();
    this._overlay = null;
    this._activeCues = [];
  }

  private _ensureRenderer(): ElementCaptionsRenderer {
    if (this._renderer) return this._renderer;

    const root = this._root(),
      overlay = document.createElement('div');

    this._applyEdgeStyle(overlay);
    root.append(overlay);

    const renderer = new ElementCaptionsRenderer(overlay, { dir: this._dir() });
    renderer._onUpdate = this._checkActiveCues.bind(this);

    this._overlay = overlay;
    this._renderer = renderer;
    return renderer;
  }

  /** The node the overlay is rendered into: a shadow root when `shadow` is set, else the host. */
  private _root(): ShadowRoot | this {
    if (!this.hasAttribute('shadow')) return this;
    if (this.shadowRoot) return this.shadowRoot;

    const root = this.attachShadow({ mode: 'open' }),
      style = document.createElement('style');

    style.textContent = `:host { ${HOST_CSS} }`;
    root.append(style);

    const urls = (this.getAttribute('styles') ?? DEFAULT_MEDIA_CAPTIONS_STYLES.join(','))
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    for (const href of urls) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      root.append(link);
    }

    return root;
  }

  /**
   * Light DOM hosts are positioned via a single zero-specificity rule injected into the document
   * head (once per tag name), so any author rule for the element wins.
   */
  private _styleHost() {
    if (this._hostStyled) return;
    this._hostStyled = true;
    if (this.shadowRoot) return;

    const doc = this.ownerDocument,
      tag = this.localName,
      marker = 'data-media-captions-host';

    if (!doc.head || doc.head.querySelector(`style[${marker}="${tag}"]`)) return;

    const style = doc.createElement('style');
    style.setAttribute(marker, tag);
    style.textContent = `:where(${tag}) { ${HOST_CSS} }`;
    doc.head.append(style);
  }

  private _dir(): 'ltr' | 'rtl' {
    return this.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
  }

  private _applyEdgeStyle(overlay: HTMLElement) {
    const style = this.getAttribute('edge-style');
    if (style) setDataAttr(overlay, 'edge-style', style);
    else overlay.removeAttribute('data-edge-style');
  }

  private _reflect(name: string, value: string | null | undefined) {
    if (value) this.setAttribute(name, value);
    else this.removeAttribute(name);
  }

  private _resolveFor() {
    const id = this.getAttribute('for'),
      doc = this.ownerDocument;

    if (!id) return;

    const el = doc.getElementById(id);
    if (el instanceof HTMLMediaElement) {
      this.media = el;
    } else if (doc.readyState === 'loading') {
      // The media element may simply come later in the markup.
      doc.addEventListener('DOMContentLoaded', () => this.isConnected && this._resolveFor(), {
        once: true,
      });
    }
  }

  private _startSync() {
    this._stopSyncing();
    if (!this._media || !this.isConnected) return;
    this._stopSync = syncCaptionsRenderer(this._ensureRenderer(), this._media, {
      frameAccurate: this.frameAccurate,
    });
  }

  private _stopSyncing() {
    this._stopSync?.();
    this._stopSync = null;
  }

  // Loads are coalesced into a microtask so `src` and `type` set together fetch once.
  private _scheduleLoad() {
    if (this._loadQueued || !this.isConnected) return;
    this._loadQueued = true;
    queueMicrotask(() => {
      this._loadQueued = false;
      if (this.isConnected) this._load();
    });
  }

  private async _load() {
    const src = this.src;
    if (src === this._loadedSrc) return;

    this._abort();
    this._loadedSrc = src;

    if (!src) {
      this._setTrack(null);
      return;
    }

    const controller = (this._controller = new AbortController()),
      type = this.type || undefined,
      response = fetch(src, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error(`Failed to load captions "${src}" (status ${res.status})`);
        return res;
      });

    let result: ParsedCaptionsResult;

    try {
      result = await parseResponse(response, { type, errors: true });
    } catch (error) {
      if (controller.signal.aborted) return;
      this._controller = null;
      this._loadedSrc = null;
      this._dispatch('error', error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (controller.signal.aborted) return;
    this._controller = null;

    if (result.fonts?.length) loadEmbeddedFonts(result.fonts).catch(() => {});

    this._setTrack(result);

    const errors = result.errors.filter(Boolean);
    if (errors.length) this._dispatch('error', errors);
    this._dispatch('load', result);
  }

  private _abort() {
    this._controller?.abort();
    this._controller = null;
  }

  private _setTrack(track: CaptionsRendererTrack | null) {
    const renderer = this._ensureRenderer();
    this._track = track;
    if (track) {
      renderer.changeTrack(track);
    } else {
      renderer.reset();
      this._checkActiveCues();
    }
  }

  private _checkActiveCues() {
    const renderer = this._renderer;
    if (!renderer) return;

    const prev = this._activeCues,
      next = renderer.activeCues;

    if (prev.length === next.length) {
      let same = true;
      for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    this._activeCues = next.slice();
    this._dispatch('cuechange', { activeCues: this._activeCues });
  }

  private _dispatch<K extends 'load' | 'error' | 'cuechange'>(
    type: K,
    detail: MediaCaptionsElementEventMap[K]['detail'],
  ) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// Typed listeners for the custom events (merged into the class).
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- typed event map
export interface MediaCaptionsElement {
  addEventListener<K extends keyof MediaCaptionsElementEventMap>(
    type: K,
    listener: (this: MediaCaptionsElement, ev: MediaCaptionsElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MediaCaptionsElementEventMap>(
    type: K,
    listener: (this: MediaCaptionsElement, ev: MediaCaptionsElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

let registered = false;

/**
 * Registers `MediaCaptionsElement` under `tagName` (default `media-captions`). Safe to call
 * repeatedly and a no-op where `customElements` does not exist (e.g., on the server). Registering
 * under a second tag name uses an anonymous subclass, since a constructor can only be defined once.
 */
export function defineMediaCaptionsElement(tagName = 'media-captions') {
  if (typeof customElements === 'undefined' || customElements.get(tagName)) return;

  const taken =
    registered ||
    (typeof customElements.getName === 'function' &&
      customElements.getName(MediaCaptionsElement) !== null);

  customElements.define(
    tagName,
    taken ? class extends MediaCaptionsElement {} : MediaCaptionsElement,
  );
  registered = true;
}

declare global {
  interface HTMLElementTagNameMap {
    'media-captions': MediaCaptionsElement;
  }
}
