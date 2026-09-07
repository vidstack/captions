// The library reads the `__DEV__` build flag (defined by Vite); this is the only way to pull the
// ambient declaration into a single-entry `tsc` run.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../src/globals.d.ts" />

import {
  CaptionsRenderer,
  inferCaptionsFormat,
  loadEmbeddedFonts,
  parseText,
  syncCaptionsRenderer,
  type CaptionsFileFormat,
  type CaptionsRendererInit,
  type ParsedCaptionsResult,
  type VTTCue,
} from '../src';
import { CanvasCaptionsRenderer, type CanvasCaptionsOptions } from '../src/canvas';
import { defineMediaCaptionsElement, type MediaCaptionsElement } from '../src/element';
import { registerFullHTMLEntities } from '../src/entities';
import {
  animations,
  announcer as announcerFeature,
  createRenderer,
  regions,
  typesetting,
  type CaptionsRendererCore,
  type RendererFeature,
} from '../src/renderer';
import { findSample, samples, type Sample } from './samples';
import { button, clamp, h, preview, throttle } from './ui/dom';
import { Gallery } from './ui/gallery';
import { Inspector } from './ui/inspector';
import { LiveCaptionFeeder } from './ui/live-cea';
import { FakeMediaElement, FRAME_DURATION } from './ui/media';
import { OptionsPanel } from './ui/options';
import { CaptionsCompositor } from './ui/pip';
import { SourcesPanel } from './ui/sources';
import { Stage } from './ui/stage';
import {
  DEFAULT_STATE,
  readState,
  RENDERER_INIT_KEYS,
  rgba,
  shareURL,
  writeState,
  type PlaygroundState,
  type View,
} from './ui/state';
import { Timeline } from './ui/timeline';
import { Transport } from './ui/transport';

// The full HTML entity table so SAMI / SRT files with named references decode completely.
registerFullHTMLEntities();
defineMediaCaptionsElement();

const state: PlaygroundState = readState(),
  media = new FakeMediaElement(),
  root = document.getElementById('app')!;

media.loop = state.loop;
media.playbackRate = state.rate;

// --- Runtime state ---------------------------------------------------------------------------

let sample: Sample = findSample(state.format),
  result: ParsedCaptionsResult | null = null,
  feeder: LiveCaptionFeeder | null = null,
  renderer: CaptionsRendererCore,
  stopSync: (() => void) | null = null,
  unsubscribeTrack: (() => void) | null = null,
  announcerObserver: MutationObserver | null = null,
  element: MediaCaptionsElement | null = null,
  elementStage: Stage | null = null,
  canvasStage: Stage | null = null,
  canvasRenderer: CanvasCaptionsRenderer | null = null,
  canvasEl: HTMLCanvasElement | null = null,
  canvasObserver: ResizeObserver | null = null,
  compositor: CaptionsCompositor | null = null,
  canvasTools: HTMLElement | null = null,
  gallery: Gallery | null = null,
  loadId = 0,
  lastPersist = 0,
  cuesDirty = false;

const supportsReducedMotion = 'reducedMotion' in CaptionsRenderer.prototype;

// --- UI --------------------------------------------------------------------------------------

const stage = new Stage({ overlay: true });

const transport = new Transport({
  media,
  getCues: () => renderer.track.cues,
  onChange: () => {
    state.rate = media.playbackRate;
    state.loop = media.loop;
    persist(true);
  },
});

const timeline = new Timeline({ onSeek: seek });

const sources = new SourcesPanel({
  samples,
  onSelect: (id) => selectSample(id),
  onApply: (text, type) => void parseAndLoad(text, type, 'edited text'),
  onFile: (file) => void loadFile(file),
});

const options = new OptionsPanel({ state, onChange: applyPatch });
options.setReducedMotionSupport(supportsReducedMotion);

const inspector = new Inspector({
  tab: state.tab,
  onSeek: seek,
  onTab: (tab) => {
    state.tab = tab;
    persist(true);
  },
});

