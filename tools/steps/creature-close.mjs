// In-game close-ups of a few animals (interface hidden), to judge models under the real lighting and water.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  for (const id of ['dartfrog', 'shrimp', 'crab', 'cory']) {
    const ok = await page.evaluate((id) => {
      const g = window.game, a = g.world.animals.by[id]?.[0];
      if (!a) return false;
      g.world.animals.by[id].slice(1).forEach((x) => { x.speedScale = 0; });
      const p = a.pos, d = id === 'dartfrog' ? 5 : 4;
      g.controls.setLookAt(p.x + d * 0.5, p.y + d * 0.45, p.z + d, p.x, p.y + 0.4, p.z, false);
      g.rig.moved = true;
      return true;
    }, id);
    await page.waitForTimeout(700);
    if (ok) await shot('close-' + id);
  }
};
