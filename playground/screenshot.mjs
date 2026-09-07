// Opens the playground in headless Chromium, walks through every built-in sample (plus the
// gallery and <media-captions> views), saves a PNG per scenario, and fails if the page logged
// any console error or uncaught exception.
//
// Usage: start the dev server first, then run:
//   ./node_modules/.bin/vp dev --port=3210 --host 127.0.0.1 &
//   node playground/screenshot.mjs [--base http://127.0.0.1:3210]

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url)),
  outDir = join(here, 'screenshots');

const baseArg = process.argv.indexOf('--base'),
  base =
    (baseArg !== -1 ? process.argv[baseArg + 1] : process.env.PLAYGROUND_URL) ??
    'http://127.0.0.1:3210';

/** Each entry becomes `screenshots/<name>.png`; `query` is appended to the playground URL. */
const SHOTS = [
  { name: 'vtt', query: 'format=vtt&t=2.2' },
  { name: 'vtt-regions', query: 'format=vtt&t=15.2' },
  { name: 'vtt-vertical', query: 'format=vtt&t=26&boxes=1' },
  { name: 'srt', query: 'format=srt&t=4.5' },
  { name: 'ass', query: 'format=ass&t=2.5' },
  { name: 'ass-typesetting', query: 'format=ass&t=13&tab=cues' },
  { name: 'ass-karaoke', query: 'format=ass&t=12.2' },
  { name: 'ttml', query: 'format=ttml&t=2.5' },
  { name: 'ttml-image', query: 'format=ttml&t=9.5&boxes=1' },
  { name: 'scc', query: 'format=scc&t=3' },
  { name: 'scc-rollup', query: 'format=scc&t=16.5' },
  { name: 'lrc', query: 'format=lrc&t=4.5' },
  { name: 'sbv', query: 'format=sbv&t=4' },
  { name: 'smi', query: 'format=smi&t=2&tab=errors' },
  { name: 'sub', query: 'format=sub&t=6&tab=errors' },
  { name: 'cea-live', query: 'format=cea-live&t=3&tab=events' },
  { name: 'cea-live-708', query: 'format=cea-live&t=7.8&edge=uniform' },
  { name: 'cea-live-ticker', query: 'format=cea-live&t=24' },
  { name: 'cea-live-windows', query: 'format=cea-live&t=36&boxes=1' },
  {
    name: 'edge-styles',
    query: 'format=vtt&t=2.2&edge=raised&fontSize=7&bgAlpha=0&edgeColor=%23202040',
  },
  { name: 'element', query: 'format=vtt&t=2.2&view=element&shadow=1' },
  { name: 'gallery', query: 'view=gallery&t=3&format=vtt' },
];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 960, height: 780 }, deviceScaleFactor: 1 }),
  problems = [];

page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => {
  problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
});

for (const shot of SHOTS) {
  const url = `${base}/playground/index.html?${shot.query}`,
    before = problems.length;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.view:not([hidden]) .stage', { timeout: 15_000 });
  if (!shot.query.includes('view=gallery')) {
    await page.waitForSelector('body[data-ready]', { timeout: 15_000 });
  }
  // Every scenario time has at least one visible cue; tolerate none so a bad time still shoots.
  await page.waitForSelector('[data-part="cue"]', { timeout: 3000 }).catch(() => {});
  // Let fonts, shadow stylesheets, and media-synced animations settle.
  await page.waitForTimeout(shot.query.includes('view=gallery') ? 1200 : 500);
  const path = join(outDir, `${shot.name}.png`);
  await page.screenshot({ path });
  const cues = await page.locator('[data-part="cue"]').count();
  console.log(
    `${shot.name.padEnd(18)} ${cues} cue element(s)${problems.length > before ? '  <-- errors' : ''}`,
  );
}

// Poke the transport once so playback, stepping, and cue jumping are exercised headlessly.
await page.goto(`${base}/playground/index.html?format=ass&t=0`);
await page.waitForSelector('body[data-ready]');
await page.keyboard.press('Space');
await page.waitForTimeout(700);
await page.keyboard.press('Space');
await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('Alt+ArrowLeft');
await page.keyboard.press('ArrowRight');
const time = await page.evaluate(() => window.playground.media.currentTime);
console.log(`transport smoke test: currentTime=${time.toFixed(3)}`);

// Options smoke test: flip every renderer option, switch views, and parse with the wrong type.
await page.goto(`${base}/playground/index.html?format=vtt&t=13.5`);
await page.waitForSelector('body[data-ready]');
const field = (label) => page.locator(`.options .field:has(.field-label:text-is("${label}"))`),
  check = (label) => page.locator(`.options .check:has-text("${label}") input`);
await field('stacking').locator('select').selectOption('spec');
await field('lineStep').locator('select').selectOption('box');
await field('Driving').locator('select').selectOption('sync');
await field('dir').locator('select').selectOption('rtl');
await field('Edge style').locator('select').selectOption('drop-shadow');
await field('Font family').locator('select').selectOption({ index: 3 });
await field('Aspect').locator('select').selectOption('4:3');
for (const label of ['announce', 'Show layout boxes', 'Reduced motion', 'shadow DOM']) {
  await check(label).check();
}
await page.locator('.stage-view .stage').click();
await page.keyboard.press('Space');
await page.waitForTimeout(600);
await page.keyboard.press('Space');
await page.locator('.view-tabs .tab[data-view="element"]').click();
await page.waitForTimeout(400);
await page.locator('.view-tabs .tab[data-view="gallery"]').click();
await page.waitForTimeout(900);
await page.locator('.view-tabs .tab[data-view="stage"]').click();
await page.locator('.nav a[data-id="cea-live"]').click();
await page.waitForSelector('body[data-ready]');
await page.locator('.stage-view .stage').click();
await page.keyboard.press('Space');
await page.waitForTimeout(600);
await page.keyboard.press('Space');
await page.locator('.nav a[data-id="vtt"]').click();
await page.waitForSelector('body[data-ready]');
await page.locator('.sources select[aria-label="Parser type"]').selectOption('ttml');
await page.locator('.sources button:has-text("Apply")').click();
await page.waitForTimeout(400);
const badge = await page.locator('.inspector .tab:has-text("Errors") .badge').textContent();
const announced = await page.locator('.sr-box').textContent();
console.log(
  `options smoke test ok (errors after parsing VTT as TTML: ${badge}; announcer: ${JSON.stringify(announced?.slice(0, 40))})`,
);

await browser.close();

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('\nno console errors');
