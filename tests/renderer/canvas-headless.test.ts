import { VTTCue, VTTRegion } from 'media-captions';
import {
  flowCue,
  interpolate,
  layoutCaptions,
  measureCue,
  monospaceTextMeasurer,
  regionOf,
  resolveTheme,
  sampleAnimation,
  type RunStyle,
} from 'media-captions/canvas';

import {
  clipToPolygon,
  combineTransforms,
  lengthToPx,
  parseColor,
  transform2D,
  transformOriginPx,
} from '../../src/canvas/values';
import { tokenizeVTTCue } from '../../src/vtt/tokenize-cue';

// A 1000x500 frame with a 1% safe area: container 980x480, font 24px, line 28.8px.
const WIDTH = 1000,
  HEIGHT = 500,
  theme = resolveTheme({}, WIDTH, HEIGHT),
  measurer = monospaceTextMeasurer(0.5); // 12px per glyph at 24px

const base: RunStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: 'white',
  bgColor: null,
  fontFamily: 'sans-serif',
  fontSize: 24,
  letterSpacing: 0,
  opacity: 1,
  stroke: undefined,
  shadow: undefined,
};

const env = { width: theme.container.width, height: theme.container.height, em: 24 };

describe('typed value resolution', () => {
  test('resolves lengths to pixels', () => {
    expect(lengthToPx({ unit: 'vh', value: 5 }, env)).toBeCloseTo(24);
    expect(lengthToPx({ unit: 'vw', value: 50 }, env)).toBe(490);
    expect(lengthToPx({ unit: 'em', value: 2 }, env)).toBe(48);
    expect(lengthToPx({ unit: '%', value: 10 }, { ...env, percent: 50 })).toBe(5);
    expect(lengthToPx(12, env)).toBe(12);
    expect(lengthToPx(undefined, env)).toBeNull();
  });

  test('places transform origins in the box', () => {
    const container = { width: 980, height: 480 },
      box = { left: 100, top: 50, width: 200, height: 40 };
    expect(transformOriginPx(undefined, container, box)).toEqual([100, 20]);
    expect(transformOriginPx({ origin: [0, 100] }, container, box)).toEqual([0, 40]);
    // An overlay point (SSA \\org) is relative to the box position.
    expect(transformOriginPx({ originAt: [50, 50] }, container, box)).toEqual([390, 190]);
  });

  test('flattens transforms to a matrix, projecting 3D rotations orthographically', () => {
    const near = (m: number[]) => m.map((v) => expect.closeTo(v, 6));
    expect(transform2D(undefined)).toEqual([1, 0, 0, 1]);
    expect(transform2D({ scaleX: 2, scaleY: 0.5 })).toEqual([2, 0, 0, 0.5]);
    // A quarter turn clockwise (y down): x maps to y.
    expect(transform2D({ rotate: 90 })).toEqual(near([0, 1, -1, 0]));
    // rotateX squashes vertically, rotateY horizontally, as CSS does without perspective.
    expect(transform2D({ rotateX: 60 })).toEqual(near([1, 0, 0, 0.5]));
    expect(transform2D({ rotateY: 60 })).toEqual(near([0.5, 0, 0, 1]));
    // Both together shear: Rx·Ry has sin(x)·sin(y) in the lower-left cell.
    expect(transform2D({ rotateX: 90, rotateY: 90 })).toEqual(near([0, 1, 0, 0]));
    // Combining applies the first transform outermost, like a CSS transform list.
    expect(combineTransforms(transform2D({ scaleX: 2 }), transform2D({ rotate: 90 }))).toEqual(
      near([0, 1, -2, 0]),
    );
  });

  test('parses colours', () => {
    expect(parseColor('#ff000080')).toEqual([255, 0, 0, expect.closeTo(0.5, 2)]);
    expect(parseColor('rgba(0, 255, 0, 0.8)')).toEqual([0, 255, 0, 0.8]);
    expect(parseColor('yellow')).toBeNull();
  });

  test('turns clips into box-relative polygons', () => {
    const container = { width: 980, height: 480 },
      box = { left: 100, top: 50, width: 200, height: 100 };
    expect(clipToPolygon({ inset: [10, 20, 0, 0] }, container, box).points).toEqual([
      [0, 10],
      [160, 10],
      [160, 100],
      [0, 100],
    ]);
    expect(clipToPolygon({ rect: [0, 0, 50, 50] }, container, box).points).toEqual([
      [-100, -50],
      [390, -50],
      [390, 190],
      [-100, 190],
    ]);
    const polygon = clipToPolygon(
      {
        polygon: [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        evenOdd: true,
      },
      container,
      box,
    );
    expect(polygon.evenOdd).toBe(true);
    expect(polygon.points[2]).toEqual([880, 430]);
  });
});

describe('text flow', () => {
  test('wraps greedily and breaks words that do not fit', () => {
    const tokens = tokenizeVTTCue(new VTTCue(0, 1, 'one two three four'));
    const flow = flowCue(tokens, base, {
      maxWidth: 12 * 9, // nine glyphs
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
      balance: false,
    });
    expect(flow.lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual([
      'one two',
      'three',
      'four',
    ]);
    expect(flow.height).toBeCloseTo(3 * 28.8);

    const long = flowCue(tokenizeVTTCue(new VTTCue(0, 1, 'abcdefghijkl')), base, {
      maxWidth: 12 * 5,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
    });
    expect(long.lines.map((l) => l.runs[0].text)).toEqual(['abcde', 'fghij', 'kl']);
  });

  test('honours explicit line breaks and balances ragged lines', () => {
    const forced = flowCue(tokenizeVTTCue(new VTTCue(0, 1, 'a\nb')), base, {
      maxWidth: 1000,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
    });
    expect(forced.lines).toHaveLength(2);

    // Greedy would give "aaaa bbbb cccc" / "dd"; balance evens it out to two similar lines.
    const balanced = flowCue(tokenizeVTTCue(new VTTCue(0, 1, 'aaaa bbbb cccc dd')), base, {
      maxWidth: 12 * 15,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
    });
    expect(balanced.lines).toHaveLength(2);
    expect(balanced.lines[0].runs.map((r) => r.text).join('')).toBe('aaaa bbbb');
  });

  test('applies inline tags, class colours, and span styles as run styles', () => {
    const cue = new VTTCue(0, 1, '<b>bold</b> <c.yellow>sun</c> <c.s-0>big</c>');
    cue.spans = { '0': { fontSize: { unit: 'em', value: 2 }, color: 'red', underline: true } };
    const flow = flowCue(tokenizeVTTCue(cue), base, {
      maxWidth: null,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: theme.classColors,
    });
    const runs = flow.lines[0].runs;
    expect(runs.map((r) => r.text)).toEqual(['bold', ' ', 'sun', ' ', 'big']);
    expect(runs[0].style.bold).toBe(true);
    expect(runs[2].style.color).toBe('yellow');
    expect(runs[4].style).toMatchObject({
      fontSize: 48,
      color: 'red',
      underline: true,
      spanKey: '0',
    });
    expect(runs[4].width).toBe(3 * 24);
  });
});

describe('ruby', () => {
  test('flows the annotation over its base and reserves a band above the line', () => {
    const tokens = tokenizeVTTCue(new VTTCue(0, 1, 'a <ruby>漢字<rt>kanji</rt></ruby> b'));
    const flow = flowCue(tokens, base, {
      maxWidth: 1000,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
    });
    const [line] = flow.lines,
      ruby = line.runs.find((run) => run.ruby)!;
    expect(line.runs.map((run) => run.text)).toEqual(['a ', '漢字', ' b']);
    // The base is 2 glyphs (24px), the annotation 5 glyphs at half size (30px): the run is as
    // wide as the annotation and the base is centred inside it.
    expect(ruby.baseWidth).toBe(24);
    expect(ruby.ruby).toMatchObject({ text: 'kanji', width: 30 });
    expect(ruby.ruby!.style.fontSize).toBe(12);
    expect(ruby.width).toBe(30);
    // The band overflows the line box like the browser's; the flow height is unchanged.
    expect(line.rubyHeight).toBe(12);
    expect(flow.height).toBe(28.8);
  });

  test('a ruby base never breaks and a ruby without <rt> flows normally', () => {
    const tokens = tokenizeVTTCue(new VTTCue(0, 1, '<ruby>abcdef<rt>x</rt></ruby>'));
    const narrow = flowCue(tokens, base, {
      maxWidth: 30,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
    });
    expect(narrow.lines).toHaveLength(1);
    expect(narrow.lines[0].runs[0].text).toBe('abcdef');

    const plain = flowCue(tokenizeVTTCue(new VTTCue(0, 1, '<ruby>ab cd</ruby>')), base, {
      maxWidth: 1000,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
    });
    expect(plain.lines[0].runs.map((run) => run.text)).toEqual(['ab cd']);
    expect(plain.lines[0].rubyHeight).toBe(0);
  });
});

describe('vertical writing', () => {
  test('flows CJK upright one em per glyph and Latin sideways by its width', () => {
    const tokens = tokenizeVTTCue(new VTTCue(0, 1, '縦書き abc'));
    const flow = flowCue(tokens, base, {
      maxWidth: 1000,
      lineHeight: 28.8,
      measurer,
      env,
      classColors: {},
      vertical: true,
    });
    const runs = flow.lines[0].runs;
    // Same-styled sideways segments merge, upright ones stay a separate run.
    expect(runs.map((r) => [r.text, r.upright ?? false, r.width])).toEqual([
      ['縦書き', true, 72], // 3 glyphs x 24px em
      [' abc', false, 48],
    ]);
    expect(flow.width).toBe(120);
  });

  test('ruby annotations flow upright beside their column', () => {
    const cue = new VTTCue(0, 1, '<ruby>漢字<rt>かんじ</rt></ruby>');
    cue.vertical = 'rl';
    const m = measureCue(cue, theme, measurer);
    const [column] = m.flow.lines,
      run = column.runs[0];
    expect(run.upright).toBe(true);
    expect(run.ruby).toMatchObject({ text: 'かんじ', upright: true, width: 36 });
    expect(column.rubyHeight).toBe(12);
    // One column plus the (swapped) padding; the annotation overflows beside it.
    expect(m.box.width).toBeCloseTo(theme.lineHeight + 2 * theme.paddingY);
  });

  test('wraps into columns and measures a vertical cue along the height', () => {
    const cue = new VTTCue(0, 1, '一二三四五六七八');
    cue.vertical = 'rl';
    cue.size = 30; // 30% of the height: 144px, minus 2 * 14.4px padding = 115px = 4 glyphs
    const m = measureCue(cue, theme, measurer);
    expect(m.vertical).toBe('rl');
    expect(m.flow.lines).toHaveLength(2);
    expect(m.box.height).toBeCloseTo(0.3 * theme.container.height);
    expect(m.box.width).toBeCloseTo(2 * theme.lineHeight + 2 * theme.paddingY);
    // Position defaults to the centre of the height.
    expect(m.box.top).toBeCloseTo(0.35 * theme.container.height);
    expect(m.input).toMatchObject({ vertical: 'rl', lineHeight: theme.lineHeight, line: -1 });
  });
});

describe('headless cue measurement', () => {
  test('a default cue fills the container width and hugs its text vertically', () => {
    const m = measureCue(new VTTCue(0, 1, 'Hello world'), theme, measurer);
    expect(m.box).toMatchObject({ left: 0, top: 0, width: theme.container.width });
    expect(m.box.height).toBeCloseTo(theme.lineHeight + 2 * theme.paddingY);
    // Text box centred inside the display box.
    expect(m.textBox.width).toBeCloseTo(11 * 12 + 2 * theme.paddingX);
    expect(m.textBox.left).toBeCloseTo((m.box.width - m.textBox.width) / 2);
    expect(m.input).toMatchObject({
      kind: 'cue',
      snapToLines: true,
      line: -1,
      fixed: false,
      positionOverride: false,
      lineHeight: theme.lineHeight,
    });
  });

  test('WebVTT position, size, and alignment size the box like the DOM renderer', () => {
    const cue = new VTTCue(0, 1, 'x');
    cue.position = 20;
    cue.size = 40;
    cue.align = 'start';
    const m = measureCue(cue, theme, measurer);
    expect(m.box.left).toBeCloseTo(0.2 * theme.container.width);
    expect(m.box.width).toBeCloseTo(0.4 * theme.container.width);
    expect(m.textBox.left).toBe(0);
  });

  test('the layout model positions boxes explicitly and folds in the anchor translation', () => {
    const cue = new VTTCue(0, 1, 'x');
    cue.layout = {
      left: 50,
      bottom: 10,
      width: 'max-content',
      translate: { x: -0.5 },
      fixed: true,
    };
    cue.textStyle = {
      fontSize: { unit: 'vh', value: 10 },
      lineHeight: 'normal',
      padding: { y: 0 },
    };
    const m = measureCue(cue, theme, measurer);
    const fontSize = 0.1 * theme.container.height;
    expect(m.style.fontSize).toBeCloseTo(fontSize);
    expect(m.box.width).toBeCloseTo(fontSize * 0.5 + 2 * theme.paddingX);
    expect(m.box.height).toBeCloseTo(fontSize * 1.2);
    expect(m.box.left).toBeCloseTo(0.5 * theme.container.width - m.box.width / 2);
    expect(m.box.top).toBeCloseTo(0.9 * theme.container.height - m.box.height);
    expect(m.input).toMatchObject({ fixed: true, positionOverride: 'bottom' });
  });

  test('regions apply only under the WebVTT conditions', () => {
    const region = new VTTRegion();
    const cue = new VTTCue(0, 1, 'x');
    cue.region = region;
    expect(regionOf(cue)).toBe(region);
    cue.size = 50;
    expect(regionOf(cue)).toBeNull();
  });
});

describe('animation sampling', () => {
  test('interpolates numbers, colours, lengths, transforms, and clips', () => {
    expect(interpolate(0, 1, 0.25)).toBe(0.25);
    expect(interpolate('rgb(0,0,0)', 'rgb(255,255,255)', 0.5)).toBe('rgba(128,128,128,1)');
    expect(interpolate({ unit: 'vh', value: 10 }, { unit: 'vh', value: 20 }, 0.5)).toEqual({
      unit: 'vh',
      value: 15,
    });
    expect(interpolate({ scaleX: 1, rotate: 0 }, { scaleX: 2, rotate: 90 }, 0.5)).toEqual({
      scaleX: 1.5,
      rotate: 45,
    });
    // A field missing on one side interpolates from its neutral value.
    expect(interpolate({ scaleX: 2 }, { rotate: 90 }, 0.5)).toEqual({ scaleX: 1.5, rotate: 45 });
    expect(interpolate({ rect: [0, 0, 100, 100] }, { rect: [0, 0, 50, 100] }, 0.5)).toEqual({
      rect: [0, 0, 75, 100],
    });
    // Mismatched kinds step at the midpoint.
    expect(interpolate({ unit: 'vh', value: 1 }, { unit: 'em', value: 1 }, 0.4)).toEqual({
      unit: 'vh',
      value: 1,
    });
  });

  test('samples \\fad-style keyframes at media time with fill both', () => {
    const spec = {
      duration: 4,
      keyframes: [
        { offset: 0, opacity: 0 },
        { offset: 0.25, opacity: 1 },
        { offset: 0.75, opacity: 1 },
        { offset: 1, opacity: 0 },
      ],
    };
    expect(sampleAnimation(spec, 10.5, 10).opacity).toBeCloseTo(0.5);
    expect(sampleAnimation(spec, 12, 10).opacity).toBe(1);
    expect(sampleAnimation(spec, 13.5, 10).opacity).toBeCloseTo(0.5);
    expect(sampleAnimation(spec, 20, 10).opacity).toBe(0);
    expect(sampleAnimation(spec, 5, 10).opacity).toBe(0);
    expect(sampleAnimation(spec, 11, 10, true).opacity).toBe(0); // reduced motion: final state
  });

  test('fills in missing offsets evenly and honours delay', () => {
    const spec = { delay: 1, duration: 2, keyframes: [{ left: 0 }, { left: 50 }, { left: 100 }] };
    expect(sampleAnimation(spec, 0, 0).left).toBe(0);
    expect(sampleAnimation(spec, 1.5, 0).left).toBe(25);
    expect(sampleAnimation(spec, 2, 0).left).toBe(50);
  });
});

describe('layoutCaptions', () => {
  test('stacks simultaneous cues without overlap using the shared layout engine', () => {
    const cues = [new VTTCue(0, 10, 'First'), new VTTCue(0, 10, 'Second')];
    const { targets } = layoutCaptions(cues, measurer, { width: WIDTH, height: HEIGHT });
    expect(targets).toHaveLength(2);
    const boxes = targets.map((t) => t.box).sort((a, b) => a.top - b.top);
    expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 0.01);
    // The last cue takes the bottom slot (reading order).
    expect(boxes[1].bottom).toBeCloseTo(theme.container.height, 0);
    const bottom = targets.find((t) => t.box === boxes[1])!;
    expect(bottom.kind === 'cue' && bottom.item.cue.text).toBe('Second');
  });

  test('places region cues inside a region box anchored per the region settings', () => {
    const region = new VTTRegion();
    region.id = 'r';
    region.width = 50;
    region.lines = 2;
    region.regionAnchorX = 0;
    region.regionAnchorY = 100;
    region.viewportAnchorX = 10;
    region.viewportAnchorY = 90;
    const cues = ['a', 'b', 'c'].map((text, i) => {
      const cue = new VTTCue(i, 10, text);
      cue.region = region;
      return cue;
    });
    const { targets } = layoutCaptions(cues, measurer, { width: WIDTH, height: HEIGHT });
    expect(targets).toHaveLength(1);
    const target = targets[0];
    expect(target.kind).toBe('region');
    if (target.kind !== 'region') return;
    expect(target.item.visible.map((c) => c.cue.text)).toEqual(['b', 'c']);
    expect(target.box.width).toBeCloseTo(0.5 * theme.container.width);
    expect(target.box.left).toBeCloseTo(0.1 * theme.container.width);
    expect(target.box.bottom).toBeCloseTo(0.9 * theme.container.height);
  });
});
