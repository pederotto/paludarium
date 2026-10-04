// Very close looks at single leaves of the leaf plants (veins, midrib, margin): PLANTS=sword,javafern node tools/shot.mjs --steps=…
export default async (page, shot) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(() => { const g = window.game; g.setSpeed(0); });
  const want = (process.env.PLANTS ?? 'sword,javafern,vallisneria,anubias,monstera,bromeliad').split(',');
  for (const id of want) {
    const ok = await page.evaluate((id) => {
      const g = window.game, p = g.world.plants.list.find((x) => x.id === id); if (!p) return false;
      const q = p.pos, n = p.surface === 'wall' ? p.normal : { x: 0.3, y: 0.6, z: 1 }, h = id === 'vallisneria' ? 6 : 2.5;
      g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(q.x + n.x * 7, q.y + h + n.y * 7, q.z + n.z * 7, q.x, q.y + h, q.z, false); return true;
    }, id);
    await page.waitForTimeout(800); if (ok) await shot('leaf-' + id);
  }
};
