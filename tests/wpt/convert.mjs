/**
 * Converts the vendored web-platform-tests WebVTT parsing suites into JSON fixtures consumed by
 * `wpt.test.ts`. Run once and commit the output:
 *
 *   node tests/wpt/convert.mjs
 *
 * Zero dependencies. Two suites are converted:
 *
 * 1. `webvtt/parsing/file-parsing/tests/*.html`
 *
 *    Each WPT test loads `support/<name>.vtt` through a `<track>` and asserts cue properties in a
 *    `trackLoaded` callback. Instead of regex-matching each `assert_equals(...)` (the bodies use
 *    loops, `Array.from(cues)`, computed indices, `Number.MAX_VALUE`, ...), the assertion body is
 *    executed in a sandbox where `cues` is a recording Proxy: every property access builds a path
 *    such as `cues[3].region.lines`, and every `assert_*` call is captured as
 *    `{ path, expected }`. Tests whose assertions can not be expressed that way are listed in
 *    `skipped` with a reason.
 *
 * 2. `webvtt/parsing/cue-text-parsing/tests/*.html`
 *
 *    Each entry is `{ name, input, expected }` (URL-encoded). `expected` is an html5lib style tree
 *    dump of `cue.getCueAsHTML()`. The dump is decoded and additionally converted into a canonical
 *    HTML string so the test can compare against our tokenizer output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(here, 'vendor', 'webvtt', 'parsing');
const fixtures = path.join(here, 'fixtures');

fs.mkdirSync(fixtures, { recursive: true });

// --------------------------------------------------------------------------------------------
// File parsing
// --------------------------------------------------------------------------------------------

const PATH = Symbol('wpt.path');

class Unconvertible extends Error {}

/**
 * Builds a Proxy that records the property path it was reached through. `cues.length` coerces to
 * the asserted cue count so that `Array.from(cues)` and `i < cues.length` loops work.
 */
function recordingProxy(pathText, cueCount) {
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === PATH) return pathText;
        if (prop === Symbol.toPrimitive) {
          return () => {
            if (pathText === 'cues.length') return cueCount;
            throw new Unconvertible(`unexpected primitive coercion of \`${pathText}\``);
          };
        }
        if (typeof prop === 'symbol') return undefined;
        if (/^\d+$/.test(prop)) return recordingProxy(`${pathText}[${prop}]`, cueCount);
        return recordingProxy(`${pathText}.${prop}`, cueCount);
      },
      has() {
        return true;
      },
    },
  );
}

function pathOf(value) {
  return value !== null && typeof value === 'object' ? value[PATH] : undefined;
}

function jsonValue(value, what) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number' && Number.isFinite(value)) return value;
  throw new Unconvertible(`${what} is not a JSON value: ${String(value)}`);
}

function extractBody(html) {
  const start = html.indexOf('var cues = video.textTracks[0].cues;');
  const end = html.indexOf('this.done();', start);
  if (start === -1 || end === -1) return null;
  return html.slice(start + 'var cues = video.textTracks[0].cues;'.length, end);
}

/**
 * Executes the WPT assertion body with a recording `cues` proxy and returns the captured
 * assertions.
 */
