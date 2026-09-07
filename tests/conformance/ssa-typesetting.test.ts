/**
 * SSA/ASS typesetting: per-run override tags, fades, `\move`, `\t` transitions, karaoke sweeps,
 * `\p` drawings, `\clip`, `Effect` fields, and wrap styles. Verifies the structured output the
 * renderer consumes (`cue.spans`, `cue.animations`, `layout.clipPath`).
 */
import { parseText, renderVTTCueString, type VTTCue } from 'media-captions';

const STYLE_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';
const EVENT_FORMAT =
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

// Arial 48, white primary, red secondary, black outline 2, no shadow, bottom centre, margins 10.
const DEFAULT =
  'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1';
const OTHER =
  'Style: Other,Impact,24,&H0000FF00,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1';

function ass(events: string[], info: string[] = []) {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1280',
    'PlayResY: 720',
    ...info,
    '',
    '[V4+ Styles]',
    STYLE_FORMAT,
    DEFAULT,
    OTHER,
    '',
    '[Events]',
    EVENT_FORMAT,
    ...events,
    '',
  ].join('\n');
}

/** A 4 second dialogue from 1s to 5s. */
const dialogue = (text: string, effect = '') =>
  `Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,${effect},${text}`;

async function parse(events: string[], info: string[] = []) {
  const result = await parseText(ass(events, info), { type: 'ass', errors: true });
  expect(result.errors).toEqual([]);
  return result;
}

async function one(text: string, effect = '', info: string[] = []) {
  const { cues } = await parse([dialogue(text, effect)], info);
  return cues[0];
}

/** Script pixels as the typed overlay-height length the parser emits. */
const lenY = (px: number) => ({
  unit: 'vh' as const,
  value: Math.round((px / 720) * 100 * 1e4) / 1e4,
});

describe('per-span override tags', () => {
  test('\\fs opens a span scaled like the style and closes when the size returns', async () => {
    const cue = await one('{\\fs30}big{\\fs48}normal');
    expect(cue.text).toBe('<c.s-0>big</c>normal');
    expect(cue.spans).toEqual({ '0': { fontSize: lenY(30) } });
  });

  test('all per-span tags map to span style keys', async () => {
    const cue = await one(
      '{\\fnImpact\\fscx120\\frz10\\bord4\\shad3\\blur1\\alpha&H80&\\3c&H0000FF&\\4c&H00FF00&\\fsp2}x',
    );
    expect(cue.text).toBe('<c.s-0>x</c>');
    expect(cue.spans!['0']).toEqual({
      fontFamily: '"Impact", sans-serif',
      transform: { scaleX: 1.2, rotate: -10, origin: [50, 100] },
      stroke: { width: lenY(8), color: 'rgba(255,0,0,1)' },
      shadow: { x: lenY(3), y: lenY(3), color: 'rgba(0,255,0,1)' },
      blur: lenY(1),
      opacity: 0.498,
      letterSpacing: lenY(2),
    });
  });

  test('3D rotations and scale are relative to the style values', async () => {
    const cue = await one('{\\frx30\\fry-45\\fscy50}x');
    expect(cue.spans!['0']).toEqual({
      transform: { scaleY: 0.5, rotateX: -30, rotateY: 45, origin: [50, 100] },
    });
  });

  test('values equal to the style defaults emit no span', async () => {
    const cue = await one('{\\fnArial\\fs48\\fscx100\\bord2\\shad0\\alpha&H00&}x');
    expect(cue.text).toBe('x');
    expect(cue.spans).toBeUndefined();
  });

  test('\\bord0 removes the style stroke on the run only', async () => {
    const cue = await one('a{\\bord0}b');
    expect(cue.text).toBe('a<c.s-0>b</c>');
    expect(cue.spans!['0']).toEqual({ stroke: null });
    expect(cue.textStyle?.stroke).toEqual({ width: lenY(4), color: 'rgba(0,0,0,1)' });
  });

  test('font names with spaces are read whole', async () => {
    const cue = await one('{\\fnArial Black}x');
    expect(cue.spans!['0']).toEqual({ fontFamily: '"Arial Black", sans-serif' });
  });

  test('spans nest correctly with formatting tags and colours', async () => {
    const cue = await one('{\\i1}a{\\fs30}b{\\i0}c{\\c&H0000FF&}d{\\fs48}e');
    expect(cue.text).toBe('<i>a<c.s-0>b</c></i><c.s-0>c<c.#ff0000>d</c></c><c.#ff0000>e</c>');
    expect(renderVTTCueString(cue)).toContain('<span data-span="0" style="font-size:');
  });

  test('\\r closes spans and \\rName switches to another style', async () => {
    const cue = await one('{\\fs30}a{\\r}b{\\rOther}c');
    expect(cue.text).toBe('<c.s-0>a</c>b<b><c.s-1>c</c></b>');
    expect(cue.spans!['1']).toEqual({
      fontSize: lenY(24),
      fontFamily: '"Impact", sans-serif',
    });
  });

  test('\\s strikes through a run', async () => {
    const cue = await one('a{\\s1}b');
    expect(cue.spans!['0']).toEqual({ strike: true });
  });

  test('span-only overrides do not force a layout on unstyled dialogues', async () => {
    const { cues } = await parse(['Dialogue: 0,0:00:01.00,0:00:05.00,Missing,,0,0,0,,{\\fs30}x']);
    expect(cues[0].layout).toBeUndefined();
    expect(cues[0].spans!['0'].fontSize).toEqual(lenY(30));
  });
});

