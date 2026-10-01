export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  await page.waitForTimeout(1500);
  for (const c of [0.15, 0.45, 0.9]) {
    await page.evaluate((c) => { const E = window.game.world.env; E.wipe = 0; window.__c = c; window.game.world.sim.updateGlassOverride = c; }, c);
    await page.evaluate((c) => { import('/src/render/uniforms.js').then(({ U }) => { U.condense.value = c; window.game.frozen = true; }); }, c);
    await page.waitForTimeout(700);
    await shot('glass' + Math.round(c * 100));
  }
};
