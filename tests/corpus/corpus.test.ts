/**
 * Real-world corpus harness. Every fixture under `./files/<format>/` imitates what a popular tool
 * or service actually emits (YouTube, ffmpeg, Aegisub, Netflix IMSC, EBU-TT-D, iTunes iTT, SCC
 * broadcast captions, ...), including a few deliberately broken files.
 *
 * Every fixture must parse without throwing in non-strict mode. The full parse result is written
 * to `./__snapshots__/<format>/<file>.json` so any parser change shows up as a reviewable diff
 * (see README.md). Rendered cue HTML is checked for basic hygiene, and a handful of fixtures carry
 * hand-written expectations for the features they exist to exercise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CaptionsFileFormat,
  cueToJSON,
  parseText,
  parseVTTTimestampMap,
  renderVTTCueString,
  type ParsedCaptionsResult,
} from 'media-captions';

const FILES = fileURLToPath(new URL('./files/', import.meta.url)),
  SNAPSHOTS = fileURLToPath(new URL('./__snapshots__/', import.meta.url));

const FORMATS: Record<string, CaptionsFileFormat> = {
  vtt: 'vtt',
  srt: 'srt',
  ass: 'ass',
  ssa: 'ssa',
  ttml: 'ttml',
  scc: 'scc',
  lrc: 'lrc',
  sbv: 'sbv',
};

/** Markup that must never survive into rendered cue HTML. */
const UNSAFE_HTML_RE = /<script|onerror|javascript:/i;

/**
 * Fixtures that currently make `parseText` throw in non-strict mode. Each is exercised by a
 * `test.fails` so the crash stays visible; once fixed, the test flips and the entry must be
 * removed (a snapshot is then written on the next run).
 */
const KNOWN_THROWS: Record<string, string> = {};

// --------------------------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------------------------

interface Fixture {
  /** `<format>/<name>.<ext>`, relative to `./files/`. */
  file: string;
  type: CaptionsFileFormat;
}

export function listFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const dir of fs.readdirSync(FILES).sort()) {
    const type = FORMATS[dir];
    if (!type) throw new Error(`unknown corpus format directory: ${dir}`);
    for (const name of fs.readdirSync(path.join(FILES, dir)).sort()) {
      fixtures.push({ file: `${dir}/${name}`, type });
    }
  }
  return fixtures;
}

export function readFixture(file: string) {
  return fs.readFileSync(path.join(FILES, file), 'utf8');
}

function parse(fixture: Fixture) {
  return parseText(readFixture(fixture.file), { type: fixture.type, errors: true });
}

function serialize(result: ParsedCaptionsResult) {
  const json = {
    cueCount: result.cues.length,
    errors: result.errors.map((error) => error.message),
    cues: result.cues.map(cueToJSON),
  };
  return JSON.stringify(json, null, 2) + '\n';
}

const fixtures = listFixtures();

// --------------------------------------------------------------------------------------------
// Every fixture parses, snapshots, and renders cleanly
// --------------------------------------------------------------------------------------------

describe('corpus', () => {
  test('the corpus covers every text format', () => {
    const covered = new Set(fixtures.map((fixture) => fixture.file.split('/')[0]));
    expect([...covered].sort()).toEqual(Object.keys(FORMATS).sort());
    expect(fixtures.length).toBeGreaterThanOrEqual(24);
  });

  describe.each(fixtures)('$file', (fixture) => {
    const knownThrow = KNOWN_THROWS[fixture.file];
    if (knownThrow) {
      test.fails(`parses without throwing (known: ${knownThrow})`, async () => {
        await parse(fixture);
      });
      return;
    }

    test('parses without throwing and matches its snapshot', async () => {
      const result = await parse(fixture);
      await expect(serialize(result)).toMatchFileSnapshot(
        path.join(SNAPSHOTS, `${fixture.file}.json`),
      );
    });

    test('cue times are finite, and ordered unless reported', async () => {
      const { cues, errors } = await parse(fixture);
      for (const cue of cues) {
        expect(Number.isFinite(cue.startTime)).toBe(true);
        expect(cue.startTime).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(cue.endTime) || cue.endTime === Infinity).toBe(true);
        // The WebVTT-derived parsers keep cues whose end is not after their start (per spec they
        // are simply never active) but must report them.
        if (cue.endTime < cue.startTime) expect(errors.length).toBeGreaterThan(0);
      }
    });

    test('rendered cue HTML has no executable markup', async () => {
      const { cues } = await parse(fixture);
      for (const cue of cues) {
        const html = renderVTTCueString(cue, cue.startTime);
        expect(html).not.toMatch(UNSAFE_HTML_RE);
      }
    });
  });
});