const nav = h('nav', { class: 'nav', 'aria-label': 'Scenarios' });
const viewTabs = h('div', { class: 'view-tabs', role: 'tablist' });
const copyLink = button('Copy link', () => void copyShareLink(), {
  title: 'Copy a URL with the current state',
});

const stageView = h('div', { class: 'view stage-view' }, stage.el);
const transportView = h('div', { class: 'view transport-view' }, transport.el, timeline.el);
const canvasView = h('div', { class: 'view canvas-view', hidden: true });
const elementView = h('div', { class: 'view element-view', hidden: true });
const galleryView = h('div', { class: 'view gallery-view', hidden: true });

root.append(
  h(
    'header',
    { class: 'header' },
    h('h1', null, 'media-captions ', h('span', { class: 'dim' }, 'playground')),
    viewTabs,
    h('span', { class: 'spacer' }),
    h(
      'span',
      { class: 'shortcuts dim' },
      'space play/pause · ←/→ ±0.1s · alt+←/→ ±1 frame · shift+←/→ cues',
    ),
    copyLink,
  ),
  h(
    'div',
    { class: 'layout' },
    nav,
    h(
      'main',
      { class: 'center' },
      stageView,
      canvasView,
      elementView,
      galleryView,
      transportView,
      sources.el,
    ),
    h('aside', { class: 'side' }, options.el, inspector.el),
  ),
);

buildNav();
buildViewTabs();

// --- Renderer lifecycle ----------------------------------------------------------------------

function rendererInit(): CaptionsRendererInit {
  const init: CaptionsRendererInit = {
    dir: state.dir,
    lineStep: state.lineStep,
    safeArea: state.safeArea,
    announce: state.announce,
  };
  if (state.stacking !== 'auto') init.stacking = state.stacking;
  if (state.retention > 0) init.retention = state.retention;
  if (supportsReducedMotion) init.reducedMotion = state.reducedMotion;
  return init;
}

/** Applies the overlay-level styling controls (edge style, CSS variables, font, motion). */
function styleOverlay(overlay: HTMLElement) {
  if (state.edge === 'default') overlay.removeAttribute('data-edge-style');
  else overlay.setAttribute('data-edge-style', state.edge);

  overlay.style.setProperty('--cue-font-size', `${state.fontSize}cqh`);
  overlay.style.setProperty('--overlay-padding', `${state.safeArea}%`);

  setVar(overlay, '--cue-color', state.color, state.color !== DEFAULT_STATE.color);
  setVar(
    overlay,
    '--cue-bg-color',
    rgba(state.bg, state.bgAlpha),
    state.bg !== DEFAULT_STATE.bg || state.bgAlpha !== DEFAULT_STATE.bgAlpha,
  );
  setVar(overlay, '--cue-edge-color', state.edgeColor, state.edgeColor !== DEFAULT_STATE.edgeColor);

  overlay.style.fontFamily = state.font === DEFAULT_STATE.font ? '' : state.font;

  if (state.reducedMotion) overlay.setAttribute('data-reduced-motion', '');
  else overlay.removeAttribute('data-reduced-motion');
}

function setVar(el: HTMLElement, name: string, value: string, set: boolean) {
  if (set) el.style.setProperty(name, value);
  else el.style.removeProperty(name);
}

function applyReducedMotion(target: CaptionsRendererCore) {
  // Feature-detected: older builds only have the `data-reduced-motion` attribute hook.
  if (supportsReducedMotion && target.reducedMotion !== state.reducedMotion) {
    target.reducedMotion = state.reducedMotion;
  }
}

/** The feature set behind the `features` preset (see `FEATURE_PRESETS`). */
function presetFeatures(): RendererFeature[] | null {
  if (state.features === 'all') return null;
  const features: RendererFeature[] = [];
  if (state.features.includes('regions')) features.push(regions());
  if (state.features.includes('typesetting')) features.push(typesetting());
  if (state.features.includes('animations')) features.push(animations());
  if (state.announce) features.push(announcerFeature());
  return features;
}

