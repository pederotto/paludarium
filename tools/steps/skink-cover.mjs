// N4 probe: the skink's world senses (refuge, rival), checked in the game itself (animals.js skink() + src/sim/skink.js).
//   node tools/steps/skink-cover.mjs [--url=http://127.0.0.1:4650/] [--seeds=1,2,3] [--dashes=4] [--males=1800 (seconds)]
// Empty tank (World.empty), noon, game paused, Animals.move stepped by hand with Math.random seeded. Five hides = leaf-litter
// patches (climate.litter = 1 within 4 cm, so skinkCover >= 0.5 there). Home is pinned to hide 0 (far west).
// Dashes: a fresh skink 7 cm from another hide, a toad pinned on the far side at 0.4 x scareCm until the skink flees (it freezes 5 s+ first). Per dash: end point,
// inside cover (skinkCover >= 0.5) and in the nearest hide, distance start->nearest hide vs start->home.
// Males: two males 6 cm apart, own homes found by the game, 1800 s (1 animal s = 1 game min at warp 1): game minutes within 10 cm
// after a 10 s grace from the first encounter. PASS: >= 90 % of the runs that dashed end in the nearest hide; 0 min within 10 cm.
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4650/'), seeds = arg('seeds', '1,2,3').split(',').map(Number);
const nD = +arg('dashes', 4), maleSec = +arg('males', 1800);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 360 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2000);

