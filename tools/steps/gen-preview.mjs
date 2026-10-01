// Generate presets into fresh tanks and screenshot them (front and 3/4 views), optionally after a stability run.
//   GEN_PRESET=cascade GEN_SEED=1 GEN_TIER=standard node tools/shot.mjs --steps=tools/steps/gen-preview.mjs --only=desktop --out=test-output/gen
// Env: GEN_PRESET, GEN_SEED, GEN_TIER, GEN_VIEWS (comma list of rig views, default front,hero),
//      GEN_DAYS (game days to fast-forward before shooting; also reports deaths), GEN_TAG (file name prefix),
//      GEN_LIST="cascade:1:standard,karst:2:nano" to build several in one session (checks the console stays clean).
export default async (page, shot, name) => {
  const list = (process.env.GEN_LIST || `${process.env.GEN_PRESET || 'cascade'}:${process.env.GEN_SEED || 1}:${process.env.GEN_TIER || 'standard'}`)
    .split(',').map((s) => s.split(':'));
  const views = (process.env.GEN_VIEWS || 'front,hero').split(',');
  const days = +(process.env.GEN_DAYS || 0);
  for (const [preset, seedS, tier] of list) {
    const seed = +seedS || 1;
    const tag = process.env.GEN_TAG || `${preset}-${tier}-${seed}`;
    const rep = await page.evaluate(async ({ preset, seed, tier, days }) => {
      document.querySelector('#ui').style.display = 'none';
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      const t0 = performance.now();
      const info = generateTerrarium(w, { preset, seed, tier });
      const gen = Math.round(performance.now() - t0);
      window.game.rig.stopOrbit();
      const deaths = [];
      const rm = w.animals.remove.bind(w.animals);
      w.animals.remove = (a, cause) => { if (cause && !/^eaten|hatched|metamorph|old age/.test(cause)) deaths.push(a.sp + ':' + cause); return rm(a, cause); };
      for (let d = 0; d < days; d++) { w.sim.step(1440); w.animals.move(0.05); }
      w.animals.remove = rm;
      const nan = Object.entries(w.env).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k);
      return { name: info.name, gen, falls: info.falls, pools: info.pools, plants: info.plants, animals: info.animals, litres: info.litres, warnings: info.warnings, deaths, nan };
    }, { preset, seed, tier, days });
    console.log(tag, JSON.stringify(rep));
    for (const v of views) {
      await page.evaluate((v) => { window.game.rig.view(v, false); }, v);
      await page.waitForTimeout(2200);
      await shot(`${tag}-${v}`);
    }
  }
};
