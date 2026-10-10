// Shrimp, crayfish and crabs followed up close while the simulation runs (run "sets", 9 Oct): builds a set, then for each species in IDS takes
// FRAMES pictures `GAP` ms apart with the camera riding beside the first animal of that species, UI hidden. Shows the baked rigs in motion
// (the bench strips cannot: it holds the rig inputs still), the leg wave, the antennae, the pincers, the tail flick.
//   PRESET=matano IDS=matanoshrimp,panther FRAMES=6 GAP=900 node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/crust-look.mjs --out=<dir>
// Writes close-<id>-<n>.png and prints per-frame position, speed and state of the followed animal.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403|404/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const preset = process.env.PRESET ?? 'matano', tier = process.env.TIER ?? 'standard', seed = +(process.env.SEED ?? 1);
  const ids = (process.env.IDS ?? 'matanoshrimp').split(','), frames = +(process.env.FRAMES ?? 6), gap = +(process.env.GAP ?? 900), dist = +(process.env.DIST ?? 6);
  const info = await page.evaluate(async ({ preset, tier, seed }) => {
    const { generateTerrarium } = await import('/src/sim/generator.js');
    const w = await window.game.loadTank(tier, { layout: 'empty' });
    window.game.rig.stopOrbit();
    const r = generateTerrarium(w, { preset, seed, tier });
    window.game.settle?.();
    return { litres: r.litres, animals: r.animals };
  }, { preset, tier, seed });
  console.log('CRUST-LOOK', JSON.stringify(info));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(4000);
  for (const id of ids) {
    const has = await page.evaluate((id) => !!window.game.world.animals.by[id]?.length, id);
    if (!has) { console.log('CRUST-LOOK no animal of', id); continue; }
    for (let n = 0; n < frames; n++) {
      const st = await page.evaluate(({ id, dist }) => {
        const g = window.game, a = g.world.animals.by[id][0], p = a.pos;
        g.rig.stopOrbit(); g.rig.moved = true;
        g.controls.setLookAt(p.x + dist * 0.45, p.y + dist * 0.35, p.z + dist, p.x, p.y, p.z, false);
        return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), state: a.state ?? a.mode ?? null, swim: !!a.swimming, hunger: a.hunger != null ? +a.hunger.toFixed(2) : null };
      }, { id, dist });
      console.log('CRUST-LOOK', id, n, JSON.stringify(st));
      await page.waitForTimeout(gap);
      await shot(`close-${id}-${n}`);
    }
  }
  console.log('CRUST-LOOK errors', errors.length, JSON.stringify(errors.slice(0, 3)));
};