// --------------------------------------------------------------------------------------------
// Hand-written expectations for the features each fixture exists to exercise
// --------------------------------------------------------------------------------------------

async function load(file: string) {
  const type = FORMATS[file.split('/')[0]];
  return parseText(readFixture(file), { type, errors: true });
}

describe('vtt', () => {
  test('YouTube auto-captions keep their positioning and word timings', async () => {
    const { cues, errors } = await load('vtt/youtube-auto-captions.vtt');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(10);
    for (const cue of cues) {
      expect(cue.align).toBe('start');
      expect(cue.position).toBe(0);
    }
    // Word-level timestamps survive tokenization and render as timed spans.
    expect(cues[0].text).toContain('<00:00:00.560><c> today</c>');
    const html = renderVTTCueString(cues[0], 0.7);
    expect(html).toContain('data-part="timed"');
    expect(html).toContain('data-past');
    expect(html).toContain('data-future');
  });

  test('HLS segments expose X-TIMESTAMP-MAP through the header metadata', async () => {
    const { metadata, cues } = await load('vtt/hls-segment.vtt');
    expect(metadata['X-TIMESTAMP-MAP']).toBe('MPEGTS:900000,LOCAL:00:00:00.000');
    expect(parseVTTTimestampMap(metadata)).toEqual({ mpegts: 900000, local: 0, offset: 10 });
    expect(cues).toHaveLength(3);
    expect(cues.map((cue) => cue.line)).toEqual([-2, -2, -2]);
  });

  test('HLS segments with a wrapped PTS still parse the map', async () => {
    const { metadata, cues } = await load('vtt/hls-segment-discontinuity.vtt');
    const map = parseVTTTimestampMap(metadata);
    expect(map?.mpegts).toBe(8589934592);
    expect(map?.local).toBe(0);
    expect(cues.map((cue) => cue.id)).toEqual(['1', '2']);
  });

  test('STYLE and REGION blocks are collected', async () => {
    const { styles, regions, cues, errors } = await load('vtt/style-region.vtt');
    expect(errors).toEqual([]);
    expect(styles).toHaveLength(2);
    expect(styles![0]).toContain('::cue {');
    expect(regions.map((region) => region.id)).toEqual(['fred', 'bill']);
    expect(regions[0].scroll).toBe('up');
    expect(regions[0].lines).toBe(3);
    expect(cues).toHaveLength(6);
    expect(cues[0].region?.id).toBe('fred');
    expect(cues[1].region?.id).toBe('bill');
    expect(cues[4].region).toBeNull();
    expect(renderVTTCueString(cues[0])).toBe(
      '<span title="Fred" data-part="voice">Hi, my name is Fred.</span>',
    );
  });

  test('BOM + CRLF and mixed line endings parse like clean LF files', async () => {
    const bom = await load('vtt/bom-crlf.vtt');
    expect(bom.errors).toEqual([]);
    expect(bom.metadata).toEqual({ Kind: 'captions', Language: 'en-GB' });
    expect(bom.cues.map((cue) => cue.text)).toEqual([
      'Saved from Windows Notepad.',
      'Carriage return and line feed\non every line.',
      '<b>Bold</b> and <i>italic</i>.',
    ]);

    const mixed = await load('vtt/mixed-line-endings.vtt');
    expect(mixed.errors).toEqual([]);
    expect(mixed.cues.map((cue) => cue.text)).toEqual([
      'CRLF cue.',
      'LF cue.',
      'Bare CR cue.',
      'Mixed within\none cue.',
      'No trailing newline',
    ]);
  });

  test('a missing WEBVTT header is reported but the cues are kept', async () => {
    const { cues, errors } = await load('vtt/missing-header.vtt');
    expect(errors.map((error) => error.message)).toEqual(['missing WEBVTT file header']);
    expect(cues).toHaveLength(3);
  });

  test('vertical Japanese cues keep their writing direction and ruby', async () => {
    const { cues, errors } = await load('vtt/vertical-ruby-ja.vtt');
    expect(errors).toEqual([]);
    expect(cues.map((cue) => cue.vertical)).toEqual(['rl', 'rl', 'lr', '']);
    expect(renderVTTCueString(cues[0])).toBe('<ruby>東京<rt>とうきょう</rt></ruby>へ行きました。');
  });

  test('broken timing lines are reported and skipped without losing later cues', async () => {
    const { cues, errors } = await load('vtt/broken-timestamps.vtt');
    const messages = errors.map((error) => error.message);
    // Minutes above 59 are invalid, as is a single-dash arrow; bogus settings are reported
    // individually while the cue itself is kept.
    expect(messages).toContain('cue start timestamp `00:99:10.000` is invalid on line 32');
    expect(messages.filter((message) => message.includes('line 12'))).toHaveLength(4);
    expect(cues.some((cue) => cue.text === 'Single dash arrow.')).toBe(false);
    expect(cues.some((cue) => cue.text === 'Ninety-nine minutes.')).toBe(false);
    expect(cues.some((cue) => cue.id === '3')).toBe(true);
    // Per spec the parser keeps cues whose end is not after their start (they are simply never
    // active) but reports them so authors notice.
    const reversed = cues.filter((cue) => cue.endTime <= cue.startTime);
    expect(reversed.map((cue) => cue.id)).toEqual(['1', '4']);
    expect(messages).toContain('cue end timestamp `0.5` is not greater than start `1` on line 4');
    expect(messages).toContain('cue end timestamp `5` is not greater than start `3604` on line 16');
  });
});