describe('fades', () => {
  test('\\fad(in,out) animates display opacity with offsets from the cue duration', async () => {
    const cue = await one('{\\fad(500,1000)}x');
    expect(cue.text).toBe('x');
    expect(cue.animations).toEqual([
      {
        target: 'display',
        duration: 4,
        fill: 'both',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 0.125, opacity: 1 },
          { offset: 0.75, opacity: 1 },
          { offset: 1, opacity: 0 },
        ],
      },
    ]);
  });

  test('\\fad with only a fade in stays opaque at the end', async () => {
    const cue = await one('{\\fad(2000,0)}x');
    expect(cue.animations![0].keyframes).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 0.5, opacity: 1 },
      { offset: 1, opacity: 1 },
      { offset: 1, opacity: 1 },
    ]);
  });

  test('\\fad longer than the cue keeps offsets monotonic', async () => {
    const cue = await one('{\\fad(3000,3000)}x');
    expect(cue.animations![0].keyframes.map((k) => k.offset)).toEqual([0, 0.75, 0.75, 1]);
  });

  test('\\fade maps alphas (0 opaque) and times to opacity keyframes', async () => {
    const cue = await one('{\\fade(255,0,255,0,500,3500,4000)}x');
    expect(cue.animations).toEqual([
      {
        target: 'display',
        duration: 4,
        fill: 'both',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 0, opacity: 0 },
          { offset: 0.125, opacity: 1 },
          { offset: 0.875, opacity: 1 },
          { offset: 1, opacity: 0 },
          { offset: 1, opacity: 0 },
        ],
      },
    ]);
  });
});

describe('\\move', () => {
  test('positions like \\pos at the start point and animates left/top in overlay percentages', async () => {
    const cue = await one('{\\move(100,100,500,300,500,1500)}x');
    expect(cue.layout).toEqual({
      width: 'max-content',
      left: 7.813,
      top: 13.889,
      translate: { x: -0.5, y: -1 },
      fixed: true,
    });
    expect(cue.animations).toEqual([
      {
        target: 'display',
        delay: 0.5,
        duration: 1,
        fill: 'both',
        keyframes: [
          { left: 7.813, top: 13.889 },
          { left: 39.063, top: 41.667 },
        ],
      },
    ]);
  });

  test('without times the move spans the whole cue', async () => {
    const cue = await one('{\\an7\\move(0,0,1280,720)}x');
    expect(cue.layout?.translate).toEqual({});
    expect(cue.animations![0]).toMatchObject({ delay: 0, duration: 4 });
    expect(cue.animations![0].keyframes[1]).toEqual({ left: 100, top: 100 });
  });
});

