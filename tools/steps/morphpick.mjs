export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.locator('.tool', { hasText: 'Animals' }).click({ force: true });
  await page.waitForTimeout(600);
  await page.locator('.opts button', { hasText: /Guppy/ }).first().click({ force: true });
  await page.waitForTimeout(700);
  await shot('morphpick');
  const a = await page.evaluate(() => { const g = window.game, A = g.world.animals.by.guppy?.[0] ?? g.world.animals.by.neon[0]; g.setSpeed(0); const v = A.pos.clone().project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  await page.locator('.tool', { hasText: 'Inspect' }).click({ force: true });
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(900); await shot('banner-genes');
};
