// Generate a preset into a fresh tank and screenshot it from the front and a 3/4 view.
//   GEN_PRESET=cascade GEN_SEED=1 GEN_TIER=standard node tools/shot.mjs --steps=tools/steps/gen-preview.mjs --only=desktop --out=test-output/gen
// Env: GEN_PRESET, GEN_SEED, GEN_TIER, GEN_VIEWS (comma list of rig views, default front,hero), GEN_DAYS (fast-forward days before shooting).
export default async (page, shot, name) => {
  const preset = process.env.GEN_PRESET || 'cascade';
  const seed = +(process.env.GEN_SEED || 1);
  const tier = process.env.GEN_TIER || 'standard';
  const views = (process.env.GEN_VIEWS || 'front,hero').split(',');
  const days = +(process.env.GEN_DAYS || 0);
  const tag = process.env.GEN_TAG || `${preset}-${tier}-${seed}`;
  const rep = await page.evaluate(async ({ preset, seed, tier, days }) => {
    document.querySelector('#ui').style.display = 'none';
    const { generateTerrarium } = await import('/src/sim/generator.js');
    const t0 = performance.now();
    const w = await window.game.loadTank(tier, { layout: 'empty' });
    const t1 = performance.now();
    const info = generateTerrarium(w, { preset, seed, tier });
    const t2 = performance.now();
    window.game.rig.stopOrbit();
    for (let d = 0; d < days; d++) { w.sim.step(1440); w.animals.move(0.05); }
    return { info, load: Math.round(t1 - t0), gen: Math.round(t2 - t1), falls: w.water.falls.length, pools: w.water.pools.length,
      plants: w.plants.list.length, animals: Object.fromEntries(Object.entries(w.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])),
      level: +w.water.level.toFixed(1), litres: +w.water.volumeLitres().toFixed(1), temp: +w.env.temp.toFixed(1), rh: Math.round(w.env.humidity) };
  }, { preset, seed, tier, days });
  console.log(tag, JSON.stringify(rep));
  for (const v of views) {
    await page.evaluate((v) => { window.game.rig.view(v, false); }, v);
    await page.waitForTimeout(2500);
    await shot(`${tag}-${v}`);
  }
};
