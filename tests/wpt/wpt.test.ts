/**
 * Runs the web-platform-tests WebVTT parsing suites (vendored under `./vendor`, converted to JSON
 * by `./convert.mjs`) against `media-captions`.
 *
 * Parse mode rule
 * ---------------
 * The spec parser never aborts: invalid cues are dropped and parsing continues. Our default
 * (non-strict) mode does the same but also accepts a few documented real-world tolerances the spec
 * rejects (bare percentages, `align:middle`, 1-3 fraction digits, `,` separators, ...). Strict mode
 * follows the spec grammar but throws on the *first* error, so it can only stand in for the spec
 * when a test expects no cues at all. Hence:
 *
 * - a test whose assertions expect `cues.length === 0` is parsed in strict mode, and a thrown
 *   parse error counts as "zero cues" (WPT still expects the track to load, just without cues);
 * - every other test is parsed in default mode.
 *
 * Divergences caused by a documented tolerance can therefore not be "fixed" by switching modes
 * (strict would abort on the file's deliberately invalid cues); they are recorded in
 * `KNOWN_DIVERGENCES.md` and in the tables below. Assertions listed there are excluded from the
 * regular test and exercised by a `test.fails` sibling instead, so the suite stays green while the
 * gap stays visible and any fix flips the `fails` test.
 *
 * Model mapping: `line`/`position` may be `'auto'` on both sides, regions are compared by `id`
 * (`sameAs`/`notSameAs`), missing regions are `null`.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseText, tokenizeVTTCue, type VTTCue, type VTTNode } from 'media-captions';

// --------------------------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------------------------

interface Assertion {
  path: string;
  expected?: string | number | boolean | null;
  sameAs?: string;
  notSameAs?: string;
  truthy?: true;
}

interface FileParsingTest {
  file: string;
  name: string;
  source: string;
  vtt: string;
  assertions: Assertion[];
}

interface CueTextTest {
  file: string;
  name: string;
  input: string;
  expectedTree: string;
  expectedHTML: string;
}

interface Skipped {
  file: string;
  name: string;
  reason: string;
}

interface Fixture<T> {
  upstream: string;
  tests: T[];
  skipped: Skipped[];
}

function loadFixture<T>(name: string): Fixture<T> {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(fs.readFileSync(fileURLToPath(url), 'utf8'));
}

const fileParsing = loadFixture<FileParsingTest>('file-parsing.json');
const cueTextParsing = loadFixture<CueTextTest>('cue-text-parsing.json');

// --------------------------------------------------------------------------------------------
// Known divergences (see KNOWN_DIVERGENCES.md)
// --------------------------------------------------------------------------------------------

/**
 * WPT test file -> assertion paths that currently fail. Keyed by file because upstream titles are
 * not unique (`settings-vertical.html` carries the `settings, size` title). The `B*`/`T*` tags
 * reference the entries in KNOWN_DIVERGENCES.md (B = parser bug, T = deliberate tolerance).
 */
