/**
 * Runs a slice of the W3C IMSC test suite (vendored under `./vendor`, see its README) through the
 * TTML parser.
 *
 * Every document must parse without throwing, produce only the errors listed for it in
 * `KNOWN_ISSUES` (see `KNOWN_ISSUES.md` for the reasons), and yield at least one cue when it has a
 * paragraph with text. A handful of documents additionally have hand-written expectations checking
 * timing, region-derived placement, span styles, image cues and vertical text against the values
 * the suite's reference renderings show.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseText, type VTTCue } from 'media-captions';

const VENDOR = fileURLToPath(new URL('./vendor/', import.meta.url));

/** Expected documents: 55 from `imsc1/ttml`, 7 from `imsc1_1/ttml`. */
const DOCUMENT_COUNT = 62;

/**
 * Vendored document -> parse error codes it is allowed to report (in order). Everything else must
 * parse cleanly. The `K*` tags reference `KNOWN_ISSUES.md`.
 */
const KNOWN_ISSUES: Record<string, number[]> = {
  // K1: no timing anywhere in the document; the paragraph is indefinite and we default to 10s.
  'imsc1/ttml/misc/unicode-non-bmp-character.ttml': [2],
  'imsc1/ttml/region/nested-region-001.ttml': [2],
  'imsc1_1/ttml/textShadow/textShadow001.ttml': [2],
};

/** Documents with text or image content that produce no cue, with the reason in KNOWN_ISSUES.md. */
const NO_CUES = new Set<string>([
  // K2: the image is an external file (`src="image001-img.png"`), which is never fetched.
  'imsc1_1/ttml/image/image001.ttml',
]);

// --------------------------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------------------------

