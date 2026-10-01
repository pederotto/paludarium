// HUD v2 in a career: drawer with concerns, Learn and Build hubs, commission chip, a modal open.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /New career/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4500);
  await page.getByRole('button', { name: /Skip tutorial/i }).click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-testid="status-chip"]').click({ force: true });
  await page.waitForTimeout(800);
  await shot('hc1-drawer');
  console.log(await page.locator('.sdrawer .concern').allInnerTexts());
  await page.locator('[data-testid="status-chip"]').click({ force: true });
  for (const h of ['build', 'learn']) {
    await page.locator(`.dock2 [data-hub="${h}"]`).click({ force: true });
    await page.waitForTimeout(500);
    await shot('hc2-hub-' + h);
  }
  await page.locator('.dock2 [data-hub="learn"]').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="commission-chip"]').click({ force: true });
  await page.waitForTimeout(1500);
  await shot('hc3-modal');
  await page.keyboard.press('Escape');
  console.log('errors', JSON.stringify(await page.evaluate(() => (window.__errs ?? []).slice(0, 5))));
};