const KNOWN_FILE_DIVERGENCES: Record<string, string[]> = {
  // T4: a cue text line containing `-->` is kept as text instead of ending the cue.
  'arrows.html': ['cues[0].text', 'cues[1].text', 'cues[2].text', 'cues[3].text'],
  // B3: `region:` (empty value) binds to the id-less region instead of being skipped.
  'header-regions.html': ['cues[8].region'],
  // B1: a timing line directly after the header (no blank line) is swallowed by the header.
  'header-space.html': ['cues.length', 'cues[0].text', 'cues[0].startTime', 'cues[0].endTime'],
  'header-tab.html': ['cues.length', 'cues[0].text', 'cues[0].startTime', 'cues[0].endTime'],
  'header-timings.html': ['cues.length', 'cues[0].text', 'cues[0].startTime', 'cues[0].endTime'],
  // B9 (NUL not replaced by U+FFFD), B1, B2 (end timestamp followed by non-whitespace).
  'nulls.html': [
    'cues.length',
    'cues[0].id',
    'cues[0].text',
    'cues[1].id',
    'cues[1].text',
    'cues[2].id',
    'cues[2].text',
    'cues[3].text',
    'cues[4].align',
    'cues[4].text',
    'cues[5].align',
    'cues[5].text',
    'cues[6].align',
    'cues[6].text',
  ],
  // B8: a `-->` line inside a REGION block does not abort the block.
  'regions-edge-case.html': ['cues[2].region.lines'],
  // B3: `id:` (empty value) clears the region id instead of being skipped.
  'regions-id.html': ['cues[2].region.lines'],
  // B6: region `lines` accepts `-0`, `1.5`, `-1`.
  'regions-lines.html': ['cues[7].region.lines', 'cues[8].region.lines', 'cues[9].region.lines'],
  // B7: anchors accept bare numbers (no `%`) and `-0%`.
  'regions-regionanchor.html': [
    'cues[6].region.regionAnchorY',
    'cues[7].region.regionAnchorY',
    'cues[8].region.regionAnchorY',
    'cues[13].region.regionAnchorX',
    'cues[13].region.regionAnchorY',
    'cues[14].region.regionAnchorY',
    'cues[19].region.regionAnchorX',
  ],
  'regions-viewportanchor.html': [
    'cues[6].region.viewportAnchorY',
    'cues[7].region.viewportAnchorY',
    'cues[8].region.viewportAnchorY',
    'cues[13].region.viewportAnchorX',
    'cues[13].region.viewportAnchorY',
    'cues[14].region.viewportAnchorY',
    'cues[19].region.viewportAnchorX',
  ],
  // T2: legacy `align:middle` is mapped to `center`.
  'settings-align.html': ['cues[10].align'],
  // B4 (loose numeric parsing) and B5 (compound settings are not atomic).
  'settings-line.html': [
    'cues[2].line',
    'cues[19].line',
    'cues[19].snapToLines',
    'cues[21].line',
    'cues[21].snapToLines',
    'cues[22].line',
    'cues[23].line',
    'cues[23].snapToLines',
    'cues[24].line',
    'cues[24].snapToLines',
    'cues[25].line',
    'cues[25].snapToLines',
    'cues[27].line',
    'cues[27].snapToLines',
    'cues[30].line',
    'cues[31].line',
    'cues[32].line',
    'cues[33].line',
    'cues[34].line',
    'cues[35].line',
    'cues[36].line',
    'cues[36].snapToLines',
    'cues[37].line',
    'cues[37].snapToLines',
    'cues[46].line',
    'cues[46].snapToLines',
  ],
  // T3 (`position:1` bare number, cue 11), B4 (`1x`, `1%x`), B5 (compound settings).
  'settings-position.html': [
    'cues[8].position',
    'cues[9].position',
    'cues[11].position',
    'cues[12].position',
    'cues[13].position',
    'cues[19].positionAlign',
    'cues[20].positionAlign',
    'cues[21].positionAlign',
    'cues[22].position',
    'cues[23].position',
    'cues[24].position',
  ],
  // B3: `region:` with an empty value binds to the id-less region.
  'settings-region.html': ['cues[5].region', 'cues[6].region', 'cues[7].region'],
  // B4: `size:1%%` and `size:1%x` parse as 1.
  'settings-size.html': ['cues[11].size', 'cues[12].size'],
  // T5: cues whose end time is not after the start time are dropped.
  'timings-negative.html': [
    'cues.length',
    'cues[0].text',
    'cues[0].startTime',
    'cues[0].endTime',
    'cues[1].text',
    'cues[1].startTime',
    'cues[1].endTime',
    'cues[2].text',
    'cues[2].startTime',
    'cues[2].endTime',
    'cues[3].text',
    'cues[3].startTime',
    'cues[3].endTime',
  ],
  // T1: 1-2 fraction digits and missing fractions are accepted in default mode.
  'timings-too-short.html': ['cues.length', 'cues[1].text'],
  // B2: leading whitespace before the start timestamp rejects the cue.
  'whitespace-chars.html': [
    'cues.length',
    'cues[0].id',
    'cues[0].text',
    'cues[1].id',
    'cues[1].text',
    'cues[2].id',
    'cues[2].text',
  ],
};

