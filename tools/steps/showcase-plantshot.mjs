// Close-up of one plant species in a generated set (S3 plants pilot). PRESET=highland TIER=wide PLANT=hartstongue DISTS=15,40 [SEED=1]
//   sh "$BB/tools/gate.sh" S3 sh "$BB/tools/with-server.sh" sh -c 'node tools/shot.mjs --url="$SERVER_URL" --only=desktop --steps=tools/steps/showcase-plantshot.mjs --out=...'
// Prints texture memory info for the plant's maps and the draw calls of the plant (instances stay one InstancedMesh per species).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const place = process.env.PLACE ?? '', preset = process.env.PRESET ?? 'highland', tier = process.env.TIER ?? 'wide', plant = process.env.PLANT ?? 'hartstongue', seed = +(process.env.SEED ?? 1);
  const info = await page.evaluate(async ({ preset, tier, seed, plant, place }) => {
    const gen = await import('/src/sim/generator.js'), sc = await import('/src/content/presets-showcase.js');
    if (!gen.PRESETS[preset]) { Object.assign(gen.PRESETS, sc.SHOWCASE_LAYOUTS); for (const [k, s] of Object.entries(sc.SHOWCASE_SETS)) Object.assign(gen.PRESETS[k], s); }
    const w = await window.game.loadTank(tier, { layout: 'empty' });
    gen.generateTerrarium(w, { preset, seed, tier });
    const g = window.game; g.setSpeed(0); g.rig.stopOrbit();
    if (place) {   // add one plant of the species: PLACE=land (dry ground near the front) or pool (the deep main pool; floating plants on the surface)
      const { Vector3: V3 } = await import('three/webgpu'), W = w; let best = null;
      for (let x = -w.terrain.field.w / 2 + 4; x <= w.terrain.field.w / 2 - 4; x += 2) for (let z = -2; z <= 16; z += 2) {
        const y = W.terrain.heightAt(x, z), sf = W.water.surfaceAt(x, z), wet = sf !== -Infinity && sf > y + 6 && W.water.inMainPool(x, z);
        if (place === 'pool' ? !wet : (sf !== -Infinity && sf > y - 1)) continue;
        const sc = (place === 'pool' ? -x : Math.abs(x)) * 0.5 + Math.abs(z - 15) * 1.5;
        if (!best || sc < best.sc) best = { x, y, z, sc, sf };
      }
      if (best) { const floating = plant === 'limnobium'; W.plants.add(plant, new V3(best.x, floating ? best.sf : best.y, best.z), { grown: 1, scale: 1, rot: 0.6 }); }
      return { n: W.plants.list.filter((p) => p.id === plant).length, at: best && [best.x, best.y, best.z] };
    }
    return { n: w.plants.list.filter((p) => p.id === plant).length };
  }, { preset, tier, seed, plant });
  await page.evaluate(() => window.game.settle?.());
  await page.waitForTimeout(6000);
  console.log('plants of', plant, JSON.stringify(info));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  for (const dist of (process.env.DISTS ?? '15,40').split(',').map(Number)) {
    const ok = await page.evaluate(({ plant, dist }) => {
      const g = window.game, L = g.world.plants.list.filter((x) => x.id === plant); if (!L.length) return false;
      const p = L.reduce((a, b) => (b.pos.z > a.pos.z ? b : a)), q = p.pos;   // the plant nearest the front glass
      g.rig.moved = true; g.controls.setLookAt(q.x + 0.1 * dist, q.y + 4 + 0.3 * dist, q.z + dist, q.x, q.y + 3.5, q.z, false); return true;
    }, { plant, dist });
    await page.waitForTimeout(2500);
    if (ok) await shot(`${plant}-${dist}cm`);
  }
  const r = await page.evaluate((plant) => { const m = window.game.world.plants.meshes?.get?.(plant) ?? null; return { mesh: m ? { count: m.count, tris: m.geometry?.index?.count / 3, maps: ['leafMap'].length } : null }; }, plant);
  console.log(JSON.stringify(r));
  console.log(`errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);
};
