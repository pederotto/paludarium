// A frog's leap, filmed (standalone): a frog on the bank of a generated blackwater tank made to hop along the front glass, each
// frame a twelfth of the hop, from the side and from above. Prints the hop time of each frame and whether the skinned swimming
// body drew it (the leap's body: sim/animals.js draw, util/gait.js leapStroke), and page errors.
//
//   node tools/steps/leap-film.mjs [--url=http://127.0.0.1:5173/] [--out=test-output/leap] [--tag=run] [--ids=leucomelas] [--webgl=1] [--query=noskin]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output/leap'), tag = arg('tag', 'run'), webgl = arg('webgl', '0') === '1';
const ids = arg('ids', 'leucomelas').split(','), N = 12, W = 380, H = 280;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/40[34]/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.goto(`${url}?quality=${arg('quality', 'high')}&fixedres${webgl ? '&webgl' : ''}${arg('query', '') ? '&' + arg('query', '') : ''}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '#ui,#loading{display:none!important}' });
page.setDefaultTimeout(600000);
await page.evaluate(async () => {
  const g = window.game;
  const w = await g.loadTank('standard', { layout: 'empty' });      // flat dry ground: nothing in the way of the hop or the camera
  for (const arr of Object.values(w.animals.by)) for (const a of [...arr]) w.animals.remove(a);
  w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
  g.frozen = true;
});
await page.waitForTimeout(3000);
for (const id of ids) {
  const rows = [];
  for (const view of ['side', 'above']) {
    await page.evaluate(async ({ id }) => {
      const { SPECIES } = await import('/src/sim/animals.js');
      const g = window.game, A = g.world.animals, T = g.world.terrain, V3 = g.camera.position.constructor;
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const x = -6, z = 8, a = A.add(id, new V3(x, T.heightAt(x, z), z), { age: 1e6, hunger: 0.1 });
      A.meshFor(id);
      for (let t = 0; t < 120 && !(A.bodyOf(id) && A.meshFor(id, null, 'swim')); t++) await new Promise((r) => setTimeout(r, 100));
      a.yaw = Math.PI / 2; a.fs = 'sit'; a.fsT = 1e9;
      for (let i = 0; i < 10; i++) { A._rt = performance.now() - 33; A.move(1 / 30); }
      const to = new V3(x + 9, 0, z); to.y = T.heightAt(to.x, to.z);
      A.startHop(a, to, 2.6);
      a.hop.dur = 1;                                   // (so a frame is a twelfth of the hop whatever its length)
      window.__lp = a;
      await new Promise((r) => setTimeout(r, 800));
    }, { id });
    const frames = [], info = [];
    for (let f = 0; f < N; f++) {
      const st = await page.evaluate(async ({ view, f, N }) => {
        const { SPECIES } = await import('/src/sim/animals.js');
        const g = window.game, A = g.world.animals, a = window.__lp;
        if (a.hop) { a.hop.t = Math.max(0, f / N - 1e-3); A.tf = 1; A.frog(a, SPECIES[a.sp], 1e-3); }
        const p = a.hop ? a.hop.from.clone().lerp(a.hop.to, 0.5) : a.pos;
        g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
        if (view === 'side') g.controls.setLookAt(p.x, p.y + 3, p.z + 34, p.x, p.y + 2, p.z, false);
        else g.controls.setLookAt(p.x, p.y + 36, p.z + 5, p.x, p.y, p.z, false);
        A.move(0);
        return { t: +(a.hop?.t ?? -1).toFixed(2), skinned: window.__skin?.drawn ?? 0 };
      }, { view, f, N });
      await page.waitForTimeout(220);
      frames.push(await page.screenshot({ clip: { x: 600 - W / 2, y: 400 - H / 2 - 20, width: W, height: H } })); info.push(st);
    }
    console.log(id, view, JSON.stringify(info.map((s) => `${s.t}${s.skinned ? 'S' : ''}`)));
    rows.push(await sharp({ create: { width: W * 6, height: H * 2, channels: 3, background: '#000' } }).composite(frames.map((input, i) => ({ input, left: (i % 6) * W, top: Math.floor(i / 6) * H }))).png().toBuffer());
  }
  const file = path.join(out, `leap-${id}-${tag}${webgl ? '-webgl' : ''}.png`);
  await sharp({ create: { width: W * 6, height: H * 4, channels: 3, background: '#000' } }).composite(rows.map((input, i) => ({ input, left: 0, top: i * H * 2 }))).png().toFile(file);
  console.log('wrote', file);
}
if (errors.length) console.log('errors', [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
