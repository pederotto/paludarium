// Filters (content/equipment.js FILTERS, sim.js): each has its own pump that pushes the main pool's water through the media.
// Checks: it catches floating detritus, it clogs over the weeks and loses flow, the Flow panel warns, Care > Water > Rinse the
// filter clears it. Pictures of each kind with its clean-water jets. PASS/FAIL.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const ok = (c, t) => console.log(name, (c ? 'PASS ' : 'FAIL ') + t);
  const r = await page.evaluate(() => {
    const g = window.game, W = g.world, E = W.env;
    g.setSpeed(0);
    const day = () => { for (let h = 0; h < 24; h++) W.sim.step(60); };
    // Detritus with the filter on and off, from the same start.
    const keep = { detritus: E.detritus, filterDirt: E.filterDirt };
    const ab = (on) => { Object.assign(E, keep); E.detritus = 3; E.filterDirt = 0; E.filter = on; day(); return { detritus: E.detritus, dirt: E.filterDirt }; };
    const on = ab(true), off = ab(false);
    E.filter = true; E.filterDirt = 0;
    W.sim.step(5);
    const lph0 = E.filterLph;
    const curve = [];
    for (let d = 1; d <= 30; d++) { day(); if (d % 3 === 0) curve.push({ d, dirt: +E.filterDirt.toFixed(2), lph: Math.round(E.filterLph) }); }
    W.water.hydro.closeWindow();
    const warn = W.water.hydro.ledger.warnings.map((w) => w.text).filter((t) => /clog/.test(t));
    return { on, off, lph0, curve, warn, logs: W.logs.filter((l) => /clog/.test(l.msg)).length, dirt: E.filterDirt };
  });
  console.log(name, JSON.stringify(r));
  ok(r.on.detritus < r.off.detritus - 0.05 && r.on.dirt > r.off.dirt, `the filter catches floating detritus (left ${r.on.detritus.toFixed(2)} vs ${r.off.detritus.toFixed(2)} without)`);
  ok(Math.round(r.lph0) >= 110, `a clean sponge filter pumps about 120 L/h (${Math.round(r.lph0)})`);
  ok(r.curve.at(-1).lph < r.lph0 * 0.6, `after a month without a rinse its flow has dropped (${r.curve.map((c) => c.lph).join(' > ')} L/h)`);
  ok(r.warn.length > 0 && r.logs > 0, 'a clogged filter is warned about in the Flow panel and the log');
  // Rinse through the real Care panel.
  await page.evaluate(() => { window.__S.modal.value = 'care'; });
  await page.waitForTimeout(800);
  await page.locator('.sheet-tabs button').nth(3).click({ force: true });
  await page.waitForTimeout(500);
  await shot('filter-care-clogged');
  await page.getByRole('button', { name: /Rinse the filter/i }).first().click({ force: true });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => { const E = window.game.world.env; window.game.world.sim.step(5); return { dirt: E.filterDirt, lph: E.filterLph }; });
  ok(after.dirt < r.dirt * 0.1 && after.lph > 110, `Rinse the filter clears it (${r.dirt.toFixed(2)} -> ${after.dirt.toFixed(2)}, ${Math.round(after.lph)} L/h)`);
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const look = async (label, kind, p, t) => {
    await page.evaluate(([k, p, t]) => { const g = window.game, W = g.world; window.__S.layer.value = 'bottom'; W.env.filterKind = k; W.env.prefilter = true; W.plumbing.t = 99; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, ...t, false); }, [kind, p, t]);
    await page.waitForTimeout(2200); await shot('filter-' + label);
  };
  for (const k of ['sponge', 'matten', 'canister']) {
    await look(k, k, [0, 34, 80], [0, 10, -10]);
    await look(k + '-low', k, [10, -4, 80], [0, -6, -10]);
  }
};
