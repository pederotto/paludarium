import { openDockItem } from './_hud.mjs';
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /New career/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  await openDockItem(page, 'Field guide');
  await page.waitForTimeout(2000);
  await shot('p1-codex');
  console.log(await page.evaluate(() => JSON.stringify({ errs: window.__errs.slice(0, 5), html: document.querySelector('.sheet')?.innerText.slice(0, 200) })));
};
