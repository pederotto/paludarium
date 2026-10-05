// Why a frog is slow to get out of deep water (standalone): frog-water.mjs's drop part for one species and preset (same seeds:
// tank, Math.random and drop points), with a trace of each drop that takes longer than --slow seconds: every half second of animal
// time where it is, what it is making for (a bank to hop onto, a climb, the glass, a roam), how far, the banks it gave up on, and
// its hops and climbs. Prints the exit times and, for the slow drops, the trace.
//
//   node tools/steps/exit-trace.mjs [--url=http://127.0.0.1:5173/] [--id=bumblebee] [--preset=blackwater] [--run=1] [--drops=20]
//        [--cap=120] [--slow=15] [--only=3,7 (drop numbers)]
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), id = arg('id', 'bumblebee'), preset = arg('preset', 'blackwater'), run = +arg('run', 1);
const drops = +arg('drops', 20), cap = +arg('cap', 120), slow = +arg('slow', 15), only = arg('only', '') ? arg('only', '').split(',').map(Number) : null;
const at = arg('at', '') ? arg('at', '').split(';').map((q) => q.split(',').map(Number)) : null;     // --at=x,z;x,z: drop there instead
const presim = +arg('presim', 0);      // seconds of the world (sim and animals, none in it) run first, as frog-water.mjs's swim part does
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 300)));
await page.goto(`${url}?quality=low&fixedres`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.game?.world, null, { timeout: 120000 });
await page.waitForTimeout(2000);
page.setDefaultTimeout(1800000);
const res = await page.evaluate(async ({ id, preset, run, drops, cap, slow, only, at, presim }) => {
  const gen = await import('/src/sim/generator.js');
  const { TANK } = await import('/src/sim/tank.js');
  const { SPECIES } = await import('/src/sim/animals.js');
  const P = gen.PRESETS[preset];
  const tier = P.tiers.includes('standard') ? 'standard' : P.tiers[0];
  let rs = (0x9e3779b9 ^ (run * 7919 + preset.length * 104729 + preset.charCodeAt(0) * 31)) | 0;
  Math.random = () => { rs |= 0; rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const game = window.game;
  const w = await game.loadTank(tier, { layout: 'empty' });
  gen.generateTerrarium(w, { preset, seed: run, tier });
  game.setSpeed?.(0);
  w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
  const A = w.animals, T = w.terrain, Wt = w.water, V3 = game.camera.position.constructor, dtA = 1 / 30;
  const tick = () => { A._rt = performance.now() - dtA * 1000; A.move(dtA); };
  for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
  A.syncOccupancy(true);
  const level0 = w.water.surfaceAt(0, TANK.d / 2 - 3, 0.2);
  for (let i = 0; i < presim * 30; i++) { w.sim.step(dtA); tick(); if (i % 300 === 0) await new Promise((r) => setTimeout(r, 0)); }
  if (presim) console.log('presim', presim, 's: water at the front', level0, '->', w.water.surfaceAt(0, TANK.d / 2 - 3, 0.2));
  const H = (a) => A.bodyBox(a, SPECIES[a.sp]).H;
  const cells = [];
  for (let x = -TANK.w / 2 + 2.5; x <= TANK.w / 2 - 2.5; x += 0.75) for (let z = -TANK.d / 2 + 2.5; z <= TANK.d / 2 - 2.5; z += 0.75) {
    const g = T.heightAt(x, z), sf = Wt.surfaceAt(x, z, 0.2);
    if (!(sf - g > 0.5)) continue;
    if (A.occ.count && A.occ.solidAt(x, sf - 0.3, z)) continue;
    if (z < w.wall.zAt(x, sf) + 2) continue;
    cells.push([x, z, sf - g]);
  }
  // (frog-water.mjs's drop seed: its species loop runs every species before this one; with one species asked for, seed as it does)
  let s = 99 + run * 31 + preset.length;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const sp = SPECIES[id], deep = cells.filter((c) => c[2] > 0.9 * sp.size + 0.3);
  const out = [];
  // what it is doing, as a short word
  const doing = (a) => a.perch ? `perch-${a.perch.ph}${a.perch.exit ? '-exit' : ''}` : a.hop ? 'hop' : a.swimming ? 'swim' : a.fs ?? a.state ?? '?';
  const hops = [];
  const origHopTo = A.hopTo.bind(A), origStartHop = A.startHop.bind(A), origStartExit = A.startExit.bind(A);
  let cur = null;
  A.hopTo = (a, spp, to, water) => { const r = origHopTo(a, spp, to, water); if (a === cur?.a) cur.ev.push(`${cur.t.toFixed(1)}s hopTo (${to.x.toFixed(1)},${to.z.toFixed(1)}) ${r ? 'ok' : 'FAILED'}`); return r; };
  A.startHop = (a, to, ...rest) => { if (a === cur?.a) cur.ev.push(`${cur.t.toFixed(1)}s startHop (${to.x.toFixed(1)},${to.y.toFixed(1)},${to.z.toFixed(1)})`); return origStartHop(a, to, ...rest); };
  A.startExit = (a, spp) => { if (a === cur?.a) cur.ev.push(`${cur.t.toFixed(1)}s startExit ${a.exit?.kind ?? '?'}`); return origStartExit(a, spp); };
  for (let k = 0; k < drops; k++) {
    const [x0, z0] = deep[Math.floor(rnd() * deep.length)];
    let x = x0 + (rnd() - 0.5) * 0.7, z = z0 + (rnd() - 0.5) * 0.7;
    if (at) [x, z] = at[k];
    const sf = Wt.surfaceAt(x, z, 0.2);
    const yaw = rnd() * Math.PI * 2;
    if (only && !only.includes(k)) continue;
    const a = A.add(id, new V3(x, sf - 0.35 * sp.size, z), { age: 1e6, hunger: 0.1 });
    if (!a) continue;
    a.yaw = yaw;
    cur = { a, t: 0, ev: [], track: [] };
    let done = false, lastShore = null;
    const n = Math.round(cap / dtA);
    for (let i = 0; i < n; i++) {
      tick();
      cur.t += dtA;
      if (a.dead || !A.by[id].includes(a)) break;
      const sh = a.shore ? `${a.exit ? 'exit-' + a.exit.kind : a.shoreLand ? 'bank' : a.roam ? 'roam' : 'shore'}@(${a.shore.x.toFixed(1)},${a.shore.z.toFixed(1)})` : '-';
      if (sh !== lastShore && a.swimming) { cur.ev.push(`${cur.t.toFixed(1)}s goal ${sh} from (${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)}) bad ${a.badShore?.length ?? 0}`); lastShore = sh; }
      if (i % 15 === 0) cur.track.push(`${cur.t.toFixed(1)}:${doing(a)}(${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)}) d${(Wt.surfaceAt(a.pos.x, a.pos.z, 0.2) - T.heightAt(a.pos.x, a.pos.z)).toFixed(1)}`);
      const sfn = Wt.surfaceAt(a.pos.x, a.pos.z, 0.2), d = sfn - T.heightAt(a.pos.x, a.pos.z);
      if (!a.swimming && !a.hop && (a.pos.y > sfn + 0.05 || d < 0.5 * H(a))) { done = true; break; }
    }
    out.push({ k, x: +x.toFixed(1), z: +z.toFixed(1), t: done ? +cur.t.toFixed(1) : -1, ev: cur.t > slow || !done ? cur.ev.slice(0, 60) : null, track: cur.t > slow || !done ? cur.track.filter((_, j) => j % 2 === 0).slice(0, 80) : null });
    A.remove(a);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { tank: [TANK.w, TANK.d, TANK.h], out };
}, { id, preset, run, drops: at ? at.length : drops, cap, slow, only, at, presim });
console.log(`${id} in ${preset} run ${run} (tank ${res.tank.join('x')}): exits`, res.out.map((o) => `#${o.k}:${o.t < 0 ? 'never' : o.t + 's'}`).join(' '));
for (const o of res.out) if (o.ev) {
  console.log(`\n#${o.k} dropped at (${o.x}, ${o.z}): ${o.t < 0 ? 'NOT OUT' : o.t + ' s'}`);
  console.log('  events: ' + o.ev.join('\n          '));
  console.log('  track:  ' + o.track.join('  '));
}
if (errors.length) console.log('errors', [...new Set(errors)].slice(0, 5).join('\n'));
await browser.close();
