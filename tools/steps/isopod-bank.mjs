// Panda king isopods at the water's edge (2026-10): they walk, tumble in where the bank is steep, and climb out by a slope
// or a ramp. Puts them on land by water in a generated tank, runs game hours, and counts falls, climbs out and drownings.
//   node tools/shot.mjs --url=http://localhost:4310/ --only=desktop --steps=tools/steps/isopod-bank.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const res = await page.evaluate(async ({ preset, hours }) => {
    const gen = await import('/src/sim/generator.js');
    const w = await window.game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset, seed: 4, tier: 'standard' });
    const A = w.animals;
    A.syncOccupancy(true);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    let placed = 0;
    for (let k = 0; k < 4000 && placed < 30; k++) {
      const p = w.randomSpot((x, y, z, s) => s === -Infinity && w.nearWater({ x, y, z }, 3));
      if (p && A.add('pandaking', p)) placed++;
    }
    let falls = 0, out = 0;
    const causes = {};
    const rm = A.remove.bind(A);
    A.remove = (a, cause) => { if (a.sp === 'pandaking') causes[cause] = (causes[cause] ?? 0) + 1; return rm(a, cause); };
    const was = new Map();
    for (let t = 0; t < hours * 60; t++) {
      w.sim.step(1);
      for (let k = 0; k < 4; k++) A.move(0.2);
      for (const a of A.by.pandaking) { const s = !!a.sunk; if (s && !was.get(a)) falls++; if (!s && was.get(a)) out++; was.set(a, s); }
    }
    const drowned = placed - A.by.pandaking.length;
    A.remove = rm;
    return { causes, preset, placed, alive: A.by.pandaking.length, falls, climbedOut: out, drowned, stillIn: A.by.pandaking.filter((a) => a.sunk).length };
  }, { preset: process.env.PRESET ?? 'reedpool', hours: +(process.env.HOURS ?? 24) });
  console.log(JSON.stringify(res));
};
