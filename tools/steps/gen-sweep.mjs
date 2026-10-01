// Builds every generated preset at every tier it supports and reports stability:
// a three-day unattended run per tank (the vacation test), deaths and console errors.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  if (process.env.SWEEP_TIERS) await page.evaluate((v) => { window.__sweepOnly = v.split(','); }, process.env.SWEEP_TIERS);
  const res = await page.evaluate(async () => {
    const { PRESETS, PRESET_ORDER } = await import('/src/content/presets.js');
    const { TANK_ORDER } = await import('/src/content/tanks.js');
    const gen = await import('/src/sim/generator.js');
    const { runVacation } = await import('/src/game/vacation.js');
    const out = [];
    for (const id of PRESET_ORDER) {
      // Every tank size in the catalogue the preset claims to suit (add ?tiers=all to also try the unsupported ones).
      for (const tier of TANK_ORDER.filter((t) => PRESETS[id].tiers.includes(t))) {
        for (const seed of tier === 'standard' || tier === 'jar' ? [1, 4242] : [1]) {
          if (window.__sweepOnly && !window.__sweepOnly.includes(tier)) continue;
          const t0 = performance.now();
          try {
            const w = await window.game.loadTank(tier, { layout: 'empty' });
            const r = gen.generateTerrarium(w, { preset: id, seed, tier });
            const built = Math.round(performance.now() - t0);
            const v = await runVacation(w, 3);
            out.push({ id, tier, seed, buildMs: built, animals: v.animals, deaths: v.deaths.length, sick: v.sick, verdict: v.verdict, plants: w.plants.list.length, warn: r.warnings ?? [] });
          } catch (e) { out.push({ id, tier, seed, error: String(e.message ?? e).slice(0, 160) }); }
        }
      }
    }
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 8))));
};
