// Where do the draw calls come from? Counts visible meshes in the scene by kind.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const g = window.game, scene = g.scene;
    const kinds = {};
    let meshes = 0, inst = 0, shadowCasters = 0, sprites = 0;
    scene.traverse((o) => {
      if (!o.visible) return;
      let p = o, hidden = false; while (p) { if (!p.visible) hidden = true; p = p.parent; }
      if (hidden) return;
      if (o.isMesh || o.isSprite || o.isPoints || o.isLine) {
        meshes++;
        if (o.isInstancedMesh) inst++;
        if (o.castShadow) shadowCasters++;
        const k = (o.isInstancedMesh ? 'inst:' : 'mesh:') + (o.material?.type ?? '?') + (o.name ? ':' + o.name : '');
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
    });
    const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 14);
    const lights = []; scene.traverse((o) => { if (o.isLight && o.castShadow) lights.push(o.type + ' ' + (o.shadow?.map?.width ?? o.shadow?.mapSize?.width)); });
    return { meshes, inst, shadowCasters, top, lights, calls: g.renderer.info.render.calls, memGeom: g.renderer.info.memory.geometries };
  });
  console.log(JSON.stringify(r, null, 1));
};
