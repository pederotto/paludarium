// Click into the starter sandbox and capture the HUD, a tool panel and the field guide.
import { pickTool } from './_tools.mjs';
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  await page.waitForTimeout(2500);
  await shot('play');
  await pickTool(page, 'plant');
  await page.waitForTimeout(600);
  await shot('plants');
  await pickTool(page, 'water');
  await page.waitForTimeout(600);
  await shot('water');
  await pickTool(page, 'animal');
  await page.waitForTimeout(600);
  await shot('animals');
};