function listDocuments(dir = VENDOR, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listDocuments(full, out);
    else if (entry.name.endsWith('.ttml')) {
      out.push(path.relative(VENDOR, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

function read(file: string) {
  return fs.readFileSync(path.join(VENDOR, file), 'utf8');
}

function parse(text: string) {
  return parseText(text, { type: 'ttml', errors: true });
}

/** Whether the document has a `<p>` with non-whitespace text content. */
function hasTextParagraph(xml: string) {
  const paragraphs = xml.matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g);
  for (const match of paragraphs) {
    if (match[1].replace(/<[^>]*>/g, '').trim()) return true;
  }
  return false;
}

function times(cues: VTTCue[]) {
  return cues.map((cue) => [cue.startTime, cue.endTime]);
}

function byText(cues: VTTCue[], text: string) {
  const cue = cues.find((candidate) => candidate.text === `<c.white>${text}</c>`);
  if (!cue) throw new Error(`no cue with text ${JSON.stringify(text)}`);
  return cue;
}

const documents = listDocuments();

// --------------------------------------------------------------------------------------------
// Conformance: every document parses
// --------------------------------------------------------------------------------------------

describe('IMSC documents parse', () => {
  test('the vendored slice is complete', () => {
    expect(documents).toHaveLength(DOCUMENT_COUNT);
    for (const file of [...Object.keys(KNOWN_ISSUES), ...NO_CUES]) {
      expect(documents).toContain(file);
    }
  });

  for (const file of documents) {
    test(file, async () => {
      const xml = read(file),
        { cues, errors } = await parse(xml);

      expect(errors.map((error) => error.code)).toEqual(KNOWN_ISSUES[file] ?? []);

      if (NO_CUES.has(file)) {
        expect(cues).toHaveLength(0);
      } else if (hasTextParagraph(xml)) {
        expect(cues.length).toBeGreaterThan(0);
      }

      for (const cue of cues) {
        expect(Number.isFinite(cue.startTime)).toBe(true);
        expect(cue.endTime).toBeGreaterThan(cue.startTime);
        if (cue.snapToLines === false) {
          expect(cue.line).toBeGreaterThanOrEqual(0);
          expect(cue.line).toBeLessThanOrEqual(100);
        }
      }
    });
  }
});

// --------------------------------------------------------------------------------------------
// Timing
// --------------------------------------------------------------------------------------------

describe('IMSC timing', () => {
  test('MediaSeqTiming001: seq children begin where the previous one ended', async () => {
    const { cues } = await parse(read('imsc1/ttml/timing/MediaSeqTiming001.ttml'));
    expect(times(cues)).toEqual([
      [5, 10],
      [15, 20],
    ]);
    expect(cues[1].text).toMatch(/^This text must appear at 15 seconds/);
  });

  test('MediaSeqTiming002: nested seq containers, zero-length text-only seq paragraphs', async () => {
    const { cues } = await parse(read('imsc1/ttml/timing/MediaSeqTiming002.ttml'));
    expect(times(cues)).toEqual([
      [5, 10],
      [15, 20],
      [25, 30],
      [35, 40],
    ]);
    for (const cue of cues) expect(cue.text).not.toContain('must not appear');
  });

  test('TimeExpressions001: every time expression form (reference frame times)', async () => {
    const { cues } = await parse(read('imsc1/ttml/timing/TimeExpressions001.ttml'));
    // Frame times of the suite's reference renderings: `end` offsets in a seq container are
    // relative to the previous sibling's end, so the durations accumulate.
    const expected = [
      0, 1.2, 73.2, 4393.2, 4394.201, 4396.201, 8119.201, 11842.436, 15565.671, 19289.505167,
      379289.605167, 739289.605167,
    ];
    expect(cues).toHaveLength(expected.length - 1);
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i].startTime).toBeCloseTo(expected[i], 3);
      expect(cues[i].endTime).toBeCloseTo(expected[i + 1], 3);
    }
  });

  test('BasicTimeContainment002: timed spans end before the paragraph', async () => {
    const { cues } = await parse(read('imsc1/ttml/timing/BasicTimeContainment002.ttml'));
    expect(cues.map((cue) => [cue.startTime, cue.endTime, cue.text])).toEqual([
      [
        0,
        5,
        'This first sentence persists for 5 seconds. This second sentence persists for 10 seconds',
      ],
      [5, 10, 'This second sentence persists for 10 seconds'],
      [10, 20, 'This sentence appears at 10 seconds and persists for 10 seconds'],
    ]);
  });

  test('four-active-regions-001: paragraph end is implied by its timed span', async () => {
    const { cues, errors } = await parse(read('imsc1/ttml/region/four-active-regions-001.ttml'));
    expect(errors).toHaveLength(0);
    expect(times(cues)).toEqual([
      [0, 10],
      [0, 10],
      [0, 10],
      [0, 10],
    ]);
  });

  test('mutiple-regions-sequence-001: cues start with their span', async () => {
    const { cues } = await parse(read('imsc1/ttml/region/mutiple-regions-sequence-001.ttml'));
    expect(times(cues)).toEqual([
      [0, 10],
      [2, 12],
      [4, 14],
      [6, 16],
    ]);
    expect(cues[1].text).toBe('<c.white.bg_black.s-1>end/before</c>');
  });

  test('region-timing: region begin/end bound the content', async () => {
    const { cues, errors } = await parse(read('imsc1/ttml/region/region-timing.ttml'));
    expect(errors).toHaveLength(0);
    expect(times(cues)).toEqual([
      [0, 10],
      [10, 15],
      [12, 18],
      [10, 20],
      [16, 20],
    ]);
    expect(cues.map((cue) => cue.line)).toEqual([25, 65, 65, 65, 65]);
  });

  test('BeginEnd002: counting paragraphs end with the next one', async () => {
    const { cues, errors } = await parse(read('imsc1/ttml/timing/BeginEnd002.ttml'));
    expect(errors).toHaveLength(0);
    expect(cues).toHaveLength(12);
    expect(times(cues)[0]).toEqual([0, 1]);
    expect(times(cues)[10]).toEqual([10, 11]);
    expect(times(cues)[11]).toEqual([11, 20]);
    for (const cue of cues) {
      expect(cue.line).toBe(100);
      expect(cue.lineAlign).toBe('end');
    }
  });

  test('DocumentExample120: fractional seconds and pixel font sizes', async () => {
    const { cues, errors } = await parse(read('imsc1/ttml/document/DocumentExample120.ttml'));
    expect(errors).toHaveLength(0);
    expect(cues).toHaveLength(11);
    expect(times(cues)[0]).toEqual([0.76, 3.45]);
    // 22px of a 480px root.
    expect(cues[2].textStyle).toEqual({ fontSize: { unit: 'vh', value: 4.5833 } });
    expect(cues[2].text).toBe(
      '<c.yellow>It is puzzling, why is it\nwe do not see things upside-down?</c>',
    );
  });
});

