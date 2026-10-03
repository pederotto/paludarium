// Reed frogs' perches (2026-10) in the reed-pool preset with bamboo poles and floating logs added: what perchSpot offers,
// the phases each frog goes through, where they sit (plants, wood, bamboo, a floating log, the glass) and why they leave.
// Each of the four frogs is given a different habit (Animals.perchSpot `perchLike`) so every kind of perch gets tried.
//   node tools/shot.mjs --url=http://localhost:4310/ --only=desktop --steps=tools/steps/perch.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const res = await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const game = window.game;
    const w = await game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'reedpool', seed: 3, tier: 'standard' });
    const A = w.animals, E = w.env;
    E.minute = Math.floor(E.minute / 1440) * 1440 + 9 * 60;
    let r = 5;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    const { TANK } = await import('/src/sim/tank.js');
    for (const [type, n] of [['bamboopole', 3], ['floatlog', 2]]) for (let i = 0; i < n; i++) for (let k = 0; k < 80; k++) {
      const x = (rnd() - 0.5) * (TANK.w - 14), z = (rnd() - 0.5) * (TANK.d - 14), wet = w.water.surfaceAt(x, z) > w.terrain.heightAt(x, z);
      if ((type === 'floatlog') !== wet) continue;
      if (w.decor.addPiece(type, x, z, { vary: true })) break;
    }
    w.groundChanged?.();
    A.syncOccupancy(true);
    const frogs = A.by.reedfrog;
    const sits = {};
    frogs.forEach((a, i) => { a.perchLike = ['plant', 'piece', 'glass', 'piece'][i % 4]; });
    const offers = frogs.map((a) => { const t = A.perchSpot(a); return t ? { kind: t.glassN ? 'glass' : t.piece ? t.piece.type : t.plant?.id, y: +t.p.y.toFixed(1), base: !!t.base } : null; });
    const phases = {}, ends = {};
    for (let tick = 0; tick < 3000; tick++) {
      w.sim.step(1); A.move(0.2);
      for (const a of frogs) a.hunger = Math.min(a.hunger, 0.3);
      for (const a of frogs) if (a.perch?.ph === 'sit' && tick % 10 === 0) { const k = a.perch.glassN ? 'glass' : a.perch.piece ? a.perch.piece.type : 'plant:' + a.perch.plant?.id; sits[k] = (sits[k] ?? 0) + 1; }
      for (const a of frogs) if (a.perch?.left && !a.perch._seen) { a.perch._seen = 1; const k = (a.perch.glassN ? 'glass' : a.perch.piece ? 'piece' : 'plant') + ':' + a.perch.left; sits['left ' + k] = (sits['left ' + k] ?? 0) + 1; }
      for (const a of frogs) {
        const k = a.perch ? a.perch.ph + ':' + (a.perch.glassN ? 'glass' : a.perch.piece ? a.perch.piece.type : 'plant') : a.swimming ? 'swim' : 'ground';
        phases[k] = (phases[k] ?? 0) + 1;
      }
    }
    return { sits, n: frogs.length, hunger: frogs.map((a) => +a.hunger.toFixed(2)), bright: E.bright(), offers, phases, plants: w.plants.list.length, pieces: w.decor.pieces.map((p) => p.type) };
  });
  console.log(JSON.stringify(res, null, 1));
};
