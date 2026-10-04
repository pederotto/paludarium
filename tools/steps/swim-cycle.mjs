// The swimming stroke, laid out to be read against film of a real frog (standalone, the creature bench): one stroke of a frog's
// swimming body (its `<id>.swim` model, skinned by the stroke: util/gait.js swimPose, render/creatures/skeleton.js poseStroke) as a
// strip of frames from straight above (head up, as the reference films are shot), from the side and three-quarter; plus the same
// frog pottering (one leg after the other), turning and floating. Needs the dev server.
//
//   node tools/steps/swim-cycle.mjs [--url=http://127.0.0.1:5173] [--ids=leucomelas] [--out=test-output/swim-cycle] [--tag=run]
//        [--phases=12] [--modes=stroke,potter,turn,float] [--gif=1 (also an animated strip of the stroke from above and the side)]
import { chromium } from 'playwright';
import fs from 'node:fs';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173'), out = arg('out', 'test-output/swim-cycle'), tag = arg('tag', 'run');
const ids = arg('ids', 'leucomelas').split(','), N = +arg('phases', 12), modes = arg('modes', 'stroke,potter,turn,float').split(',');
const S = 440;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/40[34]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
// eye, target, up, and the crop of the square frame [left, top, width, height] as fractions; lengths in body lengths (k)
const VIEWS = {
  top: (k) => ({ eye: [0, 6.6 * k, -0.42 * k], at: [0, 0, -0.42 * k], up: [0, 0, 1], crop: [0.14, 0, 0.72, 1] }),
  side: (k) => ({ eye: [6.6 * k, 0.15 * k, -0.42 * k], at: [0, 0.15 * k, -0.42 * k], up: [0, 1, 0], crop: [0, 0.3, 1, 0.4] }),
  three: (k) => ({ eye: [3.6 * k, 2.8 * k, 3.4 * k], at: [0, 0, -0.5 * k], up: [0, 1, 0], crop: [0.05, 0.2, 0.9, 0.6] }),
};
const MODES = { stroke: {}, potter: { alt: 1 }, turn: { steer: 0.9 }, float: { fl: 1 } };
for (const id of ids) {
  await page.goto(`${url}/bench.html?sp=${id}&src=glb&lod=hi&body=swim&size=${S}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.bench?.ready, null, { timeout: 90000 });
  const k = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 1200)); return (window.bench.bodyLen?.() ?? 6.6) / 1.9; });   // (the swimming body is about 1.9 trunk lengths from snout to toes as scanned)
  for (const mode of modes) {
    const rows = [];
    for (const [vn, vf] of Object.entries(VIEWS)) {
      const v = vf(k), row = [];
      await page.evaluate((v) => window.bench.cam(v.eye, v.at, v.up), v);
      for (let i = 0; i < N; i++) {
        await page.evaluate(([t, x]) => window.bench.pose('swim', t, x), [i / N, MODES[mode]]);
        await page.waitForTimeout(140);
        const c = v.crop, png = await sharp(await page.screenshot()).extract({ left: Math.round(c[0] * S), top: Math.round(c[1] * S), width: Math.round(c[2] * S), height: Math.round(c[3] * S) }).png().toBuffer();
        row.push(png);
      }
      rows.push({ vn, row, w: Math.round(v.crop[2] * S), h: Math.round(v.crop[3] * S) });
    }
    const W = Math.max(...rows.map((r) => r.w)) * N, comps = [];
    let y = 0;
    for (const r of rows) {
      r.row.forEach((png, c) => comps.push({ input: png, left: c * Math.max(...rows.map((q) => q.w)), top: y }));
      comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="20"><text x="6" y="15" font-family="sans-serif" font-size="13" fill="#9fd">${id} · ${mode} · ${r.vn}</text></svg>`), left: 0, top: y });
      y += r.h;
    }
    const file = `${out}/${id}-${mode}-${tag}.png`;
    await sharp({ create: { width: W, height: y, channels: 3, background: '#060708' } }).composite(comps).png().toFile(file);
    console.log(file);
    if (mode === 'stroke' && arg('gif', '0') === '1') {
      // frames for an animation: above and side, side by side (assembled by the caller: sharp has no animated writer for these)
      const dir = `${out}/${id}-frames-${tag}`; fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < N; i++) {
        const a = rows[0], b = rows[1];
        await sharp({ create: { width: a.w + b.w, height: Math.max(a.h, b.h), channels: 3, background: '#060708' } })
          .composite([{ input: a.row[i], left: 0, top: 0 }, { input: b.row[i], left: a.w, top: Math.round((a.h - b.h) / 2) }]).png().toFile(`${dir}/f${String(i).padStart(3, '0')}.png`);
      }
      console.log(dir);
    }
  }
}
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
