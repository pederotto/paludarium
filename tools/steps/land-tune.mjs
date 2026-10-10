// Finds the water knobs (`level`: the water's height as a share of the tank's; `pool`: the size of the pool) that put the USABLE land share
// of a land-frog set in the middle of its species' band (World.usable, habitat.js landBand), by building it again with a changed knob
// until it is close. Prints the knobs to write into content/presets.js, and the share for seeds 1 to 3 with them.
//   PRESETS=frogpond,satoyama node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/land-tune.mjs --wait=1500
//   env: TIER (default the set's `ref`), SEEDS (default 1,2,3)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const only = (process.env.PRESETS ?? '').split(',').filter(Boolean), seeds = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
  const ids = await page.evaluate(async (only) => {
    const { PRESETS, PRESET_ORDER } = await import('/src/content/presets.js');
    const { SPECIES } = await import('/src/sim/animals.js');
    return PRESET_ORDER.filter((id) => (!only.length || only.includes(id)) && (PRESETS[id].animals ?? []).some((a) => SPECIES[a]?.landTol != null));
  }, only);
  for (const id of ids) {
    const r = await page.evaluate(async ({ id, seeds, tierEnv }) => {
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const { PRESETS } = await import('/src/content/presets.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      const { landBand } = await import('/src/sim/habitat.js');
      const { TANK } = await import('/src/sim/tank.js');
      const P = PRESETS[id], tier = tierEnv || P.ref || 'standard';
      const wanted = [...new Set([...(P.animals ?? []), ...(P.stock ?? []).map((x) => x[0])])].filter((k) => SPECIES[k]?.landTol != null);
      const lo = Math.max(...wanted.map((k) => landBand(SPECIES[k])[0])), hi = Math.min(...wanted.map((k) => landBand(SPECIES[k])[1]));
      const target = (lo + hi) / 2;
      const build = async (seed) => { const w = await window.game.loadTank(tier, { layout: 'empty' }); const res = generateTerrarium(w, { preset: id, seed, tier }); return { share: w.usable().share, level: res?.level ?? w.water.level, h: TANK.h }; };
      const orig = { level: P.level, pool: P.pool };
      const first = await build(1), f0 = first.level / first.h, pool0 = P.pool ?? 1;
      const trace = [[+f0.toFixed(3), +pool0.toFixed(2), +first.share.toFixed(3)]];
      let best = { d: Math.abs(first.share - target), level: P.level, pool: P.pool, share: first.share };
      const note = (o) => { const d = Math.abs(o.share - target); if (d < best.d) best = { d, level: P.level, pool: P.pool, share: o.share }; trace.push([P.level ?? +f0.toFixed(3), P.pool ?? 1, +o.share.toFixed(3)]); };
      // pass A: the pool's size (a lagoon is scaled continuously by it), the level as the recipe has it; pass B: the level, from the start
      let pool = pool0, o = first;
      for (let it = 0; it < 7 && Math.abs(o.share - target) > 0.04; it++) {
        pool = Math.min(1.6, Math.max(0.2, pool * (o.share < target ? 0.78 : 1.25)));
        P.pool = Math.round(pool * 100) / 100; o = await build(1); note(o);
      }
      if (best.d > 0.05) {
        P.pool = orig.pool; let f = f0; o = first;
        for (let it = 0; it < 9 && Math.abs(o.share - target) > 0.04; it++) {
          f = Math.min(0.9, Math.max(0.03, f * (o.share < target ? 0.8 : 1.2)));
          P.level = Math.round(f * 1000) / 1000; o = await build(1); note(o);
        }
      }
      P.level = best.level; P.pool = best.pool;
      const check = [];
      for (const seed of seeds) check.push(+(await build(seed)).share.toFixed(3));
      const out = { tier, band: [+lo.toFixed(2), +hi.toFixed(2)], target: +target.toFixed(2), level: P.level ?? null, pool: P.pool ?? null, shares: check, trace };
      P.level = orig.level; P.pool = orig.pool;
      return out;
    }, { id, seeds, tierEnv: process.env.TIER ?? '' }).catch((e) => ({ error: String(e).slice(0, 300) }));
    console.log('TUNE', id, JSON.stringify(r));
  }
};