function buildRenderer(overlay: HTMLElement): CaptionsRendererCore {
  const init = rendererInit(),
    features = presetFeatures();
  // `all` is the batteries-included class; anything else composes the core with chosen features.
  const created = features
    ? createRenderer(overlay, { ...init, features })
    : new CaptionsRenderer(overlay, init);
  styleOverlay(overlay);
  return created;
}

function rebuildRenderer() {
  stopSync?.();
  stopSync = null;
  unsubscribeTrack?.();
  unsubscribeTrack = null;
  announcerObserver?.disconnect();
  announcerObserver = null;
  inspector.unwatchAll();
  // `destroy()` leaves the overlay element in place, so the same node is reused.
  (renderer as CaptionsRendererCore | undefined)?.destroy();

  renderer = buildRenderer(stage.overlay!);
  observeAnnouncer();
  attachCurrentTrack();
  setDrive();
  renderer.currentTime = media.currentTime;
}

function observeAnnouncer() {
  const announcer = renderer.overlay.nextElementSibling;
  if (!announcer || announcer.getAttribute('data-part') !== 'announcer') {
    options.setAnnouncement(state.announce ? '(announcer not found)' : '(announce is off)');
    return;
  }
  options.setAnnouncement('(waiting for a cue)');
  announcerObserver = new MutationObserver(() => {
    options.setAnnouncement(announcer.textContent ?? '');
  });
  announcerObserver.observe(announcer, { childList: true, characterData: true, subtree: true });
}

/** Points the renderer at the parsed result or the live track and wires up track events. */
function attachCurrentTrack() {
  unsubscribeTrack?.();
  unsubscribeTrack = null;
  inspector.unwatchAll();

  if (feeder) renderer.changeTrack({ cues: feeder.track });
  else if (result) renderer.changeTrack(result);
  else renderer.reset();
  attachCanvasTrack();

  const track = renderer.track;
  for (const cue of track.cues) inspector.watchCue(cue, () => media.currentTime);
  inspector.setCues(track.cues);
  timeline.setCues(track.cues, media.duration);

  // Render the new track at the current time right away (both driving modes).
  renderer.currentTime = media.currentTime;

  unsubscribeTrack = track.on((cue, type) => {
    if (cue) {
      inspector.log(`track:${type}`, `${preview(cue.text, 50) || '(empty)'}`, media.currentTime);
      if (type === 'add') inspector.watchCue(cue, () => media.currentTime);
      else if (type === 'remove') inspector.unwatchCue(cue);
      else if (type === 'update') inspector.refreshCueRow(cue);
    } else {
      inspector.log(`track:${type}`, '', media.currentTime);
    }
    cuesDirty = true;
  });
}

const refreshCuesIfDirty = throttle(() => {
  if (!cuesDirty) return;
  cuesDirty = false;
  inspector.setCues(renderer.track.cues);
  timeline.setCues(renderer.track.cues, media.duration);
}, 250);

function setDrive() {
  stopSync?.();
  stopSync = null;
  if (state.drive === 'sync') {
    stopSync = syncCaptionsRenderer(renderer, media.asMediaElement());
  }
}

// --- Loading ---------------------------------------------------------------------------------

function selectSample(id: string) {
  const next = findSample(id);
  state.format = next.id;
  sample = next;
  void loadSample();
  persist(true);
}

