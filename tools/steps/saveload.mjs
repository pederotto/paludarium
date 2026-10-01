// Start a generated terrarium, save, reload the page, Continue: the tank must come back the same.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /generated terrarium/i }).click({ force: true });
  await page.waitForTimeout(3000);
  await page.locator('.tile', { hasText: /Karst towers/i }).first().click({ force: true });
  await page.waitForTimeout(8000);
  const before = await page.evaluate(async () => { await window.__director.save(); const w = window.game.world; return { plants: w.plants.list.length, pieces: w.decor.pieces.length, animals: Object.values(w.animals.by).flat().length, day: w.env.day }; });
  console.log('before', JSON.stringify(before));
  await page.reload();
  await page.waitForFunction(() => window.__director, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /Continue/i }).click({ force: true, timeout: 60000 });
  await page.waitForTimeout(7000);
  const after = await page.evaluate(() => { const w = window.game.world; return { plants: w.plants.list.length, pieces: w.decor.pieces.length, animals: Object.values(w.animals.by).flat().length, day: w.env.day }; });
  console.log('after ', JSON.stringify(after));
  await shot('saveload');
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 5))));
};
