// Close-ups of plants in the starter tank (UI hidden, paused): desktop and phone.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const kinds = await page.evaluate(() => { const g = window.game; g.setSpeed(0); const W = g.world; const by = {}; for (const p of W.plants.list) (by[p.id] ??= []).push(p); return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])); });
  console.log(JSON.stringify(kinds));
  const want = (process.env.PLANTS ?? 'bromeliad,sword,vallisneria,javafern,fernph,fern').split(',');
  for (const id of want) {
    const ok = await page.evaluate((id) => { const g = window.game, p = g.world.plants.list.find((x) => x.id === id); if (!p) return false; const q = p.pos, n = p.surface === 'wall' ? p.normal : { x: 0.2, y: 0.3, z: 1 }; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(q.x + n.x * 13, q.y + 3 + n.y * 13, q.z + n.z * 13, q.x, q.y + 3, q.z, false); return true; }, id);
    await page.waitForTimeout(700); if (ok) await shot('plant-' + id);
  }
  await page.evaluate(() => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, 22, 75, 0, 10, 0, false); });
  await page.waitForTimeout(700); await shot('plant-front');
};