async function loadSample() {
  const id = ++loadId;
  delete document.body.dataset.ready;
  markNav();

  feeder?.destroy();
  feeder = null;
  result = null;
  sources.setSample(sample);
  media.duration = sample.duration;
  if (media.currentTime > media.duration) media.seek(0);

  if (sample.kind === 'live') {
    sources.clearLiveLog();
    feeder = new LiveCaptionFeeder(sample, {
      retention: state.retention || 30,
      onLog: (line) => sources.appendLiveLog(line),
    });
    inspector.setResult(
      { metadata: {}, regions: [], styles: [], fonts: [] },
      'Live CEA-608/708 stream: cues come from CEA608Decoder (CC1) and CEA708Decoder (service 1) ' +
        `in live mode. ${feeder.schedule.length} cc_data packets are scheduled over ${sample.duration}s.`,
    );
    inspector.setParseErrors([]);
    feeder.seek(media.currentTime);
    attachCurrentTrack();
    element?.load({ cues: feeder.track });
    sources.setStatus(`${feeder.schedule.length} packets scheduled`, 'ok');
    finishLoad(id);
    return;
  }

  await parseAndLoad(sample.text, sample.type, sample.name, id);
}

async function parseAndLoad(text: string, type: CaptionsFileFormat, label: string, id = ++loadId) {
  delete document.body.dataset.ready;
  feeder?.destroy();
  feeder = null;
  sources.setStatus('Parsing…');

  let parsed: ParsedCaptionsResult;
  const started = performance.now();
  try {
    parsed = await parseText(text, { type, errors: true });
  } catch (error) {
    inspector.addRuntimeError(`parseText(type: "${type}") threw`, describeError(error));
    inspector.setTab('errors');
    parsed = { metadata: {}, regions: [], cues: [], errors: [] };
    sources.setStatus(`Parse failed: ${describeError(error).split('\n')[0]}`, 'error');
  }
  if (id !== loadId) return;

  const elapsed = performance.now() - started;
  result = parsed;

  if (parsed.fonts?.length) {
    loadEmbeddedFonts(parsed.fonts).catch((error: unknown) =>
      inspector.addRuntimeError('loadEmbeddedFonts failed', describeError(error)),
    );
  }

  const maxEnd = parsed.cues.reduce(
    (max, cue) => (Number.isFinite(cue.endTime) ? Math.max(max, cue.endTime) : max),
    0,
  );
  media.duration = Math.max(
    sample.kind === 'text' && text === sample.text ? sample.duration : 1,
    Math.ceil(maxEnd + 1),
  );
  if (media.currentTime > media.duration) media.seek(0);

  inspector.setResult(parsed);
  inspector.setParseErrors(parsed.errors);
  attachCurrentTrack();
  element?.load(parsed);

  if (parsed.errors.length && !parsed.cues.length) {
    sources.setStatus(`${label}: no cues, ${parsed.errors.length} error(s)`, 'error');
  } else {
    sources.setStatus(
      `${label}: ${parsed.cues.length} cue${parsed.cues.length === 1 ? '' : 's'}, ` +
        `${parsed.regions.length} region${parsed.regions.length === 1 ? '' : 's'}, ` +
        `${parsed.errors.length} error${parsed.errors.length === 1 ? '' : 's'} in ${elapsed.toFixed(1)} ms`,
      parsed.errors.length ? 'info' : 'ok',
    );
  }

  finishLoad(id);
}

async function loadFile(file: File) {
  const type = inferCaptionsFormat('', file.name) ?? 'vtt',
    text = await file.text();
  sources.setFile(file.name, text, type);
  await parseAndLoad(text, type, file.name);
}

/** Signals to tooling (screenshots) that the current source is rendered. */
function finishLoad(id: number) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (id === loadId) document.body.dataset.ready = '';
    }),
  );
}

function describeError(error: unknown) {
  if (error instanceof Error)
    return `${error.name}: ${error.message}${error.stack ? '\n' + error.stack : ''}`;
  return String(error);
}

// --- Element demo ----------------------------------------------------------------------------

