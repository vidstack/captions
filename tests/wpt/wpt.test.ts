/**
 * Runs the web-platform-tests WebVTT parsing suites (vendored under `./vendor`, converted to JSON
 * by `./convert.mjs`) against `media-captions`.
 *
 * Parse mode
 * ----------
 * The spec parser never aborts: invalid cues are dropped and parsing continues. That is
 * `lenient: false`: the spec grammar (no bare percentages, no `align:middle`, exactly three
 * fraction digits, any `-->` line ends a cue, a bad signature gives up on the file) with the
 * recovery of the default mode rather than the first-error throw of `strict`. The default lenient
 * mode deliberately diverges from the spec for real-world files; those tolerances are covered by
 * `tests/conformance/vtt-file.test.ts` (marked TOLERANT), not here.
 *
 * Should a divergence appear again, list its assertions in the tables below: they are excluded
 * from the regular test and exercised by a `test.fails` sibling instead, so the suite stays green
 * while the gap stays visible and any fix flips the `fails` test. `KNOWN_DIVERGENCES.md` keeps the
 * history.
 *
 * Model mapping: `line`/`position` may be `'auto'` on both sides, regions are compared by `id`
 * (`sameAs`/`notSameAs`), missing regions are `null`.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseText, tokenizeVTTCue, type VTTCue, type VTTNode } from 'media-captions';
import { registerFullHTMLEntities } from 'media-captions/entities';

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
 * WPT test file -> assertion paths that currently fail (none). Keyed by file because upstream
 * titles are not unique (`settings-vertical.html` carries the `settings, size` title).
 */
const KNOWN_FILE_DIVERGENCES: Record<string, string[]> = {};

/** WPT cue text test names that currently fail (none). */
const KNOWN_CUE_TEXT_DIVERGENCES = new Set<string>();

// --------------------------------------------------------------------------------------------
// File parsing
// --------------------------------------------------------------------------------------------

async function parseFixture(test: FileParsingTest): Promise<VTTCue[]> {
  return (await parseText(test.vtt, { lenient: false, errors: true })).cues;
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
    const title = `${wpt.file}: ${wpt.name}`;

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

    test.fails(`${title} (known divergences: ${diverging.map((a) => a.path).join(', ')})`, async () => {
      assertAll(await parseFixture(wpt), diverging);
    });
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
  // The WPT entity tests expect the full HTML named character reference table, which is an
  // opt-in entry (`media-captions/entities`) so the core bundle only ships a Latin-1 subset.
  registerFullHTMLEntities();

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
