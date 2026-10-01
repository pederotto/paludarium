// Career in Explorer, mode switch in Settings, save, reload with the other mode remembered, Continue: the save's mode wins.
export default async (page, shot, name) => {
  const st = () => page.evaluate(() => { const W = window.game.world, d = window.__director; return { realism: W.realism?.mode, ero: W.water.erosion.scale, slump: W.water.erosion.slump, career: d.career?.mode, comm: d.commissions?.active?.length ?? d.commissions?.list?.length ?? null, evRate: d.events.rate, topUp: W.water.hydro.topUp, html: document.documentElement.className.includes('mode-' + W.realism?.mode) }; });
  await page.waitForSelector('.modecard', { timeout: 90000 });
  await page.locator('.modecard', { hasText: 'Explorer' }).click({ force: true });
  await page.getByRole('button', { name: /New career/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.rail'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  console.log(name, 'career explorer', JSON.stringify(await st()));
  await shot('m1-career-explorer');
  // Settings: switch to Naturalist
  await page.evaluate(() => window.__director && document.querySelector('.dock') && 0);
  await page.evaluate(() => { window.__S.modal.value = 'settings'; });
  await page.waitForTimeout(600);
  await shot('m2-settings');
  await page.locator('.modelist button', { hasText: 'Naturalist' }).click({ force: true });
  await page.waitForTimeout(500);
  console.log(name, 'switched', JSON.stringify(await st()));
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await window.__director.save(); localStorage.setItem('paludarium.mode', 'explorer'); });
  await page.reload();
  await page.waitForSelector('.modecard', { timeout: 90000 });
  await page.waitForTimeout(1500);
  await shot('m3-title-continue');
  await page.getByRole('button', { name: /Continue/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.rail'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  console.log(name, 'after reload+continue (save said naturalist, localStorage explorer)', JSON.stringify(await st()));
  // and the other way round
  await page.evaluate(async () => { window.__setMode('explorer', { quiet: true }); await window.__director.save(); localStorage.setItem('paludarium.mode', 'naturalist'); });
  await page.reload();
  await page.waitForSelector('.modecard', { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Continue/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.rail'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  console.log(name, 'reload2 (save explorer)', JSON.stringify(await st()));
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 8))));
};