// --------------------------------------------------------------------------------------------
// Animations
// --------------------------------------------------------------------------------------------

describe('IMSC animations', () => {
  test('Animation012: set on textAlign within a seq container', async () => {
    const { cues } = await parse(read('imsc1/ttml/animation/Animation012.ttml'));
    expect(cues.map((cue) => [cue.startTime, cue.endTime, cue.align])).toEqual([
      [0, 5, 'left'],
      [5, 10, 'right'],
      [10, 16, 'right'],
      [16, 20, 'left'],
    ]);
  });

  test('Animation003: display none until a set shows the paragraph', async () => {
    const { cues } = await parse(read('imsc1/ttml/animation/Animation003.ttml'));
    expect(times(cues)).toEqual([[5, 10]]);
  });

  test('Animation001: set backgroundColor', async () => {
    const { cues } = await parse(read('imsc1/ttml/animation/Animation001.ttml'));
    expect(cues.map((cue) => cue.text.slice(0, 18))).toEqual([
      '<c.white.bg_red>Th',
      '<c.white.bg_blue>T',
    ]);
  });
});

// --------------------------------------------------------------------------------------------
// Regions and layout
// --------------------------------------------------------------------------------------------

describe('IMSC layout', () => {
  test('four-active-regions-001: region-derived position, size, line and alignment', async () => {
    const { cues } = await parse(read('imsc1/ttml/region/four-active-regions-001.ttml'));
    expect(cues.map((cue) => [cue.position, cue.size, cue.line, cue.lineAlign, cue.align])).toEqual(
      [
        [0, 50, 0, 'start', 'start'],
        [50, 50, 0, 'start', 'end'],
        [0, 50, 100, 'end', 'start'],
        [50, 50, 100, 'end', 'end'],
      ],
    );
  });

  test('nested-region-001: spans render into their own regions', async () => {
    const { cues } = await parse(read('imsc1/ttml/region/nested-region-001.ttml'));
    expect(cues.map((cue) => [cue.text, cue.position, cue.line, cue.lineAlign])).toEqual([
      ['Bottom Region', 16.7, 80, 'end'],
      ['Top Region', 16.7, 40, 'end'],
    ]);
  });

  test('Padding001: 20px padding on a 200x100px region of a 320x240 root', async () => {
    const { cues } = await parse(read('imsc1/ttml/padding/Padding001.ttml'));
    expect(cues[0].position).toBeCloseTo(6.25);
    expect(cues[0].size).toBeCloseTo(50);
    expect(cues[0].line).toBeCloseTo(100 / 12);
    expect(cues[0].align).toBe('left');
  });

  test('padding-four-values-001: before/end/after/start percentages of the region', async () => {
    const { cues } = await parse(read('imsc1/ttml/padding/padding-four-values-001.ttml'));
    expect(cues[0].position).toBeCloseTo(14);
    expect(cues[0].size).toBeCloseTo(76);
    expect(cues[0].line).toBeCloseTo(87);
    expect(cues[0].lineAlign).toBe('center');
  });

  test('position001: tts:position keywords, percentages and offsets', async () => {
    const { cues, errors } = await parse(read('imsc1_1/ttml/position/position001.ttml'));
    expect(errors).toHaveLength(0);
    expect(cues).toHaveLength(62);

    const box = (text: string) => {
      const cue = byText(cues, text);
      return [cue.position, cue.line];
    };

    // Regions are 60% x 20% with displayAlign center, so `line` is the vertical centre.
    expect(box('center')).toEqual([20, 50]);
    expect(box('left')).toEqual([0, 50]);
    expect(box('right')).toEqual([40, 50]);
    expect(box('top')).toEqual([20, 10]);
    expect(box('bottom')).toEqual([20, 90]);
    expect(box('25%')).toEqual([10, 50]);
    expect(box('bottom left')).toEqual([0, 90]);
    expect(box('top right')).toEqual([40, 10]);
    expect(box('center 25%')).toEqual([20, 30]);
    expect(box('bottom left 25%')).toEqual([10, 90]);
    expect(box('bottom 25% center')).toEqual([20, 70]);
    expect(box('right 25% top')).toEqual([30, 10]);
    expect(box('bottom 25% left 25%')).toEqual([10, 70]);
  });

  test('lengthRootContainerRelative001: rw/rh extents', async () => {
    const { cues } = await parse(
      read('imsc1_1/ttml/lengthRootContainerRelative/lengthRootContainerRelative001.ttml'),
    );
    expect([cues[0].position, cues[0].size, cues[0].line]).toEqual([0, 50, 0]);
  });

  test('writing-mode-tbrl-001 / writing-mode-tb-001: vertical cues', async () => {
    for (const file of ['writing-mode-tbrl-001', 'writing-mode-tb-001']) {
      const { cues } = await parse(read(`imsc1/ttml/writingMode/${file}.ttml`));
      expect(times(cues)).toEqual([
        [0, 4],
        [2, 4],
      ]);
      for (const cue of cues) {
        expect(cue.vertical).toBe('rl');
        // Region origin 10% 10%, extent 80% 80%: the inline axis is vertical.
        expect(cue.position).toBe(10);
        expect(cue.size).toBe(80);
        // `displayAlign="before"` is the right edge for right-to-left block progression.
        expect(cue.line).toBe(90);
        expect(cue.lineAlign).toBe('end');
      }
    }
  });

  test('ruby001 / ruby002: ruby markup, vertical ruby', async () => {
    const ruby1 = await parse(read('imsc1_1/ttml/ruby/ruby001.ttml'));
    expect(ruby1.cues[0].text).toBe('<ruby>利用許諾<rt>ライセンス</rt></ruby>');
    // `tts:position="center center"` with a 40% x 40% extent.
    expect([ruby1.cues[0].position, ruby1.cues[0].size, ruby1.cues[0].line]).toEqual([30, 40, 50]);

    const ruby2 = await parse(read('imsc1_1/ttml/ruby/ruby002.ttml'));
    expect(ruby2.cues[0].vertical).toBe('rl');
    expect(ruby2.cues[0].text).toBe('<ruby>東南<rt>とうなん</rt><rt>たつみ</rt></ruby>の方角');
  });
});

