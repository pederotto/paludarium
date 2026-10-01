// HUD v2 tour: default view, status drawer, each hub menu, the speed pill, a modal. Both viewports.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await shot('h1-default');
  await page.locator('.pill-main').click({ force: true });
  await page.waitForTimeout(500);
  await shot('h2-speed');
  await page.waitForTimeout(4200);
  await page.locator('[data-testid="status-chip"]').click({ force: true });
  await page.waitForTimeout(900);
  await shot('h3-drawer');
  await page.locator('[data-testid="acc-readings"]').click({ force: true });
  await page.waitForTimeout(400);
  await shot('h3b-readings');
  await page.locator('[data-testid="status-chip"]').click({ force: true });
  for (const h of ['tank', 'build', 'learn', 'camera']) {
    await page.locator(`.dock2 [data-hub="${h}"]`).click({ force: true });
    await page.waitForTimeout(500);
    await shot('h4-hub-' + h);
  }
  await page.locator('[data-testid="hub-item-Photo mode"]').click({ force: true });
  await page.waitForTimeout(800);
  await shot('h5-photo');
  await page.evaluate(() => { window.__tools?.game; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('photo?', await page.evaluate(() => !!document.querySelector('.photo')));
  console.log('errors', JSON.stringify(await page.evaluate(() => (window.__errs ?? []).slice(0, 5))));
};
