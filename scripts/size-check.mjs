// Enforces gzipped size budgets for the published entries so growth is a decision, not a surprise.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGETS = {
  // Core renderer + VTT parser chunks that every consumer loads.
  core: {
    files: ['dist/prod.js', 'dist/prod/*'],
    exclude: /(ssa|ttml|scc|lrc|sbv|srt|sami|microdvd)-parser|cea608|cea708|entities|element|mp4/,
    limit: 22_000,
  },
  cea: { files: ['dist/prod-cea.js'], limit: 8_000 },
  element: { files: ['dist/prod-element.js'], limit: 4_000 },
  entities: { files: ['dist/prod-entities.js'], limit: 14_000 },
  mp4: { files: ['dist/prod-mp4.js'], limit: 8_000 },
  'parsers (largest)': { files: ['dist/prod-parser-*.js'], limit: 16_000, each: true },
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

let failed = false;
for (const [name, budget] of Object.entries(BUDGETS)) {
  const files = budget.files.flatMap(expand).filter((f) => !budget.exclude?.test(f));
  const sizes = files.map((f) => [f, gzipSync(readFileSync(f)).length]);
  if (budget.each) {
    for (const [f, size] of sizes) {
      const ok = size <= budget.limit;
      failed ||= !ok;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${f} ${size} B (limit ${budget.limit})`);
    }
  } else {
    const total = sizes.reduce((sum, [, size]) => sum + size, 0),
      ok = total <= budget.limit;
    failed ||= !ok;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${name}: ${total} B gzipped across ${sizes.length} files (limit ${budget.limit})`,
    );
  }
}
if (failed) process.exit(1);
