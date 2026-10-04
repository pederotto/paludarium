// Close looks at the scene's hardscape and plants in the starter tank: an overview, then the camera on each piece type
// (one of each kind of decor) and on a few plants, daylight, UI hidden. Writes test-output/scene/<tag>-*.png and a sheet.
//
//   node tools/scene-look.mjs [--url=http://127.0.0.1:5181/] [--tag=before] [--size=640]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5181/'), tag = arg('tag', 'before'), size = +arg('size', 640);
const out = 'test-output/scene';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: size, height: Math.round(size * 0.625) }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.decor && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.addStyleTag({ content: '#ui{display:none!important}' });
const targets = await page.evaluate(() => {
  const g = window.game, W = g.world;
  g.setSpeed(0);
  const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
  const t = [{ name: 'overview', overview: true }];
  const seen = new Set();
  for (const p of W.decor.pieces) {
    if (seen.has(p.type)) continue;
    seen.add(p.type);
    const b = p.mesh ? new (g.camera.position.constructor)() : null;
    const o = p.mesh ?? p.group ?? p.object;
    if (!o) continue;
    o.updateMatrixWorld(true);
    const box = new (Object.getPrototypeOf(g.camera.position).constructor)();
    const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
    o.traverse((m) => { if (!m.geometry) return; m.geometry.computeBoundingBox?.(); const bx = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); for (let a = 0; a < 3; a++) { bb.min[a] = Math.min(bb.min[a], bx.min.getComponent(a)); bb.max[a] = Math.max(bb.max[a], bx.max.getComponent(a)); } });
    t.push({ name: 'decor-' + p.type, c: bb.min.map((v, a) => (v + bb.max[a]) / 2), r: Math.max(...bb.max.map((v, a) => v - bb.min[a])) });
    void b; void box;
  }
  const plants = (W.plants?.list ?? W.plants?.plants ?? []).slice();
  const ps = new Set();
  for (const p of plants) {
    const sp = p.sp ?? p.species ?? p.type;
    if (ps.has(sp) || ps.size >= 6) continue;
    ps.add(sp);
    const pos = p.pos ?? p.position;
    if (!pos) continue;
    t.push({ name: 'plant-' + sp, c: [pos.x, pos.y + 3, pos.z], r: 12 });
  }
  return t;
});
const shots = [];
for (const t of targets) {
  await page.evaluate((t) => {
    const g = window.game;
    if (t.overview) { g.controls.setLookAt(0, 28, 95, 0, 14, 0, false); return; }
    const d = Math.max(10, t.r * 1.5);
    g.controls.setLookAt(t.c[0] + d * 0.35, t.c[1] + d * 0.3, t.c[2] + d * 0.9, t.c[0], t.c[1], t.c[2], false);
  }, t);
  await page.waitForTimeout(1500);
  const f = `${out}/${tag}-${t.name}.png`;
  await page.screenshot({ path: f });
  shots.push(f);
}
console.log(targets.map((t) => t.name).join(', '));
const w = 400, h = 250, cols = 4, rows = Math.ceil(shots.length / cols);
const ims = await Promise.all(shots.map((f) => sharp(f).resize(w, h).toBuffer()));
await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#000' } }).composite(ims.map((b, i) => ({ input: b, left: (i % cols) * w, top: Math.floor(i / cols) * h }))).png().toFile(`${out}/${tag}-sheet.png`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
