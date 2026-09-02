import '../../styles/captions.css';
import '../../styles/regions.css';

import {
  DEFAULT_MEDIA_CAPTIONS_STYLES,
  defineMediaCaptionsElement,
  MediaCaptionsElement,
} from '../../src/element';
import {
  contains,
  cue,
  cueBoxes,
  nextFrame,
  rect,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from './helpers';

defineMediaCaptionsElement();

let container: HTMLElement, el: MediaCaptionsElement;

beforeEach(() => {
  container = document.createElement('div');
  container.style.cssText = `position: relative; width: ${VIEWPORT_WIDTH}px; height: ${VIEWPORT_HEIGHT}px; background: #333; overflow: hidden;`;
  el = document.createElement('media-captions');
  container.append(el);
  document.body.append(container);
});

afterEach(() => {
  el.destroy();
  container.remove();
});

/** A real `<video>` (no source) whose `currentTime` can be set so the sync helper reads it. */
function fakeVideo(time = 0, id?: string) {
  const video = document.createElement('video');
  Object.defineProperty(video, 'currentTime', { value: time, writable: true });
  if (id) video.id = id;
  container.append(video);
  return video;
}

function seek(video: HTMLVideoElement, time: number) {
  (video as any).currentTime = time;
  video.dispatchEvent(new Event('timeupdate'));
}

function blobURL(text: string, type: string) {
  return URL.createObjectURL(new Blob([text], { type }));
}

function once<K extends 'load' | 'error' | 'cuechange'>(target: MediaCaptionsElement, type: K) {
  return new Promise<any>((resolve) => target.addEventListener(type, resolve, { once: true }));
}

const VTT = 'WEBVTT\n\n00:00.000 --> 00:05.000\nFirst\n\n00:06.000 --> 00:10.000\nSecond\n';

test('registration is idempotent and supports additional tag names', () => {
  expect(customElements.get('media-captions')).toBe(MediaCaptionsElement);
  expect(() => defineMediaCaptionsElement()).not.toThrow();
  expect(() => defineMediaCaptionsElement('x-captions')).not.toThrow();
  const other = document.createElement('x-captions');
  expect(other).toBeInstanceOf(MediaCaptionsElement);
  expect(el).toBeInstanceOf(HTMLElement);
});

test('positions itself over the container via an injected host style', () => {
  const style = document.head.querySelector('style[data-media-captions-host="media-captions"]');
  expect(style).not.toBeNull();
  expect(getComputedStyle(el).position).toBe('absolute');
  expect(getComputedStyle(el).pointerEvents).toBe('none');
  const host = rect(el),
    box = rect(container);
  expect(Math.abs(host.width - box.width)).toBeLessThan(1);
  expect(Math.abs(host.height - box.height)).toBeLessThan(1);
});

test('renders cues supplied via load() when the renderer time advances', async () => {
  el.load({ cues: [cue(0, 5, 'Hello world')] });
  expect(el.track?.cues).toHaveLength(1);

  el.renderer.currentTime = 1;
  await nextFrame();

  const boxes = cueBoxes(el);
  expect(boxes).toHaveLength(1);
  expect(boxes[0].textContent).toBe('Hello world');
  expect(contains(rect(container), rect(boxes[0]))).toBe(true);

  el.renderer.currentTime = 6;
  expect(cueBoxes(el)).toHaveLength(0);
});

test('syncs with a media element set via the `media` property', async () => {
  const video = fakeVideo(2);
  el.load({ cues: [cue(0, 5, 'Synced')] });
  el.media = video;

  expect(el.media).toBe(video);
  expect(el.renderer.currentTime).toBe(2);
  expect(cueBoxes(el)).toHaveLength(1);

  seek(video, 20);
  expect(el.renderer.currentTime).toBe(20);
  expect(cueBoxes(el)).toHaveLength(0);
});

test('resolves the media element from the `for` attribute', () => {
  const video = fakeVideo(1, 'for-video');
  el.load({ cues: [cue(0, 5, 'For')] });
  el.setAttribute('for', 'for-video');

  expect(el.htmlFor).toBe('for-video');
  expect(el.media).toBe(video);
  expect(cueBoxes(el)).toHaveLength(1);

  seek(video, 8);
  expect(cueBoxes(el)).toHaveLength(0);
});

test('loads `src` and fires `load`', async () => {
  const loaded = once(el, 'load');
  el.src = blobURL(VTT, 'text/vtt');

  const event = await loaded;
  expect(event.detail.cues).toHaveLength(2);
  expect(el.track).toBe(event.detail);

  el.renderer.currentTime = 7;
  expect(cueBoxes(el).map((box) => box.textContent)).toEqual(['Second']);
});

test('honours the `type` attribute when the response type is generic', async () => {
  const srt = '1\n00:00:00,000 --> 00:00:04,000\nSubrip\n';
  const loaded = once(el, 'load');
  el.type = 'srt';
  el.src = blobURL(srt, 'text/plain');

  const event = await loaded;
  expect(event.detail.cues).toHaveLength(1);
  expect(event.detail.cues[0].text).toBe('Subrip');
});

test('changing `src` aborts the previous load', async () => {
  const loads: string[] = [];
  el.addEventListener('load', (event) => loads.push(event.detail.cues[0].text));

  el.src = blobURL(VTT, 'text/vtt');
  await Promise.resolve();
  el.src = blobURL('WEBVTT\n\n00:00.000 --> 00:01.000\nReplacement\n', 'text/vtt');

  await once(el, 'load');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loads).toEqual(['Replacement']);
});

