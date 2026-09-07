// Enforces gzipped size budgets so growth is a decision, not a surprise.
//
// Two kinds of measurement:
// - Entry files as published (what a CDN user downloads for that entry).
// - Tree-shaken probes: a tiny module importing a typical set of names from the built package is
//   bundled with rolldown, the way a consumer's bundler would, and the output is measured. This is
//   what the composable renderer is for, and the only honest way to size it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { rolldown } from 'rolldown';

const ENTRY_BUDGETS = {
  cea: { files: ['dist/prod-cea.js'], limit: 8_000 },
  element: { files: ['dist/prod-element.js'], limit: 4_000 },
  entities: { files: ['dist/prod-entities.js'], limit: 14_000 },
  mp4: { files: ['dist/prod-mp4.js'], limit: 8_000 },
  'parsers (each)': { files: ['dist/prod-parser-*.js'], limit: 16_000, each: true },
};

// Minified + gzipped, format parsers and error messages stay external (they load on demand).
const PROBE_BUDGETS = {
  'parse (dispatch only)': {
    code: `export { parseText, parseResponse } from './dist/prod.js';`,
    limit: 1_500,
  },
  'renderer core (createRenderer)': {
    code: `export { createRenderer } from './dist/prod-renderer.js';`,
    limit: 9_500,
  },
  'renderer core + regions': {
    code: `export { createRenderer, regions } from './dist/prod-renderer.js';`,
    limit: 10_000,
  },
  'renderer full (CaptionsRenderer)': {
    code: `export { CaptionsRenderer } from './dist/prod.js';`,
    limit: 12_000,
  },
  'typical player (parse + render + sync)': {
    code: `export { parseResponse, CaptionsRenderer, syncCaptionsRenderer } from './dist/prod.js';`,
    limit: 13_000,
  },
  'canvas renderer (CanvasCaptionsRenderer)': {
    code: `export { CanvasCaptionsRenderer } from './dist/prod-canvas.js';`,
    limit: 13_000,
  },
  'everything in the main entry': {
    code: `export * from './dist/prod.js';`,
    limit: 15_000,
  },
};

function expand(pattern) {
  if (!pattern.includes('*')) return statSync(pattern, { throwIfNoEntry: false }) ? [pattern] : [];
  const dir = pattern.slice(0, pattern.lastIndexOf('/')),
    re = new RegExp(
      '^' +
        pattern
          .slice(dir.length + 1)
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*') +
        '$',
    );
  return readdirSync(dir)
    .filter((f) => re.test(f) && f.endsWith('.js'))
    .map((f) => join(dir, f));
}

function report(name, size, limit) {
  const ok = size <= limit;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${size} B gzipped (limit ${limit})`);
  return ok;
}

async function probe(code) {
  const bundle = await rolldown({
    input: 'probe.js',
    cwd: process.cwd(),
    treeshake: true,
    external: (id) => /-parser-/.test(id) || id.endsWith('/errors.js'),
    plugins: [
      {
        name: 'probe',
        resolveId: (id) => (id === 'probe.js' ? id : null),
        load: (id) => (id === 'probe.js' ? code : null),
      },
    ],
    logLevel: 'silent',
  });
  try {
    const { output } = await bundle.generate({ format: 'esm', minify: true });
    return output
      .filter((chunk) => chunk.type === 'chunk')
      .reduce((total, chunk) => total + gzipSync(chunk.code).length, 0);
  } finally {
    await bundle.close();
  }
}

let failed = false;

console.log('Published entries (as shipped, unminified):');
for (const [name, budget] of Object.entries(ENTRY_BUDGETS)) {
  const files = budget.files.flatMap(expand),
    sizes = files.map((f) => [f, gzipSync(readFileSync(f)).length]);
  if (budget.each) {
    for (const [f, size] of sizes) failed = !report(`${name} ${f}`, size, budget.limit) || failed;
  } else {
    const total = sizes.reduce((sum, [, size]) => sum + size, 0);
    failed = !report(name, total, budget.limit) || failed;
  }
}

console.log('\nTree-shaken probes (minified, parsers external):');
for (const [name, budget] of Object.entries(PROBE_BUDGETS)) {
  failed = !report(name, await probe(budget.code), budget.limit) || failed;
}

if (failed) process.exit(1);
