// The guppy breeder's tank (content/presets.js guppyroom), built as the menu builds it: which fish arrived (sex, strain, the look
// they are drawn with), the other animals and plants, the filter, and a picture of the front view by day.
//   node tools/steps/guppy-room.mjs --url=http://localhost:5173/ [--seed=1] [--out=shot.png]
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:5173/'), seed = +arg('seed', 1), out = arg('out', 'guppy-room.png');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game, null, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 600000 }).catch(() => {});
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const r = await page.evaluate(async ({ seed }) => {
    const { generateTerrarium } = await import('/src/sim/generator.js');
    const { PRESETS } = await import('/src/content/presets.js');
    const P = PRESETS.guppyroom, game = window.game;
    const w = await game.loadTank(P.ref, { layout: 'empty' });
    generateTerrarium(w, { preset: 'guppyroom', seed, tier: P.ref });
    game.rig.stopOrbit(); game.setSpeed?.(0);
    const fish = (w.animals.by.guppy ?? []).map((a) => ({ sex: a.female ? 'F' : 'M', morph: a.morph, look: a.look }));
    w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 11 * 60; for (let k = 0; k < 10; k++) w.sim.step(1);
    game.rig.view('front', false);
    const animals = {}; for (const [id, arr] of Object.entries(w.animals.by)) if (arr.length) animals[id] = arr.length;
    const plants = {}; for (const p of w.plants?.all ?? w.plants?.list ?? []) plants[p.kind ?? p.id] = (plants[p.kind ?? p.id] ?? 0) + 1;
    return { fish, animals, plants, filter: w.env.filterKind, setpoint: w.env.setpoint, litres: Math.round(w.water.volumeLitres()) };
  }, { seed });
  await page.evaluate(async () => { try { await window.game.settle?.(); } catch { /* none */ } });
  await page.waitForTimeout(8000);
  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await page.screenshot({ path: out, timeout: 180000 });
  // a close look at the strains: the 18 founders lined up mid-water at the front, a row per sex, side on to the camera
  if (arg('close', '1') === '1') {
    const yaw = +arg('yaw', '1.5708');
    await page.evaluate(({ yaw }) => {
      const game = window.game, w = game.world ?? game.W, rig = game.rig;
      const v = rig.views().front, cam = v.slice(0, 3), tgt = v.slice(3, 6);
      const dx = cam[0] - tgt[0], dz = cam[2] - tgt[2], L = Math.hypot(dx, dz), fx = dx / L, fz = dz / L;   // toward the camera
      const fish = w.animals.by.guppy, y0 = w.water.level - 5;
      const males = fish.filter((a) => !a.female), females = fish.filter((a) => a.female);
      const { TANK } = window.__tank ?? {}; const fr = +(new URLSearchParams(location.search).get('fr') ?? 0) || 12;
      const c = { x: tgt[0] + fx * fr, z: tgt[2] + fz * fr };
      const put = (arr, row) => arr.forEach((a, i) => { const s = (i - (arr.length - 1) / 2) * 4.4; a.pos.set(c.x - fz * s, y0 - row * 4.2, c.z + fx * s); a.vel.set(0, 0, 0); a.yaw = yaw; a.pitch = 0; a.frozen = true; });
      put(males, 0); put(females.filter((_, i) => i % 2 === 0), 1); put(females.filter((_, i) => i % 2 === 1), 2);
      for (const a of fish) a.state = 'idle';
      game.setSpeed?.(0); game.frozen = true;
      rig.controls.setLookAt(c.x + fx * 34, y0 - 4, c.z + fz * 34, c.x, y0 - 4, c.z, false);
    }, { yaw });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: out.replace(/\.png$/, '-close.png'), timeout: 180000 });
  }
} finally { await browser.close(); }
