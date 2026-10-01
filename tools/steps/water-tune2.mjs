// Whole-tank front view at several creature water strengths (UI hidden, sim paused).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(() => { window.game.setSpeed(0); });
  for (const k of (process.env.KS ?? '1,0.4,0.15').split(',').map(Number)) {
    await page.evaluate(async (k) => { const { U } = await import('/src/render/uniforms.js'); U.creatureWater.value = k; }, k);
    await page.waitForTimeout(700);
    await shot(`wt2-${k}`);
  }
};