/** The canvas writer's presentation options, mirroring the overlay styling controls. */
function canvasOptions(): CanvasCaptionsOptions {
  const opts: CanvasCaptionsOptions = {
    dir: state.dir,
    lineStep: state.lineStep,
    safeArea: state.safeArea / 100,
    fontSize: state.fontSize / 100,
    edgeStyle: state.edge === 'default' ? 'none' : state.edge,
    reducedMotion: state.reducedMotion,
    // The playground stylesheet lights up sung karaoke words in the accent colour.
    timedColors: { past: getComputedStyle(document.documentElement).getPropertyValue('--accent') },
  };
  if (state.stacking !== 'auto') opts.stacking = state.stacking;
  if (state.color !== DEFAULT_STATE.color) opts.color = state.color;
  if (state.bg !== DEFAULT_STATE.bg || state.bgAlpha !== DEFAULT_STATE.bgAlpha) {
    opts.backgroundColor = rgba(state.bg, state.bgAlpha);
  }
  if (state.edgeColor !== DEFAULT_STATE.edgeColor) opts.edgeColor = state.edgeColor;
  if (state.font !== DEFAULT_STATE.font) opts.fontFamily = state.font;
  return opts;
}

/**
 * The canvas view paints the same track into a `<canvas>` sized to the stage (at device pixel
 * ratio), so the DOM and canvas writers can be compared on identical content and time.
 */
function ensureCanvasView() {
  if (canvasRenderer) return;
  canvasStage ??= new Stage({ overlay: false, label: 'CanvasCaptionsRenderer' });
  canvasStage.setSize(state.width, state.aspect);
  if (!canvasStage.el.isConnected) canvasView.append(canvasStage.el);

  canvasEl = h('canvas', { class: 'stage-canvas' });
  canvasEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  canvasStage.mount(canvasEl);
  canvasRenderer = new CanvasCaptionsRenderer(canvasEl, canvasOptions());

  const fit = () => {
    const rect = canvasStage!.el.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1;
    canvasEl!.width = Math.round(rect.width * dpr);
    canvasEl!.height = Math.round(rect.height * dpr);
    canvasRenderer!.update();
  };
  canvasObserver = new ResizeObserver(fit);
  canvasObserver.observe(canvasStage.el);
  fit();
  attachCanvasTrack();

  // Picture-in-picture and fullscreen show video pixels only: composite the mock frame and the
  // captions canvas into a captured stream, the same way a player would with its <video>.
  if (CaptionsCompositor.supported) {
    compositor = new CaptionsCompositor(canvasEl, drawMockFrame);
    const report = (error: unknown) =>
      inspector.addRuntimeError('Canvas compositor', describeError(error));
    canvasTools = h(
      'div',
      { class: 'stage-tools' },
      button('Picture-in-picture', () => compositor?.enterPictureInPicture().catch(report)),
      button('Fullscreen video', () => compositor?.enterFullscreen().catch(report)),
      h(
        'span',
        { class: 'hint' },
        'canvas.captureStream() into a <video>: how captions reach PiP and iOS fullscreen',
      ),
    );
    canvasView.append(canvasTools);
  }
}

/** The stage's mock video, drawn into the compositor: the same gradient and orbit as `Stage`. */
function drawMockFrame(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const time = media.currentTime,
    gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#3a4766');
  gradient.addColorStop(1, '#141a2b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const angle = time * 0.6,
    ox = (50 + Math.cos(angle) * 30) / 100,
    oy = (50 + Math.sin(angle * 0.8) * 26) / 100,
    radius = Math.min(width, height) * 0.22,
    orb = ctx.createRadialGradient(ox * width, oy * height, 0, ox * width, oy * height, radius);
  orb.addColorStop(0, 'rgba(255, 214, 120, 0.9)');
  orb.addColorStop(0.6, 'rgba(232, 120, 96, 0.55)');
  orb.addColorStop(1, 'rgba(232, 120, 96, 0)');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, width, height);
}

function destroyCanvasView() {
  compositor?.stop();
  compositor = null;
  canvasTools?.remove();
  canvasTools = null;
  canvasObserver?.disconnect();
  canvasObserver = null;
  canvasRenderer?.destroy();
  canvasRenderer = null;
  canvasEl?.remove();
  canvasEl = null;
}