// --------------------------------------------------------------------------------------------
// Styling
// --------------------------------------------------------------------------------------------

describe('IMSC styling', () => {
  test('fontsize-001: span font size and family become a span style', async () => {
    const { cues } = await parse(read('imsc1/ttml/fontSize/fontsize-001.ttml'));
    expect(cues[0].text).toBe('<c.white.bg_black.s-1>One line Subtitle.</c>');
    expect(cues[0].spans).toEqual({
      '1': { fontSize: { unit: 'em', value: 0.8 }, fontFamily: 'monospace' },
    });
  });

  test('FontSize001: pixel span font size relative to the 480px root', async () => {
    const { cues } = await parse(read('imsc1/ttml/fontSize/FontSize001.ttml'));
    expect(cues[0].text).toBe('The last word must be in <c.s-1>24px</c>.');
    expect(cues[0].spans).toEqual({ '1': { fontSize: { unit: 'vh', value: 5 } } });
  });

  test('Color003 / backgroundcolor-rgba-001: translucent colours are span styles', async () => {
    const color = await parse(read('imsc1/ttml/color/Color003.ttml'));
    expect(color.cues[0].text).toContain('<c.red>This is the red color as a reference.');
    expect(color.cues[0].text).toContain('<c.s-1>This text must be semi-transparent red.</c>');
    expect(color.cues[0].spans).toEqual({ '1': { color: '#ff000088' } });

    const background = await parse(
      read('imsc1/ttml/backgroundColor/backgroundcolor-rgba-001.ttml'),
    );
    expect(background.cues[0].spans).toEqual({
      '1': {
        fontSize: { unit: 'em', value: 1.6 },
        fontFamily: 'monospace',
        backgroundColor: '#00000080',
      },
    });
  });

  test('TextOutline001: paragraph outline, span outline none', async () => {
    const { cues } = await parse(read('imsc1/ttml/textOutline/TextOutline001.ttml'));
    expect(cues[0].textStyle).toEqual({
      stroke: { width: { unit: 'vh', value: 0.4167 }, color: 'red' },
    });
    expect(cues[0].text).toBe('<c.s-1>This text has no outline.</c>');
    expect(cues[0].spans).toEqual({ '1': { stroke: null } });
  });

  test('textShadow001: span text shadow, paragraph line height', async () => {
    const { cues } = await parse(read('imsc1_1/ttml/textShadow/textShadow001.ttml'));
    expect(cues[0].textStyle).toEqual({ lineHeight: { unit: 'em', value: 1.25 } });
    expect(cues[0].spans).toEqual({
      '1': {
        shadow: {
          x: { unit: 'em', value: 0.1 },
          y: { unit: 'em', value: -0.2 },
          blur: { unit: 'em', value: 0.05 },
          color: 'lime',
        },
      },
    });
    expect(cues[0].text).toContain('<c.white.bg_black.s-1>shadowy scenes,');
  });

  test('LineHeight001 / aspectRatio1: line height normal and 100%', async () => {
    const normal = await parse(read('imsc1/ttml/lineHeight/LineHeight001.ttml'));
    expect(normal.cues[0].textStyle).toEqual({ lineHeight: 'normal' });

    const percent = await parse(read('imsc1/ttml/aspectRatio/aspectRatio1.ttml'));
    expect(percent.cues[0].textStyle).toEqual({ lineHeight: { unit: 'em', value: 1 } });
  });

  test('forcedDisplay1: forced region cues get the `forced` class', async () => {
    const { cues, metadata } = await parse(read('imsc1/ttml/forcedDisplay/forcedDisplay1.ttml'));
    expect(metadata.HasForcedCues).toBe('true');
    expect(cues[0].textStyle?.className).toBeUndefined();
    expect(cues[1].textStyle?.className).toBe('forced');
  });

  test('aspectRatio1 / displayAspectRatio001 / image001: aspect ratio metadata', async () => {
    expect(
      (await parse(read('imsc1/ttml/aspectRatio/aspectRatio1.ttml'))).metadata.AspectRatio,
    ).toBe('4:3');
    expect(
      (await parse(read('imsc1_1/ttml/displayAspectRatio/displayAspectRatio001.ttml'))).metadata
        .AspectRatio,
    ).toBe('4:3');
    expect((await parse(read('imsc1_1/ttml/image/image001.ttml'))).metadata.AspectRatio).toBe(
      '16:9',
    );
  });
});

