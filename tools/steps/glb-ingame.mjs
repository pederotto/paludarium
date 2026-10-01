// Put the GLB-based species into the starter tank and photograph each from close up (sim paused, UI hidden).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const info = await page.evaluate(async () => {
    const g = window.game, W = g.world, A = W.animals;
    const water = A.by.neon[0].pos.clone();
    const land = W.randomSpot((x, y, z, s) => s === -Infinity && y < 20) ?? A.by.dartfrog[0].pos.clone();
    for (let i = 0; i < 3; i++) A.add('loach', water.clone().setX(water.x + i * 1.2).setY(water.y - 0.5));
    A.add('leucomelas', land.clone().setY(land.y + 0.3)); A.add('strawberry', land.clone().setX(land.x + 3).setY(land.y + 0.3)); A.add('firesal', land.clone().setX(land.x - 4).setY(land.y + 0.3));
    await new Promise((r) => setTimeout(r, 4000));   // GLB models load asynchronously
    g.setSpeed(0);
    return { counts: Object.fromEntries(['loach', 'leucomelas', 'strawberry', 'firesal'].map((k) => [k, A.by[k].length])), meshes: Object.keys(A.meshes).filter((k) => ['loach', 'leucomelas', 'strawberry', 'firesal'].includes(k)), errs: window.__errs.slice(0, 5) };
  });
  console.log(JSON.stringify(info));
  for (const id of ['loach', 'leucomelas', 'strawberry', 'firesal']) {
    await page.evaluate((id) => { const g = window.game, a = g.world.animals.by[id][0], p = a.pos, d = id === 'firesal' ? 12 : id === 'loach' ? 11 : 6; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(p.x + d * 0.3, p.y + d * 0.35, p.z + d, p.x, p.y + 0.5, p.z, false); }, id);
    await page.waitForTimeout(900);
    await shot('glbgame-' + id);
  }
};
