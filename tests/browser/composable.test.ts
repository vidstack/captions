import '../../styles/captions.css';
import '../../styles/regions.css';

import { parseText, VTTRegion } from 'media-captions';
import {
  animations,
  createRenderer,
  regions,
  typesetting,
  type CaptionsRendererCore,
} from 'media-captions/renderer';

import { cue, cueDisplays, intersects, nextFrame, rect } from './helpers';

const WIDTH = 640,
  HEIGHT = 360;

let viewport: HTMLElement, overlay: HTMLElement, renderer: CaptionsRendererCore | null;

beforeEach(() => {
  viewport = document.createElement('div');
  viewport.style.cssText = `position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; background: #333; overflow: hidden;`;
  overlay = document.createElement('div');
  viewport.append(overlay);
  document.body.append(viewport);
  renderer = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  renderer?.destroy();
  viewport.remove();
  vi.restoreAllMocks();
});

test('the core alone positions, stacks, and avoids collisions', async () => {
  renderer = createRenderer(overlay);
  renderer.changeTrack({
    cues: [cue(0, 10, 'First line'), cue(0, 10, 'Second line'), cue(0, 10, 'Top', { line: 0 })],
  });
  renderer.currentTime = 1;
  await nextFrame();

  const [first, second, top] = cueDisplays(overlay).map(rect),
    frame = rect(viewport);
  expect(intersects(first, second)).toBe(false);
  // Reading order: the newest cue takes the bottom slot, older ones are pushed up.
  expect(first.bottom).toBeLessThanOrEqual(second.top + 1);
  expect(second.bottom).toBeLessThanOrEqual(frame.bottom);
  // Line 0 sits at the top edge, inside the 1% overlay safe area.
  expect(top.top - frame.top).toBeLessThan(frame.width * 0.015);
  expect(top.bottom).toBeLessThan(first.top);
});

test('typesetting is what makes SSA boxes land where the script says', async () => {
  const ass = `[Script Info]
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,40,&H00FF0000,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\pos(0,0)}Top left
`;
  const result = await parseText(ass, { type: 'ass' });

  renderer = createRenderer(overlay);
  renderer.changeTrack(result);
  renderer.currentTime = 1;
  await nextFrame();
  const plain = rect(cueDisplays(overlay)[0]),
    frame = rect(viewport);
  // Without typesetting the cue falls back to the WebVTT default slot: bottom centre.
  expect(plain.bottom).toBeGreaterThan(frame.top + frame.height / 2);
  expect(Math.abs((plain.left + plain.right) / 2 - (frame.left + frame.width / 2))).toBeLessThan(2);
  // The style's blue PrimaryColour is part of the text style model, so it is not applied either.
  expect(
    getComputedStyle(cueDisplays(overlay)[0].querySelector('[data-part="cue"]')!).color,
  ).not.toBe('rgb(0, 0, 255)');
  renderer.destroy();

  renderer = createRenderer(overlay, { features: [typesetting()] });
  renderer.changeTrack(result);
  renderer.currentTime = 1;
  await nextFrame();
  const typeset = rect(cueDisplays(overlay)[0]),
    safeArea = frame.width * 0.015;
  expect(typeset.left - frame.left).toBeLessThan(safeArea);
  expect(typeset.top - frame.top).toBeLessThan(safeArea);
  expect(getComputedStyle(cueDisplays(overlay)[0].querySelector('[data-part="cue"]')!).color).toBe(
    'rgb(0, 0, 255)',
  );
});

test('animations only play with the animations feature', async () => {
  const fading = () => {
    const c = cue(0, 10, 'Fade');
    c.animations = [{ duration: 4, keyframes: [{ opacity: 0 }, { opacity: 1 }] }];
    return c;
  };

  renderer = createRenderer(overlay);
  renderer.changeTrack({ cues: [fading()] });
  renderer.currentTime = 1;
  await nextFrame();
  expect(getComputedStyle(cueDisplays(overlay)[0]).opacity).toBe('1');
  renderer.destroy();

  renderer = createRenderer(overlay, { features: [animations()], reducedMotion: false });
  renderer.changeTrack({ cues: [fading()] });
  renderer.currentTime = 1;
  await nextFrame();
  expect(parseFloat(getComputedStyle(cueDisplays(overlay)[0]).opacity)).toBeCloseTo(0.25, 1);
});

test('regions roll up inside their region element with the regions feature', async () => {
  const region = new VTTRegion();
  region.id = 'roll';
  region.lines = 2;
  region.scroll = 'up';
  const cues = ['one', 'two', 'three'].map((text, i) => {
    const c = cue(i, 10, text);
    c.region = region;
    return c;
  });

  renderer = createRenderer(overlay, { features: [regions()] });
  renderer.changeTrack({ regions: [region], cues });
  renderer.currentTime = 5;
  await nextFrame();

  const regionEl = overlay.querySelector<HTMLElement>('[data-part="region"]')!;
  expect(regionEl.querySelectorAll('[data-part="cue"]')).toHaveLength(3);
  expect(regionEl.hasAttribute('data-active')).toBe(true);
  // Two lines are visible: the first cue has scrolled out of the region box.
  const box = rect(regionEl),
    [first, , third] = cueDisplays(overlay).map(rect);
  expect(first.bottom).toBeLessThanOrEqual(box.top + 1);
  expect(third.bottom).toBeLessThanOrEqual(box.bottom + 1);
});
