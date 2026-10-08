// The air pump's bubble column (run "sets"): a canyon at the long tank with the pump off and then at full, same view, plus the shop and Care wiring.
//   node tools/shot.mjs --steps=tools/steps/airpump-look.mjs --only=desktop
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const info = await page.evaluate(async () => {
    const { generateTerrarium } = await import('/src/sim/generator.js');
    const { GEAR } = await import('/src/content/equipment.js');
    const w = await window.game.loadTank('long', { layout: 'empty' });
    window.game.rig.stopOrbit();
    generateTerrarium(w, { preset: 'canyon', seed: 1, tier: 'long' });
    const had = w.equipment.has?.('airpump') ?? null;
    w.env.air = 0; w.sim.step(60);
    return { had, price: GEAR.airpump.price, air: w.env.air };
  });
  console.log('AIRPUMP setup', JSON.stringify(info));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(2500);
  await shot('air-off');
  await page.evaluate(() => { const w = window.game.world; w.env.air = 1; w.sim.step(5); });
  await page.waitForTimeout(3500);
  const em = await page.evaluate(() => { const L = window.game.world.jets?.list ?? []; return { emitters: L.length, bubbles: L.filter((m) => m.kind === 2).length, air: L.filter((m) => m.r === 1.1 && m.size === 0.24).map((m) => ({ x: +m.p.x.toFixed(1), y: +m.p.y.toFixed(1), z: +m.p.z.toFixed(1), depth: +m.depth.toFixed(1) })) }; });
  console.log('AIRPUMP emitters', JSON.stringify(em));
  await shot('air-on');
  for (const [tag, a] of [['on', 1], ['off', 0]]) {
    await page.evaluate(([a]) => { const g = window.game, w = g.world; w.env.air = a; const e = w.jets?.list?.find((m) => m.r === 1.1 && m.size === 0.24); const p = e?.p ?? { x: 37.6, y: 32.9, z: 2.1 }; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(p.x, p.y - 14, p.z + 26, p.x, p.y - 14, p.z, false); }, [a]);
    await page.waitForTimeout(3000);
    await shot('air-close-' + tag);
  }
  const o2 = await page.evaluate(() => { const w = window.game.world; w.sim.step(600); return { o2: +w.env.oxygen.toFixed(2), sump: +w.water.bodies.sump.oxygen.toFixed(2) }; });
  console.log('AIRPUMP oxygen after 10 h at full', JSON.stringify(o2), 'errors', errors.length, JSON.stringify(errors.slice(0, 3)));
};
