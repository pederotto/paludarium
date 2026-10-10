// The land/water rule of the land-frog terrariums (owner, 8 Oct 2026; World.usable, habitat.js landBand): for every preset that holds a
// species with `landTol`, build it (its reference tier, SEED, default 1) and print the usable land share (objects and plants count half),
// the plain land share, the dead (covered) share and each frog species' band; FAIL when the share is outside a band.
//   node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/land-rule.mjs --wait=1500
//   env: PRESETS=satoyama,choco (default every set with a land frog), SEEDS=1,2,3 (default 1), TIER (default the set's own `ref`), ALLTIERS=1 (every tier the set suits)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const only = (process.env.PRESETS ?? '').split(',').filter(Boolean), seeds = (process.env.SEEDS ?? process.env.SEED ?? '1').split(',').map(Number);
  const list = await page.evaluate(async ({ only, tierEnv, all }) => {
    const { PRESETS, PRESET_ORDER } = await import('/src/content/presets.js');
    const { SPECIES } = await import('/src/sim/animals.js');
    return PRESET_ORDER.filter((id) => (!only.length || only.includes(id)) && (PRESETS[id].animals ?? []).some((a) => SPECIES[a]?.landTol != null)).flatMap((id) => (all ? PRESETS[id].tiers : [tierEnv || PRESETS[id].ref || 'standard']).map((tier) => ({ id, tier })));
  }, { only, tierEnv: process.env.TIER ?? '', all: process.env.ALLTIERS === '1' });
  let bad = 0;
  for (const { id, tier } of list) for (const seed of seeds) {
    const r = await page.evaluate(async ({ id, tier, seed }) => {
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      const { landBand, landFits } = await import('/src/sim/habitat.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      window.game.rig.stopOrbit();
      const res = generateTerrarium(w, { preset: id, seed, tier });
      const u = w.usable();
      const { PRESETS: PS } = await import('/src/content/presets.js');
      const wanted = [...new Set([...(PS[id].animals ?? []), ...(PS[id].stock ?? []).map((x) => x[0])])].filter((k) => SPECIES[k]?.landTol != null);
      const frogs = wanted.map((k) => ({ id: k, n: w.animals.by[k]?.length ?? 0, band: landBand(SPECIES[k]).map((b) => +b.toFixed(2)), fits: landFits(SPECIES[k], u) }));
      return { by: Object.fromEntries(Object.entries(w.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])), name: res?.name, tier, usable: +u.share.toFixed(3), plain: +w.landShare().toFixed(3), dead: +u.dead.toFixed(3), land: +u.land.toFixed(1), water: +u.water.toFixed(1), frogs };
    }, { id, tier, seed }).catch((e) => ({ error: String(e).slice(0, 200) }));
    const fail = r.error || r.frogs.some((f) => !f.fits);
    if (fail) bad++;
    console.log(fail ? 'FAIL' : 'ok  ', id, tier, seed, JSON.stringify(r));
  }
  console.log(`LAND-RULE ${bad} of ${list.length * seeds.length} fail`);
};
