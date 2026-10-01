// Night view (lamp off) of the tank at two creature water strengths.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(() => { const g = window.game; g.setSpeed(0); g.world.env.lights = 'off'; g.world.env.minute = 2 * 60; });
  for (const k of [1, 0.3]) {
    await page.evaluate(async (k) => { const { U } = await import('/src/render/uniforms.js'); U.creatureWater.value = k; }, k);
    await page.waitForTimeout(1200);
    await shot(`wt3-${k}`);
  }
};