test('fires `error` when the source can not be fetched', async () => {
  const errored = once(el, 'error');
  const url = blobURL(VTT, 'text/vtt');
  URL.revokeObjectURL(url);
  el.src = url;

  const event = await errored;
  expect(event.detail).toBeInstanceOf(Error);
  expect(el.track).toBeNull();
});

test('mirrors `edge-style` onto the overlay', () => {
  const overlay = el.renderer.overlay;
  el.edgeStyle = 'raised';
  expect(el.getAttribute('edge-style')).toBe('raised');
  expect(overlay.getAttribute('data-edge-style')).toBe('raised');

  el.removeAttribute('edge-style');
  expect(el.edgeStyle).toBe('');
  expect(overlay.hasAttribute('data-edge-style')).toBe(false);
});

test('forwards `dir` to the renderer', () => {
  expect(el.renderer.dir).toBe('ltr');
  el.dir = 'rtl';
  expect(el.renderer.dir).toBe('rtl');
  expect(el.renderer.overlay.getAttribute('data-dir')).toBe('rtl');
  el.dir = 'ltr';
  expect(el.renderer.dir).toBe('ltr');
});

test('reflects `frame-accurate`', () => {
  expect(el.frameAccurate).toBe(true);
  el.frameAccurate = false;
  expect(el.getAttribute('frame-accurate')).toBe('false');
  el.setAttribute('frame-accurate', '');
  expect(el.frameAccurate).toBe(true);
});

test('`shadow` renders into a shadow root with default stylesheet links', () => {
  const shadowEl = document.createElement('media-captions');
  shadowEl.setAttribute('shadow', '');
  container.append(shadowEl);

  const root = shadowEl.shadowRoot!;
  expect(root).not.toBeNull();
  expect(shadowEl.children).toHaveLength(0);
  expect(root.contains(shadowEl.renderer.overlay)).toBe(true);
  expect(root.querySelector('style')?.textContent).toContain(':host');

  const links = Array.from(root.querySelectorAll('link[rel="stylesheet"]')).map(
    (link) => (link as HTMLLinkElement).href,
  );
  expect(links).toEqual(DEFAULT_MEDIA_CAPTIONS_STYLES);
  expect(shadowEl.renderer.overlay.getAttribute('part')).toBe('captions');

  shadowEl.destroy();
});

test('`styles` overrides the shadow stylesheets', () => {
  const shadowEl = document.createElement('media-captions');
  shadowEl.setAttribute('shadow', '');
  shadowEl.setAttribute('styles', '/styles/captions.css, /styles/regions.css');
  container.append(shadowEl);

  const links = Array.from(shadowEl.shadowRoot!.querySelectorAll('link')).map((link) =>
    link.getAttribute('href'),
  );
  expect(links).toEqual(['/styles/captions.css', '/styles/regions.css']);

  shadowEl.destroy();
});

test('keeps working after being disconnected and reconnected', async () => {
  const video = fakeVideo(1);
  el.load({ cues: [cue(0, 5, 'Persist')] });
  el.media = video;
  expect(cueBoxes(el)).toHaveLength(1);

  el.remove();
  seek(video, 20);
  // Sync stopped while disconnected.
  expect(el.renderer.currentTime).toBe(1);

  container.append(el);
  // Reconnecting resumes syncing from the media time.
  expect(el.renderer.currentTime).toBe(20);
  expect(cueBoxes(el)).toHaveLength(0);

  seek(video, 2);
  expect(cueBoxes(el)).toHaveLength(1);
  expect(el.track?.cues).toHaveLength(1);
});

test('fires `cuechange` when the active cue set changes', () => {
  const events: (readonly any[])[] = [];
  el.addEventListener('cuechange', (event) => events.push(event.detail.activeCues));

  const a = cue(0, 5, 'A'),
    b = cue(3, 8, 'B');
  el.load({ cues: [a, b] });

  el.renderer.currentTime = 1;
  expect(events).toHaveLength(1);
  expect(events[0]).toEqual([a]);

  // Same set, no event.
  el.renderer.currentTime = 2;
  expect(events).toHaveLength(1);

  el.renderer.currentTime = 4;
  expect(events).toHaveLength(2);
  expect(events[1]).toEqual([a, b]);

  el.renderer.currentTime = 20;
  expect(events).toHaveLength(3);
  expect(events[2]).toEqual([]);

  // Driven through the media sync path too.
  const video = fakeVideo(6);
  el.media = video;
  expect(events).toHaveLength(4);
  expect(events[3]).toEqual([b]);

  el.clear();
  expect(events).toHaveLength(5);
  expect(events[4]).toEqual([]);
  expect(el.track).toBeNull();
});
