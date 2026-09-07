import { parseText, VTTRegion } from 'media-captions';
import {
  CanvasCaptionsRenderer,
  canvasTextMeasurer,
  layoutCaptions,
  paintCaptions,
} from 'media-captions/canvas';

import { createFixture, cue, cueDisplays, nextFrame, rect, type Fixture } from './helpers';

const WIDTH = 640,
  HEIGHT = 360;

let fixture: Fixture, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D;

beforeEach(() => {
  fixture = createFixture(WIDTH, HEIGHT);
  canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx = canvas.getContext('2d')!;
});

afterEach(() => {
  fixture.destroy();
});

function pixel(x: number, y: number) {
  return Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
}

/** Whether any pixel in the rectangle passes the predicate. */
function some(x: number, y: number, w: number, h: number, test: (rgba: number[]) => boolean) {
  const data = ctx.getImageData(
    Math.round(x),
    Math.round(y),
    Math.max(1, Math.round(w)),
    Math.max(1, Math.round(h)),
  ).data;
  for (let i = 0; i < data.length; i += 4) {
    if (test([data[i], data[i + 1], data[i + 2], data[i + 3]])) return true;
  }
  return false;
}

/** Whether every pixel in the rectangle is fully transparent. */
function clear(x: number, y: number, w: number, h: number) {
  return !some(x, y, w, h, (rgba) => rgba[3] > 0);
}

test('the headless measurer agrees with the DOM renderer on cue boxes', async () => {
  const cues = [
    cue(0, 10, 'A plain caption line'),
    cue(0, 10, 'Second line stacks above it'),
    cue(0, 10, 'Top left, sized', { line: 1, position: 10, size: 40, align: 'start' }),
    cue(0, 10, 'Percentage line', { snapToLines: false, line: 30, lineAlign: 'center' }),
    cue(0, 10, 'Wrapped: this caption is long enough to need at least two lines of text', {
      size: 50,
    }),
  ];
  fixture.renderer.changeTrack({ cues });
  fixture.renderer.currentTime = 1;
  await nextFrame();

  const frame = rect(fixture.viewport),
    dom = cueDisplays(fixture.overlay).map((display) => {
      const r = rect(display);
      return {
        text: display.textContent!,
        left: r.left - frame.left,
        top: r.top - frame.top,
        width: r.width,
        height: r.height,
      };
    });

  const { theme, targets } = layoutCaptions(cues, canvasTextMeasurer(ctx), {
    width: WIDTH,
    height: HEIGHT,
  });

  for (const target of targets) {
    if (target.kind !== 'cue') continue;
    const expected = dom.find((d) => d.text === target.item.cue.text)!,
      box = target.box,
      left = theme.container.left + box.left,
      top = theme.container.top + box.top;
    // Same font, size, padding, and layout engine: boxes should land within a couple of pixels.
    expect(Math.abs(left - expected.left), `${expected.text} left`).toBeLessThan(2.5);
    expect(Math.abs(box.width - expected.width), `${expected.text} width`).toBeLessThan(2.5);
    expect(Math.abs(box.height - expected.height), `${expected.text} height`).toBeLessThan(2.5);
    expect(Math.abs(top - expected.top), `${expected.text} top`).toBeLessThan(3);
  }
});

test('paints a background box and text where the layout put them', () => {
  const c = cue(0, 10, 'Hello canvas');
  paintCaptions(ctx, [c], 1, {});
  const { theme, targets } = layoutCaptions([c], canvasTextMeasurer(ctx), {
    width: WIDTH,
    height: HEIGHT,
  });
  const target = targets[0];
  if (target.kind !== 'cue') throw new Error('expected a cue');
  const box = target.box,
    text = target.item.textBox,
    x = theme.container.left + box.left + text.left,
    y = theme.container.top + box.top + text.top;

  // Padding corner: only the translucent black background (alpha 0.8 => 204).
  const corner = pixel(x + 2, y + 2);
  expect(corner.slice(0, 3)).toEqual([0, 0, 0]);
  expect(corner[3]).toBeGreaterThan(190);
  // Glyphs: some near-white pixels inside the text box.
  expect(some(x, y, text.width, text.height, ([r, g, b]) => r > 200 && g > 200 && b > 200)).toBe(
    true,
  );
  // Outside the box: nothing.
  expect(clear(0, 0, WIDTH, y - 2)).toBe(true);
});

