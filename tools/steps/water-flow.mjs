// Per-pond chemistry, the Flow balance panel and the Water quality lens (desktop and phone).
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(5000);
  const rep = await page.evaluate(async () => {
    const W = window.game.world, E = W.env, B = W.water.bodies, H = W.water.hydro;
    const row = (b) => `${b.name.padEnd(9)} V${b.vol.toFixed(1)} nh3 ${b.ammonia.toFixed(3)} no2 ${b.nitrite.toFixed(3)} no3 ${b.nitrate.toFixed(1)} o2 ${b.oxygen.toFixed(2)} T ${b.temp.toFixed(2)} alg ${b.algae.toFixed(3)} in ${b.inLph.toFixed(0)} out ${b.outLph.toFixed(0)}`;
    const out = { before: B.list.map(row), env0: [E.ammonia, E.nitrate, E.oxygen].map((v) => +v.toFixed(3)) };
    for (let h = 0; h < 24; h++) W.sim.step(60);
    await new Promise((r) => setTimeout(r, 1500));
    out.after = B.list.map(row);
    const tot = B.list.reduce((s, b) => s + Math.max(b === B.sump ? 1 : 0.25, b.vol), 0);
    const mean = (k) => B.list.reduce((s, b) => s + b[k] * Math.max(b === B.sump ? 1 : 0.25, b.vol), 0) / tot;
    out.env = { nh3: +E.ammonia.toFixed(3), mean_nh3: +mean('ammonia').toFixed(3), no3: +E.nitrate.toFixed(2), mean_no3: +mean('nitrate').toFixed(2), o2: +E.oxygen.toFixed(2), mean_o2: +mean('oxygen').toFixed(2) };
    out.pump = { running: H.pump.running, lph: +H.pump.lph.toFixed(0), sub: H.pump.submerge };
    out.warn = H.ledger.warnings.map((w) => w.text);
    out.check = H.ledger.check;
    return out;
  });
  console.log(JSON.stringify(rep, null, 1));
  const lens = (v) => page.evaluate((x) => { window.__lens?.(x); }, v);
  // Care > Water > Flow balance, through the real UI.
  await page.locator('button[title="Care"]').first().click({ force: true });
  await page.waitForTimeout(800);
  await page.locator('.sheet-tabs button').nth(3).click({ force: true });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Flow balance/i }).first().click({ force: true });
  await page.waitForTimeout(1500);
  await shot('flow-panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  for (let k = 0; k < 6; k++) { await page.keyboard.press('l'); await page.waitForTimeout(200); }
  await page.waitForTimeout(2200);
  await shot('flow-lens');
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs?.slice(0, 5))));
};
