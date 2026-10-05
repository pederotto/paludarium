// Floating bodies riding the water (standalone): a fire-bellied toad rests at the surface of a generated blackwater tank's lagoon
// while drops fall beside it; each frame the ripple field's height right under it (read back here on its own) is set against the
// height the toad is drawn riding at (Animals.ride, from render/waterfx.js probe) and the probe's own reading. Prints the series and
// the lag and gain that best line the ride up with the water, and page errors.
//
//   node tools/steps/ride-probe.mjs [--url=http://127.0.0.1:5173/] [--webgl=1] [--id=toad] [--secs=6] [--drop=6] [--every=1.5]
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), webgl = arg('webgl', '0') === '1', id = arg('id', 'toad'), secs = +arg('secs', 6);
const drop = +arg('drop', 6), every = +arg('every', 1.5);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 300)));
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/40[34]/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${url}?quality=high&fixedres${webgl ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
await page.waitForTimeout(3000);
page.setDefaultTimeout(600000);
const setup = await page.evaluate(async ({ id }) => {
  const gen = await import('/src/sim/generator.js');
  const { SPECIES } = await import('/src/sim/animals.js');
  const g = window.game;
  const w = await g.loadTank('standard', { layout: 'empty' });
  gen.generateTerrarium(w, { preset: 'blackwater', seed: 1, tier: 'standard' });
  for (const arr of Object.values(w.animals.by)) for (const a of [...arr]) w.animals.remove(a);
  w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
  await new Promise((r) => setTimeout(r, 3000));
  const A = w.animals, V3 = g.camera.position.constructor, sp = SPECIES[id], x = -14, z = 13, s = w.water.surfaceAt(x, z, 0.2);
  const a = A.add(id, new V3(x, s - 0.5 * sp.size, z), { age: 1e6, hunger: 0.1 });
  A.meshFor(id);
  for (let t = 0; t < 120 && !(A.bodyOf(id) && A.meshFor(id, null, 'swim')); t++) await new Promise((r) => setTimeout(r, 100));
  a.swimming = true; a.floating = true; a.roam = true; a.timer = 1e9; a.yaw = Math.PI / 2; a.shore = new V3(x + 0.3, 0, z); a.wetT = 0; a.wetStay = 1e9;
  window.__a = a;
  return { s, backend: g.renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl' };
}, { id });
console.log('setup', JSON.stringify(setup));
const rows = await page.evaluate(async ({ secs, drop, every }) => {
  const half2f = (h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 32768 ? -1 : 1; return sg * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15)); };
  const g = window.game, fx = g.fx, a = window.__a, { TANK } = await import('/src/sim/tank.js');
  const out = [], t0 = performance.now();
  let nextDrop = 0.5;
  while ((performance.now() - t0) / 1000 < secs) {
    const t = (performance.now() - t0) / 1000;
    if (t > nextDrop) { fx.addDrop(a.pos.x + 3.5, a.pos.z + 0.5, drop, 0.8); nextDrop += every; }
    // the field right under it, read on its own (bilinear over the four cells round it)
    const W = fx.rt[0].width, H = fx.rt[0].height, u = (a.pos.x / TANK.w + 0.5) * W - 0.5, v = (a.pos.z / TANK.d + 0.5) * H - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    const px = await g.renderer.readRenderTargetPixelsAsync(fx.rt[0], i0, j0, 2, 2);
    const hv = (k) => (px instanceof Uint16Array ? half2f(px[k * 4]) : px[k * 4]) * 0.02;
    const fu = u - i0, fv = v - j0, field = (hv(0) * (1 - fu) + hv(1) * fu) * (1 - fv) + (hv(2) * (1 - fu) + hv(3) * fu) * fv;
    const pr = fx.surface(a.id);
    out.push({ t: +t.toFixed(3), field: +(field * 10).toFixed(3), probe: pr ? +(pr.h * 10).toFixed(3) : null, ride: +((a.ride?.y ?? 0) * 10).toFixed(3), tip: +(((a.ride?.p ?? 0) * 180) / Math.PI).toFixed(1), roll: +(((a.ride?.r ?? 0) * 180) / Math.PI).toFixed(1), y: +a.pos.y.toFixed(2), off: !!fx.probeOff, sw: !!a.swimming, fl: !!a.floating });
    await new Promise((r) => requestAnimationFrame(r));
  }
  return out;
}, { secs, drop, every });
const stride = Math.max(1, Math.floor(rows.length / 60));
for (let i = 0; i < rows.length; i += stride) { const r = rows[i]; console.log(`${r.t.toFixed(2)}s field ${r.field} mm  probe ${r.probe} mm  ride ${r.ride} mm  tip ${r.tip}° roll ${r.roll}°  y ${r.y}${r.off ? ' PROBE OFF' : ''}${r.sw ? '' : ' (out of the water)'}${r.fl ? '' : ' (not floating)'}`); }
// how well the ride follows the water: the lag (in frames) and gain with the least error
const f = rows.map((r) => r.field), rd = rows.map((r) => r.ride);
let best = null;
for (let lag = 0; lag <= 12; lag++) {
  let sxy = 0, sxx = 0, n = 0;
  for (let i = lag; i < rows.length; i++) { sxy += f[i - lag] * rd[i]; sxx += f[i - lag] ** 2; n++; }
  const gain = sxx > 0 ? sxy / sxx : 0;
  let err = 0, tot = 0;
  for (let i = lag; i < rows.length; i++) { err += (rd[i] - gain * f[i - lag]) ** 2; tot += rd[i] ** 2; }
  if (!best || err < best.err) best = { lag, gain: +gain.toFixed(2), err, rel: tot > 0 ? +(err / tot).toFixed(3) : 0 };
}
const peak = (arr) => Math.max(...arr.map(Math.abs));
console.log(`frames ${rows.length} in ${secs}s; field peak ${peak(f).toFixed(2)} mm, ride peak ${peak(rd).toFixed(2)} mm; best fit: ride = ${best.gain} x field, ${best.lag} frames late (unexplained ${best.rel})`);
if (errors.length) console.log('errors/warnings', [...new Set(errors)].slice(0, 8).join('\n'));
await browser.close();
