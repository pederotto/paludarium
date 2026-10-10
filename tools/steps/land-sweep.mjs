// How the usable land share (World.usable) follows the main water level after a set is built: for PRESET on TIER, sets the level over a
// sweep and lets the water settle a few steps each time. Used to decide whether the generator can correct a frog set's water at build time.
//   PRESET=reedpool TIER=low node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/land-sweep.mjs --wait=1500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async ({ preset, tier }) => {
    const { generateTerrarium } = await import('/src/sim/generator.js');
    const w = await window.game.loadTank(tier, { layout: 'empty' });
    generateTerrarium(w, { preset, seed: 1, tier });
    const H = w.water.hydro, L0 = w.water.level, out = [];
    for (const f of [0.25, 0.4, 0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.8]) {
      const t0 = performance.now();
      w.water.setLevel(L0 * f);
      for (let k = 0; k < 40; k++) H.step(1 / 30);
      w.water.syncLevel();
      out.push([+(L0 * f).toFixed(1), +w.usable().share.toFixed(3), +w.landShare().toFixed(3), Math.round(performance.now() - t0)]);
    }
    return { L0: +L0.toFixed(1), out };
  }, { preset: process.env.PRESET ?? 'reedpool', tier: process.env.TIER ?? 'low' }).catch((e) => ({ error: String(e).slice(0, 300) }));
  console.log('SWEEP', process.env.PRESET ?? 'reedpool', process.env.TIER ?? 'low', JSON.stringify(r));
};