// --------------------------------------------------------------------------------------------
// Images
// --------------------------------------------------------------------------------------------

describe('IMSC images', () => {
  test('image001: external image source produces no cue (K2)', async () => {
    const { cues, errors } = await parse(read('imsc1_1/ttml/image/image001.ttml'));
    expect(errors).toHaveLength(0);
    expect(cues).toHaveLength(0);
  });

  test('image001 with the vendored PNG inlined: an image cue in the region box', async () => {
    // The suite ships the image as a separate file; inlining it exercises the same document with
    // the embedded form the parser supports.
    const png = fs.readFileSync(path.join(VENDOR, 'imsc1_1/ttml/image/image001-img.png'));
    const xml = read('imsc1_1/ttml/image/image001.ttml').replace(
      'src="image001-img.png"',
      `src="data:image/png;base64,${png.toString('base64')}"`,
    );

    const { cues, errors } = await parse(xml);
    expect(errors).toHaveLength(0);
    expect(cues).toHaveLength(1);

    const [cue] = cues;
    expect(cue.startTime).toBe(0);
    expect(cue.endTime).toBe(1);
    expect(cue.text).toBe('');
    // Region `640px 736px` / `640px 120px` of a 1920x1080 root.
    expect(cue.layout?.left).toBeCloseTo(100 / 3);
    expect(cue.layout?.top).toBeCloseTo((736 / 1080) * 100);
    expect(cue.layout?.width).toBeCloseTo(100 / 3);
    expect(cue.layout?.height).toBeCloseTo((120 / 1080) * 100);
    expect(cue.textStyle?.image?.url).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(cue.textStyle?.backgroundColor).toBe('transparent');
  });
});
