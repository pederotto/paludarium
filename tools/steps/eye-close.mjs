// Close-ups of an animal's analytic eye on the bench, both LODs and both graphics paths: the camera on the eye's own axis at a few
// distances, plus an oblique one past the lids. For eye artefacts (the red-eyed tree frog's "glitchy texture", 11 Oct 2026).
//
//   node tools/steps/eye-close.mjs [--sp=redeye] [--url=http://localhost:5173] [--out=test-output/eye] [--tag=now] [--size=420]
//        [--paths=gpu,webgl] [--lods=hi,lo] [--dists=1.2,2.5,5]
// Writes <out>/<sp>-<tag>.png: a row per (path, lod), a column per view.
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const sp = arg('sp', 'redeye'), body = arg('body', ''), url = arg('url', 'http://localhost:5173'), out = arg('out', 'test-output/eye'), tag = arg('tag', 'now');
const size = +arg('size', 420), paths = arg('paths', 'gpu,webgl').split(','), lods = arg('lods', 'hi,lo').split(','), dists = arg('dists', '1.2,2.5,5').split(',').map(Number);
fs.mkdirSync(out, { recursive: true });
const guard = setTimeout(() => { console.error('eye-close: no result after 4 min, giving up'); process.exit(3); }, 240000);   // (a stuck page must not hold the probe slot)

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const rows = [];
for (const p of paths) for (const lod of lods) {
  const page = await (await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`${url}/bench.html?sp=${sp}&src=glb${body ? '&body=' + body : ''}&lod=${lod}&size=${size}${p === 'webgl' ? '&webgl' : ''}`);
  await page.waitForFunction(() => window.bench?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const eye = await page.evaluate(async () => (await (await fetch('/assets/creatures/manifest.json')).json()));
  const e = eye[body ? sp + '.' + body : sp].finish.eyes[0];
  const add = (a, b, s) => a.map((v, i) => v + b[i] * s);
  const views = dists.map((d) => ({ eye: add(e.c, e.axis, e.r * d), tgt: e.c, fov: 28 }));
  // oblique: from above and behind the eye, grazing the upper lid (where lid and ball meet)
  views.push({ eye: add(add(e.c, e.axis, e.r * 2.2), e.w, e.r * 2.2), tgt: e.c, fov: 28 });
  views.push({ eye: add(add(e.c, e.axis, e.r * 2.2), e.h, -e.r * 2.4), tgt: e.c, fov: 28 });
  const tiles = [];
  for (const v of views) {
    await page.evaluate((v) => { window.bench.cam(v.eye, v.tgt, [0, 1, 0], v.fov); }, v);
    await page.waitForTimeout(400);
    tiles.push(await page.locator('canvas').first().screenshot());
  }
  console.log(p, lod, errors.length ? 'errors: ' + errors.join(' | ') : 'ok');
  rows.push(tiles);
  await page.context().close();
}
await browser.close();
clearTimeout(guard);
const W = size, H = size, cols = rows[0].length;
const comp = [];
rows.forEach((r, i) => r.forEach((b, j) => comp.push({ input: b, left: j * W, top: i * H })));
await sharp({ create: { width: W * cols, height: H * rows.length, channels: 3, background: '#000' } }).composite(comp).png().toFile(`${out}/${sp}${body ? '.' + body : ''}-${tag}.png`);
console.log(`${out}/${sp}${body ? '.' + body : ''}-${tag}.png  rows: ${paths.flatMap((p) => lods.map((l) => p + '/' + l)).join(', ')}`);
