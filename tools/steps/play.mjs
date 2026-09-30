// Click into the starter sandbox and capture the HUD, a tool panel and the field guide.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  await page.waitForTimeout(2500);
  await shot('play');
  await page.locator('.tool', { hasText: 'Plants' }).click();
  await page.waitForTimeout(600);
  await shot('plants');
  await page.locator('.tool', { hasText: 'Water' }).click();
  await page.waitForTimeout(600);
  await shot('water');
  await page.locator('.tool', { hasText: 'Animals' }).click();
  await page.waitForTimeout(600);
  await shot('animals');
};
