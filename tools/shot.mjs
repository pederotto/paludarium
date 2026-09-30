// Multi-viewport screenshot harness, driven against a running dev server.
//
//   node tools/shot.mjs [--url=http://localhost:5173/] [--out=test-output] [--wait=6000]
//        [--steps=file.mjs] [--only=desktop|phone] [--query="?fresh"]
//
// Launches the installed Chrome with real WebGPU (Metal) and takes screenshots
// at a 16:9 desktop size and at a phone size. A steps module may export
// `async (page, shot) => {}` to click around and call shot('name').
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:5173/');
const out = arg('out', 'test-output');
const wait = +arg('wait', 6000);
const only = arg('only', '');
const query = arg('query', '');
const stepsFile = arg('steps', '');
fs.mkdirSync(out, { recursive: true });

const SIZES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const steps = stepsFile ? (await import(path.resolve(stepsFile))).default : null;
let failed = false;
for (const [name, opts] of Object.entries(SIZES)) {
  if (only && only !== name) continue;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
  await page.goto(url + query, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(wait);
  const shot = async (label) => {
    const file = path.join(out, `${label}-${name}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
  };
  const info = await page.evaluate(() => ({ backend: window.game?.gfx?.backend, quality: window.game?.gfx?.quality, fps: window.game?.gfx?.stats?.fps, adapt: window.game?.gfx?.adapt, gpu: !!navigator.gpu }));
  console.log(name, JSON.stringify(info));
  if (steps) await steps(page, shot, name); else await shot('main');
  if (errors.length) { failed = true; console.log(name, 'ERRORS:\n' + errors.slice(0, 8).join('\n')); }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
