// Studio > Tanks (custom size) and Settings, at both viewports.
import { openDockItem } from './_hud.mjs';
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  await openDockItem(page, 'Tanks and sizes');
  await page.waitForTimeout(900);
  await page.getByText('Tanks', { exact: true }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(900);
  await shot('sizes-studio');
};
