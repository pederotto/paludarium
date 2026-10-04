// Plant-ground probe: do plants on the ground stand on what is DRAWN under them (the ground mesh, terrain `hv`, or the top of a
// stone), not on the stamped height `h` the drawn ground does not follow at the rim of a stone's footprint (a grass 2 cm in the air)?
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/plant-ground.mjs --wait=2500 --url=http://127.0.0.1:5173/
//   PG_LAYOUTS=starter,karst@5,suriname@5   (the default: the starter tank and generated tanks, preset@seed)
//
// Per layout: the plants on the ground (floating ones left out), how many stand more than 0.3 cm above the drawn surface under
// them (a ray down from 2 cm above the plant onto the stones, or the drawn ground), the worst gap, and the first few cases.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(300000);
  for (const layout of (process.env.PG_LAYOUTS ?? 'starter,karst@5,suriname@5').split(',')) {
    const r = await page.evaluate(async ({ layout }) => {
      const { PLANTS } = await import('/src/sim/plants.js');
      const g = window.game, [preset, seed] = layout.split('@');
      const w = await g.loadTank('standard', { layout: seed ? 'empty' : preset });
      if (seed) (await import('/src/sim/generator.js')).generateTerrarium(w, { preset, seed: +seed, tier: 'standard' });
      const T = w.terrain, f = T.field, V3 = g.camera.position.constructor, rc = new (window.__tools.ray.constructor)();
      const pieces = (w.decor?.pieces ?? []).map((p) => p.mesh).filter(Boolean);
      for (const m of pieces) m.updateMatrixWorld(true);
      const cases = [];
      let n = 0, up = 0, worst = 0;
      for (const p of w.plants.list) {
        if (p.surface !== 'terrain' || PLANTS[p.id]?.habitat === 'floating') continue;
        n++;
        const hv = f.sample(p.pos.x, p.pos.z, f.hv);
        rc.set(new V3(p.pos.x, p.pos.y + 2, p.pos.z), new V3(0, -1, 0));
        const hit = rc.intersectObjects(pieces, false)[0];
        const gap = p.pos.y - Math.max(hv, hit ? hit.point.y : -1e9);
        worst = Math.max(worst, gap);
        if (gap > 0.3) { up++; if (cases.length < 6) cases.push({ id: p.id, pos: p.pos.toArray().map((v) => +v.toFixed(2)), hv: +hv.toFixed(2), h: +T.heightAt(p.pos.x, p.pos.z).toFixed(2), stone: hit ? +hit.point.y.toFixed(2) : null, gap: +gap.toFixed(2) }); }
      }
      return { layout, plants: n, above03: up, worstCm: +worst.toFixed(2), cases };
    }, { layout });
    console.log('PLANTGROUND', JSON.stringify(r));
  }
};
