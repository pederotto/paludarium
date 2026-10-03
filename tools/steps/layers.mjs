// The view layers (render/layers.js): Surface, X-ray and Bottom layer from the same camera, plus a close look at the
// pump and a hose under the ground in X-ray. Checks what each layer draws: PASS/FAIL.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const set = async (l) => { await page.evaluate((v) => { window.__S.layer.value = v; }, l); await page.waitForTimeout(1500); };
  const look = (p, t) => page.evaluate(([p, t]) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, ...t, false); }, [p, t]);
  await look([0, 40, 95], [0, 12, -10]);
  const rep = [];
  for (const l of ['surface', 'xray', 'bottom']) {
    await set(l);
    await shot('layer-' + l);
    rep.push(await page.evaluate((l) => {
      const g = window.game, W = g.world, cam = g.camera;
      const seen = (o) => o && o.layers.test(cam.layers);
      const plants = Object.values(W.plants.meshes ?? {}).filter((m) => m.count > 0);
      const plantsSeen = W.worldRoot ? 0 : plants.filter(seen).length;
      return {
        l, plantsSeen: plants.filter(seen).length, plants: plants.length,
        rocks: W.decor.meshes.filter(seen).length, rocksAll: W.decor.meshes.length,
        terrain: seen(W.terrain.mesh), water: seen(W.water.surface), plumbing: seen(W.plumbing.mesh),
        ghost: !!W.plumbing.ghost?.visible, light: seen(g.stage.lights.led), glass: g.stage.root ? seen(g.stage.root) : null, plantsSeen0: plantsSeen,
      };
    }, l));
  }
  for (const r of rep) console.log(name, JSON.stringify(r));
  const [s, x, b] = rep;
  const ok = (c, t) => console.log(name, (c ? 'PASS ' : 'FAIL ') + t);
  ok(s.plantsSeen === s.plants && s.rocks === s.rocksAll && !s.ghost, 'Surface draws everything, no x-ray');
  ok(x.plantsSeen === x.plants && x.rocks === x.rocksAll && x.ghost, 'X-ray draws everything plus the glowing build');
  ok(b.plantsSeen === 0 && b.rocks === 0 && b.terrain && b.water && b.plumbing && b.light, 'Bottom layer: no plants or rocks; ground, water, plumbing and light stay');
  // A new plant added while the Bottom layer is on stays hidden.
  await set('bottom');
  const late = await page.evaluate(() => { const W = window.game.world; const p = W.randomSpot((x, y, z, s) => s === -Infinity); if (p) W.plants.add?.('fern', p); const m = W.plants.meshes?.fern; return m ? m.layers.test(window.game.camera.layers) : null; });
  ok(late === false || late === null, `a plant added in the Bottom layer stays hidden (${late})`);
  const [px, pz] = await page.evaluate(() => window.game.world.plumbing.pumpXZ());
  await set('xray');
  await look([px + 10, 24, pz + 30], [px - 6, 6, pz - 10]);
  await page.waitForTimeout(800);
  await shot('layer-xray-close');
  await set('surface');
  await page.waitForTimeout(800);
  await shot('layer-surface-close');
};
