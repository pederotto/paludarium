// Menu > Home saves and returns to the Title; Continue restores the same tank. Esc opens the menu too.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const snap = () => page.evaluate(() => { const W = window.game.world; return { day: W.env.day, plants: W.plants.list.length, animals: W.animals.list?.length ?? null, tank: window.game.tankId }; });
  const before = await snap();
  await page.locator('[data-testid="menu-button"]').click({ force: true });
  await page.waitForTimeout(500);
  await shot('home1-menu');
  await page.locator('[data-testid="menu-Home"]').click({ force: true });
  await page.waitForTimeout(3500);
  console.log('screen', await page.evaluate(() => window.__S.screen.value));
  await shot('home2-title');
  await page.getByRole('button', { name: /Continue/ }).click({ force: true, timeout: 20000 });
  await page.waitForTimeout(4000);
  const after = await snap();
  console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('esc menu', await page.evaluate(() => !!document.querySelector('.menupop')));
  await shot('home3-esc');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('esc closes', await page.evaluate(() => !document.querySelector('.menupop')));
  console.log('errors', JSON.stringify(await page.evaluate(() => (window.__errs ?? []).slice(0, 5))));
};
