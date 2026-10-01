// Framing check for Kids' corner: Frog Island at the front view, HUD on.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /Kids' corner/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.locator('.kw-card', { hasText: /Frog Island/ }).click({ force: true });
  await page.waitForTimeout(9000);
  await shot('kframe');
};
