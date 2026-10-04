// In-game animation sequences of single animals, for looking at gaits, swimming and behaviour with the real renderer.
//
//   node tools/animals-seq.mjs --scenario=swim|walk|crab|salamander --species=dartfrog,toad [--url=http://localhost:4173/]
//        [--out=test-output/seq] [--tag=after] [--frames=8] [--dt=0.2] [--warm=2] [--size=420] [--view=side|three|top]
//        [--night=1|0|sense]   the game clock: 23:00 with the lamp off, or noon; `sense`: noon in the picture, night to the animals (a salamander or gecko is only out at night)
//        [--force=walk|hop|turn|tap|call|go]   (go: a salamander, newt, axolotl or gecko ends its pause and sets off)
//        [--force=walk|hop|turn|tap|call]   a frog or toad on land is made to do that right after the warm-up (a walk or hop of
//        about 4 cm ahead, a half turn on the spot (a salamander, newt or gecko: turns to a goal 6 cm behind it), toe tapping at a fly in front of it, a calling bout), so a short sequence shows it
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
const force = arg('force', '');
const cool = arg('cool', '');         // a temperature (°C) the air is held at, e.g. 15 for a fire salamander (the starter tank is about 24)
const night = arg('night', '');       // 1: the lamp is off and it is 23:00 (salamanders and geckos are out); 0: noon
const open = arg('open', '') === '1';  // walk: the most open level ground instead of ground near the water
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
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#ui{display:none!important}' });

