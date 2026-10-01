// Edits the ground under the pump, under pools and on slopes in the real starter tank and
// checks that water is conserved (total within 0.5%) and the pump keeps running.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const rep = await page.evaluate(async () => {
    const W = window.game.world, H = W.water.hydro, f = W.terrain.field;
    H.topUp = false;
    const out = [];
    const bump = (cx, cz, r, dh) => {
      for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
        const [x, z] = f.toWorld(i, j);
        const k = Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));
        f.base[f.idx(i, j)] = Math.max(0.6, f.base[f.idx(i, j)] + dh * k);
      }
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const t0 = H.total();
    const cases = [
      ['raise under the pump', H.pump.intake.x, H.pump.intake.z, 4, 14],
      ['raise under top pool', -26, -15.5, 3, 6],
      ['raise under middle pool', -3, -13, 3, 5],
      ['raise on the stream slope', 3, -7, 4, 4],
      ['dig the lagoon', 0, 8, 6, -3],
      ['raise under the spring pool', 32, -15.5, 3, 4],
    ];
    for (const [label, cx, cz, r, dh] of cases) {
      const before = H.total();
      bump(cx, cz, r, dh);
      W.groundChanged();
      const right = H.total();
      await wait(1500);
      const after = H.total();
      out.push({ label, before: Math.round(before), afterEdit: Math.round(right), afterRun: Math.round(after), dEdit: +(((right - before) / before) * 100).toFixed(3), dRun: +(((after - before) / before) * 100).toFixed(3), pump: H.pump.running, level: +H.level.toFixed(2), intake: [Math.round(H.pump.intake.x), Math.round(H.pump.intake.z)], imb: +H.ledger.check.maxImbalance.toFixed(3) });
    }
    return { out, drift: +(((H.total() - t0) / t0) * 100).toFixed(3), logs: W.logs.slice(0, 4).map((l) => l.msg), warnings: H.ledger.warnings.map((w) => w.text), pools: H.pools.length, bodies: W.water.bodies.list.map((b) => `${b.name} ${b.vol.toFixed(1)}L in ${b.inLph.toFixed(0)} out ${b.outLph.toFixed(0)}`) };
  });
  for (const r of rep.out) console.log(JSON.stringify(r));
  console.log('total drift %', rep.drift, 'pools', rep.pools);
  console.log('logs', JSON.stringify(rep.logs));
  console.log('warnings', JSON.stringify(rep.warnings));
  console.log('bodies', JSON.stringify(rep.bodies));
  const bad = rep.out.filter((r) => Math.abs(r.dEdit) > 0.5 || Math.abs(r.dRun) > 0.5 || !r.pump);
  console.log(bad.length ? 'FAIL ' + JSON.stringify(bad) : 'PASS water conserved');
  await shot('water-conserve');
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs?.slice(0, 5))));
};
