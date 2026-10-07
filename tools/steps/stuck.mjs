// Stuck-animal test. Fills a tank with generated scenery plus extra roots, wood, boulders and floating
// pieces, adds animals of every movement kind, then runs 3 simulated days at 20x speed (one sim step and
// one animals.move(0.2) per simulated 10 minutes x10, as the frame loop does at 20x) and reports:
//   maxStillS  the longest an animal stayed nearly still (< 0.3 cm in 6 s windows) while hungry and wanting to move
//   inSolid    the most animals found inside a solid cell (a piece, the ground, or fish out of the water) after any tick
// Runs the scene twice: with the occupancy steering and unstick logic off (baseline) and on.
//   node tools/shot.mjs --only=desktop --steps=tools/steps/stuck.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  if (process.env.STUCK_ONLY) await page.evaluate((o) => { window.__only = [o === 'on']; }, process.env.STUCK_ONLY);
  if (process.env.STUCK_SCENE) await page.evaluate((o) => { window.__scene = o; }, process.env.STUCK_SCENE);
  const res = await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const { SPECIES } = await import('/src/sim/animals.js');
    const out = [];
    const scenes = [['blackwater', 'standard', 11], ['suriname', 'standard', 5], ['swamp', 'nano', 3]].filter((x) => !window.__scene || x[0] === window.__scene);
    for (const avoid of (window.__only ?? [false, true])) {
      for (const [preset, tier, seed] of scenes) {
        const game = window.game;
        const w = await game.loadTank(tier, { layout: 'empty' });
        gen.generateTerrarium(w, { preset, seed, tier });
        // Extra clutter, some of it floating over the water or hanging as an overhang.
        let s = seed * 7919 + 13;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        const T = w.terrain;
        const kinds = [['roots', 10], ['wood', 8], ['boulder', 5], ['stump', 2], ['spire', 2]];
        for (const [type, n] of kinds) for (let i = 0; i < n; i++) {
          const x = (rnd() - 0.5) * (TANK.w - 14), z = (rnd() - 0.5) * (TANK.d - 14);
          const opt = { rot: rnd() * 6.28 };
          if ((type === 'roots' || type === 'wood') && rnd() < 0.4) opt.y = Math.max(T.heightAt(x, z), w.water.level - 2) + 1 + rnd() * 8;
          w.decor.addPiece(type, x, z, opt);
        }
        const A = w.animals;
        A.avoid = avoid;
        A.syncOccupancy(true);
        const mix = { neon: 10, cardinal: 6, cory: 5, loach: 3, guppy: 4, shrimp: 8, snail: 6, crab: 2, isopod: 8, springtail: 8, dartfrog: 3, toad: 2, newt: 2, axolotl: 1, fly: 5 };
        for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
        for (const [id, n] of Object.entries(mix)) {
          for (let i = 0; i < n; i++) {
            for (let k = 0; k < 80; k++) {
              const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
              const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
              if (r.pos) { A.add(id, r.pos); break; }
            }
          }
        }
        const all = () => Object.values(A.by).flat();
        const n0 = all().length;
        const track = new Map();
        let maxStill = 0, worstSp = '', maxInside = 0, insideTicks = 0, worstKind = '', insideGame = 0; const insideGameBy = {};
        const FISH = ['neon', 'cardinal', 'cory', 'loach', 'guppy'];
        const inside = (a) => {
          if (a.onWall || a.hop || a.stranded) return false;
          const g = T.heightAt(a.pos.x, a.pos.z);
          const fish = FISH.includes(a.sp);
          if (A.occ.solidAt(a.pos.x, a.pos.y + (fish || a.swimming ? 0 : 0.5), a.pos.z)) return true;      // (fruit flies walk now: tested like any walker)
          if (fish) {
            const top = A.waterTop(a.pos.x, a.pos.z);
            if (a.pos.y < g + 0.2 || a.pos.y > top + 0.05 || !(top > -Infinity)) return true;
          } else if (a.pos.y < g - 0.35) return true;
          return false;
        };
        const firstInside = [];
        const t0 = performance.now();
        for (let day = 0; day < 3; day++) {
          for (let h = 0; h < 24; h++) {
            for (let k = 0; k < 6; k++) {
              w.sim.step(10);
              for (let j = 0; j < 10; j++) {
                A.move(0.2);
                let bad = 0;
                for (const a of all()) {
                  { const sk = SPECIES[a.sp]; if (sk && A.insideSolid(a, sk)) { insideGame++; insideGameBy[a.sp] = (insideGameBy[a.sp] ?? 0) + 1; } }
                  if (inside(a)) { bad++; worstKind = a.sp; if (firstInside.length < 3) firstInside.push({ sp: a.sp, pos: a.pos.toArray().map((v) => +v.toFixed(1)), st: a.state, g: +T.heightAt(a.pos.x, a.pos.z).toFixed(1), swim: !!a.swimming, top: A.waterTop(a.pos.x, a.pos.z), lvl: w.water.level, solid: A.occ.solidAt(a.pos.x, a.pos.y, a.pos.z), guard: A.insideSolid(a, SPECIES[a.sp]), by: +A.bodyY(a, SPECIES[a.sp]).toFixed(2), tick: +A.t.toFixed(1) }); }
                  // Own still-time tracker, independent of the game's detector.
                  const hungry = a.hunger > 0.25;
                  let tr = track.get(a);
                  if (!hungry || !A.wantsMove(a)) { if (tr) tr.t = 0; continue; }
                  if (!tr) { tr = { p: a.pos.clone(), t: 0 }; track.set(a, tr); }
                  if (a.pos.distanceTo(tr.p) > 0.3) { tr.p.copy(a.pos); tr.t = 0; } else tr.t += 0.2;
                  if (tr.t > maxStill) { maxStill = tr.t; worstSp = a.sp; }
                }
                if (bad) insideTicks++;
                maxInside = Math.max(maxInside, bad);
              }
            }
            // Keep everyone hungry and alive, so they keep looking for food.
            for (const a of all()) { a.hunger = Math.max(a.hunger, 0.4); a.health = Math.max(a.health, 0.9); }
            if (h % 6 === 0) A.feed();
            if (h % 4 === 0) await new Promise((r) => setTimeout(r, 0));
          }
        }
        out.push({ firstInside, avoid, preset, tier, pieces: w.decor.pieces.length, solidCells: A.occ.count, animals: n0, alive: all().length, maxStillS: +maxStill.toFixed(1), worst: worstSp, maxInside, insideTicks, worstKind, insideGame, insideGameBy, stats: { ...A.stuckStats, worst: +A.stuckStats.worst.toFixed(1) }, sec: Math.round((performance.now() - t0) / 1000) });
      }
    }
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
  const on = res.filter((r) => r.avoid);
  const ok = on.every((r) => r.maxInside === 0 && r.maxStillS <= 8);
  console.log(ok ? 'STUCK TEST PASS' : 'STUCK TEST FAIL', 'errors', JSON.stringify(await page.evaluate(() => window.__errs?.slice(0, 5) ?? [])));
};