for (const id of species) {
  // Set the scene: one animal, in the right place, world paused.
  const setup = await page.evaluate(({ id, scenario, night, cool, open }) => {
    const g = window.game, W = g.world, A = W.animals;
    g.setSpeed(0);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
    A.food = [];
    if (night === 'sense') { W.env.bright = () => 0; }       // the animals feel night while the picture stays lit
    if (cool !== '') { W.climate.tempAt = () => +cool; W.env.temp = +cool; }
    if (night !== '') { const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + (night === '1' ? 23 * 60 : 12 * 60); }
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
        if (open) {       // --open=1: the most open level ground (a turn seen from above, clear of water, plants and pieces)
          if (!A.okFor('land', x, z, 0.3, 1)) continue;
          let room = 0;
          for (let k = 0; k < 16; k++) { const xx = x + Math.cos(k / 16 * 6.283) * 5, zz = z + Math.sin(k / 16 * 6.283) * 5; room += A.okFor('land', xx, zz, 0.3, 1) && T.normalAt(xx, zz).y > 0.8 && Math.abs(T.heightAt(xx, zz) - gnd) < 1.5 ? 1 : 0; }
          score = room - Math.abs(x) * 0.02 - Math.abs(z) * 0.02;
        }
        if (!A.occ.count || true) { /* open ground preferred */ }
      }
      if (score > bs) { bs = score; best = { x, z, gnd, s }; }
    }
    if (!best) return { error: 'no spot' };
    const ctor = A.food.constructor && (A.pos0 ?? null);
    return { best, level: W.water.level };
  }, { id, scenario, night, cool, open });
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
    return { t: f(window.game.world.animals.t), pos: a.pos.toArray().map(f), yaw: f(a.yaw), swimming: !!a.swimming, speed: f(a.speedNow ?? 0), state: a.state ?? a.fs ?? '', fs: a.fs, mode: a.hm?.mode ?? a.mode, act: a.hit ? f(a.hit.act) : undefined, T: a.T && f(a.T), RH: a.RH && f(a.RH), hunger: f(a.hunger), dbg: a.hm && JSON.stringify({ g: a.hit?.goal && [f(a.hit.goal.x), f(a.hit.goal.z)], sp: a.hit && f(a.hit.speed), ml: f(a.hm.moveLeft), pl: f(a.hm.pauseLeft), calm: a.hit?.calm, ok: window.game.world.animals.okFor('land', a.pos.x, a.pos.z), side: [0,1,2,3].map((k)=>window.game.world.animals.okFor('land', a.pos.x + Math.sin(k*1.57)*1.5, a.pos.z + Math.cos(k*1.57)*1.5)), mg: a.hm.goal && [f(a.hm.goal.x), f(a.hm.goal.z)] }), kick: f(a.kick ?? 0), hop: !!a.hop, shore: !!a.shore, gait: f(a.gait ?? 0), why: (a.why ?? []).join('|'), hp: f(a.health) };
  });

  await advance(warm);
  if (force) await page.evaluate(({ force }) => {
    const A = window.game.world.animals, a = window.__a, sp = { size: 1 }, V3 = window.game.camera.position.constructor;
    const ahead = (d) => new V3(a.pos.x + Math.sin(a.yaw) * d, 0, a.pos.z + Math.cos(a.yaw) * d);
    a.order = null; a.chain = 0;
    if (force === 'walk') { a.plan = { type: 'walk', to: ahead(4), ang: a.yaw, water: false, v: 1 }; a.fs = 'walk'; a.walkT = 0; }
    else if (force === 'hop') { const to = ahead(4); to.y = window.game.world.terrain.heightAt(to.x, to.z); A.startHop(a, to, 1.4); }
    else if (force === 'turn' && a.hm) {
      // a salamander, newt or gecko: a goal 6 cm behind it, walked to with the game's own step (the mind is held off for this animal)
      const goal = { x: a.pos.x - Math.sin(a.yaw) * 6, z: a.pos.z - Math.cos(a.yaw) * 6 }, orig = A.herp, T = window.game.world.terrain;
      A.herp = function (b, s2, arr, dt) {
        if (b !== a) return orig.call(this, b, s2, arr, dt);
        b.hr ??= [0, 0, 0, 0]; b.hr.fill(0); b.wantMove = true; b.state = 'walk'; b.target = new V3(goal.x, 0, goal.z);
        this.herpStep(b, s2, {}, goal, 2.0, dt, 'any', 99);
        b.pos.y = T.heightAt(b.pos.x, b.pos.z); b.normal = T.normalAt(b.pos.x, b.pos.z);
      };
    }
    else if (force === 'turn') { a.faceTo = a.yaw + Math.PI; a.afterTurn = 'sit'; a.fs = 'turn'; }
    else if (force === 'tap') { a.fs = 'sit'; a.fsT = 99; a.tapT = 99; }
    else if (force === 'go' && a.hm) { a.hm.pauseLeft = 0; a.hm.moveLeft = 0; a.hm.goal = null; a.hm.mode = 'forage'; a.hm.modeT = 0; }       // a salamander or gecko sets off now
    else if (force === 'call') { a.fs = 'sit'; a.fsT = 99; a.male = true; a.v ??= null; if (a.v) a.v.callNext = 0; }
    void sp;
  }, { force });
  if (arg('trace', '')) console.log(await page.evaluate(() => { const A = window.game.world.animals, a = window.__a, out = []; for (let i = 0; i < 25; i++) { A.move(0.04); out.push(`${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)} yaw ${a.yaw.toFixed(2)} hsp ${(a.hsp ?? 0).toFixed(2)} sp ${a.hit?.speed} g ${a.hit?.goal ? a.hit.goal.x.toFixed(1) + ',' + a.hit.goal.z.toFixed(1) : '-'} still ${(a.stillT ?? 0).toFixed(1)}`); } return out.join('\n'); }));
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
  console.log(tel.map((t) => `${t.dbg ?? ''} ${t.t}s ${t.swimming ? 'SWIM' : (t.fs ?? t.state)} ${t.mode ?? ''} act=${t.act} T=${t.T} RH=${t.RH} v=${t.speed} pos=${t.pos.join(',')} kick=${t.kick} hop=${t.hop} shore=${t.shore} why=${t.why}`).join('\n'));
}
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
