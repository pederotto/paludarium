// One animal at a chosen kind of spot, seen from a fixed camera in a lit tank: a frame strip for judging a model, its gait and its
// behaviour in the real renderer (tools/animals-seq.mjs follows the animal and is often dark or blocked by plants; this does not).
//
//   node tools/look.mjs --species=newt [--spot=bank|bottom|land|stem] [--face=up|down|along] [--frames=8] [--dt=0.5] [--warm=1]
//        [--view=side|three|top|front] [--dist=14] [--size=520] [--mode=rest|forage|hunt|graze] [--count=1] [--food=0]
//        [--url=http://127.0.0.1:5173/] [--out=test-output/look] [--tag=now] [--night=sense|1|0] [--cool=18] [--free=1] [--follow=1]
//
//   spot   bank: under water on the slope of a pool's bank (the body on a slope: the tail and the snout against the ground);
//          bottom: the flattest deep bottom; land: open ground near water; stem: next to the tallest plant on land
//   face   for `bank`: up or down the slope, or along it
//   mode   a salamander's mind is put in that mode (and kept there unless --free=1)
//   count  that many animals of the species round the spot (shrimp groups); food: drops that many flakes over it
// Writes <out>/<species>-<spot>-<tag>.png (a column per frame, rows of 4) and prints a line of telemetry per frame. The world clock
// is paused; animals are advanced by hand (Animals.move in 0.04 s steps), so every frame is the same slice of animal time.
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/');
const id = arg('species', 'newt'), spot = arg('spot', 'bank'), face = arg('face', 'up');
const frames = +arg('frames', 8), dt = +arg('dt', 0.5), warm = +arg('warm', 1), size = +arg('size', 520);
const view = arg('view', 'side'), dist = +arg('dist', 14), out = arg('out', 'test-output/look'), tag = arg('tag', 'now');
const mode = arg('mode', ''), free = arg('free', '0') === '1', count = +arg('count', 1), food = +arg('food', 0);
const night = arg('night', 'sense'), cool = arg('cool', ''), follow = arg('follow', '0') === '1';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await (await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#ui{display:none!important}' });

const setup = await page.evaluate(({ id, spot, face, night, cool, count, food, mode }) => {
  const g = window.game, W = g.world, A = W.animals, T = W.terrain;
  g.setSpeed(0);
  for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
  A.food = [];
  if (night === 'sense') { const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60; window.__dark = true; }
  if (cool !== '') { W.climate.tempAt = () => +cool; W.env.temp = +cool; }
  if (night === '1' || night === '0') { const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + (night === '1' ? 23 * 60 : 12 * 60); }
  const wet = (x, z, d = 0.3) => { const s = W.water.surfaceAt(x, z, 0.2); return Number.isFinite(s) && s > T.heightAt(x, z) + d; };
  // (away from plants, which hide the animal, and from the front glass, where the camera would stand in the substrate)
  const plants = (W.plants?.list ?? []).map((q) => ({ x: q.pos.x, z: q.pos.z, r: 2 + (q.reach ?? 3) * 0.4 }));
  const clutter = (x, z) => plants.reduce((n, q) => n + (Math.hypot(q.x - x, q.z - z) < q.r + 3 ? 1 : 0), 0) + (z > 12 ? (z - 12) * 0.6 : 0) + (z < -6 ? (-6 - z) * 0.5 : 0);
  let best = null, bs = -1e9;
  for (let x = -40; x <= 40; x += 1) for (let z = -18; z <= 18; z += 1) {
    const h = T.heightAt(x, z);
    if (spot === 'bank') {
      if (!wet(x, z, 2)) continue;
      // the steepest direction here and a slope of 0.2 … 0.6 over the body length, water over all of it
      const n = T.normalAt(x, z), sl = Math.hypot(n.x, n.z) / Math.max(0.2, n.y);
      if (sl < 0.15 || sl > 0.7) continue;
      const up = Math.atan2(-n.x, -n.z);
      const yaw = face === 'up' ? up : face === 'down' ? up + Math.PI : up + Math.PI / 2;
      let okAll = true;
      for (const d of [-5, -2.5, 2.5, 5]) if (!wet(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, 1.2)) okAll = false;
      if (!okAll) continue;
      const sc = -Math.abs(sl - 0.4) * 10 - clutter(x, z) * 2 - Math.abs(x) * 0.02;
      if (sc > bs) { bs = sc; best = { x, z, y: h, yaw }; }
    } else if (spot === 'bottom') {
      if (!wet(x, z, 3)) continue;
      const n = T.normalAt(x, z);
      let dry = 0;
      for (let k = 0; k < 8; k++) if (!wet(x + Math.sin(k * 0.785) * 6, z + Math.cos(k * 0.785) * 6, 1.5)) dry++;
      const sc = n.y * 10 - dry * 3 + (W.water.surfaceAt(x, z) - h) * 0.3 - clutter(x, z) * 2;
      if (sc > bs) { bs = sc; best = { x, z, y: h, yaw: 0.9 }; }
    } else if (spot === 'land') {
      if (wet(x, z, -0.1)) continue;
      const n = T.normalAt(x, z);
      if (n.y < 0.92) continue;
      let near = 99;
      for (let r = 3; r < 24 && near === 99; r += 3) for (let k = 0; k < 12; k++) if (wet(x + Math.cos(k * 0.52) * r, z + Math.sin(k * 0.52) * r)) { near = r; break; }
      const sc = -Math.abs(near - 8) - clutter(x, z) * 2 - Math.abs(x) * 0.03;
      if (sc > bs) { bs = sc; best = { x, z, y: h, yaw: 0.9 }; }
    }
  }
  if (spot === 'stem') {
    const P = W.plants?.list ?? [];
    for (const q of P) {
      const ht = W.plants.heightOf?.(q) ?? 0, x = q.pos?.x ?? q.x, z = q.pos?.z ?? q.z;
      if (x === undefined || wet(x, z, -0.1)) continue;
      if (ht > bs) { bs = ht; best = { x: x + 2, z: z + 2, y: T.heightAt(x + 2, z + 2), yaw: 0.9, plant: q.id, ht }; }
    }
  }
  if (!best) return { error: 'no ' + spot + ' spot' };
  const V3 = g.camera.position.constructor;
  const placed = [];
  for (let i = 0; i < count; i++) {
    const r = i ? 1.5 + Math.random() * 3 : 0, t = Math.random() * 6.283;
    const x = best.x + Math.sin(t) * r, z = best.z + Math.cos(t) * r;
    const a = A.add(id, new V3(x, T.heightAt(x, z), z), { age: 1e6, hunger: 0.1 });
    if (!a) break;
    a.yaw = i ? Math.random() * 6.283 : best.yaw;
    placed.push(a);
  }
  if (!placed.length) return { error: 'could not add ' + id };
  window.__a = placed[0];
  window.__all = placed;
  // As when the player clicks it: the camera flying in is not a threat to it (the editor rewrites `watched` every frame: pinned here).
  Object.defineProperty(A, 'watched', { configurable: true, get: () => window.__a, set: () => {} });
  // Food: settled flakes in a small heap 8 cm from the spot (along its heading), landed a while ago (so the scent has spread).
  if (food) {
    const fx = best.x + Math.sin(best.yaw) * 8, fz = best.z + Math.cos(best.yaw) * 8;
    for (let i = 0; i < food; i++) {
      const x = fx + (Math.random() - 0.5) * 1.2, z = fz + (Math.random() - 0.5) * 1.2;
      A.food.push({ kind: 'flake', pos: new V3(x, T.heightAt(x, z) + 0.1, z), sink: 1, float: 0, age: 600, settled: true });
    }
    window.__foodAt = { x: fx, z: fz };
  }
  return { best, n: placed.length, level: W.water.level };
}, { id, spot, face, night, cool, count, food, mode });
if (setup.error) { console.log(setup.error, errors.slice(0, 5)); await browser.close(); process.exit(1); }
console.log(JSON.stringify(setup));

const pin = () => page.evaluate(({ mode, free }) => {
  const a = window.__a;
  if (!mode || free || !a.hm) return;
  if (a.hm.mode !== mode) { a.hm.mode = mode; a.hm.modeT = 0; a.hm.goal = null; }
  if (mode === 'rest') { a.hm.modeT = 0; a.hm.pauseLeft = 9; a.hm.moveLeft = 0; }
}, { mode, free });
// (--night=sense: noon in the picture, night to the animals: the lamp reads dark only while they think)
const advance = (secs) => page.evaluate(async (secs) => {
  const W = window.game.world, A = W.animals, E = W.env, n = Math.round(secs / 0.04), bright = E.bright;
  if (window.__dark) E.bright = () => 0;
  try { for (let i = 0; i < n; i++) A.move(0.04); } finally { E.bright = bright; }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, secs);
let camAt = null;
const aim = () => page.evaluate(({ view, dist, camAt }) => {
  const g = window.game, a = window.__a, all = window.__all ?? [a];
  // (a group is framed on its middle, or between it and the food)
  const mid = all.reduce((m, b) => ({ x: m.x + b.pos.x / all.length, y: m.y + b.pos.y / all.length, z: m.z + b.pos.z / all.length }), { x: 0, y: 0, z: 0 });
  if (window.__foodAt && all.length > 1) { mid.x = (mid.x + window.__foodAt.x) / 2; mid.z = (mid.z + window.__foodAt.z) / 2; }
  const p = camAt ?? (all.length > 1 ? mid : a.pos), yaw = camAt?.yaw ?? a.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
  let ox, oy, oz;
  if (view === 'side') { ox = c * dist; oz = -s * dist; oy = dist * 0.18; }
  else if (view === 'top') { ox = 0.01; oz = 0.01; oy = dist; }
  else if (view === 'front') { ox = s * dist; oz = c * dist; oy = dist * 0.25; }
  else { ox = (c * 0.8 + s * 0.6) * dist; oz = (-s * 0.8 + c * 0.6) * dist; oy = dist * 0.45; }
  g.rig.stopOrbit(); g.rig.moved = true;
  g.controls.setLookAt(p.x + ox, p.y + oy, p.z + oz, p.x, p.y + 0.6, p.z, false);
  return { x: p.x, y: p.y, z: p.z, yaw };
}, { view, dist, camAt });
const probe = () => page.evaluate(() => {
  const a = window.__a, f = (v) => +(+(v ?? 0)).toFixed(2), A = window.game.world.animals, T = window.game.world.terrain;
  return { t: f(A.t), pos: a.pos.toArray().map(f), g: f(T.heightAt(a.pos.x, a.pos.z)), ws: f(window.game.world.water.surfaceAt(a.pos.x, a.pos.z, 0.2)), yaw: f(a.yaw), mode: a.hm?.mode ?? a.sm?.mode ?? a.state, swim: !!a.swimming, v: f(a.speedNow), lift: f(a.tLift), head: f(a.hLift), doing: a.doing ?? '', food: A.food.filter((f) => !f.eaten).length, group: (window.__all ?? []).map((b) => b.sIt?.mode ?? b.hm?.mode ?? '').join(','), fear: a.hm ? f(a.hm.fear) : undefined, perch: a.perch ? a.perch.ph + (a.perch.i != null ? '#' + a.perch.i + '/' + a.perch.path?.length : '') + ' to ' + [a.perch.top.x, a.perch.top.y, a.perch.top.z].map(f).join(',') + (a.perch.plant ? ' ' + a.perch.plant.id : a.perch.glassN ? ' glass' : ' piece') : '', fs: a.fs ?? '', stuck: f(a.stuckT ?? 0), threat: a.hm ? JSON.stringify(A.herpThreat?.(a, window.game.world.animals.constructor && {}, { scareCm: 9 }, false)) : undefined };
});

await pin();
await advance(warm);
camAt = await aim();          // the camera stays where it was put: the animal moves through the frame
await advance(0.3);
const shots = [];
for (let i = 0; i < frames; i++) {
  await pin();
  await advance(dt);
  if (follow) { camAt = null; await aim(); await page.waitForTimeout(250); }       // (--follow=1: the camera keeps the animal in frame)
  await page.waitForTimeout(120);
  const pr = await probe();
  console.log(JSON.stringify(pr));
  const png = await page.screenshot();
  const label = Buffer.from(`<svg width="${size}" height="40"><text x="8" y="18" font-size="14" font-family="monospace" fill="#8fe">${id} ${spot} ${tag} t=${pr.t} ${pr.mode}${pr.swim ? ' SWIM' : ''}</text><text x="8" y="34" font-size="12" font-family="monospace" fill="#fc8">v=${pr.v} lift=${pr.lift} head=${pr.head}</text></svg>`);
  shots.push(await sharp(png).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer());
}
const cols = Math.min(4, shots.length), rows = Math.ceil(shots.length / cols);
const file = `${out}/${id}-${spot}-${tag}.png`;
await sharp({ create: { width: cols * size, height: rows * size, channels: 3, background: '#000' } })
  .composite(shots.map((b, i) => ({ input: b, left: (i % cols) * size, top: Math.floor(i / cols) * size }))).png().toFile(file);
console.log('->', file);
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
