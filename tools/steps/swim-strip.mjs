// Frogs swimming, filmed (standalone): each frog and toad swimming straight across the deep lagoon of a generated blackwater tank by
// day, 12 frames 1/12 s apart, from three cameras: near above the water (3/4 view, the skinned near level of detail), near under it
// through the front glass (as the user's reference photo art-src/raw/reference/frog_swimming_leucomelas.jpg is taken), and far
// (the vertex rig: the camera beyond the near distance, a narrow lens). One strip a species and camera, the reference photo beside.
//
//   node tools/steps/swim-strip.mjs [--url=http://127.0.0.1:5173/] [--out=test-output/swim] [--tag=after] [--webgl=1]
//        [--ids=dartfrog,strawberry,leucomelas,auratus,bumblebee,reedfrog,redeye,toad] [--float=1 (the toad resting at the surface)]
//
// Prints per frame what the sim says (stroke phase, leg extension, height under the surface, pitch) so a strip can be read against
// the numbers, and page errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output/swim'), tag = arg('tag', 'run'), webgl = arg('webgl', '0') === '1';
const ids = arg('ids', 'dartfrog,strawberry,leucomelas,auratus,bumblebee,reedfrog,redeye,toad').split(',');
const floatToad = arg('float', '0') === '1';
const N = 8, W = 300, H = 200;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/40[34]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.goto(`${url}?quality=high&fixedres${webgl ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
console.log('loaded'); await page.waitForTimeout(3000);
await page.addStyleTag({ content: '#ui{display:none!important}' });
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
console.log('tank built'); await page.waitForTimeout(4000);
const ref = path.resolve('art-src/raw/reference/frog_swimming_leucomelas.jpg');
const VIEWS = [['near-side', 1], ['near-above', 2], ['far', 3]];
for (const id of ids) {
  const rows = [];
  for (const [view, vi] of VIEWS) {
    const frames = [], info = [];
    const ok = await page.evaluate(async ({ id, floatToad }) => {
      const { SPECIES } = await import('/src/sim/animals.js');
      const g = window.game, A = g.world.animals, Wt = g.world.water, V3 = g.camera.position.constructor, sp = SPECIES[id];
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const x = -12, z = 13, s = Wt.surfaceAt(x, z, 0.2);
      if (!(s > -1e9)) return false;
      const a = A.add(id, new V3(x, s - 0.35 * sp.size, z), { age: 1e6, hunger: 0.1 });
      A.meshFor(id);
      for (let t = 0; t < 80 && !A.bodyOf(id); t++) await new Promise((r) => setTimeout(r, 100));
      // swimming straight along the glass (a far mark it heads for, no exit): a frog's stroke as it crosses open water
      a.swimming = true; a.roam = true; a.timer = 1e9; a.shore = new V3(40, 0, z); a.yaw = Math.PI / 2;
      if (floatToad && id === 'toad') { a.floating = true; a.shore = new V3(x + 0.5, 0, z); }
      window.__sw = a;
      for (let i = 0; i < 45; i++) { A._rt = performance.now() - 33; A.move(1 / 30); }
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    }, { id, floatToad });
    if (!ok) { console.log(id, 'no water'); continue; }
    console.log(id, view, 'placed');
    for (let f = 0; f < N; f++) {
      const st = await page.evaluate(({ vi, f }) => {
        const g = window.game, A = g.world.animals, a = window.__sw;
        if (f) for (let i = 0; i < 3; i++) { A._rt = performance.now() - 33; A.move(1 / 36); }
        const p = a.pos, s = g.world.water.surfaceAt(p.x, p.z, 0.2);
        g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
        // side-on just above the water (posture, legs), 3/4 from above (the player's view), and beyond the near distance (far LOD)
        if (vi === 1) g.controls.setLookAt(p.x, s + 3, p.z + 14, p.x, s, p.z, false);
        else if (vi === 2) g.controls.setLookAt(p.x - 6, s + 13, p.z + 12, p.x, s, p.z, false);
        else g.controls.setLookAt(p.x - 10, s + 40, p.z + 58, p.x, s, p.z, false);
        A.move(0);
        return { kick: +(a.kick ?? 0).toFixed(2), under: +(s - p.y).toFixed(2), pitch: +(a.pitch ?? 0).toFixed(2), swim: !!a.swimming, d: +g.camera.position.distanceTo(p).toFixed(1), skinned: window.__skin?.drawn ?? 0 };
      }, { vi, f });
      await page.waitForTimeout(250);
      const k = vi === 3 ? 0.5 : 1.6;
      const buf = await page.screenshot({ clip: { x: 600 - W / 2 * k, y: 400 - H / 2 * k, width: W * k, height: H * k } });
      frames.push(await sharp(buf).resize(W, H).png().toBuffer());
      info.push(st);
    }
    console.log(id, view, JSON.stringify(info.map((s) => `${s.kick}/${s.under}/${s.pitch}${s.skinned ? 'S' : ''}`)), 'camera', info[0]?.d, 'cm');
    rows.push(await sharp({ create: { width: W * N, height: H, channels: 3, background: '#000' } }).composite(frames.map((input, i) => ({ input, left: i * W, top: 0 }))).png().toBuffer());
  }
  if (!rows.length) continue;
  const refImg = await sharp(ref).resize(Math.round(H * rows.length * 1.79), H * rows.length).png().toBuffer();
  const rw = Math.round(H * rows.length * 1.79);
  await sharp({ create: { width: W * N + rw, height: H * rows.length, channels: 3, background: '#000' } })
    .composite([...rows.map((input, i) => ({ input, left: 0, top: i * H })), { input: refImg, left: W * N, top: 0 }])
    .png().toFile(path.join(out, `swim-${tag}-${id}${webgl ? '-webgl' : ''}.png`));
  console.log('wrote', path.join(out, `swim-${tag}-${id}${webgl ? '-webgl' : ''}.png`));
}
if (errors.length) console.log('errors', errors.slice(0, 6).join('\n'));
await browser.close();
