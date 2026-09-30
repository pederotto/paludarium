// Stability check for generated terrariums: builds each one, fast-forwards 10 game days and reports
// deaths of the display animals, NaNs, dying plants and the climate. Sets a non-zero exit code on any failure.
//
//   GEN_LIST="cascade:1:standard,jar:2:jar" node tools/shot.mjs --steps=tools/steps/gen-check.mjs --only=desktop --wait=1500
//   GEN_ALL=1 node tools/shot.mjs --steps=tools/steps/gen-check.mjs --only=desktop --wait=1500     (every preset on every suitable tier, seeds 1-3)
//
// Env: GEN_LIST (preset:seed:tier,...), GEN_ALL, GEN_SEEDS (default 1,2,3), GEN_DAYS (default 10).
// Feeder insects (fruit flies, springtails, isopods) that die of hunger or dryness are counted separately:
// they breed up to what their food allows, so some losses are normal.
const FEEDERS = ['fly', 'springtail', 'isopod', 'tadpole', 'eggs'];

export default async (page, shot, name) => {
  const days = +(process.env.GEN_DAYS || 10);
  let list = (process.env.GEN_LIST || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [preset, seed, tier] = s.split(':'); return { preset, seed: +(seed || 1), tier: tier || 'standard' }; });
  if (process.env.GEN_ALL || !list.length) {
    const seeds = (process.env.GEN_SEEDS || '1,2,3').split(',').map(Number);
    const all = await page.evaluate(async () => {
      const { PRESETS, PRESET_ORDER } = await import('/src/content/presets.js');
      return PRESET_ORDER.flatMap((id) => PRESETS[id].tiers.map((tier) => ({ preset: id, tier })));
    });
    list = all.flatMap((c) => seeds.map((seed) => ({ ...c, seed })));
  }
  let bad = 0;
  for (const { preset, seed, tier } of list) {
    const r = await page.evaluate(async ({ preset, seed, tier, days, FEEDERS }) => {
      await new Promise((res) => { const t = setInterval(() => { if (document.getElementById('loading')?.classList.contains('gone') && window.game?.world) { clearInterval(t); setTimeout(res, 800); } }, 200); });
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      window.game.rig.stopOrbit();
      const info = generateTerrarium(w, { preset, seed, tier });
      const cnt = () => Object.fromEntries(Object.entries(w.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
      const before = cnt(), plants0 = w.plants.list.length;
      const deaths = [], feederLoss = [];
      const rm = w.animals.remove.bind(w.animals);
      w.animals.remove = (a, cause) => {
        if (cause && !/^eaten|hatched|metamorph|moved/.test(cause) && cause !== 'old age') (FEEDERS.includes(a.sp) ? feederLoss : deaths).push(a.sp + ':' + cause);
        return rm(a, cause);
      };
      for (let d = 0; d < days; d++) {
        w.sim.step(1440);
        for (let k = 0; k < 3; k++) w.animals.move(0.05);
      }
      const E = w.env;
      const nan = Object.entries(E).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => 'env.' + k);
      for (const p of w.plants.list) if (![p.pos.x, p.pos.y, p.pos.z, p.grown, p.health].every(Number.isFinite)) nan.push('plant:' + p.id);
      for (const a of w.animals.all) if (![a.pos.x, a.pos.y, a.pos.z, a.health, a.hunger].every(Number.isFinite)) nan.push('animal:' + a.sp);
      const weak = w.plants.list.filter((p) => p.health < 0.5).length;
      const tally = (l) => l.reduce((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {});
      return {
        name: info.name, falls: info.falls, pools: info.pools, litres: info.litres, before, after: cnt(), plants: [plants0, w.plants.list.length], weak,
        deaths: tally(deaths), feederLoss: tally(feederLoss), nan, temp: +E.temp.toFixed(1), rh: Math.round(E.humidity), mold: +E.mold.toFixed(2), algae: +E.algae.toFixed(2),
        o2: +E.oxygen.toFixed(1), nh3: +E.ammonia.toFixed(2), warnings: info.warnings,
      };
    }, { preset, seed, tier, days, FEEDERS });
    const fail = Object.keys(r.deaths).length > 0 || r.nan.length > 0 || r.weak > Math.max(2, r.plants[1] * 0.08);
    if (fail) bad++;
    console.log(fail ? 'FAIL' : 'ok  ', `${preset}:${seed}:${tier}`, JSON.stringify(r));
  }
  console.log(bad ? `${bad} of ${list.length} failed` : `all ${list.length} stable`);
  if (bad) process.exitCode = 1;
};
