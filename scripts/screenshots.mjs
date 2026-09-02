// Renders the sandbox scenarios in headless Chromium and saves PNGs used by the README.
// Usage: pnpm screenshots

import { chromium } from 'playwright';
import { createServer } from 'vite';

const SCENARIOS = [
  { name: 'cues', file: 'vtt-cues.png', time: 3 },
  { name: 'regions', file: 'vtt-regions.png', time: 3 },
  { name: 'region-scroll', file: 'vtt-region-scroll.png', time: 3.5 },
  { name: 'collisions', file: 'collisions.png', time: 3 },
  { name: 'ssa', file: 'ssa.png', time: 1.3 },
  { name: 'edge-styles', file: 'edge-styles.png', time: 1, selector: '#root' },
];

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  define: { __DEV__: 'true' },
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1100, height: 700 },
  deviceScaleFactor: 1.5,
});

for (const scenario of SCENARIOS) {
  await page.goto(`${base}.sandbox/index.html?scenario=${scenario.name}&time=${scenario.time}`);
  await page.waitForSelector('body[data-ready]');
  await page.waitForSelector('[data-part="cue"]');
  // Let region scroll transitions and font loading settle.
  await page.waitForTimeout(600);
  const target = page.locator(scenario.selector ?? '.viewport').first();
  await target.screenshot({ path: `assets/${scenario.file}` });
  console.log(`saved assets/${scenario.file}`);
}

await browser.close();
await server.close();
