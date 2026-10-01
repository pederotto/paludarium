// A clean hero shot of a generated terrarium for the README (interface hidden).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /generated terrarium/i }).click({ force: true });
  await page.waitForTimeout(3000);
  await page.locator('.tile', { hasText: /Cascade canyon/i }).first().click({ force: true });
  await page.waitForTimeout(9000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(() => { window.game.rig.view('hero', false); });
  await page.waitForTimeout(3500);
  await shot('hero');
};
