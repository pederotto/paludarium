// Close-ups of fish and shrimp at several creature water-absorption strengths (U.creatureWater).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const ks = (process.env.KS ?? '1,0.6,0.3').split(',').map(Number);
  for (const id of (process.env.IDS ?? 'neon,shrimp').split(',')) {
    await page.evaluate((id) => {
      const g = window.game, a = g.world.animals.by[id]?.[0];
      g.setSpeed(0);
      const p = a.pos;
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(p.x + 1.5, p.y + 1.2, p.z + 9, p.x, p.y, p.z, false);
    }, id);
    for (const k of ks) {
      await page.evaluate(async (k) => { const { U } = await import('/src/render/uniforms.js'); U.creatureWater.value = k; }, k);
      await page.waitForTimeout(700);
      await shot(`wt-${id}-${k}`);
    }
  }
};