function recordAssertions(body) {
  const lengthMatch = body.match(/assert_equals\(\s*cues\.length\s*,\s*(\d+)/);
  if (!lengthMatch) throw new Unconvertible('no `cues.length` assertion to seed the cue count');
  const cueCount = Number(lengthMatch[1]);

  // Hand rewrite: `assert_true(!!region)` loses the path once coerced to a boolean, so route it
  // through a dedicated recorder that receives the proxy itself.
  const source = body.replace(/assert_true\(\s*!!\s*(\w+)/g, 'assert_truthy($1');

  const assertions = [];

  const asserts = {
    assert_equals(actual, expected) {
      const p = pathOf(actual);
      if (!p) throw new Unconvertible(`assert_equals on a non-cue value: ${String(actual)}`);
      const ref = pathOf(expected);
      assertions.push(
        ref
          ? { path: p, sameAs: ref }
          : { path: p, expected: jsonValue(expected, `expected for ${p}`) },
      );
    },
    assert_not_equals(actual, other) {
      const p = pathOf(actual),
        o = pathOf(other);
      if (!p || !o) throw new Unconvertible('assert_not_equals on non-cue values');
      assertions.push({ path: p, notSameAs: o });
    },
    assert_true(actual) {
      const p = pathOf(actual);
      if (!p) throw new Unconvertible(`assert_true on a non-cue value: ${String(actual)}`);
      assertions.push({ path: p, expected: true });
    },
    assert_false(actual) {
      const p = pathOf(actual);
      if (!p) throw new Unconvertible(`assert_false on a non-cue value: ${String(actual)}`);
      assertions.push({ path: p, expected: false });
    },
    assert_truthy(actual) {
      const p = pathOf(actual);
      if (!p) throw new Unconvertible('assert_true(!!x) on a non-cue value');
      assertions.push({ path: p, truthy: true });
    },
    assert_unreached(msg) {
      throw new Unconvertible(`assert_unreached: ${msg}`);
    },
  };

  const fn = new Function(
    'cues',
    ...Object.keys(asserts),
    'document',
    'track',
    'video',
    `"use strict";\n${source}`,
  );

  fn(
    recordingProxy('cues', cueCount),
    ...Object.values(asserts),
    new Proxy(
      {},
      {
        get: () => {
          throw new Unconvertible('test depends on `document`');
        },
      },
    ),
    new Proxy(
      {},
      {
        get: () => {
          throw new Unconvertible('test depends on `track`');
        },
      },
    ),
    new Proxy(
      {},
      {
        get: () => {
          throw new Unconvertible('test depends on `video`');
        },
      },
    ),
  );

  return assertions;
}

/**
 * `header-regions.html` does not use the generated template: expectations are JSON embedded in
 * each cue's text, compared against the cue's region with defaults filled in.
 */
function convertHeaderRegions(vtt) {
  const regionDefaults = {
    width: 100,
    lines: 3,
    regionAnchorX: 0,
    regionAnchorY: 100,
    viewportAnchorX: 0,
    viewportAnchorY: 100,
    scroll: '',
  };

  const lines = vtt.split(/\r?\n|\r/);
  const assertions = [];
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('-->')) continue;
    const expected = JSON.parse(lines[i + 1]);
    if (expected === 'no region') {
      assertions.push({ path: `cues[${index}].region`, expected: null });
    } else {
      assertions.push({ path: `cues[${index}].region`, truthy: true });
      for (const prop in regionDefaults) {
        assertions.push({
          path: `cues[${index}].region.${prop}`,
          expected: prop in expected ? expected[prop] : regionDefaults[prop],
        });
      }
    }
    index++;
  }

  return [{ path: 'cues.length', expected: index }, ...assertions];
}

function convertFileParsing() {
  const dir = path.join(vendor, 'file-parsing', 'tests');
  const tests = [];
  const skipped = [];

  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? file;
    const src = html.match(/(?:track|testTrack)\.src\s*=\s*'([^']+)'/)?.[1];

    if (!src) {
      skipped.push({ file, name: title, reason: 'no `support/*.vtt` track source found' });
      continue;
    }

    // Read as UTF-8 so BOM, NUL, CR, FF, and VT survive verbatim.
    const vtt = fs.readFileSync(path.join(dir, src), 'utf8');
    const entry = { file, name: title, source: src, vtt };

    try {
      if (file === 'header-regions.html') {
        entry.assertions = convertHeaderRegions(vtt);
      } else if (file === 'stylesheets.html') {
        throw new Unconvertible(
          'asserts `document.styleSheets.length` (DOM); STYLE parsing has no cue assertions',
        );
      } else {
        const body = extractBody(html);
        if (body === null) throw new Unconvertible('unrecognised test template');
        entry.assertions = recordAssertions(body);
      }
      tests.push(entry);
    } catch (error) {
      if (!(error instanceof Unconvertible)) throw error;
      skipped.push({ file, name: title, reason: error.message });
    }
  }

  return { tests, skipped };
}

// --------------------------------------------------------------------------------------------
// Cue text parsing
// --------------------------------------------------------------------------------------------

/**
 * Parses an html5lib style tree dump (see `webvtt/parsing/cue-text-parsing/common.js`
 * `test_serializer`) into a tree of `{ type, name, attrs, children } | { type: 'text', value } |
 * { type: 'pi', target, data }` nodes.
 */
