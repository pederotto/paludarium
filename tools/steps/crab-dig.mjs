// Crab burrows in the real game: vampire crabs on the starter tank dig pits into the substrate (sim/burrow.js), the soil
// moves (volume kept), and the change reaches the terrain mesh through the water's commit (render/water.js groundDisturbed).
//
//   node tools/steps/crab-dig.mjs [--url=http://localhost:5173/] [--seconds=60] [--speed=2] [--out=test-output/crab-dig]
//
// Puts three crabs on open soil by day (they want to hide, so they dig), runs the game at the given speed index (2 = 5x) for
// `seconds` of real time, then reports loads dug, pit depths at the homes, the terrain volume before and after, and whether
// the mesh shows the pit; writes a close-up of each burrow. PASS when at least one pit is 0.5 cm deep in the mesh and the
// soil volume moved by less than 0.1 %.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:5173/'), seconds = +arg('seconds', 60), speed = +arg('speed', 2), out = arg('out', 'test-output/crab-dig');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '#ui{display:none!important}' });

const setup = await page.evaluate(() => {
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, f = T.field;
  for (const a of [...(A.by.crab ?? [])]) A.remove(a, 'removed');
  W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 11 * 60;        // late morning: lamp on, crabs want to hide
  // Open, diggable, dry ground (soil or sand, no piece within 3 cm).
  const spots = [];
  for (let x = -40; x <= 40 && spots.length < 3; x += 2) for (let z = -15; z <= 18 && spots.length < 3; z += 2) {
    const g0 = T.heightAt(x, z);
    if (W.water.surfaceAt(x, z) > g0 - 0.5 || T.normalAt(x, z).y < 0.95) continue;
    if ((f.matAt(x, z, 0) + f.matAt(x, z, 1)) < 0.6 || f.sample(x, z, f.base) < 2.5) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
    let clear = true;
    for (let k = 0; k < 8; k++) { const t = k * Math.PI / 4; if (A.occ.count && A.occ.solidAt(x + Math.sin(t) * 3, g0 + 1, z + Math.cos(t) * 3)) clear = false; }
    if (clear) spots.push({ x, z });
  }
  const V3 = g.camera.position.constructor;
  window.__crabs = spots.map((s) => { const a = A.add('crab', new V3(s.x, T.heightAt(s.x, s.z), s.z), { hunger: 0 }); a.home = new V3(s.x, 0, s.z); a.cb = null; return a; });
  window.__loads = 0;
  const dig = A.crabDig.bind(A);
  A.crabDig = (a, m) => { window.__loads++; return dig(a, m); };
  const vol = () => { let s = 0; for (let n = 0; n < f.base.length; n++) s += f.base[n]; return s * f.da * f.db; };
  window.__vol = vol;
  window.__h0 = spots.map((s) => T.heightAt(s.x, s.z));
  return { spots, vol: vol(), erosion: W.water.erosion.strength };
});
console.log('spots', JSON.stringify(setup.spots), 'erosion strength', setup.erosion);
// Bare ground (only the terrain drawn), before and after: the pit and the heap without the crab sitting in them.
const bare = (on) => page.evaluate((on) => {
  const g = window.game;
  g.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.name !== 'terrain') { if (on) { o.userData._vis = o.visible; o.visible = false; } else if (o.userData._vis !== undefined) { o.visible = o.userData._vis; delete o.userData._vis; } } });
}, on);
const look = (h) => page.evaluate(({ h }) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; const y = g.world.terrain.heightAt(h[0], h[1]); g.controls.setLookAt(h[0] + 3, y + 9, h[1] + 7, h[0], y, h[1], false); }, { h });
const cam0 = await page.evaluate(() => { const c = window.game.camera.position; const t = window.game.controls.getTarget(new c.constructor()); return [c.x, c.y, c.z, t.x, t.y, t.z]; });
await bare(true);
for (let i = 0; i < setup.spots.length; i++) { await look([setup.spots[i].x, setup.spots[i].z]); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/ground-${i}-before.png` }); }
await bare(false);
await page.evaluate((c) => window.game.controls.setLookAt(...c, false), cam0);   // back where it was: a camera close by frightens crabs
await page.evaluate((s) => window.game.setSpeed(s), speed);
for (let t = 0; t < seconds; t += 10) {
  await page.waitForTimeout(10000);
  console.log(await page.evaluate(() => `t+10s loads ${window.__loads} modes ${window.__crabs.map((a) => a.cb?.mode + '/' + (a.cb?.dig?.ph ?? '-')).join(' ')}`));
}
await page.evaluate(() => window.game.setSpeed(0));
await page.waitForTimeout(6000);   // let a pending commit land
const res = await page.evaluate(async () => {
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, f = T.field;
  // Whatever is still pending reaches the mesh (as the next commit would).
  const { pitDepth } = await import('/src/sim/burrow.js');
  return {
    loads: window.__loads, vol: window.__vol(),
    crabs: window.__crabs.map((a, i) => ({ mode: a.cb?.mode, home: a.home && [a.home.x, a.home.z].map((v) => +v.toFixed(1)), basePit: +pitDepth(f, a.home.x, a.home.z).toFixed(2), meshDrop: +(window.__h0[i] - T.heightAt(a.home.x, a.home.z)).toFixed(2), alive: !a.dead })),
  };
});
console.log(JSON.stringify(res, null, 1));
// The pictures: terrain and animals only (plants and pieces hidden), so the pits and heaps show.
await page.evaluate(() => {
  const g = window.game, A = g.world.animals, keep = new Set();
  for (const m of Object.values(A.meshes)) for (const x of [m._lo?.mesh, m.hi?.mesh]) if (x) keep.add(x);
  g.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.name !== 'terrain' && !keep.has(o) && !keep.has(o.parent)) o.visible = false; });
});
for (let i = 0; i < res.crabs.length; i++) {
  const c = res.crabs[i];
  await page.evaluate(({ h }) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; const y = g.world.terrain.heightAt(h[0], h[1]); g.controls.setLookAt(h[0] + 4, y + 7, h[1] + 7, h[0], y, h[1], false); }, { h: c.home });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/burrow-${i}.png` });
}
await bare(true);
for (let i = 0; i < res.crabs.length; i++) { await look(res.crabs[i].home); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/ground-${i}-after.png` }); }
const dv = Math.abs(res.vol - setup.vol) / setup.vol;
const pass = res.crabs.some((c) => c.meshDrop > 0.5) && dv < 1e-3;
console.log(`volume ${setup.vol.toFixed(1)} -> ${res.vol.toFixed(1)} cm3 (${(dv * 100).toFixed(4)} %)`);
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
console.log(pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