function attachCanvasTrack() {
  if (!canvasRenderer) return;
  if (feeder) canvasRenderer.changeTrack({ cues: feeder.track });
  else if (result) canvasRenderer.changeTrack(result);
  else canvasRenderer.reset();
  canvasRenderer.currentTime = media.currentTime;
}

function ensureElementView() {
  if (element) return;

  elementStage ??= new Stage({ overlay: false, label: '<media-captions>' });
  elementStage.setSize(state.width, state.aspect);
  if (!elementStage.el.isConnected) elementView.append(elementStage.el);

  const el = document.createElement('media-captions') as MediaCaptionsElement;
  if (state.shadow) {
    el.setAttribute('shadow', '');
    el.setAttribute(
      'styles',
      `${location.origin}/styles/captions.css,${location.origin}/styles/regions.css`,
    );
  }
  if (state.edge !== 'default') el.setAttribute('edge-style', state.edge);
  el.setAttribute('dir', state.dir);

  el.addEventListener('load', () =>
    inspector.log('element:load', 'track loaded', media.currentTime),
  );
  el.addEventListener('error', (event) => {
    const detail = event.detail;
    inspector.log(
      'element:error',
      Array.isArray(detail) ? `${detail.length} parse error(s)` : detail.message,
      media.currentTime,
    );
  });
  el.addEventListener('cuechange', (event) => {
    const cues = event.detail.activeCues;
    inspector.log(
      'cuechange',
      `${cues.length} active: ${cues.map((c) => preview(c.text, 24)).join(' | ')}`,
      media.currentTime,
    );
  });

  elementStage.mount(el);
  elementStage.label.textContent = `<media-captions${state.shadow ? ' shadow' : ''}> media=fakeMedia`;
  el.media = media.asMediaElement();
  styleOverlay(el.renderer.overlay);
  applyReducedMotion(el.renderer);
  if (feeder) el.load({ cues: feeder.track });
  else if (result) el.load(result);
  element = el;
}

function destroyElementView() {
  if (!element) return;
  element.destroy();
  element.remove();
  element = null;
}

// --- Views -----------------------------------------------------------------------------------

function setView(view: View) {
  state.view = view;
  stageView.hidden = view !== 'stage';
  canvasView.hidden = view !== 'canvas';
  elementView.hidden = view !== 'element';
  galleryView.hidden = view !== 'gallery';
  transportView.hidden = view === 'gallery';

  if (view === 'element') ensureElementView();
  else destroyElementView();

  if (view === 'canvas') ensureCanvasView();
  else destroyCanvasView();

  if (view === 'gallery') {
    if (!gallery) {
      media.pause();
      gallery = new Gallery({
        samples,
        time: media.currentTime,
        aspect: state.aspect,
        createRenderer: buildRenderer,
        onTime: (time) => {
          media.seek(time);
          persist();
        },
        onError: (sampleId, error) =>
          inspector.addRuntimeError(
            `Gallery: ${sampleId}`,
            Array.isArray(error) ? `${error.length} parse error(s)` : describeError(error),
          ),
      });
      galleryView.append(gallery.el);
    }
  } else if (gallery) {
    gallery.destroy();
    gallery = null;
  }

  for (const tab of viewTabs.children) {
    tab.setAttribute('aria-selected', String((tab as HTMLElement).dataset.view === view));
  }
  persist(true);
}

function buildViewTabs() {
  const views: { id: View; label: string }[] = [
    { id: 'stage', label: 'Stage' },
    { id: 'canvas', label: 'Canvas' },
    { id: 'element', label: '<media-captions>' },
    { id: 'gallery', label: 'Gallery' },
  ];
  for (const { id, label } of views) {
    viewTabs.append(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'tab',
          'data-view': id,
          onclick: () => setView(id),
        },
        label,
      ),
    );
  }
}