describe('\\t transitions', () => {
  test('colour transition on the whole cue', async () => {
    const cue = await one('{\\t(\\c&H0000FF&)}x');
    expect(cue.text).toBe('x');
    expect(cue.spans).toBeUndefined();
    expect(cue.animations).toEqual([
      {
        target: 'cue',
        delay: 0,
        duration: 4,
        fill: 'both',
        keyframes: [
          { offset: 0, color: 'rgba(255,255,255,1)' },
          { offset: 1, color: 'rgba(255,0,0,1)' },
        ],
      },
    ]);
  });

  test('timed transform, stroke, blur, size, and outline colour transitions', async () => {
    const cue = await one(
      '{\\t(500,1500,\\fscx200\\frz90\\bord0\\blur2\\fs24\\3c&H00FF00&\\1a&H80&)}x',
    );
    const [anim] = cue.animations!;
    expect(anim).toMatchObject({ target: 'cue', delay: 0.5, duration: 1 });
    expect(anim.keyframes).toEqual([
      {
        offset: 0,
        strokeColor: 'rgba(0,0,0,1)',
        opacity: 1,
        transform: { scaleX: 1, scaleY: 1, rotate: 0 },
        strokeWidth: lenY(4),
        blur: lenY(0),
        fontSize: lenY(48),
      },
      {
        offset: 1,
        strokeColor: 'rgba(0,255,0,1)',
        opacity: 0.498,
        transform: { scaleX: 2, scaleY: 1, rotate: -90 },
        strokeWidth: lenY(0),
        blur: lenY(2),
        fontSize: lenY(24),
      },
    ]);
  });

  test('acceleration samples progress^accel at 8 intervals', async () => {
    const cue = await one('{\\t(0,4000,2,\\alpha&HFF&)}x');
    const frames = cue.animations![0].keyframes;
    expect(frames).toHaveLength(9);
    expect(frames.map((k) => k.offset)).toEqual([
      0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
    ]);
    // opacity = 1 - progress^2
    expect(frames[2].opacity).toBe(0.938);
    expect(frames[4].opacity).toBe(0.75);
    expect(frames[8].opacity).toBe(0);
  });

  test('a single parameter is the acceleration', async () => {
    const cue = await one('{\\t(0.5,\\alpha&HFF&)}x');
    expect(cue.animations![0]).toMatchObject({ delay: 0, duration: 4 });
    expect(cue.animations![0].keyframes[4].opacity).toBe(0.293);
  });

  test('mid-text transitions target a fresh span run', async () => {
    const cue = await one('a{\\t(\\fs30)}b');
    expect(cue.text).toBe('a<c.s-0>b</c>');
    expect(cue.spans).toEqual({ '0': {} });
    expect(cue.animations).toEqual([
      {
        target: { span: '0' },
        delay: 0,
        duration: 4,
        fill: 'both',
        keyframes: [
          { offset: 0, fontSize: lenY(48) },
          { offset: 1, fontSize: lenY(30) },
        ],
      },
    ]);
  });

  test('transitions inside a colour tag target a span so the colour can change', async () => {
    const cue = await one('{\\c&H0000FF&\\t(\\c&H00FF00&)}x');
    expect(cue.text).toBe('<c.#ff0000><c.s-0>x</c></c>');
    expect(cue.animations![0].target).toEqual({ span: '0' });
    expect(cue.animations![0].keyframes[0].color).toBe('rgba(255,0,0,1)');
  });

  test('chained transitions start from the previous end state', async () => {
    const cue = await one('{\\t(0,1000,\\fs30)\\t(1000,2000,\\fs60)}x');
    expect(cue.animations![1].keyframes[0].fontSize).toEqual(lenY(30));
    expect(cue.animations![1].keyframes[1].fontSize).toEqual(lenY(60));
  });

  test('unsupported tags inside \\t apply immediately as their end state', async () => {
    const cue = await one('{\\t(\\frz90\\i1\\fnImpact)}x');
    expect(cue.text).toBe('<i><c.s-0>x</c></i>');
    expect(cue.spans!['0']).toEqual({ fontFamily: '"Impact", sans-serif' });
    expect(cue.animations![0].target).toBe('cue');
    expect(cue.animations![0].keyframes[1].transform).toEqual({
      scaleX: 1,
      scaleY: 1,
      rotate: -90,
    });
  });

  test('a \\t without animatable changes emits nothing', async () => {
    const cue = await one('{\\t(\\an5)}x');
    expect(cue.animations).toBeUndefined();
  });
});

