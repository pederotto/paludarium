// Review shots of the new HUD: default view and Shape / Add tools open.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(5000);
  await shot('ui1-default');
  await page.keyboard.press('3'); await page.waitForTimeout(900); await shot('ui2-shape');
  await page.keyboard.press('8'); await page.waitForTimeout(900); await shot('ui3-add-animals');
};
