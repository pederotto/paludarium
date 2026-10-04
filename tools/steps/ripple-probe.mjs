// What a swimming frog does to the water, in numbers (standalone): a frog swims across the lagoon of a generated blackwater tank for
// a few seconds while the ripple field (render/waterfx.js) is read back each quarter second: the largest ripple and the mean height
// within 8 cm of the frog, in millimetres, and a picture of the field around it (bright: raised, dark: lowered) for each reading.
//
//   node tools/steps/ripple-probe.mjs [--url=http://127.0.0.1:5173/] [--out=test-output/ripple] [--tag=run] [--id=leucomelas] [--scene=dash|float|hop] [--secs=4]
import { chromium } from 'playwright';
import fs from 'node:fs';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output/ripple'), tag = arg('tag', 'run'), id = arg('id', 'leucomelas'), scene = arg('scene', 'dash'), secs = +arg('secs', 4);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/40[34]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.goto(`${url}?quality=high&fixedres${arg('webgl', '0') === '1' ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
await page.waitForTimeout(3000);
page.setDefaultTimeout(600000);
await page.evaluate(async ({ id, scene }) => {
  const gen = await import('/src/sim/generator.js');
  const { SPECIES } = await import('/src/sim/animals.js');
  const g = window.game;
  const w = await g.loadTank('standard', { layout: 'empty' });
  gen.generateTerrarium(w, { preset: 'blackwater', seed: 1, tier: 'standard' });
  for (const arr of Object.values(w.animals.by)) for (const a of [...arr]) w.animals.remove(a);
  w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
  g.frozen = true;
  await new Promise((r) => setTimeout(r, 3000));
  const A = w.animals, V3 = g.camera.position.constructor, sp = SPECIES[id], x = -14, z = 13, s = w.water.surfaceAt(x, z, 0.2);
  const a = A.add(id, new V3(x, s - 0.5 * sp.size, z), { age: 1e6, hunger: 0.1 });
  A.meshFor(id);
  for (let t = 0; t < 120 && !(A.bodyOf(id) && A.meshFor(id, null, 'swim')); t++) await new Promise((r) => setTimeout(r, 100));
  a.swimming = true; a.roam = true; a.timer = 1e9; a.yaw = Math.PI / 2; a.shore = new V3(60, 0, z);
  if (scene === 'float') { a.floating = true; a.shore = new V3(x + 0.5, 0, z); }
  window.__sw = a;
}, { id, scene });
const rows = [], tiles = [];
for (let k = 0; k < secs * 4; k++) {
  const r = await page.evaluate(async () => {
    const half2f = (h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 32768 ? -1 : 1; return sg * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15)); };
    const g = window.game, A = g.world.animals, a = window.__sw, fx = g.fx;
    for (let i = 0; i < 15; i++) { A._rt = performance.now() - 16; A.move(1 / 60); A.draw(1 / 60); fx.step(); }       // a quarter second of swimming and of ripples
    const [W, H] = [fx.rt[0].width, fx.rt[0].height];
    const px = await g.renderer.readRenderTargetPixelsAsync(fx.rt[0], 0, 0, W, H);
    const half = px instanceof Uint16Array, hAt = (i) => (half ? half2f(px[i * 4]) : px[i * 4]) * 0.02 * 10;    // mm
    const tank = (await import('/src/sim/tank.js')).TANK;
    const cx = Math.round((a.pos.x / tank.w + 0.5) * W), cz = Math.round((a.pos.z / tank.d + 0.5) * H), R = Math.round(8 / tank.w * W);
    let mx = 0, sum = 0, n = 0;
    const N = 2 * R + 1, crop = new Uint8Array(N * N);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const u = cx + i, v = cz + j;
      let h = 0;
      if (u >= 0 && u < W && v >= 0 && v < H) { h = hAt(v * W + u); mx = Math.max(mx, Math.abs(h)); sum += Math.abs(h); n++; }
      crop[(j + R) * N + (i + R)] = Math.max(0, Math.min(255, 128 + h * 60));
    }
    return { v: +(a.sw?.v ?? 0).toFixed(1), p: +((a.kick ?? 0) % 1).toFixed(2), max: +mx.toFixed(2), mean: +(sum / Math.max(1, n)).toFixed(3), hulls: fx.hulls?.size ?? 0, N, crop: Array.from(crop), x: +a.pos.x.toFixed(1) };
  });
  rows.push(`${(k / 4).toFixed(2)}s x ${r.x} stroke ${r.p} v ${r.v} cm/s  ripple max ${r.max} mm  mean ${r.mean} mm  hulls ${r.hulls}`);
  tiles.push(await sharp(Buffer.from(r.crop), { raw: { width: r.N, height: r.N, channels: 1 } }).resize(140, 140, { kernel: 'nearest' }).png().toBuffer());
}
console.log(rows.join('\n'));
const cols = 8, rowsN = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * 140, height: rowsN * 140, channels: 3, background: '#000' } }).composite(tiles.map((input, i) => ({ input, left: (i % cols) * 140, top: Math.floor(i / cols) * 140 }))).png().toFile(`${out}/ripple-${id}-${scene}-${tag}.png`);
console.log('wrote', `${out}/ripple-${id}-${scene}-${tag}.png`);
if (errors.length) console.log('errors', [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
