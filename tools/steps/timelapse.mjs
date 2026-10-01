// Start a 7-day time-lapse on the starter tank; capture it running and the report at the end.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.locator('.dock2 [data-hub="camera"]').click({ force: true });
  await page.waitForTimeout(400);
  await shot('lapse-menu');
  await page.locator('.hubmenu [title="Time-lapse 7 days"]').click({ force: true });
  await page.waitForTimeout(6000);
  await shot('lapse-running');
  await page.waitForFunction(() => document.querySelector('.lapse .acts .primary'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot('lapse-done');
  console.log(await page.locator('.lapse').innerText());
  await page.locator('.lapse .primary').click({ force: true });
  await page.waitForTimeout(600);
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 5))));
};
