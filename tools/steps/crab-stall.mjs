// Panther crabs in a generated tank: where do they stand still, how near the back wall, in which mode (the "stuck near the back" report of 9 Oct).
//   N=6 PRESET=matano SEED=5 SECS=300 node tools/shot.mjs --only=desktop --url=http://127.0.0.1:<dev port>/ --steps=tools/steps/crab-stall.mjs --out=test-output/crabstall
// Prints per crab: worstStill (the longest it stood within 0.5 cm, s), nearBackStill (the same within 8 cm of the back wall), its modes (samples), and the
// first stall events with what its mind was doing (mode, goal, burst, home). Needs the dev server (it imports /src/sim). Compare builds at the same load.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  const res = await page.evaluate(async (opt) => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const game = window.game;
    const w = await game.loadTank(opt.tier, { layout: 'empty' });
    gen.generateTerrarium(w, { preset: opt.preset, seed: opt.seed, tier: opt.tier });
    const A = w.animals;
    A.syncOccupancy?.(true);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    let s = opt.seed * 7919 + 13; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const made = [];
    for (let i = 0; i < opt.n; i++) for (let k = 0; k < 120; k++) {
      const x = (rnd() - 0.5) * (TANK.w - 12), z = (rnd() - 0.5) * (TANK.d - 12);
      const r = A.placement('panther', { point: { x, y: 0, z }, surface: 'ground' });
      if (r.pos) { made.push(A.add('panther', r.pos)); break; }
    }
    await new Promise((r) => setTimeout(r, 1500));
    const crabs = Object.values(A.by).flat().filter((a) => a.sp === 'panther');
    const T = w.terrain, Wl = w.wall;
    const trk = crabs.map((a) => ({ id: a.id, pts: [], modes: {}, worst: 0, nearStill: 0, still: 0, last: null, ev: [] }));
    const dt = 0.2, total = opt.secs;
    for (let t = 0; t < total; t += dt) {
      if (Math.round(t / dt) % 25 === 0) w.sim.step(2);
      A.move(dt);
      crabs.forEach((a, i) => {
        const k = trk[i], p = a.pos, back = p.z - Wl.zAt(p.x, T.heightAt(p.x, p.z) + 1);
        const md = a.cb?.mode ?? '?'; k.modes[md] = (k.modes[md] ?? 0) + 1;
        if (!k.last) k.last = { x: p.x, z: p.z, t };
        if (Math.hypot(p.x - k.last.x, p.z - k.last.z) > 0.5) { k.last = { x: p.x, z: p.z, t }; k.still = 0; } else { k.still += dt; k.worst = Math.max(k.worst, k.still); if (back < 8) k.nearStill = Math.max(k.nearStill, k.still); }
        if (k.still > 5 && back < 10 && k.ev.length < 6 && Math.round(t / dt) % 10 === 0) { const ci = a.ci ?? {}; k.ev.push({ t: +t.toFixed(1), still: +k.still.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(1), back: +back.toFixed(1), yaw: +(a.yaw ?? 0).toFixed(2), mode: md, goal: ci.goal ? [+ci.goal.x.toFixed(1), +ci.goal.z.toFixed(1)] : null, speed: ci.speed, calm: ci.calm, blockedN: a.blockedN, stuckLevel: a.stuckLevel, lead: a.cb?.lead, burst: a.cb?.burst, pauseT: +(a.cb?.pauseT ?? 0).toFixed(1), bank: a.cbBank ? [+a.cbBank.x.toFixed(1), +a.cbBank.z.toFixed(1)] : null, home: a.home ? [+a.home.x.toFixed(1), +a.home.z.toFixed(1)] : null, face: ci.face ? 1 : 0 }); }
        if (Math.round(t / dt) % 25 === 0) k.pts.push([+t.toFixed(0), +p.x.toFixed(1), +p.z.toFixed(1), +back.toFixed(1), md, a.state, a.cb?.mode === 'flee' ? 1 : 0]);
      });
    }
    return { n: crabs.length, trk: trk.map((k) => ({ id: k.id, worstStill: +k.worst.toFixed(1), nearBackStill: +k.nearStill.toFixed(1), modes: k.modes, ev: k.ev, pts: k.pts.slice(0, 40).map((p) => p.join(',')).join(' | ') })) };
  }, { preset: process.env.PRESET ?? 'matano', tier: process.env.TIER ?? 'standard', seed: +(process.env.SEED ?? 3), n: +(process.env.N ?? 3), secs: +(process.env.SECS ?? 120) });
  console.log(JSON.stringify(res, null, 1));
};
