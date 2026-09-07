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
  parseClipPath,
  parseColor,
  parseSweepGradient,
  parseTransform,
  resolveLength,
} from '../../src/canvas/css-values';
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

describe('css value bridge', () => {
  test('resolves the length dialect the parsers emit', () => {
    expect(resolveLength('calc(var(--overlay-height) * 0.05)', env)).toBeCloseTo(24);
    expect(resolveLength('calc(var(--overlay-width) * 0.5 + 10%)', { ...env, percent: 200 })).toBe(
      510,
    );
    expect(resolveLength('2em', env)).toBe(48);
    expect(resolveLength('10%', { ...env, percent: 50 })).toBe(5);
    expect(resolveLength('5cqh', env)).toBeCloseTo(24);
    expect(resolveLength('0', env)).toBe(0);
    expect(resolveLength('auto', env)).toBeNull();
    // Chained factors and nested expressions (TTML relative font sizes).
    expect(resolveLength('calc(var(--overlay-height) * 0.05 * 0.8)', env)).toBeCloseTo(19.2);
    expect(resolveLength('calc((var(--cue-font-size) + 6px) / 2)', env)).toBe(15);
    expect(resolveLength('calc(var(--unknown) * 2)', env)).toBeNull();
  });

  test('parses transforms and colours', () => {
    const t = parseTransform('translateX(-50%) scaleX(1.2) rotate(-15deg)', {
      ...env,
      percentX: 200,
      percentY: 40,
    });
    expect(t).toEqual({ translateX: -100, translateY: 0, scaleX: 1.2, scaleY: 1, rotate: -15 });
    expect(parseColor('#ff000080')).toEqual([255, 0, 0, expect.closeTo(0.5, 2)]);
    expect(parseColor('rgba(0, 255, 0, 0.8)')).toEqual([0, 255, 0, 0.8]);
    expect(parseColor('yellow')).toBeNull();
  });

  test('reads the two colours of a karaoke sweep gradient', () => {
    expect(
      parseSweepGradient('linear-gradient(90deg, rgba(255,255,255,1) 50%, rgba(0,165,255,1) 50%)'),
    ).toEqual({ from: 'rgba(255,255,255,1)', to: 'rgba(0,165,255,1)' });
    expect(parseSweepGradient('url(x.png)')).toBeNull();
  });

  test('turns our clip-path output into box-relative polygons', () => {
    const box = { width: 200, height: 100 };
    expect(parseClipPath('inset(10px 20% 0 0)', env, box)).toEqual([
      [0, 10],
      [160, 10],
      [160, 100],
      [0, 100],
    ]);
    const polygon = parseClipPath(
      'polygon(calc(var(--overlay-width) * 0.1 + 50%) 0%, 100% 0%, 100% 100%)',
      env,
      box,
    );
    expect(polygon).toEqual([
      [198, 0],
      [200, 0],
      [200, 100],
    ]);
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
    cue.spans = { '0': { fontSize: '2em', color: 'red', textDecoration: 'underline' } };
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
      fontSize: 'calc(var(--overlay-height) * 0.1)',
      lineHeight: 'normal',
      paddingY: '0',
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
  test('interpolates numbers, lengths, colours, and transform lists', () => {
    expect(interpolate(0, 1, 0.25)).toBe(0.25);
    expect(interpolate('10%', '20%', 0.5)).toBe('15%');
    expect(interpolate('rgb(0,0,0)', 'rgb(255,255,255)', 0.5)).toBe('rgba(128,128,128,1)');
    expect(interpolate('scaleX(1) rotate(0deg)', 'scaleX(2) rotate(90deg)', 0.5)).toBe(
      'scaleX(1.5) rotate(45deg)',
    );
    // Mismatched shapes step at the midpoint.
    expect(interpolate('scaleX(1)', 'rotate(90deg)', 0.4)).toBe('scaleX(1)');
    // Length lists (karaoke sweep `background-position`), unitless zero included.
    expect(interpolate('100% 0', '0 0', 0.25)).toBe('75% 0');
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
    const spec = {
      delay: 1,
      duration: 2,
      keyframes: [{ left: '0%' }, { left: '50%' }, { left: '100%' }],
    };
    expect(sampleAnimation(spec, 0, 0).left).toBe('0%');
    expect(sampleAnimation(spec, 1.5, 0).left).toBe('25%');
    expect(sampleAnimation(spec, 2, 0).left).toBe('50%');
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
