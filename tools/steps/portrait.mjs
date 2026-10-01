// Framing check: the starter tank with the normal HUD (phone portrait or 16:9) at the front view.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4500);
  await shot('frame');
};