function buildNav() {
  nav.append(h('div', { class: 'nav-title' }, 'Scenarios'));
  for (const s of samples) {
    nav.append(
      h(
        'a',
        {
          href: `?format=${s.id}`,
          'data-id': s.id,
          onclick: (event: Event) => {
            event.preventDefault();
            if (state.view === 'gallery') setView('stage');
            selectSample(s.id);
          },
        },
        s.name,
        s.kind === 'live' ? h('span', { class: 'live-dot', title: 'live' }) : null,
      ),
    );
  }
  nav.append(
    h('div', { class: 'nav-title' }, 'Views'),
    h(
      'a',
      {
        href: '?view=gallery',
        'data-view': 'gallery',
        onclick: (event: Event) => {
          event.preventDefault();
          setView('gallery');
        },
      },
      'Gallery (all samples)',
    ),
    h(
      'a',
      {
        href: '?view=element',
        'data-view': 'element',
        onclick: (event: Event) => {
          event.preventDefault();
          setView('element');
        },
      },
      '<media-captions> element',
    ),
  );
}

function markNav() {
  for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[data-id]')) {
    if (link.dataset.id === sample.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// --- State changes ---------------------------------------------------------------------------

function applyPatch(patch: Partial<PlaygroundState>) {
  Object.assign(state, patch);
  const keys = Object.keys(patch) as (keyof PlaygroundState)[];

  let restyle = false,
    rebuild = false,
    rebuildElement = false;

  for (const key of keys) {
    switch (key) {
      case 'width':
      case 'aspect':
        stage.setSize(state.width, state.aspect);
        elementStage?.setSize(state.width, state.aspect);
        canvasStage?.setSize(state.width, state.aspect);
        if (key === 'aspect' && gallery) {
          gallery.destroy();
          gallery = null;
          setView('gallery');
        }
        break;
      case 'drive':
        setDrive();
        break;
      case 'dir':
        renderer.dir = state.dir;
        element?.setAttribute('dir', state.dir);
        break;
      case 'reducedMotion':
        applyReducedMotion(renderer);
        if (element) applyReducedMotion(element.renderer);
        gallery?.eachOverlay((_, r) => applyReducedMotion(r));
        restyle = true;
        break;
      case 'edge':
        if (element) {
          if (state.edge === 'default') element.removeAttribute('edge-style');
          else element.setAttribute('edge-style', state.edge);
        }
        restyle = true;
        break;
      case 'safeArea':
      case 'fontSize':
      case 'color':
      case 'bg':
      case 'bgAlpha':
      case 'edgeColor':
      case 'font':
        restyle = true;
        break;
      case 'shadow':
        rebuildElement = true;
        break;
      case 'rate':
        media.playbackRate = state.rate;
        break;
      case 'loop':
        media.loop = state.loop;
        break;
    }
    if (RENDERER_INIT_KEYS.includes(key)) rebuild = true;
  }

  if (rebuild) {
    if (feeder && keys.includes('retention')) {
      // The live track owns its retention; rebuild the feeder with the new value.
      void loadSample();
    }
    rebuildRenderer();
    if (gallery) {
      gallery.destroy();
      gallery = null;
      if (state.view === 'gallery') setView('gallery');
    }
  }

  if (restyle) {
    styleOverlay(renderer.overlay);
    if (element) styleOverlay(element.renderer.overlay);
    gallery?.eachOverlay((overlay) => styleOverlay(overlay));
    renderer.update(true);
  }

  if (rebuildElement && element) {
    destroyElementView();
    ensureElementView();
  }

  // The canvas writer takes the same presentation as options, not CSS.
  if (canvasRenderer && (restyle || rebuild || keys.includes('dir'))) {
    canvasRenderer.options = canvasOptions();
  }

  options.sync(state);
  persist(true);
}

function seek(time: number) {
  media.seek(clamp(time, 0, media.duration));
  persist(true);
}

function persist(force = false) {
  const now = performance.now();
  if (!force && now - lastPersist < 1000) return;
  lastPersist = now;
  state.t = media.currentTime;
  state.rate = media.playbackRate;
  state.loop = media.loop;
  writeState(state);
}

async function copyShareLink() {
  state.t = media.currentTime;
  const url = shareURL(state);
  try {
    await navigator.clipboard.writeText(url);
    copyLink.textContent = 'Copied!';
  } catch {
    prompt('Copy this link', url);
    copyLink.textContent = 'Copy link';
    return;
  }
  setTimeout(() => (copyLink.textContent = 'Copy link'), 1200);
}

// --- Keyboard --------------------------------------------------------------------------------

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
      target.isContentEditable)
  ) {
    return;
  }
  if (state.view === 'gallery') return;

  switch (event.key) {
    case ' ':
      event.preventDefault();
      transport.togglePlay();
      break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      event.preventDefault();
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      if (event.shiftKey) transport.jumpCue(dir);
      else if (event.altKey) transport.stepFrames(dir);
      else transport.stepTime(dir * 0.1);
      break;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      event.preventDefault();
      const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
        index = rates.indexOf(media.playbackRate),
        next = clamp(index + (event.key === 'ArrowUp' ? 1 : -1), 0, rates.length - 1);
      transport.setRate(rates[next]);
      state.rate = media.playbackRate;
      persist(true);
      break;
    }
    case 'Home':
      event.preventDefault();
      seek(0);
      break;
    case 'l':
    case 'L':
      media.loop = !media.loop;
      persist(true);
      break;
  }
});