/** WPT cue text test names that currently fail (see KNOWN_DIVERGENCES.md). */
const KNOWN_CUE_TEXT_DIVERGENCES = new Set<string>([
  // T8: limited named character reference table, no legacy no-semicolon references.
  'WebVTT cue data parser test entities - f1869f6e2853635eec81cc3afa3e2b8148ccbdc0', // &amp
  'WebVTT cue data parser test entities - 261cd4e9df4a12535b66a0c39e9635aab2bb19aa', // &AMP;
  'WebVTT cue data parser test entities - e3ac2060b915f0f499b2863f999dcdb38a5db79b', // &ClockwiseContourIntegral;
  'WebVTT cue data parser test entities - 31c8a5ecfa5c54d8c0ec5b4ee8f0bbea0d6d40af', // &nsubE;
  'WebVTT cue data parser test entities - 9ed59950764468c4ef2948d71cf75c3f2b60c74d', // &notin;
  'WebVTT cue data parser test entities - 71a6efcfab81264fb95bb3234c59687c11c72baf', // &not;
  'WebVTT cue data parser test entities - 86d7c20ca3c060f9e699c7da43927c4a07a5d569', // &not
  'WebVTT cue data parser test entities - 314cd94292df37044e90ce27b5606bf8ec636b94', // &notit;
  // B10: a pending start tag / timestamp tag at end of input is dropped.
  'WebVTT cue data parser test entities - b1fff1ac42688d16e00f6c758d84e5152e39702d', // &<c
  'WebVTT cue data parser test timestamps - 47fa4306a695161da88533d456ce94829e53b13d', // <00:00.500
  'WebVTT cue data parser test timestamps - c1036a4322c1852e02e5a1843a9a81dfca6d7af3', // <00:00:00.500
  // B12: end tag names are trimmed, so `</\nc>` closes `<c>`.
  'WebVTT cue data parser test tags - fe3b6277edf5c2f84e7a6779eddd0cac30552bca',
  // B11: `<rt>` outside `<ruby>` creates a node instead of being ignored.
  'WebVTT cue data parser test tags - 68e1d0376f827ebe0c047751a2067594ff41b612',
  // B9: NUL is not replaced by U+FFFD.
  'WebVTT cue data parser test text - 6805ac5ddce21cfceb4eccf04a6a9013760f5d5b',
  // T6: timestamp tags outside the cue's time range are dropped.
  'WebVTT cue data parser test timestamps - 66ba641ff047a226fa60fe867fd2479d40f3ff0f',
  'WebVTT cue data parser test timestamps - 398e8da1aaaf392739ca72057fef58bd5333f74d',
  'WebVTT cue data parser test timestamps - 391fce67644cf4dd9967e1436d1449ef5baf675f',
  // T7: a mismatched end tag closes through open ancestors instead of being ignored.
  'WebVTT cue data parser test tree-building - 325c1e590e74f1ff33ca5b4838c04cf6b6dd71ba',
  'WebVTT cue data parser test tree-building - 92847ed2694c9639ba96f4cc61e2215362a74904',
  'WebVTT cue data parser test tree-building - c0da62d1c8716ca544c96799f06ac7e4664500fb',
  'WebVTT cue data parser test tree-building - 132f07c3ab0e86dd1b93bf434c94c0d1cfdd4fde',
]);

// --------------------------------------------------------------------------------------------
// File parsing
// --------------------------------------------------------------------------------------------

function expectsZeroCues(test: FileParsingTest) {
  return test.assertions.some((a) => a.path === 'cues.length' && a.expected === 0);
}

async function parseFixture(test: FileParsingTest): Promise<VTTCue[]> {
  if (!expectsZeroCues(test)) {
    return (await parseText(test.vtt, { errors: true })).cues;
  }

  try {
    return (await parseText(test.vtt, { strict: true, errors: true })).cues;
  } catch {
    // Strict mode rejected the file: the spec equivalent is a track with no cues.
    return [];
  }
}

function resolve(root: { cues: VTTCue[] }, path: string): unknown {
  const keys = path.match(/[^.[\]]+/g) ?? [];
  let value: any = root;
  for (const key of keys) {
    if (value === null || value === undefined) {
      throw new TypeError(`\`${path}\`: can not read \`${key}\` of ${String(value)}`);
    }
    value = value[key];
  }
  return value;
}

function describeValue(value: unknown) {
  if (value !== null && typeof value === 'object') {
    return 'id' in value ? `region#${JSON.stringify((value as any).id)}` : '[object]';
  }
  return typeof value === 'number' && Object.is(value, -0) ? '-0' : JSON.stringify(value);
}

function sameRegion(a: unknown, b: unknown) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return (a as any).id === (b as any).id;
}

/** Applies a single WPT assertion, returning a failure message or `null` when it holds. */
function check(cues: VTTCue[], assertion: Assertion): string | null {
  const root = { cues };
  let actual: unknown;

  try {
    actual = resolve(root, assertion.path);
  } catch (error) {
    return (error as Error).message;
  }

  if (assertion.truthy) {
    return actual ? null : `\`${assertion.path}\` expected a value, got ${describeValue(actual)}`;
  }

  if (assertion.sameAs !== undefined) {
    const other = resolve(root, assertion.sameAs);
    return sameRegion(actual, other)
      ? null
      : `\`${assertion.path}\` (${describeValue(actual)}) expected to be the same region as \`${assertion.sameAs}\` (${describeValue(other)})`;
  }

  if (assertion.notSameAs !== undefined) {
    const other = resolve(root, assertion.notSameAs);
    return !sameRegion(actual, other)
      ? null
      : `\`${assertion.path}\` expected to differ from \`${assertion.notSameAs}\`, both are ${describeValue(actual)}`;
  }

  // WPT's assert_equals uses SameValue semantics (distinguishes -0 from +0).
  return Object.is(actual, assertion.expected)
    ? null
    : `\`${assertion.path}\` expected ${describeValue(assertion.expected)}, got ${describeValue(actual)}`;
}

