// In-game close-ups of fish and other animals with the simulation paused (so nothing swims away) and the interface hidden.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const ids = (process.env.IDS ?? 'neon,cory,shrimp,cardinal').split(',');
  for (const id of ids) {
    const ok = await page.evaluate((id) => {
      const g = window.game, list = g.world.animals.by[id];
      if (!list?.length) return false;
      g.setSpeed(0);
      const a = list[0], p = a.pos, d = 9;
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(p.x + 1.5, p.y + 1.2, p.z + d, p.x, p.y, p.z, false);
      return true;
    }, id);
    await page.waitForTimeout(900);
    if (ok) await shot('close-' + id);
  }
};
