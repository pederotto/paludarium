// R7 CHECK: do school fish lie inside each other? Test Lab, standard tank depth 18, the L1 obstacle layout of tools/scenarios/lab-swimmers.json,
// bedotia x8 + cory x6 + neon x10. Every animal second (SECS real seconds at rate 4, after a 10 s settle) per species: body overlap = the two body axes
// (tail end to snout end along the heading, from Animals.bodyBox) closer than the smaller half-width; deep overlap = closer than half of it;
// spread = mean distance to the school centroid. TIRE=1: every fish forced tired (fm.F 0.95, tired) 8 animal-s in, the forced-rest run (must not pile at one spot).
// Stamp: the output carries stamp = window.__SCHOOLSEP ('r7-2' with src/sim/schoolsep.js, null on a build without it; the species table comes from lab.SPECIES, so the probe also runs against the live site: --url=https://pederotto.github.io/paludarium/lab.html); radar = the Lab bug radar's counts by kind
// (teleport must be 0 and not above the base), stuck = the fish watchdog's counters over the run. EXPECTED on the fixed build: overlapShare <= 0.10, deepShare <= 0.02 per species,
// spread within +-25% of the base (base 4745, one run: bedotia 0.85 / 0.71 / spread 21.7; cory 0.59 / 0.37 / 10.8; neon 0.37 / 0.21 / 14.9). Single runs are not evidence: >= 3 per variant, order B F F B.
//   SECS=45 [TIRE=1] node tools/shot.mjs --only=desktop --url=http://localhost:<port>/lab.html --steps=tools/steps/lab-fish-overlap.mjs --wait=2500
import fs from 'node:fs';
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const secs = +(process.env.SECS ?? 45), tire = process.env.TIRE === '1';
  const L1 = JSON.parse(fs.readFileSync(new URL('../scenarios/lab-swimmers.json', import.meta.url), 'utf8'))[0].spec;
  const N = { bedotia: 8, cory: 6, neon: 10 }, animals = []; let k = 0;
  for (const [sp, n] of Object.entries(N)) for (let i = 0; i < n; i++, k++) animals.push({ sp, x: -16 + (k % 8) * 4.6, z: -8 + Math.floor(k / 8) * 8 + (k % 2) * 3, yaw: 0, drive: null });
  const spec = { v: 1, tank: 'standard', ground: 'flat', depth: 18, obstacles: L1.obstacles, dots: [], rate: 4, animals };
  const res = await page.evaluate(async ({ spec, secs, tire, N, wh, feed, hungry }) => {
    const lab = window.lab; await lab.apply(spec); lab.rate(4); lab.pause(false);
    const A = lab.game.world.animals, SP = lab.SPECIES;
    const w0 = performance.now();
    while (Object.entries(N).some(([sp, n]) => A.all.filter((a) => a.sp === sp && !a.dead).length < n) && performance.now() - w0 < 90000) await new Promise((r) => setTimeout(r, 200));
    const dot = (a, b) => a.reduce((t, v, i) => t + v * b[i], 0);
    const segDist = (A1, B1, A2, B2) => { // closest distance between segments A1B1 and A2B2 (Ericson)
      const d1 = B1.map((v, i) => v - A1[i]), d2 = B2.map((v, i) => v - A2[i]), r = A1.map((v, i) => v - A2[i]);
      const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
      const cl = (v) => Math.min(1, Math.max(0, v));
      let s = den > 1e-9 ? cl((b * f - c * e) / den) : 0, t = (b * s + f) / (e || 1e-9);
      if (t < 0) { t = 0; s = cl(-c / (a || 1e-9)); } else if (t > 1) { t = 1; s = cl((b - c) / (a || 1e-9)); }
      return Math.hypot(...A1.map((v, i) => v + d1[i] * s - (A2[i] + d2[i] * t)));
    };
    const sw0 = Object.getPrototypeOf(A).swim, TM = { ms: 0, n: 0 };         // (cost: wall ms per swim() call, wrapped the same way on every build)
    A.swim = function (...args) { const t = performance.now(); const r = sw0.apply(this, args); TM.ms += performance.now() - t; TM.n++; return r; };
    const why = [], proto = Object.getPrototypeOf(A), rel0 = proto.relocate;   // WHY=1: every relocate() of a fish with who/what was at its spot (R7b)
    const snap = (a) => { const g = a.fm?.goal, nb = A.all.filter((b) => b !== a && !b.dead && b.sp === a.sp).map((b) => ({ id: b.id, d: +b.pos.distanceTo(a.pos).toFixed(1), dg: g ? +Math.hypot(b.pos.x - g.x, b.pos.z - g.z).toFixed(1) : null })).sort((x, y) => x.d - y.d).slice(0, 3);
      return { id: a.id, sp: a.sp, tt: +(A.t - t0).toFixed(1), goal: g ? [+g.x.toFixed(1), +g.z.toFixed(1)] : null, dgoal: g ? +Math.hypot(a.pos.x - g.x, a.pos.z - g.z).toFixed(1) : null, resting: !!a.fm?.resting, tired: !!a.fm?.tired, F: +(a.fm?.F ?? 0).toFixed(2), holdS: +(a.holdS ?? 0).toFixed(0), fd: +Math.min(99, ...A.food.filter((f) => !f.eaten).map((f) => f.pos.distanceTo(a.pos))).toFixed(1), nib: !!a.nib, dart: !!a.dart, v: +a.vel.length().toFixed(2), stillT: +(a.stillT ?? 0).toFixed(1), lvl: a.stuckLevel ?? 0, pos: [+a.pos.x.toFixed(1), +a.pos.y.toFixed(1), +a.pos.z.toFixed(1)], nb }; };
    if (wh) A.relocate = function (a, sp, ...rest) { if (sp.kind === 'swim' && why.length < 200) why.push({ inside: rest[1] ?? false, ...snap(a) }); return rel0.call(this, a, sp, ...rest); };
    const st0 = { ...(A.stuckStats ?? {}) }; lab.radar.clear();
    const S = {}; for (const sp of Object.keys(N)) S[sp] = { n: 0, over: 0, deep: 0, pairs: 0, deepPairs: 0, spread: 0, maxPairs: 0 };
    const t0 = A.t; let tired = false, fed = 0;  // FEED=1: A.feed() at 8 and 30 animal-s (as probes/set-look.mjs)
    const iv = setInterval(() => {
      if (tire && !tired && A.t - t0 > 8) { tired = true; for (const a of A.all) if (a.fm) { a.fm.F = 0.95; a.fm.tired = true; } }
      const hungerUp = () => { if (hungry) for (const a of A.all) if (a.sp in N && !a.dead) a.hunger = 0.8; }; if (feed && fed < 1 && A.t - t0 > 8) { fed = 1; hungerUp(); A.feed(); } if (feed && fed < 2 && A.t - t0 > 30) { fed = 2; hungerUp(); A.feed(); }
      if (A.t - t0 < 10) return;
      for (const sp of Object.keys(N)) {
        const f = A.all.filter((a) => a.sp === sp && !a.dead); if (f.length < 2) continue;
        const seg = f.map((a) => { const bx = A.bodyBox(a, SP[sp]), fx = Math.sin(a.yaw ?? 0), fz = Math.cos(a.yaw ?? 0); return { p: [a.pos.x + fx * bx.z0, a.pos.y, a.pos.z + fz * bx.z0], q: [a.pos.x + fx * bx.z1, a.pos.y, a.pos.z + fz * bx.z1], r: bx.X }; });
        let bp = 0, dp = 0;
        for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) { const d = segDist(seg[i].p, seg[i].q, seg[j].p, seg[j].q), lim = Math.min(seg[i].r, seg[j].r); if (d < lim) bp++; if (d < 0.5 * lim) dp++; }
        const c = [0, 1, 2].map((k2) => f.reduce((s, a) => s + [a.pos.x, a.pos.y, a.pos.z][k2], 0) / f.length);
        const o = S[sp]; o.n++; o.pairs += bp; o.deepPairs += dp; if (bp) o.over++; if (dp) o.deep++; o.maxPairs = Math.max(o.maxPairs, bp);
        o.spread += f.reduce((s, a) => s + Math.hypot(a.pos.x - c[0], a.pos.y - c[1], a.pos.z - c[2]), 0) / f.length;
      }
    }, 250);
    await new Promise((r) => setTimeout(r, secs * 1000)); clearInterval(iv);
    const out = {}; for (const [sp, o] of Object.entries(S)) out[sp] = { samples: o.n, overlapShare: +(o.over / Math.max(1, o.n)).toFixed(2), deepShare: +(o.deep / Math.max(1, o.n)).toFixed(2), meanPairs: +(o.pairs / Math.max(1, o.n)).toFixed(2), maxPairs: o.maxPairs, spread: +(o.spread / Math.max(1, o.n)).toFixed(2) };
    const radar = {}; for (const x of lab.radar.rows()) radar[x.kind] = (radar[x.kind] ?? 0) + x.n;
    const tele = lab.radar.rows().filter((x) => x.kind === 'teleport').slice(0, 2).map((x) => JSON.stringify(x).slice(0, 110));
    const stuck = {}; delete A.swim; delete A.relocate; for (const [k2, v] of Object.entries(A.stuckStats ?? {})) if (typeof v === 'number') stuck[k2] = v - (st0[k2] ?? 0);
    return { out, radar, tele, swimMsPerCall: +(TM.ms / Math.max(1, TM.n)).toFixed(4), swimCalls: TM.n, stuck, animalSecs: +(A.t - t0).toFixed(0), tire, stamp: window.__SCHOOLSEP ?? null, feed, ate: A.all.reduce((t, a) => t + (a.ate ?? 0), 0), flakesLeft: A.food.filter((f) => !f.eaten).length, why };
  }, { spec, secs, tire, N, wh: process.env.WHY === '1', feed: ['1', '2'].includes(process.env.FEED), hungry: process.env.FEED === '2' });
  console.log('OVERLAP ' + JSON.stringify(res));
};
