// Screenshot of the starter tank seen from a low angle (floor blur check).
//   node tools/angle-shot.mjs --out=test-output/angle.png [--polar=1.35] [--dpr=1]
import { chromium } from 'playwright';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +arg('dpr', 1) })).newPage();
p.on('pageerror', (e) => console.log('pageerror', String(e.message).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300)); });
await p.goto(arg('url', 'http://localhost:4173/'));
await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await p.getByRole('button', { name: /starter paludarium/i }).click({ force: true });
await p.waitForFunction(() => window.game?.world?.sim && document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 });
await p.waitForFunction(() => !document.body.innerText.includes('Build living worlds'), null, { timeout: 60000 }).catch(() => console.log('title still up'));
await p.waitForTimeout(3000);
await p.evaluate(async (polar) => { const c = window.game.controls; await c.rotatePolarTo(polar, false); await c.rotateAzimuthTo(0.5, false); c.dollyTo?.(c.distance * 0.6, false); }, +arg('polar', 1.4));
await p.waitForTimeout(4000);
console.log(await p.evaluate(() => [document.getElementById('loading')?.className, document.body.innerText.slice(0,120)]));
await p.screenshot({ path: arg('out', 'test-output/angle.png') });
await b.close();
