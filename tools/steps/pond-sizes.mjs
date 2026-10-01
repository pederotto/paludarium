// Lists the water bodies (sump and ponds) of every generated preset at the standard tank: volume in litres, mean and max depth.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  const tiers = (process.env.TIERS ?? 'standard').split(',');
  const res = await page.evaluate(async (tiers) => {
    const { PRESET_ORDER, PRESETS } = await import('/src/content/presets.js');
    const gen = await import('/src/sim/generator.js');
    const out = [];
    for (const id of PRESET_ORDER) for (const tier of tiers) {
      if (!PRESETS[id].tiers.includes(tier)) continue;
      try {
        const w = await window.game.loadTank(tier, { layout: 'empty' });
        gen.generateTerrarium(w, { preset: id, seed: 1, tier });
        for (let i = 0; i < 120; i++) w.sim.step(10);
        const B = w.water.bodies;
        out.push(`${id}/${tier}: sump ${B.sump.vol.toFixed(1)}L ponds ` + B.slots.filter(Boolean).map((b) => `${b.vol.toFixed(2)}L(d${b.maxDepth.toFixed(1)})`).join(' '));
      } catch (e) { out.push(`${id}/${tier}: ERROR ${String(e.message ?? e).slice(0, 120)}`); }
    }
    return out;
  }, tiers);
  console.log(res.join('\n'));
};
