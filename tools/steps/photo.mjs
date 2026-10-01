import { openDockItem } from './_hud.mjs';
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  await openDockItem(page, 'Photo mode');
  await page.waitForTimeout(2500);
  await page.mouse.click(520, 430);
  await page.waitForTimeout(1500);
  await shot('photo');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.getByRole('button', { name: /Snap/ }).click({ force: true })]);
  console.log('download', dl ? dl.suggestedFilename() : 'none');
  if (dl) { await dl.saveAs('test-output/snap.png'); }
};