describe('karaoke', () => {
  test('\\kf and \\K sweep the fill from the secondary to the primary colour', async () => {
    const cue = await one('{\\kf100}Ka{\\K50}ra');
    expect(cue.text).toBe('<00:00:01.000><c.s-0>Ka</c><00:00:02.000><c.s-1>ra</c>');
    expect(cue.spans!['0']).toEqual({
      sweep: { sung: 'rgba(255,255,255,1)', unsung: 'rgba(255,0,0,1)' },
    });
    expect(cue.animations).toEqual([
      {
        target: { span: '0' },
        delay: 0,
        duration: 1,
        fill: 'both',
        keyframes: [{ sweep: 0 }, { sweep: 1 }],
      },
      {
        target: { span: '1' },
        delay: 1,
        duration: 0.5,
        fill: 'both',
        keyframes: [{ sweep: 0 }, { sweep: 1 }],
      },
    ]);
    expect(renderVTTCueString(cue)).toContain('-webkit-background-clip: text;');
  });

  test('\\ko animates the outline colour at the syllable time', async () => {
    const cue = await one('{\\k50}a{\\ko100}b');
    expect(cue.text).toBe('<00:00:01.000>a<00:00:01.500><c.s-0>b</c>');
    expect(cue.spans).toEqual({ '0': {} });
    expect(cue.animations).toEqual([
      {
        target: { span: '0' },
        delay: 0.5,
        duration: 1,
        fill: 'both',
        keyframes: [{ strokeColor: 'rgba(255,0,0,1)' }, { strokeColor: 'rgba(255,255,255,1)' }],
      },
    ]);
  });

  test('\\2c changes the sweep start colour', async () => {
    const cue = await one('{\\2c&H00FF00&\\kf100}x');
    expect(cue.spans!['0'].sweep?.unsung).toBe('rgba(0,255,0,1)');
  });
});

