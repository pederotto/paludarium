// The ground along the front glass of the generated tanks (sim/generator.js sill): per preset and seed, the water level, the
// false bottom's mesh (E.plenumH, fitted on the first steps; '-' without one), and along the front glass: the share of it that
// is land, the share where the ground stands a centimetre or more over the mesh (the build shows through the glass: egg-crate,
// mesh and substrate), the highest and the mean ground there, and a checksum of the whole ground (tanks without a false bottom
// must not change). PRESETS=a,b and SEEDS=1,2 pick them.
//   node tools/shot.mjs --url=http://127.0.0.1:5173/ --only=desktop --steps=tools/steps/front-ground.mjs --wait=2500 --out=<dir>
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const presets = (process.env.PRESETS ?? 'streambank,reedpool,swamp,blackwater,everglades,matano,cascade,suriname,stream,karst,jar').split(',');
  const seeds = (process.env.SEEDS ?? '1,2').split(',').map(Number);
  for (const preset of presets) for (const seed of seeds) {
    const r = await page.evaluate(async ({ preset, seed }) => {
      const gen = await import('/src/sim/generator.js'), { TANK } = await import('/src/sim/tank.js');
      const w = await window.game.loadTank('standard', { layout: 'empty' });
      gen.generateTerrarium(w, { preset, seed, tier: 'standard' });
      for (let t = 0; t < 3; t++) w.sim.step(1);
      window.game.setSpeed(0);
      const T = w.terrain, E = w.env, lv = w.water.level, fb = E.drainage >= 1 ? E.plenumH : null, z = TANK.d / 2 - 0.3;
      let n = 0, land = 0, over = 0, hi = -1, sum = 0;
      for (let x = -TANK.w / 2 + 1; x < TANK.w / 2 - 1; x += 0.5) {
        const h = T.baseAt(x, z); n++; sum += h; hi = Math.max(hi, h);
        if (h > lv + 0.3) land++;
        if (fb != null && h >= fb + 1) over++;
      }
      const f = T.field; let ck = 0; for (let i = 0; i < f.h.length; i += 7) ck += f.base[i] * ((i % 13) + 1);
      return { level: +lv.toFixed(1), mesh: fb, land: +(land / n * 100).toFixed(0), overMesh: fb != null ? +(over / n * 100).toFixed(0) : '-', hi: +hi.toFixed(1), mean: +(sum / n).toFixed(1), ck: Math.round(ck) };
    }, { preset, seed });
    console.log(`front ${preset.padEnd(11)} seed ${seed}: water ${r.level} cm, mesh ${r.mesh ?? '-'} cm, front glass land ${r.land}%, ground >= mesh + 1 cm ${r.overMesh}${r.overMesh === '-' ? '' : '%'}, highest ${r.hi} cm, mean ${r.mean} cm, checksum ${r.ck}`);
    if (r.mesh != null) {
      await page.evaluate(() => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, 22, 95, 0, 8, 0, false); g.world.env.minute = Math.floor(g.world.env.minute / 1440) * 1440 + 11 * 60; });
      await page.addStyleTag({ content: '#ui{display:none!important}' });
      await page.waitForTimeout(2500);
      await shot(`front-${preset}-${seed}`);
    }
  }
};
