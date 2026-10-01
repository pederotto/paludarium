// Water-quality lens: cycle to it, then switch the reading (worst / ammonia / nitrate / oxygen / temperature).
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.mouse.move(600, 400);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('l'); await page.waitForTimeout(250);
    if (await page.locator('.legend b', { hasText: /Water quality/ }).count()) break;
  }
  await page.waitForTimeout(1200);
  await shot('lensq-worst');
  for (const m of ['Ammonia', 'Nitrate', 'Oxygen', 'Temperature']) {
    await page.locator('.lens-metrics .chip', { hasText: new RegExp('^' + m) }).click({ force: true });
    await page.waitForTimeout(1200);
    await shot('lensq-' + m.toLowerCase());
  }
  console.log('legend', await page.locator('.legend').innerText());
};