// --- Runtime error capture -------------------------------------------------------------------

window.addEventListener('error', (event) => {
  inspector.addRuntimeError(
    event.message,
    event.error instanceof Error ? event.error.stack : undefined,
  );
});
window.addEventListener('unhandledrejection', (event) => {
  inspector.addRuntimeError('Unhandled promise rejection', describeError(event.reason));
});

// --- Frame loop ------------------------------------------------------------------------------

const updateInspector = throttle((active: readonly VTTCue[], time: number) => {
  inspector.update(active, time);
}, 100);

const flushLiveLog = throttle(() => {
  if (!feeder) return;
  sources.flushLiveLog(
    `# Live cc_data feed: ${feeder.fedCount} / ${feeder.schedule.length} packets fed, ` +
      `${feeder.track.size} cues in the CueTrack (retention ${state.retention || 30}s).\n` +
      '# Columns: time, then cc_type + two data bytes per triplet.',
  );
}, 200);

let lastTime = -1;

function frame(now: number) {
  media.tick(now);
  const time = media.currentTime;

  if (feeder) {
    feeder.advance(time);
    flushLiveLog();
  }

  if (state.drive === 'direct' && (time !== lastTime || cuesDirty)) {
    renderer.currentTime = time;
  }
  lastTime = time;

  refreshCuesIfDirty();

  stage.setTime(time);
  elementStage?.setTime(time);
  canvasStage?.setTime(time);
  if (canvasRenderer && (time !== lastTime || cuesDirty)) canvasRenderer.currentTime = time;
  transport.update();
  timeline.draw(time, renderer.activeCues);
  updateInspector(renderer.activeCues, time);

  if (state.boxes) {
    stage.drawBoxes(renderer.overlay);
    if (element && elementStage) elementStage.drawBoxes(element.shadowRoot ?? element);
  } else {
    stage.drawBoxes(null);
    elementStage?.drawBoxes(null);
  }

  if (!media.paused) persist();

  requestAnimationFrame(frame);
}

// --- Boot ------------------------------------------------------------------------------------

stage.setSize(state.width, state.aspect);
media.duration = sample.duration;
media.seek(clamp(state.t, 0, sample.duration));
rebuildRenderer();
setView(state.view);
void loadSample();
requestAnimationFrame(frame);

// Handy for poking at things from the devtools console.
Object.assign(window, {
  playground: {
    get renderer() {
      return renderer;
    },
    get result() {
      return result;
    },
    get feeder() {
      return feeder;
    },
    get element() {
      return element;
    },
    media,
    state,
    FRAME_DURATION,
  },
});
