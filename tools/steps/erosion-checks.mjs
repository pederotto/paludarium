// Player-facing checks: a sculpted steep soil mound slumps (log line, puff), a rock whose ground is dug away settles,
// and the stability and sediment lenses draw. Screenshots: erosion-stability, erosion-sediment.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { document.querySelector('#ui').style.display = 'none'; window.game.rig.stopOrbit(); window.game.rig.view('top', false); });
  const r = await page.evaluate(async () => {
    const W = window.game.world, f = W.terrain.field, E = W.water.erosion;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const cx = 30, cz = 12;
    for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
      const [x, z] = f.toWorld(i, j);
      if (Math.hypot(x - cx, z - cz) < 3.2) f.base[f.idx(i, j)] += 9;
    }
    W.groundChanged();
    const n0 = f.idx(...f.toGrid(cx, cz).map(Math.round));
    const h0 = f.base[n0];
    const s0 = E.stats.slumped;
    await wait(250);
    let t = 0;
    while (t < 12000 && !W.logs.some((l) => l.msg === 'A bank slumped.')) { await wait(500); t += 500; }
    const h1 = f.base[n0];
    const slumpedLog = W.logs.some((l) => l.msg === 'A bank slumped.');
    const p = W.decor.addPiece('boulder', -30, 14, { size: 8, seed: 3 });
    await wait(2500);
    const y0 = p.mesh.position.y;
    for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
      const [x, z] = f.toWorld(i, j);
      if (Math.hypot(x + 30, z - 14) < 9) f.base[f.idx(i, j)] = Math.max(0.6, f.base[f.idx(i, j)] - 3);
    }
    W.groundChanged();
    await wait(1800);
    const flagged = p.unsupported === true;
    await wait(9000);
    return { moundTop: [+h0.toFixed(2), +h1.toFixed(2)], slumpedCm3: +(E.stats.slumped - s0).toFixed(2), slumpedLog, boulderY: [+y0.toFixed(2), +p.mesh.position.y.toFixed(2)], flaggedWhileHanging: flagged, flagNow: !!p.unsupported, log: W.logs.slice(0, 4).map((l) => l.msg) };
  });
  console.log('CHECK', JSON.stringify(r));
  const lens = async (l) => { await page.evaluate((l) => { window.game.lens?.set(l); }, l); await page.waitForTimeout(1500); await shot('erosion-' + l); };
  await lens('stability');
  await page.evaluate(() => { const E = window.game.world.water.erosion; for (let q = 0; q < E.nWet; q++) E.s[E.wet[q]] += 0.02; });
  await lens('sediment');
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs?.slice(0, 5))));
};
