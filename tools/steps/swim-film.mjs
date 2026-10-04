// Frogs swimming in a tank, filmed (standalone): a frog put in the deep lagoon of a generated blackwater tank by day and filmed for
// a couple of seconds from above (as film of real frogs is usually shot), from low beside it (the waterline, how deep it lies) and
// through the water from the front. A sheet of frames a species and scene, and the frames themselves for an animation.
//
//   node tools/steps/swim-film.mjs [--url=http://127.0.0.1:5173/] [--out=test-output/swim-film] [--tag=run] [--webgl=1]
//        [--ids=leucomelas,toad] [--scenes=dash,turn,potter,float] [--frames=16] [--views=above,low,under] [--keep=1 (the frames too)]
//
// Scenes: dash (straight for a far bank, both legs), turn (its goal off to one side: it steers with its legs), potter (a slow
// wander, one leg after the other), float (resting at the surface). Prints what the sim says each frame (stroke phase, speed,
// depth under the surface, whether the skinned swimming body drew it) and page errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output/swim-film'), tag = arg('tag', 'run'), webgl = arg('webgl', '0') === '1';
const ids = arg('ids', 'leucomelas').split(','), scenes = arg('scenes', 'dash').split(','), N = +arg('frames', 16), views = arg('views', 'above,low,under').split(',');
const keep = arg('keep', '0') === '1', W = 420, H = 300;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/40[34]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.goto(`${url}?quality=${arg('quality', 'high')}&fixedres${webgl ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '#ui,#loading{display:none!important}' });
page.setDefaultTimeout(600000);
await page.evaluate(async () => {
  const gen = await import('/src/sim/generator.js');
  const g = window.game;
  const w = await g.loadTank('standard', { layout: 'empty' });
  gen.generateTerrarium(w, { preset: 'blackwater', seed: 1, tier: 'standard' });
  for (const arr of Object.values(w.animals.by)) for (const a of [...arr]) w.animals.remove(a);
  w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
  g.frozen = true;
});
await page.waitForTimeout(4000);
for (const id of ids) for (const scene of scenes) {
  const ok = await page.evaluate(async ({ id, scene }) => {
    const { SPECIES } = await import('/src/sim/animals.js');
    const g = window.game, A = g.world.animals, Wt = g.world.water, V3 = g.camera.position.constructor, sp = SPECIES[id];
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    const x = -14, z = 13, s = Wt.surfaceAt(x, z, 0.2);
    if (!(s > -1e9)) return false;
    const a = A.add(id, new V3(x, s - 0.5 * sp.size, z), { age: 1e6, hunger: 0.1 });
    A.meshFor(id);
    for (let t = 0; t < 120 && !(A.bodyOf(id) && A.meshFor(id, null, 'swim')); t++) await new Promise((r) => setTimeout(r, 100));
    // swimming along the front glass toward a far mark (no way out there), or resting, or with its goal off to one side
    a.swimming = true; a.roam = true; a.timer = 1e9; a.yaw = Math.PI / 2; a.shore = new V3(60, 0, z);
    if (scene === 'float') { a.floating = true; a.shore = new V3(x + 0.5, 0, z); }
    window.__sw = a; window.__scene = scene;
    for (let i = 0; i < 40; i++) { A._rt = performance.now() - 33; A.move(1 / 30); }
    if (scene === 'turn') a.shore = new V3(a.pos.x + 6, 0, a.pos.z - 30);
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  }, { id, scene });
  if (!ok) { console.log(id, scene, 'no water'); continue; }
  for (const view of views) {
    const frames = [], info = [];
    for (let f = 0; f < N; f++) {
      const st = await page.evaluate(({ view, f }) => {
        const g = window.game, A = g.world.animals, a = window.__sw;
        // (a toad pottering: the sim's own urgency for a roaming toad; a frog is made to potter by hand, to show the gait)
        if (f) for (let i = 0; i < 2; i++) { A._rt = performance.now() - 33; if (window.__scene === 'potter' && a.sw) a.swPotter = true; A.move(1 / 30); }
        const p = a.pos, s = g.world.water.surfaceAt(p.x, p.z, 0.2);
        g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
        if (view === 'above') g.controls.setLookAt(p.x + 1, s + 44, p.z + 6, p.x + 1, s, p.z, false);
        else if (view === 'low') g.controls.setLookAt(p.x - 12, s + 9, p.z + 30, p.x + 1, s, p.z, false);
        else g.controls.setLookAt(p.x + 1, s - 2, p.z + 38, p.x + 1, s - 1, p.z, false);
        A.move(0);
        return { kick: +(a.kick ?? 0).toFixed(2), v: +(a.sw?.v ?? 0).toFixed(1), under: +(s - p.y).toFixed(2), alt: +(a.sw?.alt ?? 0).toFixed(1), fl: +(a.sw?.fl ?? 0).toFixed(1), swim: !!a.swimming, skinned: window.__skin?.drawn ?? 0 };
      }, { view, f });
      await page.waitForTimeout(220);
      const buf = await page.screenshot({ clip: { x: 600 - W / 2, y: 400 - H / 2, width: W, height: H } });
      frames.push(buf); info.push(st);
    }
    console.log(id, scene, view, JSON.stringify(info.map((s) => `${s.kick}/${s.v}/${s.under}${s.skinned ? 'S' : ''}${s.alt ? 'a' : ''}${s.fl ? 'f' : ''}`)));
    const cols = Math.ceil(N / 2);
    const file = path.join(out, `${id}-${scene}-${view}-${tag}${webgl ? '-webgl' : ''}.png`);
    await sharp({ create: { width: W * cols, height: H * 2, channels: 3, background: '#000' } }).composite(frames.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * H }))).png().toFile(file);
    console.log('wrote', file);
    if (keep) { const dir = file.replace(/\.png$/, ''); fs.mkdirSync(dir, { recursive: true }); frames.forEach((b, i) => fs.writeFileSync(`${dir}/f${String(i).padStart(3, '0')}.png`, b)); }
  }
}
if (errors.length) console.log('errors', [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
