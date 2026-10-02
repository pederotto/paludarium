// In-game animation sequences of single animals, for looking at gaits, swimming and behaviour with the real renderer.
//
//   node tools/animals-seq.mjs --scenario=swim|walk|crab|salamander --species=dartfrog,toad [--url=http://localhost:4173/]
//        [--out=test-output/seq] [--tag=after] [--frames=8] [--dt=0.2] [--warm=2] [--size=420] [--view=side|three|top]
//
// Opens the starter tank, takes every other animal out, puts ONE animal of each requested species where the scenario
// wants it (the deepest part of the main pool for `swim`; open ground near the pool for `walk`), pauses the world and
// advances the animals by hand (Animals.move in 0.04 s steps) so every frame is the same slice of animal time, then
// follows the animal with the camera and writes one contact sheet per species: <out>/<scenario>-<species>-<tag>.png and
// a line of telemetry per frame (position, speed, swimming, state). Needs real WebGPU (the installed Chrome).
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:4173/');
const scenario = arg('scenario', 'swim');
const species = arg('species', 'dartfrog').split(',');
const out = arg('out', 'test-output/seq');
const tag = arg('tag', 'after');
const frames = +arg('frames', 8), dt = +arg('dt', 0.2), warm = +arg('warm', 2), size = +arg('size', 420);
const view = arg('view', 'three');
const cols = +arg('cols', 4);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#ui{display:none!important}' });