describe('drawings', () => {
  test('a rectangle becomes an SVG drawing span sized in overlay percentages', async () => {
    const cue = await one('{\\an7\\pos(100,100)\\bord0\\p1}m 0 0 l 200 0 200 100 0 100{\\p0}');
    expect(cue.text).toBe('<c.s-0></c>');
    expect(cue.spans!['0']).toEqual({
      stroke: null,
      drawing: {
        path: 'M0 0L200 0L200 100L0 100Z',
        viewBox: [0, 0, 200, 100],
        width: 15.625,
        height: 13.889,
        fill: 'rgba(255,255,255,1)',
      },
    });
    expect(cue.layout).toEqual({
      width: 'max-content',
      left: 7.813,
      top: 13.889,
      translate: {},
      fixed: true,
    });
    expect(cue.textStyle?.padding).toEqual({ y: 0, x: 0 });
    expect(renderVTTCueString(cue)).toContain('viewBox="0 0 200 100"');
  });

  test('outline strokes the drawing and grows the box by the outline', async () => {
    const cue = await one('{\\p1\\c&H0000FF&\\3c&H00FF00&}m 0 0 l 200 0 200 100 0 100{\\p0}');
    expect(cue.spans!['0'].drawing).toMatchObject({
      viewBox: [-2, -2, 204, 104],
      height: 14.444,
      fill: 'rgba(255,0,0,1)',
      stroke: 'rgba(0,255,0,1)',
      strokeWidth: 4,
    });
    expect(cue.spans!['0'].drawing?.width).toBeCloseTo(15.9375, 2);
  });

  test('bezier segments and the bounding box include control points', async () => {
    const cue = await one('{\\bord0\\p1}m 0 0 b 0 100 100 100 100 0{\\p0}');
    expect(cue.spans!['0'].drawing).toMatchObject({
      path: 'M0 0C0 100 100 100 100 0Z',
      viewBox: [0, 0, 100, 100],
    });
  });

  test('\\p2 halves the coordinates', async () => {
    const cue = await one('{\\bord0\\p2}m 0 0 l 400 0 400 200 0 200{\\p0}');
    expect(cue.spans!['0'].drawing?.path).toBe('M0 0L200 0L200 100L0 100Z');
  });

  test('b-splines are converted to cubic segments', async () => {
    const cue = await one('{\\bord0\\p1}m 0 0 s 100 0 100 100 0 100 c{\\p0}');
    const path = cue.spans!['0'].drawing!.path;
    expect(path.startsWith('M0 0L')).toBe(true);
    expect(path.split('C').length - 1).toBeGreaterThanOrEqual(3);
    expect(path.endsWith('Z')).toBe(true);
  });

  test('multiple subpaths are closed individually', async () => {
    const cue = await one('{\\bord0\\p1}m 0 0 l 10 0 10 10 m 20 20 l 30 20 30 30{\\p0}');
    expect(cue.spans!['0'].drawing?.path).toBe('M0 0L10 0L10 10ZM20 20L30 20L30 30Z');
  });

  test('drawings without \\pos use the alignment margins', async () => {
    const cue = await one('{\\an7\\bord0\\p1}m 0 0 l 10 0 10 10 0 10{\\p0}');
    expect(cue.layout).toMatchObject({ left: 0.781, top: 1.389, maxWidth: 98.438 });
    expect(cue.layout?.fixed).toBeUndefined();
  });

  test('drawings mixed with text keep the text', async () => {
    const cue = await one('before {\\p1}m 0 0 l 10 0 10 10{\\p0} after');
    expect(cue.text).toBe('before <c.s-0></c> after');
    // Per-run state set alongside a drawing (`\\bord0`) stays in effect for the text after it.
    const bord = await one('before {\\bord0\\p1}m 0 0 l 10 0 10 10{\\p0} after');
    expect(bord.text).toBe('before <c.s-0></c><c.s-1> after</c>');
    expect(bord.spans!['1']).toEqual({ stroke: null });
  });
});

describe('\\clip', () => {
  test('rectangular clips are screen-fixed rectangles in overlay percentages', async () => {
    const cue = await one('{\\an7\\pos(640,360)\\clip(600,300,700,400)}x');
    expect(cue.layout?.clip).toEqual({ rect: [46.875, 41.667, 54.688, 55.556] });
  });

  test('clips are independent of the anchor translation', async () => {
    const cue = await one('{\\an5\\pos(640,360)\\clip(0,0,1280,720)}x');
    expect(cue.layout?.clip).toEqual({ rect: [0, 0, 100, 100] });
    expect(cue.layout?.translate).toEqual({ x: -0.5, y: -0.5 });
  });

  test('vector clips become even-odd polygons', async () => {
    const cue = await one('{\\an7\\pos(0,0)\\clip(m 0 0 l 100 0 100 100 0 100)}x');
    expect(cue.layout?.clip).toEqual({
      polygon: [
        [0, 0],
        [7.813, 0],
        [7.813, 13.889],
        [0, 13.889],
      ],
      evenOdd: true,
    });
  });

  test('clips on layout-positioned cues are kept; \\iclip is ignored', async () => {
    const { cues } = await parse([
      dialogue('{\\clip(0,0,10,10)}x'),
      dialogue('{\\pos(0,0)\\iclip(0,0,10,10)}y'),
    ]);
    expect(cues[0].layout?.clip).toEqual({ rect: [0, 0, 0.781, 1.389] });
    expect(cues[0].layout?.fixed).toBeUndefined();
    expect(cues[1].layout?.clip).toBeUndefined();
    expect(cues[1].text).toBe('y');
  });
});

