// Runs tools/steps/amph-life-day.mjs like tools/shot.mjs does, with a patient page load (a busy machine takes over 30 s for the
// first load of a dev server).   node tools/steps/amph-life-run.mjs --url=http://127.0.0.1:4502/   (env as amph-life-day.mjs)
import { chromium } from 'playwright';
import steps from './amph-life-day.mjs';
const url = (process.argv.find((a) => a.startsWith('--url=')) ?? '--url=http://localhost:5173/').slice(6);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  await steps(page, null, 'desktop');
} finally { await browser.close(); }
