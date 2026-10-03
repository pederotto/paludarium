// Crowding test. Fills a generated tank with many frogs, toads, fish, shrimp, crawlers, flies, newts and geckos,
// runs 2 simulated days at 20x (per frame: sim.step(1) and animals.move(0.2), as the game loop does) and reports:
//   overlapPairs  pairs of animals of the same medium that overlapped by more than 50% of their body size for
//                 more than 3 s of animal time (should be about 0)
//   inSolid       most animals found inside a piece, the ground or (fish) out of the water after any tick
//   beyondGlass   most animals found beyond the glass (x, z, floor or lid) after any tick
//   behindWall    most non-wall animals found behind the background relief
//   node tools/shot.mjs --only=desktop --steps=tools/steps/crowding.mjs --wait=2500
//   CROWD_DAYS=2 CROWD_AVOID=0|1  (avoid 0 = baseline without separation)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  const days = +(process.env.CROWD_DAYS ?? 2);
  const avoidList = (process.env.CROWD_AVOID ?? '1').split(',').map((v) => v === '1');
  const res = await page.evaluate(async ({ days, avoidList }) => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const { SPECIES } = await import('/src/sim/animals.js');
    const out = [];
    for (const avoid of avoidList) {
      const game = window.game;
      const w = await game.loadTank('standard', { layout: 'empty' });
      gen.generateTerrarium(w, { preset: 'suriname', seed: 5, tier: 'standard' });
      let s = 777;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const A = w.animals, T = w.terrain;
      A.avoid = avoid;
      A.syncOccupancy(true);
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const mix = { dartfrog: 14, leucomelas: 8, strawberry: 6, toad: 8, newt: 5, firesal: 4, axolotl: 4, gecko: 8, neon: 40, guppy: 20, cory: 10, shrimp: 40, snail: 10, crab: 4, isopod: 30, springtail: 25, fly: 20 };
      for (const [id, n] of Object.entries(mix)) {
        for (let i = 0; i < n; i++) {
          // Clump them: place in a small window so they start crowded.
          const cx = (rnd() - 0.5) * (TANK.w - 20), cz = (rnd() - 0.5) * (TANK.d - 20);
          for (let k = 0; k < 120; k++) {
            const x = cx + (rnd() - 0.5) * 10, z = cz + (rnd() - 0.5) * 10;
            const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
            if (r.pos) { A.add(id, r.pos); break; }
          }
        }
      }
      const all = () => Object.values(A.by).flat();
      const n0 = all().length;
      const FISH = ['neon', 'cardinal', 'cory', 'loach', 'guppy'];
      const inside = (a) => {
        if (a.onWall || a.hop || a.stranded) return false;
        const g = T.heightAt(a.pos.x, a.pos.z);
        const fish = FISH.includes(a.sp);
        if (A.occ.solidAt(a.pos.x, a.pos.y + (fish || a.swimming ? 0 : 0.5), a.pos.z)) return true;      // (fruit flies walk now: tested like any walker)
        if (fish) { const top = A.waterTop(a.pos.x, a.pos.z); return a.pos.y < g + 0.2 || a.pos.y > top + 0.05 || !(top > -Infinity); }
        return a.pos.y < g - 0.35;
      };
      const pairT = new Map(), bad = new Map();
      let maxInside = 0, maxGlass = 0, maxBehind = 0, worstSp = {}, glassSp = {}, behindSp = {}, minRatio = 9;
      const t0 = performance.now();
      const dtA = 0.2, ticks = Math.round(days * 1440);
      for (let tick = 0; tick < ticks; tick++) {
        w.sim.step(1);
        A.move(dtA);
        const list = all();
        let ins = 0, gl = 0, bw = 0;
        const seen = new Set();
        for (let i = 0; i < list.length; i++) {
          const a = list[i], sa = SPECIES[a.sp];
          if (inside(a)) { ins++; worstSp[a.sp] = (worstSp[a.sp] ?? 0) + 1; }
          if (Math.abs(a.pos.x) > TANK.w / 2 + 0.01 || Math.abs(a.pos.z) > TANK.d / 2 + 0.01 || a.pos.y > TANK.h + 0.01 || a.pos.y < -0.01) { gl++; glassSp[a.sp] = (glassSp[a.sp] ?? 0) + 1; }
          if (!a.wallMode && !a.onWall && sa.kind !== 'egg' && a.pos.z < w.wall.zAt(a.pos.x, Math.max(a.pos.y, T.heightAt(a.pos.x, a.pos.z)) + 0.3) - 0.3) { bw++; behindSp[a.sp] = (behindSp[a.sp] ?? 0) + 1; }
          if (!a.grp) continue;
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            if (b.grp !== a.grp) continue;
            let dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
            if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
            if (a.grp === 'wall') dz = 0; else if (a.grp === 'land') { if (Math.abs(dy) > 1.5) continue; dy = 0; }
            const d = Math.hypot(dx, dy, dz), R = a.rad + b.rad;
            if (d < 0.5 * R) {
              const key = a.id * 100000 + b.id;
              seen.add(key);
              const t = (pairT.get(key) ?? 0) + dtA;
              pairT.set(key, t);
              if (t > 3 && !bad.has(key)) bad.set(key, a.sp + '/' + b.sp + '@' + a.grp);
            }
            if (d / R < minRatio) minRatio = d / R;
          }
        }
        for (const k of [...pairT.keys()]) if (!seen.has(k)) pairT.delete(k);
        maxInside = Math.max(maxInside, ins); maxGlass = Math.max(maxGlass, gl); maxBehind = Math.max(maxBehind, bw);
        if (tick % 120 === 0) { for (const a of all()) a.health = Math.max(a.health, 0.8); }
        if (tick % 240 === 0) { A.feed(); await new Promise((r) => setTimeout(r, 0)); }
      }
      out.push({ avoid, animals: n0, alive: all().length, overlapPairs: bad.size, overlapKinds: [...bad.values()].slice(0, 8), minRatio: +minRatio.toFixed(2), inSolid: maxInside, beyondGlass: maxGlass, behindWall: maxBehind, worstSp, glassSp, behindSp, sec: Math.round((performance.now() - t0) / 1000), stuck: { ...A.stuckStats, worst: +A.stuckStats.worst.toFixed(1) } });
    }
    return out;
  }, { days, avoidList });
  for (const r of res) console.log(JSON.stringify(r));
  const on = res.filter((r) => r.avoid);
  console.log(on.every((r) => r.overlapPairs <= 3 && r.inSolid === 0 && r.beyondGlass === 0) ? 'CROWDING PASS' : 'CROWDING CHECK', 'errors', JSON.stringify(await page.evaluate(() => window.__errs?.slice(0, 5) ?? [])));
};