function parseTreeDump(dump) {
  const lines = dump.split('\n');
  if (lines[0] !== '#document-fragment') {
    throw new Unconvertible(`unexpected dump root: ${lines[0]}`);
  }

  /** @type {any} */
  const root = { type: 'element', name: '#document-fragment', attrs: {}, children: [], indent: -1 };
  /** @type {any[]} */
  const stack = [root];
  /** @type {any} */
  let openText = null;

  for (let i = 1; i < lines.length; i++) {
    let line = lines[i];

    // Text nodes containing newlines span several dump lines; only the first starts with `|`.
    if (openText) {
      if (line.endsWith('"')) {
        openText.value += '\n' + line.slice(0, -1);
        openText = null;
      } else {
        openText.value += '\n' + line;
      }
      continue;
    }

    if (!line.startsWith('|')) throw new Unconvertible(`unexpected dump line: ${line}`);
    line = line.slice(1);
    const indent = line.length - line.trimStart().length;
    const content = line.slice(indent);

    let attr;
    if (content.startsWith('"')) {
      while (stack[stack.length - 1].indent >= indent) stack.pop();
      const node = { type: 'text', value: content.slice(1) };
      stack[stack.length - 1].children.push(node);
      if (content.length >= 2 && content.endsWith('"')) node.value = content.slice(1, -1);
      else openText = node;
    } else if ((attr = content.match(/^([^\s"<=]+)="(.*)"$/))) {
      const owner = stack[stack.length - 1];
      if (owner.type !== 'element' || owner.indent !== indent - 2) {
        throw new Unconvertible(`attribute without an owning element: ${content}`);
      }
      owner.attrs[attr[1]] = attr[2];
    } else if (content.startsWith('<?')) {
      const pi = content.match(/^<\?(\S+) (.*)>$/);
      if (!pi) throw new Unconvertible(`bad processing instruction: ${content}`);
      while (stack[stack.length - 1].indent >= indent) stack.pop();
      stack[stack.length - 1].children.push({ type: 'pi', target: pi[1], data: pi[2] });
    } else if (content.startsWith('<')) {
      const el = content.match(/^<([^\s>]+)>$/);
      if (!el) throw new Unconvertible(`bad element: ${content}`);
      while (stack[stack.length - 1].indent >= indent) stack.pop();
      const node = { type: 'element', name: el[1], attrs: {}, children: [], indent };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      throw new Unconvertible(`unexpected dump content: ${content}`);
    }
  }

  if (openText) throw new Unconvertible('unterminated text node in dump');
  return root;
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text) {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** Canonical HTML: attributes sorted by name, text escaped, PIs as `<?target data>`. */
function treeToHTML(node) {
  return node.children
    .map((child) => {
      if (child.type === 'text') return escapeText(child.value);
      if (child.type === 'pi') return `<?${child.target} ${child.data}>`;
      const attrs = Object.keys(child.attrs)
        .sort()
        .map((name) => ` ${name}="${escapeAttr(child.attrs[name])}"`)
        .join('');
      return `<${child.name}${attrs}>${treeToHTML(child)}</${child.name}>`;
    })
    .join('');
}

function convertCueTextParsing() {
  const dir = path.join(vendor, 'cue-text-parsing', 'tests');
  const tests = [];
  const skipped = [];

  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? file;
    const entryRE =
      /\{\s*name\s*:\s*'([^']*)'\s*,\s*input\s*:\s*'([^']*)'\s*,\s*expected\s*:\s*'([^']*)'\s*\}/g;

    let match;
    let count = 0;
    while ((match = entryRE.exec(html))) {
      count++;
      const [, name, input, expected] = match;
      const entry = {
        file,
        // Matches the WPT harness: `document.title + ' - ' + test.name`.
        name: `${title} - ${name}`,
        input: decodeURIComponent(input),
        expectedTree: decodeURIComponent(expected),
      };
      try {
        entry.expectedHTML = treeToHTML(parseTreeDump(entry.expectedTree));
        tests.push(entry);
      } catch (error) {
        if (!(error instanceof Unconvertible)) throw error;
        skipped.push({ file, name: entry.name, reason: error.message });
      }
    }

    if (count === 0)
      skipped.push({ file, name: title, reason: 'no `runTests([...])` entries found' });
  }

  return { tests, skipped };
}

// --------------------------------------------------------------------------------------------

const readme = fs.readFileSync(path.join(here, 'vendor', 'README.md'), 'utf8');
const upstream = readme.match(/commit `([0-9a-f]+)`/)?.[1] ?? 'unknown';

function write(name, data) {
  const out = path.join(fixtures, name);
  fs.writeFileSync(out, JSON.stringify({ upstream, ...data }, null, 2) + '\n');
  console.log(
    `${path.relative(process.cwd(), out)}: ${data.tests.length} tests, ${data.skipped.length} skipped`,
  );
  for (const s of data.skipped) console.log(`  skipped ${s.file} (${s.name}): ${s.reason}`);
}

write('file-parsing.json', convertFileParsing());
write('cue-text-parsing.json', convertCueTextParsing());