for (const id of species) {
  // Set the scene: one animal, in the right place, world paused.
  const setup = await page.evaluate(({ id, scenario }) => {
    const g = window.game, W = g.world, A = W.animals;
    g.setSpeed(0);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
    A.food = [];
    const T = W.terrain;
    const V = (x, y, z) => { const v = A.scene ? null : null; return { x, y, z }; };
    // Find a spot: deepest water at least 6 cm from the nearest dry cell (swim), or dry open ground within 14 cm of water (walk).
    let best = null, bs = -1e9;
    for (let x = -50; x <= 50; x += 1.5) for (let z = -30; z <= 30; z += 1.5) {
      const gnd = T.heightAt(x, z), s = W.water.surfaceAt(x, z, 0.2);
      const wet = Number.isFinite(s) && s > gnd + 0.3;
      let score;
      if (scenario === 'swim') {
        if (!wet) continue;
        let dry = 99;
        for (let r = 3; r < 40 && dry === 99; r += 3) for (let k = 0; k < 12; k++) {
          const xx = x + Math.cos(k / 12 * 6.283) * r, zz = z + Math.sin(k / 12 * 6.283) * r;
          if (!(W.water.surfaceAt(xx, zz, 0.2) > T.heightAt(xx, zz) + 0.3)) { dry = r; break; }
        }
        score = Math.min(dry, 14) * 2 + (s - gnd) + (id === 'axolotl' ? 0 : 0);
        if (dry < 5) continue;
      } else {
        if (wet) continue;
        if (T.normalAt(x, z).y < 0.9) continue;
        let near = 99;
        for (let r = 3; r < 30 && near === 99; r += 3) for (let k = 0; k < 12; k++) {
          const xx = x + Math.cos(k / 12 * 6.283) * r, zz = z + Math.sin(k / 12 * 6.283) * r;
          if (W.water.surfaceAt(xx, zz, 0.2) > T.heightAt(xx, zz) + 0.3) { near = r; break; }
        }
        score = -Math.abs(near - 9) - Math.abs(x) * 0.02 + (z > -10 ? 2 : 0);
        if (!A.occ.count || true) { /* open ground preferred */ }
      }
      if (score > bs) { bs = score; best = { x, z, gnd, s }; }
    }
    if (!best) return { error: 'no spot' };
    const ctor = A.food.constructor && (A.pos0 ?? null);
    return { best, level: W.water.level };
  }, { id, scenario });
  if (setup.error) { console.log(id, setup.error); continue; }
  const placed = await page.evaluate(({ id, scenario, best }) => {
    const g = window.game, W = g.world, A = W.animals;
    // A Vector3 from a plant or the camera (the sim has no global THREE).
    const V3 = g.camera.position.constructor;
    const y = scenario === 'swim' ? Math.max(best.gnd, best.s - 0.5) : best.gnd;
    const a = A.add(id, new V3(best.x, y, best.z), { age: 1e6, hunger: 0.1 });
    if (!a) return { error: 'cap' };
    a.yaw = 0.9;
    window.__a = a;
    return { id: a.id, pos: a.pos.toArray() };
  }, { id, scenario, best: setup.best });
  if (placed.error) { console.log(id, placed.error); continue; }

  const cam = async (d, sideK) => page.evaluate(({ view, d }) => {
    const g = window.game, a = window.__a;
    const p = a.pos, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    // yaw: the animal faces (sin yaw, cos yaw); its right/left is (cos yaw, -sin yaw)
    let ox, oy, oz;
    if (view === 'side') { ox = c * d; oz = -s * d; oy = d * 0.22; }
    else if (view === 'top') { ox = 0.01; oz = 0.01; oy = d; }
    else if (view === 'front') { ox = s * d; oz = c * d; oy = d * 0.3; }
    else { ox = (c * 0.8 + s * 0.6) * d; oz = (-s * 0.8 + c * 0.6) * d; oy = d * 0.5; }
    g.rig.stopOrbit(); g.rig.moved = true;
    g.controls.setLookAt(p.x + ox, p.y + oy, p.z + oz, p.x, p.y + 0.4, p.z, false);
  }, { view, d });
  const dist = +arg('dist', species.includes('toad') ? 13 : id === 'axolotl' ? 22 : id === 'firesal' ? 26 : id === 'crab' ? 8 : 10);

  const advance = (secs) => page.evaluate(async (secs) => {
    const A = window.game.world.animals;
    const n = Math.round(secs / 0.04);
    for (let i = 0; i < n; i++) A.move(0.04);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, secs);
  const probe = () => page.evaluate(() => {
    const a = window.__a, f = (v) => +(+v).toFixed(2);
    return { t: f(window.game.world.animals.t), pos: a.pos.toArray().map(f), yaw: f(a.yaw), swimming: !!a.swimming, speed: f(a.speedNow ?? 0), state: a.state ?? a.fs ?? '', fs: a.fs, mode: a.mode, kick: f(a.kick ?? 0), hop: !!a.hop, shore: !!a.shore, gait: f(a.gait ?? 0), why: (a.why ?? []).join('|'), hp: f(a.health) };
  });

  await advance(warm);
  const shots = [], tel = [];
  for (let i = 0; i < frames; i++) {
    await cam(dist);
    await page.waitForTimeout(160);
    const png = await page.screenshot();
    const t = await probe();
    tel.push(t);
    shots.push(png);
    await advance(dt);
  }
  const rows = Math.ceil(frames / cols);
  const comps = shots.map((png, i) => ({ input: png, left: (i % cols) * size, top: Math.floor(i / cols) * size }));
  const labels = shots.map((_, i) => ({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="40"><text x="8" y="16" font-family="monospace" font-size="12" fill="#9fd">${id} ${tag} t=${tel[i].t}s ${tel[i].swimming ? 'SWIM' : tel[i].fs ?? tel[i].state}</text><text x="8" y="32" font-family="monospace" font-size="11" fill="#fc8">v=${tel[i].speed} kick=${tel[i].kick}</text></svg>`),
    left: (i % cols) * size, top: Math.floor(i / cols) * size,
  }));
  const file = `${out}/${scenario}-${id}-${tag}.png`;
  await sharp({ create: { width: cols * size, height: rows * size, channels: 3, background: '#050607' } }).composite([...comps, ...labels]).png().toFile(file);
  fs.writeFileSync(file.replace('.png', '.json'), JSON.stringify(tel, null, 1));
  console.log(id, '->', file);
  console.log(tel.map((t) => `${t.t}s ${t.swimming ? 'SWIM' : (t.fs ?? t.state)} v=${t.speed} pos=${t.pos.join(',')} kick=${t.kick} hop=${t.hop} shore=${t.shore} why=${t.why}`).join('\n'));
}
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
