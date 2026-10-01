export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__S.lens.value = 'quality'; });
  await page.waitForTimeout(1500);
  await shot('hl-lens');
};