describe('srt', () => {
  test('ffmpeg exports map <font> colours and {\\an8} placement', async () => {
    const { cues, errors } = await load('srt/ffmpeg-export.srt');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(10);
    expect(cues[0].text).toBe(
      '<c.#ffff00>- Where are we going?</c>\n<c.#00ffff>- Somewhere quiet.</c>',
    );
    // `{\an8}` = top centre.
    expect(cues[1].text).toBe('[thunder rumbling]');
    expect(cues[1].line).toBe(0);
    expect(cues[1].snapToLines).toBe(true);
    expect(cues[1].align).toBe('center');
    // `{\an5}` = middle of the screen.
    expect(cues[6].snapToLines).toBe(false);
    expect(cues[6].line).toBe(50);
    // Unquoted HTML colour names map to hex.
    expect(cues[5].text).toBe('<c.#008000>Green without quotes</c> and <u>underlined</u>.');
    // Override tags never leak into cue text.
    for (const cue of cues) expect(cue.text).not.toMatch(/\{\\/);
  });

  test('Amara-style odd spacing is tolerated', async () => {
    const { cues } = await load('srt/amara-odd-spacing.srt');
    expect(cues.length).toBeGreaterThanOrEqual(9);
    expect(cues[0].text).toBe('Extra spaces around the arrow.');
    expect(cues[0].startTime).toBe(0.5);
    // Dots and truncated milliseconds still yield timings.
    expect(cues.find((cue) => cue.text === 'Dots instead of commas.')?.startTime).toBe(16);
    expect(cues.find((cue) => cue.text === 'Truncated milliseconds.')?.startTime).toBe(18);
  });

  test('Rev-style speaker chevrons are kept and escaped when rendered', async () => {
    const { cues } = await load('srt/rev-speaker-labels.srt');
    expect(cues).toHaveLength(10);
    expect(cues[0].text.startsWith('>> INTERVIEWER:')).toBe(true);
    expect(renderVTTCueString(cues[0])).toContain('&gt;&gt; INTERVIEWER:');
  });

  test('Subtitle Edit BOM + CRLF export parses like a clean file', async () => {
    const { cues, errors } = await load('srt/subtitle-edit-bom-crlf.srt');
    expect(errors).toEqual([]);
    expect(cues.map((cue) => cue.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(cues[2].text).toBe('<c.#ff8800>Orange</c> <i><b>nested</b></i>');
    expect(cues[3].line).toBe(0);
  });
});

describe('ssa / ass', () => {
  test('Aegisub karaoke: sweeps, transforms, moves, fades and a drawn sign', async () => {
    const { cues, errors } = await load('ass/aegisub-karaoke.ass');
    expect(errors).toEqual([]);
    // Comment and template lines never produce cues.
    expect(cues.length).toBe(11);

    const karaoke = cues.filter((cue) => cue.text.includes('<00:00:12.'));
    expect(karaoke.length).toBeGreaterThanOrEqual(1);
    // `\kf` sweeps become span animations.
    const sweep = cues.find((cue) => cue.text.includes('君'));
    expect(sweep?.animations?.length).toBeGreaterThan(0);

    // `\move` produces a layout animation on a fixed cue.
    const move = cues.find((cue) => cue.text.includes('omoi'));
    expect(move?.layout?.fixed).toBe(true);
    expect(move?.animations?.some((anim) => anim.target === 'display')).toBe(true);

    // `\p1` drawings become inline SVG spans.
    const drawings = cues.filter((cue) =>
      Object.values(cue.spans ?? {}).some((span) => span.drawing),
    );
    expect(drawings).toHaveLength(2);
    const drawing = Object.values(drawings[0].spans!).find((span) => span.drawing)!.drawing!;
    expect(drawing.path).toBe('M0 0L260 0L260 110L0 110Z');
    expect(drawing.viewBox).toEqual([0, 0, 260, 110]);
    expect(renderVTTCueString(drawings[0])).toContain('<svg');
    // Signs are layered above dialogue.
    expect(drawings[1].layer).toBe(2);

    // `\t(\1c...)` animates the colour of the clipped line.
    const clipped = cues.find((cue) => cue.text.includes('clipped'));
    expect(clipped?.animations?.length).toBe(1);
  });

  test('fansub dialogue: styles, positions, colours, banners and scrolls', async () => {
    const { cues, errors } = await load('ass/fansub-dialogue.ass');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(23);
    expect(cues[2].text).toBe("<v Yui>It's already seven-thirty.\nYou'll be late again.");
    expect(cues[3].text).toBe('<v Rin><i>Late</i> is a matter of perspective.');
    // `\h` is a non-breaking space.
    expect(cues.find((cue) => cue.text.includes('About'))?.text).toBe('<v Yui>About&nbsp;what?');
    // Braces always open an override block, so `{literal brace}` is dropped like VSFilter does.
    expect(cues.find((cue) => cue.text.includes('lone'))?.text).toBe(
      '<v Yui>Line with a  and a lone \\ backslash.',
    );
    // Alignment 8 style is placed at the top.
    const top = cues.find((cue) => cue.text.includes('Sakuragaoka'));
    expect(top?.layout?.top).toBeDefined();
    // Effect field animations.
    const banner = cues.find((cue) => cue.text.startsWith('A banner effect'));
    expect(banner?.animations?.length).toBeGreaterThan(0);
    const scroll = cues.find((cue) => cue.text.startsWith('Scrolling credits'));
    expect(scroll?.animations?.length).toBeGreaterThan(0);
  });

  test('legacy SSA v4.00 maps the old alignment scheme and Marked field', async () => {
    const { cues, errors } = await load('ssa/legacy-v4.ssa');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(13);
    expect(cues[0].layout?.bottom).toBeDefined();
    expect(cues[0].layout?.top).toBeUndefined();
    // SSA alignment 6 is top-centre (ASS 8); the cue sits at the top.
    expect(cues[1].layout?.top).toBeDefined();
    expect(cues[1].layout?.bottom).toBeUndefined();
    // `Marked=1` lines keep their name as a voice.
    expect(cues[2].text).toBe('<v Narrator>Marked line with a name.');
    // `\N` is a hard break and `\n` a soft one (a space with WrapStyle 0).
    expect(cues[3].text).toBe('Two lines\nwith a hard break and a soft break.');
    // Legacy `\a6` override also goes top, `\a10` to the middle.
    expect(cues[4].layout?.top).toBeDefined();
    expect(cues[5].layout?.top).toBe(50);
    expect(cues[5].layout?.translate?.y).toBe(-0.5);
    // Banner and Scroll effects animate the box.
    expect(cues[8].animations).toHaveLength(1);
    expect(cues[9].animations).toHaveLength(1);
  });

  test('a broken ASS file still yields the well-formed lines', async () => {
    const { cues, errors } = await load('ass/broken-format-line.ass');
    expect(errors.length).toBeGreaterThan(0);
    expect(cues.some((cue) => cue.text === 'Short format line still works.')).toBe(true);
    expect(cues.some((cue) => cue.text === 'Recovered.')).toBe(true);
    expect(cues.every((cue) => cue.endTime >= cue.startTime)).toBe(true);
  });
});

describe('ttml', () => {
  test('Netflix-style IMSC1: frame times, regions, spans, forced display', async () => {
    const { cues, errors, metadata } = await load('ttml/netflix-imsc1.ttml');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(12);
    // 00:00:01:12 at 24000/1001 fps.
    expect(cues[0].startTime).toBeCloseTo(1 + 12 / (24000 / 1001), 6);
    expect(cues[1].text).toBe('<c.white>I told you.\nI was at the office.</c>');
    expect(cues[2].text).toContain('<i>');
    // Named colours become classes, one run per span.
    expect(cues[3].text).toBe('<c.yellow>-Until midnight?\n</c><c.cyan>-Yes, until midnight.</c>');
    expect(cues[4].text).toContain('<b>nothing</b>');
    expect(metadata.HasForcedCues).toBe('true');
    expect(cues[6].textStyle?.className).toBe('forced');
    // `xml:space="preserve"` keeps runs of spaces and the source newline.
    expect(cues[8].text).toBe('<c.white>Preserved   spacing\n  and a newline.</c>');
    // `dur` works as well as `end`.
    expect(cues[10].endTime).toBeCloseTo(cues[10].startTime + 3, 6);
    // Regions map to percentage line/position placement: `bottom` sits low, `top` high.
    expect(cues[0].snapToLines).toBe(false);
    expect(cues[0].line).toBe(90);
    expect(cues[2].line).toBe(10);
    expect(cues[5].align).toBe('start');
  });

  test('EBU-TT-D: prefixed elements, cell units, coloured spans', async () => {
    const { cues, errors } = await load('ttml/ebu-tt-d.ttml');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(7);
    expect(cues[0].startTime).toBeCloseTo(0.76, 6);
    expect(cues[0].text).toContain('\n');
    expect(cues[0].text).toContain('Guten Abend');
    // Yellow-on-black spans carry their colours as classes.
    expect(cues[1].text).toBe('<c.yellow.bg_black>* Wir haben heute drei Themen. *</c>');
    // Left-aligned override.
    expect(cues[4].align === 'start' || cues[4].align === 'left').toBe(true);
    expect(cues[5].text).toContain('<i>');
  });

  test('iTunes iTT: SMPTE drop-frame timecodes at 29.97 fps', async () => {
    const { cues, errors } = await load('ttml/itunes-itt-smpte.ttml');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(8);
    // 00:00:02:15 drop-frame: 75 frames at 29.97 fps.
    expect(cues[0].startTime).toBeCloseTo(75 / 29.97, 3);
    // Drop-frame: frames 00 and 01 of minute 1 do not exist, so 00:00:59:28 -> 00:01:02:04 is
    // 2 + 64 - 2 = 64 frames.
    expect(cues[4].endTime - cues[4].startTime).toBeCloseTo(64 / 29.97, 3);
    // One hour of drop-frame timecode is one hour of real time.
    expect(cues[6].startTime).toBeCloseTo(3600, 1);
    expect(cues[1].text).toContain('<i>');
    expect(cues[3].text).toContain('<b>move</b>');
  });

  test('legacy DFXP: 2006 namespace, ticks, seconds, entities', async () => {
    const { cues, errors } = await load('ttml/legacy-dfxp.ttml');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(9);
    expect(cues[0].startTime).toBe(1);
    expect(cues[0].endTime).toBe(3.5);
    expect(cues[2].startTime).toBe(6.5);
    expect(cues[3].endTime).toBe(11.5);
    expect(cues[4].text).toContain('\n');
    // Only `<` needs escaping in cue text; numeric entities are decoded.
    expect(cues[6].text).toBe('<c.white>&lt;html> &amp; entities © ☺</c>');
    expect(cues[5].text).toBe('<c.lime>Green span</c><c.white> in a paragraph.</c>');
    expect(cues[7].align).toBe('left');
    expect(cues[8].text).toBe('<c.white>Whitespace-collapsed multi-line source text.</c>');
  });

  test('broken XML is reported without throwing', async () => {
    const { cues, errors } = await load('ttml/broken-xml.ttml');
    expect(errors.map((error) => error.message)).toContain(
      'time expression `bogus` is invalid on line 16',
    );
    for (const cue of cues) {
      expect(Number.isFinite(cue.startTime)).toBe(true);
      expect(cue.endTime).toBeGreaterThanOrEqual(cue.startTime);
    }
  });
});

describe('scc', () => {
  test('broadcast SCC: pop-on, paint-on and roll-up captions', async () => {
    const { cues, errors } = await load('scc/broadcast-popon-rollup.scc');
    expect(errors).toEqual([]);
    expect(cues.length).toBeGreaterThanOrEqual(12);

    const texts = cues.map((cue) => cue.text);
    expect(texts[0]).toBe('Previously on the program...\n<i>we visited the harbour.</i>');
    expect(texts).toContain('>> Is anyone there?\n♪ [wind howling] ♪');
    expect(texts).toContain('WOMAN: Hello?');
    expect(texts).toContain('MAN: Over here.');
    expect(texts).toContain('(distant thunder)');
    expect(texts).toContain('Painted directly to the screen.');

    // Roll-up: each carriage return shifts the previous row up.
    expect(texts).toContain('AND NOW THE WEATHER.\nTEMPERATURES WILL DROP');
    expect(texts).toContain('>> THANKS, JIM.\nCOMING UP AFTER THE BREAK:\nLOCAL SPORTS.');

    // Pop-on display starts at EOC (00:00:02:15 = 75 frames) and ends at EDM.
    expect(cues[0].startTime).toBeCloseTo(75 / 29.97, 6);
    expect(cues[0].endTime).toBeCloseTo((5 * 30 + 2) / 29.97, 6);
    // Top-row caption.
    const thunder = cues.find((cue) => cue.text === '(distant thunder)')!;
    expect(thunder.snapToLines).toBe(false);
    expect(thunder.line).toBe(0);
  });

  test('broken SCC: bad header, timecodes and hex words are reported', async () => {
    const { cues, errors } = await load('scc/broken.scc');
    const messages = errors.map((error) => error.message);
    expect(messages[0]).toContain('Scenarist_SCC V1.0');
    expect(messages.some((message) => message.includes('malformed hex word'))).toBe(true);
    expect(messages.some((message) => message.includes('invalid SCC timecode'))).toBe(true);
    expect(cues.some((cue) => cue.text === 'First caption.')).toBe(true);
    expect(cues.some((cue) => cue.text.includes('Roll-up after garbage.'))).toBe(true);
  });
});

describe('lrc', () => {
  test('enhanced LRC: word timings, offset, repeats and blank lines', async () => {
    const { cues, errors, metadata } = await load('lrc/enhanced-timing.lrc');
    expect(errors).toEqual([]);
    expect(metadata.ti).toBe('Paper Boats');
    expect(metadata.offset).toBe('-150');
    // LRC convention: `time = tag - offset`, so `[offset:-150]` shifts everything 150ms later.
    expect(cues[1].startTime).toBeCloseTo(12.55, 6);
    // Word timestamps become WebVTT timestamp tags (also offset).
    expect(cues[1].text).toBe('Fold <00:00:13.000>the <00:00:13.250>corners <00:00:13.750>down');
    // A bare `[mm:ss.xx]` line ends the previous cue rather than producing an empty one.
    expect(cues[4].endTime).toBeCloseTo(24.15, 6);
    // Repeated chorus lines produce a cue per timestamp.
    expect(cues.filter((cue) => cue.text.includes('harbour')).length).toBe(2);
    // Blank timestamp lines close the previous cue instead of producing one.
    expect(cues.some((cue) => cue.text === '')).toBe(false);
    const html = renderVTTCueString(cues[1], 13.3);
    expect(html).toContain('data-past');
    expect(html).toContain('data-future');
  });

  test('simple LRC: repeats, sloppy decimals and non-timestamp lines', async () => {
    const { cues, metadata } = await load('lrc/simple-repeats.lrc');
    expect(metadata.ar).toBe('Nobody In Particular');
    expect(metadata.offset).toBe('+500');
    expect(cues.filter((cue) => cue.text === 'Oh, coffee, coffee, coffee')).toHaveLength(6);
    // Cues are sorted by time even though the source lists repeats inline.
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startTime).toBeGreaterThanOrEqual(cues[i - 1].startTime);
    }
    // `[offset:+500]` shifts everything 500ms earlier (`time = tag - offset`).
    expect(cues[0].startTime).toBeCloseTo(0.5, 6);
    expect(cues.find((cue) => cue.text === 'One decimal place')?.startTime).toBeCloseTo(65, 6);
    expect(cues.find((cue) => cue.text === 'No decimals at all')?.startTime).toBeCloseTo(67.5, 6);
    expect(cues.find((cue) => cue.text.startsWith('Single-digit minute'))?.startTime).toBeCloseTo(
      70.5,
      6,
    );
    // Lines without a timestamp are ignored rather than glued onto the previous cue.
    expect(cues.some((cue) => cue.text.includes('no timestamp'))).toBe(false);
    // Markup characters are escaped so they render as text.
    const tags = cues.find((cue) => cue.text.includes('bracketed'))!;
    expect(renderVTTCueString(tags)).toContain('&lt;angle&gt; brackets &amp;');
  });
});

describe('sbv', () => {
  test('YouTube SBV: [br] breaks, chevrons, hour timestamps', async () => {
    const { cues, errors } = await load('sbv/youtube-export.sbv');
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(9);
    expect(cues[1].text).toBe("Today we're doing something\na little different.");
    expect(cues[4].text).toBe('This line uses a\nbracketed line break.');
    expect(cues[7].startTime).toBe(3600);
    expect(renderVTTCueString(cues[2])).toContain('&gt;&gt; So what');
    expect(renderVTTCueString(cues[5])).toContain('Tom &amp; Jerry &lt;3');
  });

  test('broken SBV: bad timing lines are reported, valid cues survive', async () => {
    const { cues, errors } = await load('sbv/broken.sbv');
    expect(errors.length).toBeGreaterThan(0);
    expect(cues[0].text).toBe('A valid first cue.');
    expect(cues.some((cue) => cue.text === 'Recovered.')).toBe(true);
    expect(cues.every((cue) => cue.endTime >= cue.startTime)).toBe(true);
  });
});
