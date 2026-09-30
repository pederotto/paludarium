// Title screen ▸ generated terrariums ▸ start one, then Surprise me from a new title.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /generated terrarium/i }).click({ force: true });
  await page.waitForTimeout(1200);
  await shot('gen-menu');
  await page.locator('.tile', { hasText: /Mountain stream/i }).first().click({ force: true });
  await page.waitForTimeout(name === 'phone' ? 9000 : 7000);
  await shot('gen-play');
};