test('typesetting pixels: colour, drawing, and clip', async () => {
  const ass = `[Script Info]
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,30,&H0000FF00,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\pos(40,40)}Green
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\pos(400,40)\\c&H0000FF&\\p1}m 0 0 l 100 0 100 60 0 60{\\p0}
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\pos(40,200)\\clip(40,200,140,260)}Clipped to a small window
`;
  const { cues } = await parseText(ass, { type: 'ass' });
  paintCaptions(ctx, cues, 1, {});

  // The script maps 1:1 onto the frame (PlayRes = canvas), minus the 1% safe area.
  const safe = 0.01 * WIDTH;
  // Green glyphs near (40, 40).
  expect(some(40 + safe, 40 + safe, 120, 40, ([r, g, b]) => g > 200 && r < 80 && b < 80)).toBe(
    true,
  );
  // A red drawing near (400, 40): solid red fill.
  expect(
    some(
      400 + safe + 10,
      40 + safe + 10,
      40,
      20,
      ([r, g, b, a]) => r > 200 && g < 60 && b < 60 && a > 250,
    ),
  ).toBe(true);
  // The clipped line paints inside its window but nothing past its right edge.
  expect(some(40 + safe, 200 + safe, 100, 60, ([, , , a]) => a > 0)).toBe(true);
  expect(clear(140 + safe + 2, 200 + safe, 200, 60)).toBe(true);
});

test('animations are sampled at media time', async () => {
  const c = cue(0, 4, 'Fading');
  c.animations = [{ duration: 4, keyframes: [{ opacity: 0 }, { opacity: 1 }] }];
  const renderer = new CanvasCaptionsRenderer(canvas);
  renderer.changeTrack({ cues: [c] });

  const alphaAt = (time: number) => {
    renderer.currentTime = time;
    const { theme, targets } = layoutCaptions([c], canvasTextMeasurer(ctx), {
      width: WIDTH,
      height: HEIGHT,
    });
    const target = targets[0];
    if (target.kind !== 'cue') throw new Error('expected a cue');
    const x = theme.container.left + target.box.left + target.item.textBox.left + 2,
      y = theme.container.top + target.box.top + 2;
    return pixel(x, y)[3];
  };

  expect(alphaAt(1)).toBeLessThan(alphaAt(3));
  expect(alphaAt(3.9)).toBeGreaterThan(180);
  renderer.destroy();
});

test('regions roll up inside their box and clip to it', () => {
  const region = new VTTRegion();
  region.id = 'r';
  region.width = 60;
  region.lines = 2;
  region.scroll = 'up';
  region.regionAnchorX = 0;
  region.regionAnchorY = 100;
  region.viewportAnchorX = 20;
  region.viewportAnchorY = 90;
  const cues = ['one', 'two', 'three'].map((text, i) => {
    const c = cue(i, 10, text);
    c.region = region;
    return c;
  });

  paintCaptions(ctx, cues, 5, {});
  const { theme, targets } = layoutCaptions(cues, canvasTextMeasurer(ctx), {
    width: WIDTH,
    height: HEIGHT,
  });
  const target = targets[0];
  if (target.kind !== 'region') throw new Error('expected a region');
  const box = target.box,
    left = theme.container.left + box.left,
    top = theme.container.top + box.top;
  // Two rows of background inside the region (text is centred), nothing above it.
  const half = box.height / 2;
  expect(some(left, top + 4, box.width, half - 6, ([, , , a]) => a > 150)).toBe(true);
  expect(some(left, top + half + 4, box.width, half - 6, ([, , , a]) => a > 150)).toBe(true);
  expect(clear(left, top - 20, box.width, 18)).toBe(true);
});

test('the renderer follows a live track and clears when reset', () => {
  const renderer = new CanvasCaptionsRenderer(canvas, { backgroundColor: 'rgb(255, 0, 0)' });
  const track = renderer.track;
  renderer.changeTrack({ cues: [] });
  renderer.currentTime = 5;
  expect(clear(0, 0, WIDTH, HEIGHT)).toBe(true);

  renderer.track.add(cue(0, 10, 'Live'));
  expect(some(0, 0, WIDTH, HEIGHT, ([r, g, b, a]) => r > 200 && g < 30 && b < 30 && a > 200)).toBe(
    true,
  );
  expect(renderer.activeCues).toHaveLength(1);

  renderer.reset();
  expect(clear(0, 0, WIDTH, HEIGHT)).toBe(true);
  expect(renderer.track).not.toBe(track);
  renderer.destroy();
});
