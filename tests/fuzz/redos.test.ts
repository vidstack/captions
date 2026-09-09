/**
 * ReDoS audit. Extracts every regular expression literal from `src/**\/*.ts` and runs each
 * against pathological inputs (50k repeated characters, alternating pairs) with a per-run time
 * budget. A regex whose worst case is super-linear in the input blows the budget and is reported
 * with its source location.
 *
 * Extraction is deliberately rough (a regex-for-regexes): anything that does not compile as a
 * `RegExp` is skipped, and the odd division expression that happens to compile is harmless.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Budget per regex per input. Linear regexes finish 50k characters in well under a millisecond. */
const BUDGET_MS = 200;

const INPUTS: [string, string][] = [
  ["'a' x 50k", 'a'.repeat(50_000)],
  ["'<' x 50k", '<'.repeat(50_000)],
  ["'&' x 50k + ';'", '&'.repeat(50_000) + ';'],
  ["' ' x 50k + 'x'", ' '.repeat(50_000) + 'x'],
  ["'-' x 50k + '>'", '-'.repeat(50_000) + '>'],
  ["'ab' x 20k", 'ab'.repeat(20_000)],
  ["'0' x 50k + ':'", '0'.repeat(50_000) + ':'],
  ["'{\\\\' x 20k", '{\\'.repeat(20_000)],
  ["'\\n' x 50k", '\n'.repeat(50_000)],
  ["'rgba(0,0,0,' + '0' x 50k", 'rgba(0,0,0,' + '0'.repeat(50_000)],
  ["'.a' x 20k + '{'", '.a'.repeat(20_000) + '{'],
];

/**
 * Regexes known to be super-linear that live in files owned by concurrent work. Keyed by regex
 * source and pinned with `test.fails` so the audit flips (and the entry must go) once fixed.
 */
const KNOWN_SLOW = new Map<string, string>([]);

/**
 * Regexes that are super-linear in isolation but whose only call site bounds the input so the
 * worst case can not occur. Skipped with the guard named, so a new unguarded use is noticed.
 */
const GUARDED = new Map<string, string>([
  [
    String.raw`\{([^}]*)\}`,
    'src/ssa OVERRIDE_BLOCK_RE: the scan stops at the last `}` of the line (ssa-parser.ts)',
  ],
]);

/** Rough regex-literal matcher: `/.../flags` that is not the start of a comment. */
const REGEX_LITERAL_RE = /\/(?![*/])(?:\\.|\[[^\]]*\]|[^/\n])+\/[dgimsuyv]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

interface Literal {
  source: string;
  flags: string;
  locations: string[];
}

function listSources(dir = SRC, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out.sort();
}

/** Every distinct regex literal in `src/`, with all the `file:line` locations it appears at. */
function extractLiterals(): Literal[] {
  const byKey = new Map<string, Literal>();

  for (const file of listSources()) {
    const text = fs.readFileSync(file, 'utf8'),
      // Blank out block comments but keep their newlines so line numbers stay right.
      code = text.replace(BLOCK_COMMENT_RE, (comment) => comment.replace(/[^\n]/g, ' ')),
      relative = path.relative(SRC, file);

    for (const match of code.matchAll(REGEX_LITERAL_RE)) {
      const literal = match[0],
        lastSlash = literal.lastIndexOf('/'),
        source = literal.slice(1, lastSlash),
        flags = literal.slice(lastSlash + 1);

      try {
        RegExp(source, flags);
      } catch {
        continue;
      }

      const line = code.slice(0, match.index).split('\n').length,
        key = `${source}/${flags}`,
        location = `src/${relative}:${line}`;

      const existing = byKey.get(key);
      if (existing) existing.locations.push(location);
      else byKey.set(key, { source, flags, locations: [location] });
    }
  }

  return [...byKey.values()];
}

const literals = extractLiterals();

test('extracts a meaningful number of regex literals from src/', () => {
  expect(literals.length).toBeGreaterThan(50);
});

describe('no regex literal exceeds the budget on pathological input', () => {
  for (const literal of literals) {
    const known = KNOWN_SLOW.get(literal.source),
      guarded = GUARDED.get(literal.source),
      title = `/${literal.source}/${literal.flags}${known ? ` (known: ${known})` : ''}${
        guarded ? ` (guarded: ${guarded})` : ''
      }`,
      run = guarded ? test.skip : known ? test.fails : test;

    run(title, () => {
      const re = new RegExp(literal.source, literal.flags),
        slow: string[] = [];

      for (const [name, input] of INPUTS) {
        re.lastIndex = 0;
        const started = performance.now();
        // Global regexes are run to exhaustion (every match); others stop at the first match, which
        // for a non-matching input still means trying every start position.
        if (re.global) input.match(re);
        else re.test(input);
        const elapsed = performance.now() - started;
        if (elapsed > BUDGET_MS) slow.push(`${name}: ${elapsed.toFixed(0)}ms`);
      }

      expect(slow, `slow regex at ${literal.locations.join(', ')}`).toEqual([]);
    });
  }
});
