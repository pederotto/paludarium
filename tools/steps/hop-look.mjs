// A dart frog's hop in the game (docs/MUSCLES.md, util/hop.js): the starter tank by day, the camera close behind the frog (as the
// owner's clip A), one hop of --d cm started through the game's own hopTo, then the game paused and the hop stepped by hand: at each of
// --frames moments its time is set and the game's own frog() places and pitches the frog, then the frame is drawn; with the stamp window.__muscles.writes and the hop's plan printed, and any page errors.
//
//   node tools/steps/hop-look.mjs [--url=http://127.0.0.1:4640/] [--d=3] [--webgl=1] [--every=60] [--frames=14] [--view=back|side]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4640/'), webgl = arg('webgl', '0') === '1', d = +arg('d', '3'), every = +arg('every', '60');
const nFrames = +arg('frames', '14'), view = arg('view', 'back'), dist = +arg('dist', '11'), out = 'test-output/muscles';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 520, height: 420 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|403/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.goto(`${url}?quality=high&fixedres${webgl ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals?.by?.dartfrog?.length, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);
await page.addStyleTag({ content: '#ui{display:none!important}' });
// a frog on open ground, a free spot ahead of it: tried in turn until one hop is accepted by the game's own check
const plan = await page.evaluate(async ({ d, view, dist }) => {
  const { SPECIES } = await import('/src/sim/animals.js');
  const g = window.game, A = g.world.animals, E = g.world.env;
  if (E) E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
  g.setSpeed(0);
  for (const a of A.by.dartfrog ?? []) {
    if (a.hop || a.swimming || a.perch) continue;
    const sp = SPECIES.dartfrog;
    for (let k = 0; k < 12; k++) {
      const yaw = (a.yaw ?? 0) + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.5;
      const to = a.pos.clone(); to.x += Math.sin(yaw) * d; to.z += Math.cos(yaw) * d;
      a.yaw = yaw;
      if (!A.hopTo(a, sp, to)) continue;
      const p = a.pos, dir = view === 'back' ? -1 : 0, s = [Math.cos(yaw), -Math.sin(yaw)];
      g.rig.stopOrbit?.(); g.rig.moved = true;
      if (view === 'back') g.controls.setLookAt(p.x - Math.sin(yaw) * dist, p.y + dist * 0.18, p.z - Math.cos(yaw) * dist, p.x + Math.sin(yaw) * d * 0.5, p.y + 0.9, p.z + Math.cos(yaw) * d * 0.5, false);
      else g.controls.setLookAt(p.x + s[0] * dist + Math.sin(yaw) * d * 0.5, p.y + dist * 0.15, p.z + s[1] * 8 + Math.cos(yaw) * d * 0.5, p.x + Math.sin(yaw) * d * 0.5, p.y + 0.9, p.z + Math.cos(yaw) * d * 0.5, false);
      const P = a.hop.plan;
      return { dur: P?.dur, tLaunch: P?.tLaunch, tFlight: P?.tFlight, push: P?.push, theta: P ? P.theta * 180 / Math.PI : null, lead: P?.lead, lag: P?.lag, short: P?.short };
    }
  }
  return null;
}, { d, view, dist });
console.log('hop', JSON.stringify(plan));
const shots = [];
for (let i = 0; i < nFrames; i++) {
  const st = await page.evaluate(async (t) => {
    const { SPECIES } = await import('/src/sim/animals.js');
    const A = window.game.world.animals, a = A.by.dartfrog.find((x) => x.hop) ?? null;
    if (!a) return { t: -1, writes: window.__muscles?.writes ?? -1 };
    a.hop.t = t; A.frog(a, SPECIES.dartfrog, 0);          // (dt 0: the hop stays at t, frog() puts the body where it is then)
    return { t: a.hop?.t ?? -1, writes: window.__muscles?.writes ?? -1 };
  }, Math.min(0.999, i / (nFrames - 1)));
  await page.waitForTimeout(250);
  const f = `${out}/hop-game-${view}${webgl ? '-webgl' : ''}-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: f });
  shots.push([f, st.t]);
}
console.log('frames at hop t:', shots.map(([, t]) => t.toFixed(2)).join(' '), errors.length ? '\nerrors: ' + [...new Set(errors)].slice(0, 4).join(' | ') : '\nno page errors');
await browser.close();
const W = 260, H = 210;
const tiles = await Promise.all(shots.map(async ([f, t]) => ({ input: await sharp(f).resize(W, H).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20"><text x="4" y="15" font-size="13" fill="#ff0" font-family="sans-serif">t ${t.toFixed(2)}</text></svg>`), left: 0, top: 0 }]).png().toBuffer() })));
const cols = 7, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#000' } }).composite(tiles.map((t, i) => ({ ...t, left: (i % cols) * W, top: Math.floor(i / cols) * H }))).png().toFile(`${out}/hop-game-${view}${webgl ? '-webgl' : ''}.png`);
console.log(`wrote ${out}/hop-game-${view}${webgl ? '-webgl' : ''}.png`);
