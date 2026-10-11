// Replay check: the same tank from the same seed must come out exactly the same. Builds the stuck test's cluttered tank, freezes the
// game loop (only this probe steps the world), waits for every creature model and background job, seeds the simulation's stream
// (util/rng.js seedRng(seed, true): replay clock on), places the cast and runs HOURS game hours (a sim step of 10 game minutes and ten
// animals.move(0.2) per step, as at 20x). Every 50 moves it takes a fingerprint of every animal's position, heading and mind mode, and
// keeps the event timeline (relocations, goals given up). Then it does it all again and compares: REPLAY OK, or the first tick and
// animal where the two runs part. RUNS=2 (default), SEED=777, HOURS=6, SCENE=blackwater|suriname|swamp.
//   node tools/shot.mjs --only=desktop --url=http://localhost:<port>/ --steps=tools/steps/replay.mjs
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(1800000);
  const res = await page.evaluate(async ([RUNS, SEED, HOURS, SCENE, FINE, FOCUS]) => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const { seedRng, rngState } = await import('/src/util/rng.js');
    const [preset, tier, seed] = { blackwater: ['blackwater', 'standard', 11], suriname: ['suriname', 'standard', 5], swamp: ['swamp', 'nano', 3] }[SCENE];
    const mix = { neon: 6, guppy: 3, shrimp: 6, snail: 4, isopod: 6, springtail: 6, crab: 3, dartfrog: 3, toad: 2, newt: 3, axolotl: 1, skink: 3, gecko: 3, fly: 4 };
    const game = window.game;
    // (no frames during a replay: erosion, plant sway, plumbing and jets update in the frame loop, outside the simulation step and its
    // seeded stream, so frames between building the tank and the end of a run would make two runs start from different ground and stems)
    const frame0 = game.frame; game.frame = () => {};
    const build = async () => {
      const w = await game.loadTank(tier, { layout: 'empty' });
      game.frozen = true;
      seedRng(SEED, true);                                   // (the tank itself is part of the replay: the generator and the decor draw from it)
      gen.generateTerrarium(w, { preset, seed, tier });
      let s = seed * 7919 + 13; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const T = w.terrain;
      for (const [type, n] of [['roots', 10], ['wood', 8], ['boulder', 5], ['stump', 2], ['spire', 2]]) for (let i = 0; i < n; i++) { const x = (rnd() - 0.5) * (TANK.w - 14), z = (rnd() - 0.5) * (TANK.d - 14); const opt = { rot: rnd() * 6.28, seed: i }; if ((type === 'roots' || type === 'wood') && rnd() < 0.4) opt.y = Math.max(T.heightAt(x, z), w.water.level - 2) + 1 + rnd() * 8; w.decor.addPiece(type, x, z, opt); }
      game.worldRoot?.updateMatrixWorld?.(true);                // (the pieces' world matrices: a frame would refresh them, and frames are off)
      const A = w.animals; A.avoid = true; A.syncOccupancy(true);
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      return { w, A, rnd };
    };
    const place = (A, rnd) => { for (const [id, n] of Object.entries(mix)) for (let i = 0; i < n; i++) for (let k = 0; k < 80; k++) { const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8); const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' }); if (r.pos) { A.add(id, r.pos); break; } } };
    // Warm-up: every creature model loaded once (a body is measured from its mesh when it arrives: a run must not see it arrive midway).
    { const { A, rnd } = await build(); place(A, rnd); for (let k = 0; k < 600 && (A.modelsLoading ?? 0) > 0; k++) await new Promise((r) => setTimeout(r, 100)); }
    const one = async () => {
      const { w, A, rnd } = await build();
      seedRng(SEED, true);
      w.animals.t = 0;
      const placed = { rngBefore: rngState() }; place(A, rnd); placed.rngAfter = rngState();
      placed.pos = Object.values(A.by).flat().map((a) => `${a.sp}:${a.pos.x.toFixed(6)},${a.pos.z.toFixed(6)}`).join('|');
      // (every body measured from its own model before the first move: a model that arrives midway changes the body's size, and it arrives
      // at a different moment in every run; frames are off, so the wait changes nothing else)
      A.draw();                                                  // (meshes are made when drawn: one draw here, the same moment in every run)
      game.worldRoot?.updateMatrixWorld?.(true);
      const ids = Object.keys(A.by).filter((id) => A.by[id].length);
      const missing = () => ids.filter((id) => !A.bodyOf(id));
      for (let k = 0; k < 300 && ((A.modelsLoading ?? 0) > 0 || missing().length || k < 3); k++) await new Promise((r) => setTimeout(r, 50));
      const noBody = missing(), parented = !!A.scene?.parent;
      // The world at the start, part by part: which part differs between two runs is where a replay leaks.
      const h32 = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
      const T = w.terrain, terr = []; for (let x = -TANK.w / 2; x <= TANK.w / 2; x += 1.5) for (let z = -TANK.d / 2; z <= TANK.d / 2; z += 1.5) terr.push(T.heightAt(x, z).toFixed(5));
      const occCells = A.occ?.count ?? 0, occKeys = A.occ?.cells ? h32([...(A.occ.cells.keys?.() ?? [])].join(',')) : null;
      const world0 = {
        terrain: h32(terr.join(',')), water: w.water.level, occCount: occCells, occKeys, occVersion: A.occ?.version,
        plants: h32((w.plants?.list ?? []).map((p) => `${p.type ?? p.id}:${(p.pos?.x ?? p.x)?.toFixed?.(4)},${(p.pos?.z ?? p.z)?.toFixed?.(4)}`).join('|')),
        pieces: h32(w.decor.pieces.map((p) => `${p.type}:${p.mesh?.matrixWorld?.elements?.map((e) => e.toFixed(4)).join(',') ?? ''}`).join('|')),
        animals: h32(Object.values(A.by).flat().map((a) => `${a.sp}:${a.pos.x.toFixed(6)},${a.pos.y.toFixed(6)},${a.pos.z.toFixed(6)},${(a.yaw ?? 0).toFixed(6)},${a.rad},${a.phase}`).join('|')),
        rng: rngState(), t: A.t, env: JSON.stringify({ m: w.env?.minute, temp: w.env?.temp, rh: w.env?.humidity }),
      };
      const all = () => Object.values(A.by).flat();
      const fp = [], ev = [], fine = [], dump = [];
      const reloc0 = Object.getPrototypeOf(A).relocate;
      A.relocate = function (a, ...r) { ev.push(['reloc', +A.t.toFixed(2), a.sp, all().indexOf(a)]); return reloc0.call(this, a, ...r); };
      let moves = 0;
      for (let h = 0; h < HOURS; h++) for (let k = 0; k < 6; k++) {
        w.sim.step(10);
        for (let j = 0; j < 10; j++) {
          const rb = rngState();
          A.move(0.2); moves++;
          if (FINE && moves <= 3) dump.push(all().filter((a) => a.sp === FOCUS).map((a) => JSON.stringify({ m: moves, pos: [a.pos.x, a.pos.y, a.pos.z], yaw: a.yaw, mind: a.mind && Object.fromEntries(Object.entries(a.mind).filter(([k, v]) => typeof v !== 'function')), out: a.ci ?? a.hit ?? a.si, hh: a.hh, sw: a.swimming, hsp: a.hsp, why: a.abortWhy, relT: a.relocT, home: a.home, target: a.target, rad: a.rad, bh: a.bh, cap: a.cap, sp: a.speedNow, tf: A.tf }, (k, v) => typeof v === 'number' ? +v.toFixed(6) : v)));
          if (FINE && moves <= 60) fine.push({ m: moves, rb, ra: rngState(), p: all().map((a) => `${a.sp}:${a.pos.x.toFixed(6)},${a.pos.z.toFixed(6)},${(a.yaw ?? 0).toFixed(5)}`) });
          for (const a of all()) if (a.abortT === A.t) ev.push(['abort', +A.t.toFixed(2), a.sp, all().indexOf(a), a.abortWhy]);
          if (moves % 50 === 0) fp.push({ t: +A.t.toFixed(2), rng: rngState(), a: all().map((a) => `${a.sp}:${a.pos.x.toFixed(6)},${a.pos.y.toFixed(6)},${a.pos.z.toFixed(6)},${(a.yaw ?? 0).toFixed(6)},${a.mind?.mode ?? a.state ?? ''}`) });
        }
      }
      A.relocate = reloc0;
      return { fp, ev, n: all().length, moves, fine, placed, dump, noBody, parented, world0 };
    };
    const runs = [];
    for (let r = 0; r < RUNS; r++) runs.push(await one());
    game.frozen = false; game.frame = frame0;
    const [a, b] = runs;
    let diverge = null;
    for (let i = 0; i < Math.min(a.fp.length, b.fp.length) && !diverge; i++) {
      if (a.fp[i].rng !== b.fp[i].rng && !diverge) diverge = { at: a.fp[i].t, what: 'random stream', ra: a.fp[i].rng, rb: b.fp[i].rng };
      const k = a.fp[i].a.findIndex((x, j) => x !== b.fp[i].a[j]);
      if (k >= 0) diverge = { at: a.fp[i].t, what: 'animal', idx: k, a: a.fp[i].a[k], b: b.fp[i].a[k], rngSame: a.fp[i].rng === b.fp[i].rng };
    }
    const evSame = JSON.stringify(a.ev) === JSON.stringify(b.ev);
    let fineDiff = null;
    if (FINE) {
      if (a.placed.rngBefore !== b.placed.rngBefore || a.placed.rngAfter !== b.placed.rngAfter || a.placed.pos !== b.placed.pos) fineDiff = { at: 'placement', a: [a.placed.rngBefore, a.placed.rngAfter], b: [b.placed.rngBefore, b.placed.rngAfter], posSame: a.placed.pos === b.placed.pos };
      for (let i = 0; i < Math.min(a.fine.length, b.fine.length) && !fineDiff; i++) {
        const x = a.fine[i], y = b.fine[i];
        if (x.rb !== y.rb) fineDiff = { at: x.m, what: 'stream before the move (drawn outside the simulation)' };
        else { const k = x.p.findIndex((q, j) => q !== y.p[j]); if (k >= 0) fineDiff = { at: x.m, what: 'position', idx: k, a: x.p[k], b: y.p[k], rngAfterSame: x.ra === y.ra }; else if (x.ra !== y.ra) fineDiff = { at: x.m, what: 'stream after the move' }; }
      }
    }
    let dumpDiff = null;
    if (FINE) for (let i = 0; i < a.dump.length && !dumpDiff; i++) for (let j = 0; j < a.dump[i].length && !dumpDiff; j++) if (a.dump[i][j] !== b.dump[i][j]) {
      const x = JSON.parse(a.dump[i][j]), y = JSON.parse(b.dump[i][j]), keys = [];
      const walk = (p, u, v) => { if (JSON.stringify(u) === JSON.stringify(v)) return; if (u && v && typeof u === 'object' && typeof v === 'object') { for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) walk(p + '.' + k, u[k], v[k]); } else keys.push([p, u, v]); };
      walk('', x, y); dumpDiff = { move: x.m, animal: j, keys: keys.slice(0, 14) };
    }
    const worldDiff = Object.keys(a.world0).filter((k) => a.world0[k] !== b.world0[k]).map((k) => [k, a.world0[k], b.world0[k]]);
    const hash = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); };
    const runHash = hash(JSON.stringify(a.fp) + JSON.stringify(a.ev));
    return { runHash, worldDiff, bodies: [a.noBody, b.noBody, a.parented, b.parented], dumpDiff, fineDiff, scene: SCENE, seed: SEED, animals: a.n, moves: a.moves, prints: a.fp.length, events: a.ev.length, eventsB: b.ev.length, evSame, diverge, ok: !diverge && evSame && a.fp.length === b.fp.length };
  }, [+(process.env.RUNS ?? 2), +(process.env.SEED ?? 777), +(process.env.HOURS ?? 6), process.env.SCENE ?? 'blackwater', process.env.FINE === '1', process.env.FOCUS ?? 'crab']);
  console.log((res.ok ? 'REPLAY OK ' : 'REPLAY DIFFERS ') + JSON.stringify(res));
};