describe('Effect field', () => {
  test('Scroll up moves the box up through the band and clips to it', async () => {
    const cue = await one('x', 'Scroll up;100;300;50');
    expect(cue.layout).toMatchObject({ top: 41.667, left: 50, fixed: true });
    expect(cue.layout?.bottom).toBeUndefined();
    // The band is fixed on screen: y 100..300 of 720, wider than any box.
    const band = { rect: [-100, 13.889, 200, 41.667] };
    expect(cue.layout?.clip).toEqual(band);
    // 1000 / 50 = 20 px/s over 200px = 10s, clamped to the 4s cue.
    expect(cue.animations).toEqual([
      {
        target: 'display',
        duration: 4,
        fill: 'both',
        keyframes: [
          { top: 41.667, translate: { y: 0 }, clip: band },
          { top: 13.889, translate: { y: -1 }, clip: band },
        ],
      },
    ]);
  });

  test('Scroll down starts above the band and its speed follows the delay', async () => {
    const cue = await one('x', 'Scroll down;100;300;10');
    expect(cue.layout?.top).toBe(13.889);
    const [anim] = cue.animations!;
    // 1000 / 10 = 100 px/s over 200px = 2s.
    expect(anim.duration).toBe(2);
    expect(anim.keyframes[0]).toMatchObject({ top: 13.889, translate: { y: -1 } });
    expect(anim.keyframes[1]).toMatchObject({ top: 41.667, translate: { y: 0 } });
  });

  test('Banner scrolls right-to-left across the overlay on one line', async () => {
    const cue = await one('x', 'Banner;20');
    expect(cue.layout).toMatchObject({ left: 100, bottom: 1.389, fixed: true });
    expect(cue.layout?.maxWidth).toBeUndefined();
    expect(cue.textStyle?.wrap).toBe('nowrap');
    expect(cue.animations).toEqual([
      {
        target: 'display',
        duration: 4,
        fill: 'both',
        keyframes: [
          { left: 100, translate: { x: 0 } },
          { left: 0, translate: { x: -1 } },
        ],
      },
    ]);
  });

  test('Banner;delay;1 scrolls left-to-right', async () => {
    const cue = await one('x', 'Banner;1;1');
    expect(cue.layout?.left).toBe(0);
    // 1000 px/s over 1280px = 1.28s.
    expect(cue.animations![0].duration).toBe(1.28);
    expect(cue.animations![0].keyframes[0]).toEqual({ left: 0, translate: { x: -1 } });
  });

  test('unknown effects are ignored', async () => {
    const cue = await one('x', 'Karaoke');
    expect(cue.animations).toBeUndefined();
    expect(cue.layout?.fixed).toBeUndefined();
  });
});

describe('script info', () => {
  test.each([
    [0, 'wrap'],
    [1, 'wrap'],
    [2, 'nowrap'],
    [3, 'wrap'],
  ])('WrapStyle %i -> wrap %s', async (wrapStyle, wrap) => {
    const cue = await one('x', '', [`WrapStyle: ${wrapStyle}`]);
    expect(cue.textStyle?.wrap).toBe(wrap);
  });

  test('\\q overrides the wrap style per dialogue', async () => {
    const cue = await one('{\\q2}a\\nb');
    expect(cue.textStyle?.wrap).toBe('nowrap');
    expect(cue.text).toBe('a\nb');
  });

  test('Collisions is surfaced in metadata for the renderer', async () => {
    const { metadata } = await parse([dialogue('x')], ['Collisions: Normal']);
    expect(metadata.Collisions).toBe('Normal');
  });
});

describe('serialisation', () => {
  test('spans and animations survive a JSON round trip', async () => {
    const cue = await one('{\\fad(200,200)\\fs30}a{\\kf50}b');
    const { VTTCue } = await import('media-captions');
    const copy = VTTCue.from(JSON.parse(JSON.stringify(cue)));
    expect(copy.spans).toEqual(cue.spans);
    expect(copy.animations).toEqual(cue.animations);
    expect(renderVTTCueString(copy)).toBe(renderVTTCueString(cue));
  });
});

