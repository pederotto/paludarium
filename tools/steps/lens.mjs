export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.mouse.move(600, 400);
  for (const l of ['humidity', 'temperature', 'light']) {
    await page.keyboard.press('l');
    await page.waitForTimeout(1500);
    await shot('lens-' + l);
  }
};
