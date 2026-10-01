// Forces mould on and screenshots the starter tank (mould shader check).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  for (const v of [0.35, 0.8]) {
    await page.evaluate(async (v) => { const { U } = await import('/src/render/uniforms.js'); window.game.world.env.mold = v; U.mold.value = v; window.__keepMold = v; }, v);
    await page.waitForTimeout(600);
    await shot('mould-' + v);
  }
};
