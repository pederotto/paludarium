// Frogs and water: how much of the time each frog species swims in every generated tank, and how fast a frog that falls into deep
// water gets out again.
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/frog-water.mjs --wait=2500 --url=http://127.0.0.1:5173/
//   FW_PRESETS=all|karst,suriname  FW_RUNS=3  FW_SECONDS=300  FW_DROPS=50  FW_CAP=120  FW_PART=swim,drop  FW_TAG=run  FW_SHOTS=0
//
// Per run r (1 … FW_RUNS) and preset: the preset's standard tank (the jar its own), generator seed r, Math.random seeded from r and
// the preset, the clock at noon (the frogs' active time), and the animals' clock at 1x (Animals.tf = 1: each tick is 1/30 s of
// animal time whatever the probe's own speed).
//   swim   the generator's animals out; two of each frog (poison frogs, bumblebee toad, reed frog, red-eyed tree frog, fire-bellied
//          toad) put on dry ground at random; FW_SECONDS of the world (sim and animals) at 1/30 s a tick. Per species: the share of
//          the time it swims, the share it stands in water deeper than half its body without swimming (wading too deep), and how it
//          got in each time (what it was doing the tick before).
//   drop   every other animal out; one frog at a time put into deep water (deep enough that it floats) at FW_DROPS seeded random
//          points per species, run alone until it is out: not swimming, not in the air, and above the surface or in water less than
//          half its body deep. Exit times in seconds of animal time: median, p95, max, paddling over 30 s, trapped (not out by FW_CAP),
//          and the way out (hop, wade, climb: glass, stem, rock, wood).
// Prints one JSON line per preset and run, then a table per species over all runs; FW_SHOTS=1 adds pictures of a frog at its exit.
const ALL = ['cascade', 'suriname', 'blackwater', 'stream', 'karst', 'swamp', 'streambank', 'reedpool', 'matano', 'everglades', 'jar'];
const FROGS = ['dartfrog', 'strawberry', 'leucomelas', 'auratus', 'bumblebee', 'redeye', 'reedfrog', 'toad'];
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(3600000);
  const env = process.env;
  const presets = !env.FW_PRESETS || env.FW_PRESETS === 'all' ? ALL : env.FW_PRESETS.split(',');
  const runs = +(env.FW_RUNS ?? 3), seconds = +(env.FW_SECONDS ?? 300), drops = +(env.FW_DROPS ?? 50), cap = +(env.FW_CAP ?? 120);
  const parts = (env.FW_PART ?? 'swim,drop').split(','), tag = env.FW_TAG ?? 'run', shots = +(env.FW_SHOTS ?? 0);
  const species = env.FW_SPECIES ? env.FW_SPECIES.split(',') : FROGS;
  const agg = {};
  for (let run = 1; run <= runs; run++) for (const preset of presets) {
    const res = await page.evaluate(async ({ preset, run, seconds, drops, cap, parts, species, shots }) => {
      const gen = await import('/src/sim/generator.js');
      const { TANK } = await import('/src/sim/tank.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      const P = gen.PRESETS[preset];
      if (!P) return { preset, error: 'no such preset' };
      const tier = P.tiers.includes('standard') ? 'standard' : P.tiers[0];
      let rs = (0x9e3779b9 ^ (run * 7919 + preset.length * 104729 + preset.charCodeAt(0) * 31)) | 0;
      Math.random = () => { rs |= 0; rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const game = window.game;
      const w = await game.loadTank(tier, { layout: 'empty' });
      gen.generateTerrarium(w, { preset, seed: run, tier });
      game.setSpeed?.(0);
      w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
      const A = w.animals, T = w.terrain, Wt = w.water, V3 = game.camera.position.constructor;
      const dtA = 1 / 30;
      // (the animals' clock at 1x: Animals.trackTime takes the real time since its last call as the frame's, and the probe runs faster)
      const tick = (sim) => { if (sim) w.sim.step(dtA); A._rt = performance.now() - dtA * 1000; A.move(dtA); };
      const clear = () => { for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a); };
      const H = (a) => A.bodyBox(a, SPECIES[a.sp]).H;
      const depthAt = (x, z) => Wt.surfaceAt(x, z, 0.2) - T.heightAt(x, z);
      const doing = (a) => a.perch ? `perch-${a.perch.ph}${a.perch.exit ? '-exit' : ''}` : a.hop ? 'hop' : a.swimming ? 'swim' : a.fs ?? a.state ?? '?';
      const out = { preset, run, tier };
      A.syncOccupancy(true);
      if (parts.includes('swim')) {
        clear();
        let s = 4242 + run * 17;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (const id of species) for (let i = 0; i < 2; i++) for (let k = 0; k < 300; k++) {
          const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
          if (depthAt(x, z) > -0.3) continue;                        // on dry ground (a toad may be put in the water; not here)
          const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
          if (r.pos && !r.error) { A.add(id, r.pos, { age: 1e6, hunger: 0.15 }); break; }
        }
        const st = {}, prevDoing = new Map(), prevSwim = new Map();
        const ticks = Math.round(seconds / dtA);
        for (let i = 0; i < ticks; i++) {
          tick(true);
          for (const a of Object.values(A.by).flat()) {
            if (!species.includes(a.sp)) continue;
            const r = st[a.sp] ??= { n: 0, swim: 0, deep: 0, entries: {} };
            if (i % 3 === 0) {
              r.n++;
              if (a.swimming) r.swim++;
              else if (!a.hop && !a.perch && depthAt(a.pos.x, a.pos.z) > 0.5 * H(a)) r.deep++;
            }
            if (a.swimming && !prevSwim.get(a)) { const k = prevDoing.get(a) ?? 'start'; r.entries[k] = (r.entries[k] ?? 0) + 1; }
            prevSwim.set(a, !!a.swimming); prevDoing.set(a, doing(a));
          }
          if (i % 300 === 0) { for (const a of Object.values(A.by).flat()) { a.health = Math.max(a.health, 0.8); a.hunger = Math.min(a.hunger, 0.4); } await new Promise((r) => setTimeout(r, 0)); }
        }
        out.swim = Object.fromEntries(Object.entries(st).map(([k, r]) => [k, { n: r.n, swim: +(r.swim / r.n * 100).toFixed(2), deep: +(r.deep / r.n * 100).toFixed(2), entries: r.entries }]));
      }
      if (parts.includes('drop')) {
        clear();
        // Deep water: open water inside the glass, out of rocks and the background, where this frog floats.
        const cells = [];
        for (let x = -TANK.w / 2 + 2.5; x <= TANK.w / 2 - 2.5; x += 0.75) for (let z = -TANK.d / 2 + 2.5; z <= TANK.d / 2 - 2.5; z += 0.75) {
          const g = T.heightAt(x, z), sf = Wt.surfaceAt(x, z, 0.2);
          if (!(sf - g > 0.5)) continue;
          if (A.occ.count && A.occ.solidAt(x, sf - 0.3, z)) continue;
          if (z < w.wall.zAt(x, sf) + 2) continue;
          cells.push([x, z, sf - g]);
        }
        out.drop = {};
        let s = 99 + run * 31 + preset.length;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (const id of species) {
          const sp = SPECIES[id];
          const deep = cells.filter((c) => c[2] > 0.9 * sp.size + 0.3);
          if (!deep.length) { out.drop[id] = { none: true }; continue; }
          const times = [], how = {}, stuckAt = [];
          for (let k = 0; k < drops; k++) {
            const [x0, z0] = deep[Math.floor(rnd() * deep.length)];
            const x = x0 + (rnd() - 0.5) * 0.7, z = z0 + (rnd() - 0.5) * 0.7;
            const sf = Wt.surfaceAt(x, z, 0.2);
            const a = A.add(id, new V3(x, sf - 0.35 * sp.size, z), { age: 1e6, hunger: 0.1 });
            if (!a) continue;
            a.yaw = rnd() * Math.PI * 2;
            let t = 0, done = false, lastWay = 'swim';
            const n = Math.round(cap / dtA);
            for (let i = 0; i < n; i++) {
              tick(false);
              t += dtA;
              if (a.dead || !A.by[id].includes(a)) break;
              if (a.hop) lastWay = a.swimming ? 'hop' : lastWay === 'swim' ? 'hop' : lastWay;
              if (a.perch && a.perch.ph !== 'go') lastWay = `climb-${a.perch.kind ?? (a.perch.glassN ? (a.perch.plant ? 'stem' : 'glass') : a.perch.plant ? 'leaf' : a.perch.piece ? 'wood' : 'rock')}`;
              const sfn = Wt.surfaceAt(a.pos.x, a.pos.z, 0.2), d = sfn - T.heightAt(a.pos.x, a.pos.z);
              if (!a.swimming && !a.hop && (a.pos.y > sfn + 0.05 || d < 0.5 * H(a))) { done = true; if (lastWay === 'swim') lastWay = 'wade'; break; }
            }
            if (done) { times.push(t); how[lastWay] = (how[lastWay] ?? 0) + 1; }
            else { times.push(Infinity); if (stuckAt.length < 6) stuckAt.push([+x.toFixed(1), +z.toFixed(1), +a.pos.x.toFixed(1), +a.pos.z.toFixed(1)]); }
            A.remove(a);
            if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0));
          }
          out.drop[id] = { times: times.map((v) => (Number.isFinite(v) ? +v.toFixed(2) : -1)), how, stuckAt };
        }
      }
      if (shots) window.__fw = { preset };
      return out;
    }, { preset, run, seconds, drops, cap, parts, species, shots });
    if (res.error) { console.log('FW', tag, preset, run, res.error); continue; }
    const brief = { preset, run };
    if (res.swim) brief.swim = Object.fromEntries(Object.entries(res.swim).map(([k, r]) => [k, `${r.swim}%/${r.deep}%`]));
    if (res.drop) brief.drop = Object.fromEntries(Object.entries(res.drop).map(([k, r]) => [k, r.none ? 'none' : `${q(r.times, 0.5)}s p95 ${q(r.times, 0.95)}s trapped ${r.times.filter((v) => v < 0).length}`]));
    console.log(`FW ${tag}`, JSON.stringify(brief));
    for (const [k, r] of Object.entries(res.swim ?? {})) {
      const g = ((agg[k] ??= {}).swim ??= {});
      (g[preset] ??= []).push(r.swim);
      ((agg[k].deep ??= {})[preset] ??= []).push(r.deep);
      for (const [e, c] of Object.entries(r.entries)) (agg[k].entries ??= {})[e] = (agg[k].entries[e] ?? 0) + c;
    }
    for (const [k, r] of Object.entries(res.drop ?? {})) {
      if (r.none) continue;
      const g = ((agg[k] ??= {}).drop ??= {});
      (g[preset] ??= []).push(...r.times);
      for (const [e, c] of Object.entries(r.how)) (agg[k].how ??= {})[e] = (agg[k].how[e] ?? 0) + c;
      if (r.stuckAt.length) ((agg[k].stuck ??= {})[preset] ??= []).push(...r.stuckAt);
    }
  }
  console.log(`\nFROG-WATER ${tag}: swim % of the time per preset (mean of runs [each run]); deep = standing in water over half its body`);
  for (const [k, r] of Object.entries(agg)) {
    if (r.swim) {
      const cols = Object.entries(r.swim).map(([p, v]) => `${p} ${mean(v).toFixed(1)}${v.length > 1 ? ` [${v.map((x) => x.toFixed(1)).join(' ')}]` : ''}`);
      const worst = Math.max(...Object.values(r.swim).map(mean)), deepW = Math.max(...Object.values(r.deep).map(mean));
      console.log(`  ${k.padEnd(10)} worst ${worst.toFixed(1)}%  deep worst ${deepW.toFixed(1)}%  | ${cols.join(' | ')}`);
      console.log(`  ${''.padEnd(10)} got in after: ${JSON.stringify(r.entries ?? {})}`);
    }
  }
  console.log(`\nFROG-WATER ${tag}: forced drops into deep water, seconds to get out (median / p95 / max, >30 s, trapped of n)`);
  for (const [k, r] of Object.entries(agg)) {
    if (!r.drop) continue;
    const all = Object.values(r.drop).flat();
    const line = (v) => `${q(v, 0.5)} / ${q(v, 0.95)} / ${q(v, 1)}  >30s ${v.filter((x) => x < 0 || x > 30).length}  trapped ${v.filter((x) => x < 0).length} of ${v.length}`;
    console.log(`  ${k.padEnd(10)} ALL ${line(all)}   ways out ${JSON.stringify(r.how ?? {})}`);
    for (const [p, v] of Object.entries(r.drop)) console.log(`  ${''.padEnd(10)} ${p.padEnd(11)} ${line(v)}`);
    if (r.stuck) console.log(`  ${''.padEnd(10)} trapped at (drop x,z → where it was): ${JSON.stringify(r.stuck)}`);
  }
  const errs = await page.evaluate(() => window.__errs?.slice(0, 5) ?? []);
  if (errs.length) console.log('errors', JSON.stringify(errs));
};
function mean(v) { return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length); }
// quantile of exit times, a trapped frog (-1) counting as never out
function q(v, f) {
  const s = v.map((x) => (x < 0 ? Infinity : x)).sort((a, b) => a - b);
  if (!s.length) return '-';
  const x = s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 1e-9))];
  return Number.isFinite(x) ? +x.toFixed(1) : 'never';
}