describe('tag emission', () => {
  const STYLE =
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1';
  const doc = (text: string) =>
    `[Script Info]\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\n${STYLE}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,${text}\n`;

  test('closing tags out of order never leaves empty pairs', async () => {
    const { cues } = await parseText(doc('{\\b1\\i1\\u1}x{\\b0\\i0\\u0}'), { type: 'ass' });
    expect(cues[0].text).toBe('<b><i><u>x</u></i></b>');
  });

  test('toggling with no text in between emits nothing', async () => {
    const { cues } = await parseText(doc('{\\b1}{\\b0}plain {\\i1}{\\i0}text'), { type: 'ass' });
    expect(cues[0].text).toBe('plain text');
  });

  test('re-opened tags are emitted before the next text run', async () => {
    const { cues } = await parseText(doc('{\\b1\\i1}a{\\b0}b{\\i0}c'), { type: 'ass' });
    expect(cues[0].text).toBe('<b><i>a</i></b><i>b</i>c');
  });

  test('rectangular \\clip without \\pos becomes a screen-fixed clip rectangle', async () => {
    const { cues } = await parseText(doc('{\\clip(0,0,640,360)}clipped'), { type: 'ass' });
    expect(cues[0].layout?.clip).toEqual({ rect: [0, 0, 50, 50] });
    expect(cues[0].layout?.fixed).toBeUndefined();
  });
});

describe('transform origin', () => {
  const STYLE =
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1';
  const doc = (text: string) =>
    `[Script Info]\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\n${STYLE}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,${text}\n`;

  const spans = (cue: VTTCue) => Object.values(cue.spans ?? {});

  test('inline rotation pivots on the alignment anchor by default', async () => {
    const top = (await parseText(doc('{\\an8\\frz15}x'), { type: 'ass' })).cues[0];
    expect(spans(top)).toEqual([{ transform: { rotate: -15, origin: [50, 0] } }]);
    expect(top.textStyle?.transform).toBeUndefined();
    const bottomLeft = (await parseText(doc('{\\an1\\frz15}x'), { type: 'ass' })).cues[0];
    expect(spans(bottomLeft)[0].transform?.origin).toEqual([0, 100]);
    const plain = (await parseText(doc('{\\an5}x'), { type: 'ass' })).cues[0];
    expect(plain.textStyle?.transform).toBeUndefined();
    expect(plain.spans).toBeUndefined();
  });

  test('a cue-level \\t scale pivots on the anchor', async () => {
    const cue = (await parseText(doc('{\\an8\\t(\\fscx150\\fscy150)}x'), { type: 'ass' })).cues[0];
    expect(cue.textStyle?.transform).toEqual({ origin: [50, 0] });
    expect(cue.animations?.[0].target).toBe('cue');
    const faded = (await parseText(doc('{\\an8\\fad(200,200)}x'), { type: 'ass' })).cues[0];
    expect(faded.textStyle?.transform).toBeUndefined();
  });

  test('a style-level Angle rotates the cue box around its anchor', async () => {
    const rotated = doc('{\\an8}x').replace(',100,100,0,0,1,2,0,2,', ',100,100,0,20,1,2,0,2,');
    const cue = (await parseText(rotated, { type: 'ass' })).cues[0];
    expect(cue.textStyle?.transform).toEqual({ rotate: -20, origin: [50, 0] });
  });

  test('\\org on a positioned cue becomes an overlay-relative origin', async () => {
    const cue = (await parseText(doc('{\\pos(640,360)\\org(0,0)\\frz90}x'), { type: 'ass' }))
      .cues[0];
    expect(spans(cue)[0].transform).toEqual({ rotate: -90, originAt: [0, 0] });
    // The DOM writer places the pivot relative to the box through the overlay size variables.
    expect(renderVTTCueString(cue)).toContain(
      'transform-origin: calc(var(--overlay-width) * -0.5 + 50%) calc(var(--overlay-height) * -0.5 + 100%);',
    );
  });
});
