import { openDockItem } from './_hud.mjs';
// New career → jar + tutorial coach → each panel.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /New career/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4500);
  await shot('c1-career-start');
  const openPanel = async (label, file, extra) => {
    await openDockItem(page, label);
    await page.waitForTimeout(1600);
    if (extra) await extra();
    await shot(file);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  };
  await openPanel('Studio', 'c2-studio');
  await openPanel('Field guide', 'c3-codex', async () => { await page.locator('.codex-item', { hasText: 'nitrogen' }).first().click({ force: true }); await page.waitForTimeout(900); });
  await openPanel('Care', 'c4-care');
  await openPanel('Lab', 'c5-lab');
  await page.evaluate(() => { window.__open = true; });
  await shot('c6-end');
};
