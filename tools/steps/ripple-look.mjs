// How a frog's ripples read in the game's own views (standalone): a fire-bellied toad and a yellow-banded poison frog swimming in
// the lagoon of a generated blackwater tank by day, filmed with the ripple simulation on and, for comparison, off (FX.on = 0: the
// surface keeps only its small travelling waves). Views: `fit` (the camera the game opens a tank with), `pond` (a player's look at
// the water from the front and above, about 45 cm off), `close` (about 22 cm off, following the toad), `low` (near the waterline),
// `three` (a three-quarter view of the tank from the front and above, as a player looks round), `over` (looking down on the water),
// `feet` (close behind the swimmer, on its hind feet: the webbing).
// One sheet a view: the top row ripples on, the bottom row off; `--crop=1` adds a 2x crop round the toad.
//
//   node tools/steps/ripple-look.mjs [--url=http://127.0.0.1:5173/] [--out=test-output/ripple-look] [--tag=run] [--views=fit,pond,close,low]
//        [--frames=6] [--webgl=1] [--quality=high] [--size=1280x800]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output/ripple-look'), tag = arg('tag', 'run'), webgl = arg('webgl', '0') === '1';
const views = arg('views', 'fit,pond,close,low').split(','), N = +arg('frames', 6), crop = arg('crop', '0') === '1';
const who = arg('who', 'toad'), drops = +arg('drops', 0);   // the animal filmed (toad or frog), and a drop of this strength beside it each frame (a click)
const [VW, VH] = arg('size', '1280x800').split('x').map(Number);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })).newPage();
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
  const A = w.animals, V3 = g.camera.position.constructor;
  const put = (id, x, z, yaw, goal) => {
    const s = w.water.surfaceAt(x, z, 0.2), a = A.add(id, new V3(x, s - 0.6, z), { age: 1e6, hunger: 0.1 });
    a.swimming = true; a.roam = true; a.timer = 1e9; a.yaw = yaw; a.shore = goal; a.wetT = 0; a.wetStay = 1e9;
    return a;
  };
  for (const id of ['toad', 'leucomelas']) A.meshFor(id);
  for (let t = 0; t < 150 && !(A.meshFor('toad', null, 'swim') && A.meshFor('leucomelas', null, 'swim')); t++) await new Promise((r) => setTimeout(r, 100));
  window.__toad = put('toad', -20, 19, Math.PI / 2, new V3(60, 0, 19));
  window.__frog = put('leucomelas', 10, 17, -Math.PI / 2, new V3(-60, 0, 17));
  await g.settle?.(8000);
});
await page.waitForTimeout(5000);
const sheets = [];
for (const view of views) {
  const frames = [[], []], info = [];
  for (const on of [1, 0]) {
    for (let f = 0; f < N; f++) {
      const st = await page.evaluate(({ view, on, f, who, drops }) => {
        const g = window.game, a = who === 'frog' ? window.__frog : window.__toad;
        return import('/src/render/waterfx.js').then(({ FX }) => {
          FX.on.value = on;
          // keep them swimming across the lagoon (turned back at its ends)
          // the toad kept swimming across the lagoon with purpose (a far landing place: the stroke a frog swims for a bank with),
          // turned back at its ends; the poison frog makes for its own way out, as it would (put back in the water once it is out)
          const T = window.__toad, V3 = T.pos.constructor;
          T.swimming = true; T.wetT = 0; T.floating = false; T.dive = null; T.roam = false; T.timer = 1e9; T.exit = null;
          if (!T.shore || Math.abs(T.pos.x) > 30) { T.shore = new V3(T.pos.x > 0 ? -60 : 60, 0, T.pos.z); T.shoreLand = T.shore.clone(); }
          const F = window.__frog, sF = g.world.water.surfaceAt(F.pos.x, F.pos.z, 0.2);
          if (!F.swimming || !(sF > -1e9)) { F.pos.set(10, g.world.water.surfaceAt(10, 17, 0.2) - 0.5, 17); F.swimming = true; F.hop = null; F.perch = null; F.timer = 0; F.shore = null; }
          const p = a.pos, s = g.world.water.surfaceAt(p.x, p.z, 0.2);
          if (drops) g.fx.addDrop(p.x + 4, p.z - 3, drops, 0.8);
          g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
          if (view === 'fit') { if (f === 0) g.rig.fit(); }
          else if (view === 'pond') g.controls.setLookAt(p.x, s + 24, p.z + 34, p.x, s, p.z, false);
          else if (view === 'three') g.controls.setLookAt(p.x + 30, s + 30, p.z + 55, p.x - 4, s - 2, p.z - 12, false);
          else if (view === 'over') g.controls.setLookAt(p.x + 2, s + 40, p.z + 4, p.x, s, p.z - 8, false);
          else if (view === 'feet') { const bx = -Math.sin(a.yaw), bz = -Math.cos(a.yaw); g.controls.setLookAt(p.x + bx * 11, s + 4, p.z + bz * 11 + 1.5, p.x + bx * 3.6, s - 0.6, p.z + bz * 3.6, false); }
          else if (view === 'close') g.controls.setLookAt(p.x, s + 12, p.z + 17, p.x, s, p.z, false);
          else g.controls.setLookAt(p.x - 6, s + 4, p.z + 22, p.x, s, p.z, false);
          // where the toad is on the screen, for the crop
          const v = p.clone().project(g.camera);
          return { sx: (v.x * 0.5 + 0.5), sy: (0.5 - v.y * 0.5), kick: +(a.kick ?? 0).toFixed(2), sw: !!a.swimming, ride: +((a.ride?.y ?? 0) * 10).toFixed(2), at: [p.x, p.y, p.z].map((q) => +q.toFixed(1)), doing: a.perch ? 'perch-' + a.perch.ph : a.hop ? 'hop' : a.swimming ? 'swim' : a.fs ?? a.state, dead: !!a.dead, s: +s.toFixed(1) };
        });
      }, { view, on, f, who, drops });
      await page.waitForTimeout(view === 'fit' && f === 0 ? 1500 : 250);
      const buf = await page.screenshot();
      frames[1 - on].push({ buf, st });
      info.push(st);
    }
  }
  const W = 400, H = Math.round(W * VH / VW);
  const tiles = [];
  for (let r = 0; r < 2; r++) for (let i = 0; i < N; i++) tiles.push({ input: await sharp(frames[r][i].buf).resize(W, H).png().toBuffer(), left: i * W, top: r * H });
  const file = path.join(out, `ripple-${view}-${who}-${tag}${webgl ? '-webgl' : ''}.png`);
  await sharp({ create: { width: W * N, height: H * 2, channels: 3, background: '#000' } }).composite(tiles).png().toFile(file);
  console.log('wrote', file, JSON.stringify(info.slice(0, N).map((s) => `${s.kick}${s.sw ? '' : '!'}/${s.ride} ${s.doing} ${s.at} s${s.s}${s.dead ? ' DEAD' : ''}`)));
  // a full-size frame each, on and off, and a crop round the toad
  fs.writeFileSync(path.join(out, `ripple-${view}-${who}-on-${tag}.png`), frames[0][N - 1].buf);
  fs.writeFileSync(path.join(out, `ripple-${view}-${who}-off-${tag}.png`), frames[1][N - 1].buf);
  if (crop) for (const [k, fr] of [['on', frames[0][N - 1]], ['off', frames[1][N - 1]]]) {
    const cw = 320, ch = 200, cx = Math.round(Math.min(VW - cw, Math.max(0, fr.st.sx * VW - cw / 2))), cy = Math.round(Math.min(VH - ch, Math.max(0, fr.st.sy * VH - ch / 2)));
    await sharp(fr.buf).extract({ left: cx, top: cy, width: cw, height: ch }).resize(cw * 2, ch * 2, { kernel: 'nearest' }).png().toFile(path.join(out, `ripple-${view}-${who}-crop-${k}-${tag}.png`));
  }
  sheets.push(file);
}
if (errors.length) console.log('errors', [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
