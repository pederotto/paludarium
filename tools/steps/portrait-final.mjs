export default async (page, shot, name) => {
  if (name !== 'phone') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(7000);
  await shot('portrait-final');
};