function assertAll(cues: VTTCue[], assertions: Assertion[]) {
  const failures = assertions.map((a) => check(cues, a)).filter((f): f is string => f !== null);
  if (failures.length) {
    throw new Error(
      `${failures.length}/${assertions.length} assertions failed:\n  ${failures.join('\n  ')}`,
    );
  }
}

describe('WPT webvtt/parsing/file-parsing', () => {
  for (const wpt of fileParsing.tests) {
    const known = new Set(KNOWN_FILE_DIVERGENCES[wpt.file] ?? []);
    const mode = expectsZeroCues(wpt) ? 'strict' : 'default';
    const title = `${wpt.file}: ${wpt.name} [${mode} mode]`;

    if (!known.size) {
      test(title, async () => {
        assertAll(await parseFixture(wpt), wpt.assertions);
      });
      continue;
    }

    const passing = wpt.assertions.filter((a) => !known.has(a.path));
    const diverging = wpt.assertions.filter((a) => known.has(a.path));

    test(`${title} (${passing.length}/${wpt.assertions.length} assertions)`, async () => {
      assertAll(await parseFixture(wpt), passing);
    });

    test.fails(
      `${title} (known divergences: ${diverging.map((a) => a.path).join(', ')})`,
      async () => {
        assertAll(await parseFixture(wpt), diverging);
      },
    );
  }

  test('skipped tests are documented', () => {
    expect(fileParsing.skipped.map((s) => s.file)).toEqual(['stylesheets.html']);
  });
});

// --------------------------------------------------------------------------------------------
// Cue text parsing
// --------------------------------------------------------------------------------------------

function escapeText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string) {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** Formats seconds as a WebVTT timestamp the way `getCueAsHTML()` serialises timestamp PIs. */
function formatTimestamp(seconds: number) {
  const ms = Math.round(seconds * 1000),
    h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60,
    f = ms % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, 3)}`;
}

/**
 * Serialises our tokens the same way `convert.mjs` serialises the expected `getCueAsHTML()` tree:
 * attributes sorted by name, `<c>`/`<v>`/`<lang>` as `<span>`, timestamps as
 * `<?timestamp hh:mm:ss.ttt>` processing instructions (flattened, since the DOM has no timestamp
 * element while our tokenizer nests the timed segment under a node).
 */
function serialize(nodes: VTTNode[]): string {
  let html = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      html += escapeText(node.data);
      continue;
    }

    if (node.type === 'timestamp') {
      html += `<?timestamp ${formatTimestamp(node.time)}>${serialize(node.children)}`;
      continue;
    }

    const attrs: Record<string, string> = {};
    if (node.class) attrs.class = node.class;
    if (node.type === 'v') attrs.title = node.voice ?? '';
    if (node.type === 'lang') attrs.lang = node.lang ?? '';

    const attrText = Object.keys(attrs)
      .sort()
      .map((name) => ` ${name}="${escapeAttr(attrs[name])}"`)
      .join('');

    html += `<${node.tagName}${attrText}>${serialize(node.children)}</${node.tagName}>`;
  }
  return html;
}

async function cueTextToHTML(input: string) {
  // Mirrors the WPT harness (`cue-text-parsing/common.js`): the input is the payload of a single
  // one second cue, so file-level handling (NUL replacement, blank lines) is exercised as well.
  const { cues } = await parseText(`WEBVTT\n\n00:00.000 --> 00:01.000\n${input}`, {
    errors: true,
  });
  if (!cues.length) throw new Error('expected the WPT wrapper file to produce one cue');
  return serialize(tokenizeVTTCue(cues[0]));
}

describe('WPT webvtt/parsing/cue-text-parsing', () => {
  for (const wpt of cueTextParsing.tests) {
    const run = KNOWN_CUE_TEXT_DIVERGENCES.has(wpt.name) ? test.fails : test;
    run(`${wpt.name} (${JSON.stringify(wpt.input)})`, async () => {
      expect(await cueTextToHTML(wpt.input)).toBe(wpt.expectedHTML);
    });
  }

  test('no cue text tests were skipped', () => {
    expect(cueTextParsing.skipped).toEqual([]);
  });
});
