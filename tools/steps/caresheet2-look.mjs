// Pictures for the second care-sheet pass: a reed frog on the glass and on a bamboo pole or log, the false bottom through the
// glass, the corner foam filter, the feeders on the ground.
//   node tools/shot.mjs --url=http://localhost:4310/ --only=desktop --steps=tools/steps/caresheet2-look.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const { Care } = await import('/src/app/actions.js');
    const g = window.game, w = await g.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'reedpool', seed: 3, tier: 'standard' });
    const A = w.animals, E = w.env;
    E.minute = Math.floor(E.minute / 1440) * 1440 + 8 * 60;
    E.filterKind = 'matten'; E.drainage = 1; E.plenumH = Math.round(w.water.level + 1); E.substrate = 'abg';
    let r = 5;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const [type, n] of [['bamboopole', 3], ['floatlog', 2]]) for (let i = 0; i < n; i++) for (let k = 0; k < 80; k++) {
      const x = (rnd() - 0.5) * (TANK.w - 14), z = (rnd() - 0.5) * (TANK.d - 14), wet = w.water.surfaceAt(x, z) > w.terrain.heightAt(x, z);
      if ((type === 'floatlog') !== wet) continue;
      if (w.decor.addPiece(type, x, z, { vary: true })) break;
    }
    w.groundChanged?.();
    A.syncOccupancy(true);
    const frogs = A.by.reedfrog;
    frogs.forEach((a, i) => { a.perchLike = ['glass', 'piece', 'glass', 'piece'][i % 4]; });
    for (let t = 0; t < 240; t++) { for (const a of frogs) a.hunger = Math.min(a.hunger, 0.25); w.sim.step(1); A.move(0.2); }
    Care.feeders(g, 'cricket'); Care.feeders(g, 'dubia'); Care.feeders(g, 'waxworm');
    for (let t = 0; t < 30; t++) { for (const a of frogs) a.hunger = Math.min(a.hunger, 0.25); w.sim.step(1); A.move(0.2); }
    g.setSpeed(0);
    window.__cam = (p) => { g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, false); };
  });
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const look = async (label, fn, arg) => { const ok = await page.evaluate(fn, arg); await page.waitForTimeout(2000); if (ok !== false) await shot(label); else console.log('no', label); };
  await look('frog-glass', () => { const a = window.game.world.animals.by.reedfrog.find((b) => b.perch?.ph === 'sit' && b.perch.glassN); if (!a) return false; const p = a.pos, n = a.perch.glassN; window.__cam([p.x - n.x * 14 + 2, p.y + 2, p.z - n.z * 14, p.x, p.y, p.z]); });
  await look('frog-piece', () => { const a = window.game.world.animals.by.reedfrog.find((b) => b.perch?.ph === 'sit' && b.perch.piece); if (!a) return false; const p = a.pos; window.__cam([p.x + 3, p.y + 4, p.z + 10, p.x, p.y, p.z]); });
  await look('false-bottom', () => window.__cam([-15, 3, 36, -15, 2.5, 22]));
  await look('corner-filter', () => { const w = window.game.world, T = (w.water.level); window.__cam([0, T + 14, 40, 0, T - 2, -12]); });
  await look('feeders', () => { const A = window.game.world.animals; const a = A.by.dubia[0] ?? A.by.cricket[0]; if (!a) return false; const p = a.pos; window.__cam([p.x + 2, p.y + 5, p.z + 8, p.x, p.y, p.z]); });
};