const res = await page.evaluate(async ({ seeds, nD, maleSec }) => {
  const { SKINK } = await import('/src/sim/skink.js');
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, C = W.climate, V3 = (g.camera ?? W.camera ?? A.camera).position.constructor;
  g.setSpeed(0); W.empty();
  const clear = () => { for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed'); A.food = []; };
  clear();
  W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 12 * 60;
  const rng = (s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const H = [{ x: -36, z: -8 }, { x: -14, z: 8 }, { x: 4, z: -6 }, { x: 22, z: 8 }, { x: 38, z: -6 }];
  const paint = () => { for (const h of H) for (let dx = -4; dx <= 4; dx += 1) for (let dz = -4; dz <= 4; dz += 1) if (dx * dx + dz * dz <= 16) C.litter[C.idx ? C.idx(h.x + dx, h.z + dz) : 0] = 1; };
  if (!C.idx) { const nx = C.nx; C.idx = (x, z) => Math.min(C.nz - 1, Math.max(0, Math.floor((z + (C.nz * C.cs) / 2) / C.cs))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((x + (nx * C.cs) / 2) / C.cs))); }
  paint();
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z), near = (p) => H.reduce((b, h, i) => (d2(p, h) < d2(p, H[b]) ? i : b), 0);
  const add = (id, x, z) => A.add(id, new V3(x, T.heightAt(x, z), z), { age: 1e6, hunger: 0.1 });
  const out = { stamp: (await (await fetch('/src/sim/animals.js')).text()).includes('N4b: 8 angles') ? 'STAMP N4b refuge rings served' : 'STAMP MISSING (old animals.js)', dashes: [], males: [], dbg: [], scare: SKINK.scareCm }, DBG = 3;
  for (const seed of seeds) {
    for (let i = 0; i < nD; i++) {
      Math.random = rng(seed * 100 + i); clear(); paint();
      const hi = 1 + (i % 4), h = H[hi], ang = Math.random() * Math.PI * 2;
      const s0 = { x: h.x + Math.sin(ang) * 7, z: h.z + Math.cos(ang) * 7 };
      const sk = add('skink', s0.x, s0.z); sk.home = { x: H[0].x, z: H[0].z };
      const ux = (s0.x - h.x) / 7, uz = (s0.z - h.z) / 7, tr = SKINK.scareCm * 0.4;
      const tp = { x: s0.x + ux * tr, z: s0.z + uz * tr };
      let toad = add('toad', tp.x, tp.z);
      let t = 0, still = 0, dashed = false, dEnd = null;
      for (; t < 40; t += 0.05) {
        if (toad && !dashed && t < 20) { toad.pos.set(tp.x, T.heightAt(tp.x, tp.z), tp.z); } else if (toad) { A.remove(toad, 'removed'); toad = null; }
        sk.home = { x: H[0].x, z: H[0].z };
        const p0 = { x: sk.pos.x, z: sk.pos.z };
        A.move(0.05);
        if (sk.si?.mode === 'flee' && !dashed && out.dbg.length < DBG) {
          const x = sk.pos.x, z = sk.pos.z, cand = [];
          for (let k = 0; k < 16; k++) { const r = 2 + (k % 4) * 6, tt = k * 2.4 + sk.phase, px = x + Math.sin(tt) * r, pz = z + Math.cos(tt) * r; cand.push([+px.toFixed(1), +pz.toFixed(1), r, +A.skinkCover(px, pz).toFixed(2), A.okFor('land', px, pz)]); }
          let best = null; for (let dx = -20; dx <= 20; dx += 0.5) for (let dz = -20; dz <= 20; dz += 0.5) { const dd = Math.hypot(dx, dz); if (A.skinkCover(x + dx, z + dz) >= 0.6 && (!best || dd < best[2])) best = [+(x + dx).toFixed(1), +(z + dz).toFixed(1), +dd.toFixed(1)]; }
          out.dbg.push({ seed, i, stamp: 'skRefuge' in sk ? 'PATCH skRefuge=' + JSON.stringify(sk.skRefuge) : 'NO-PATCH', pos: [+x.toFixed(1), +z.toFixed(1)], coverHere: +A.skinkCover(x, z).toFixed(2), hideCentreCover: +A.skinkCover(h.x, h.z).toFixed(2), goal: sk.si.goal && [+sk.si.goal.x.toFixed(1), +sk.si.goal.z.toFixed(1)], cand: cand.filter((c) => c[3] >= 0.3), nCand: cand.length, nearestReal: best });
        }
        if (sk.si?.mode === 'flee') dashed = true;
        still = dashed && d2(p0, sk.pos) < 0.01 ? still + 0.05 : 0;
        if (dashed && !dEnd && (sk.si?.mode !== 'flee' || still >= 1.5)) dEnd = { x: sk.pos.x, z: sk.pos.z, t, why: sk.si?.mode !== 'flee' ? 'flee-ended:' + sk.si?.mode : 'still1.5s' };
      }
      const e = dEnd ?? { x: sk.pos.x, z: sk.pos.z, t, why: 'no-end' }, cov = A.skinkCover(e.x, e.z), L = { x: sk.pos.x, z: sk.pos.z };
      out.dashes.push({ seed, i, dashed, end: [+e.x.toFixed(1), +e.z.toFixed(1)], cover: +cov.toFixed(2), inNearest: cov >= 0.5 && near(e) === hi, atHome: d2(e, H[0]) < 5, why: e.why, later: [+L.x.toFixed(1), +L.z.toFixed(1)], laterCover: +A.skinkCover(L.x, L.z).toFixed(2), laterHome: d2(L, H[0]) < 5, dNear: +d2(s0, h).toFixed(1), dHome: +d2(s0, H[0]).toFixed(1), t: +e.t.toFixed(1) });
    }
    Math.random = rng(seed * 100 + 99); clear(); paint();
    const m1 = add('skink', -3, 0), m2 = add('skink', 3, 0); m1.male = true; m2.male = true;
    let first = -1, close = 0, closeAll = 0, minD = 99;
    for (let t = 0; t < maleSec; t += 0.1) {
      A.move(0.1);
      if (Math.round(t * 10) % 600 === 0) paint();
      const d = d2(m1.pos, m2.pos); minD = Math.min(minD, d);
      if (d < 10) { if (first < 0) first = t; closeAll += 0.1; if (t > first + 10) close += 0.1; }
    }
    out.males.push({ seed, firstEnc: first, minWithin10: +(close * (A.warp ?? 1)).toFixed(1), totalWithin10: +(closeAll * (A.warp ?? 1)).toFixed(1), minD: +minD.toFixed(1), homes: [m1.home, m2.home].map((h) => h && [+h.x.toFixed(0), +h.z.toFixed(0)]) });
  }
  return out;
}, { seeds, nD, maleSec });

console.log(res.stamp);
for (const d of res.dbg) console.log('DBG', JSON.stringify(d));
for (const d of res.dashes) console.log(`dash s${d.seed}#${d.i} dashed=${d.dashed} end=${d.end} cover=${d.cover} inNearestCover=${d.inNearest} atHome=${d.atHome} end=${d.why} | LATER(40 s) at=${d.later} cover=${d.laterCover} home=${d.laterHome} | dNearest=${d.dNear} dHome=${d.dHome} t=${d.t}s`);
for (const m of res.males) console.log(`males s${m.seed} firstEnc=${m.firstEnc.toFixed?.(1)}s within10cm(after 10 s grace)=${m.minWithin10} game-min total=${m.totalWithin10} minD=${m.minD} homes=${JSON.stringify(m.homes)}`);
const dd = res.dashes.filter((d) => d.dashed), ok = dd.filter((d) => d.inNearest).length, n = dd.length, bad = res.males.filter((m) => m.minWithin10 > 0).length;
const pass = ok >= Math.ceil(0.9 * n) && bad === 0;
console.log(`SUMMARY dashes (runs that dashed) in nearest cover ${ok}/${n} (need ${Math.ceil(0.9 * n)}); male runs with time within 10 cm: ${bad}/${res.males.length} -> ${pass ? 'PASS' : 'FAIL'}`);
if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(pass ? 0 : 1);
