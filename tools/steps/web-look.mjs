// The webbing between a swimming frog's hind toes, close up (standalone, the creature bench): the right hind foot of each frog's
// swimming body through one stroke, the camera following the foot (its toes' end from the posed skeleton) from above and from the
// outside, so the web can be held against photographs of the species' feet. Needs the dev server.
//
//   node tools/steps/web-look.mjs [--url=http://127.0.0.1:5173] [--ids=toad,reedfrog,bumblebee,redeye,leucomelas] [--phases=6]
//        [--out=test-output/web] [--tag=run]
import { chromium } from 'playwright';
import fs from 'node:fs';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173'), out = arg('out', 'test-output/web'), tag = arg('tag', 'run');
const ids = arg('ids', 'toad,reedfrog,bumblebee,redeye,leucomelas').split(','), N = +arg('phases', 6), S = 360;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
const rows = [];
for (const id of ids) {
  await page.goto(`${url}/bench.html?sp=${id}&src=glb&lod=hi&body=swim&size=${S}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.bench?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  for (const view of ['above', 'outside']) {
    const row = [];
    for (let i = 0; i < N; i++) {
      await page.evaluate(([t, view]) => {
        const B = window.bench;
        B.pose('swim', t, {});
        B.state.stroke.info = {};
        B.frame();                                              // (poses the skeleton: the toes' end lands in stroke.info.tips)
        const tip = B.state.stroke.info.tips?.[4] ?? [2, 0, -4];
        const L = B.bodyLen() / 1.9;
        // the foot's middle a little in from the toes' end, toward the hip
        const at = [tip[0] * 0.9, tip[1], tip[2] * 0.95];
        if (view === 'above') B.cam([at[0] + 0.05 * L, at[1] + 1.1 * L, at[2] - 0.02 * L], at, [0, 0, 1], 28);
        else B.cam([at[0] + 1.0 * L, at[1] + 0.35 * L, at[2] - 0.25 * L], at, [0, 1, 0], 28);
        B.frame();
      }, [i / N, view]);
      await page.waitForTimeout(120);
      row.push(await page.screenshot());
    }
    rows.push({ id, view, row });
  }
}
const comps = [];
rows.forEach((r, y) => {
  r.row.forEach((png, x) => comps.push({ input: png, left: x * S, top: y * S }));
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="22"><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#9fd">${r.id} · right hind foot · ${r.view}</text></svg>`), left: 0, top: y * S });
});
const file = `${out}/web-${tag}.png`;
await sharp({ create: { width: S * N, height: S * rows.length, channels: 3, background: '#060708' } }).composite(comps).png().toFile(file);
console.log(file);
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
