// B5d check (numbers, no screenshots): the water below the ground in the starter tank as a false bottom, a LECA layer and a
// plain substrate. In the X-ray layer the body (render/soilside.js `body`) is shown, its height uniform and the cut-away's level
// equal sim/plenum.js belowGround(E), and the sheet reaches that level (cells whose ground is over it); in Surface it is hidden.
// PASS/FAIL per build, then console errors.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const ok = (c, t) => console.log(name, (c ? 'PASS ' : 'FAIL ') + t);
  const r = await page.evaluate(async () => {
    const { belowGround, bodyTop } = await import('/src/sim/plenum.js');
    const g = window.game, W = g.world, E = W.env, S = W.soilSide, out = {};
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const keep = { drainage: E.drainage, plenumH: E.plenumH, plenumLevel: E.plenumLevel, groundLevel: E.groundLevel };
    for (const [build, v] of [['false bottom', 1], ['LECA', 0.6], ['plain', 0]]) {
      E.drainage = v; E.plenumLevel = undefined; E.groundLevel = undefined;
      if (v >= 1) E.plenumH = Math.round((W.water.level + 1) * 2) / 2;
      W.sim.step(10);
      g.layers.set('xray'); await frames(6);
      const b = belowGround(E, W.water.level), geo = S.body.geometry, gA = geo.getAttribute('g'), upA = geo.getAttribute('up');
      let top = 0;
      if (gA) for (let k = 0; k < gA.count; k++) if (upA.getX(k) > 0.5) top = Math.max(top, bodyTop(gA.getX(k), S.u.level.value));
      const row = { level: +b.level.toFixed(3), litres: +b.L.toFixed(2), mode: b.mode, visible: S.body.visible, uLevel: +S.u.level.value.toFixed(3), uWater: +S.u.water.value.toFixed(3), top: +top.toFixed(3), verts: gA?.count ?? 0, pool: +W.water.level.toFixed(2) };
      g.layers.set('surface'); await frames(3);
      row.surfaceHidden = !S.body.visible;
      out[build] = row;
    }
    Object.assign(E, keep); W.sim.step(1);
    return out;
  });
  console.log(JSON.stringify(r));
  for (const [build, v] of Object.entries(r)) {
    ok(v.visible && v.verts > 0, `${build}: the X-ray body is shown (${v.verts} vertices)`);
    ok(Math.abs(v.uLevel - v.level) <= 0.02 && Math.abs(v.uWater - v.level) < 1e-3, `${build}: body ${v.uLevel} cm and cut-away ${v.uWater} cm = belowGround ${v.level} cm (${v.litres} L, pool ${v.pool} cm)`);
    ok(Math.abs(v.top - v.uLevel) < 1e-3, `${build}: the sheet's top reaches the level (${v.top} cm)`);
    ok(v.surfaceHidden, `${build}: hidden in Surface`);
  }
  ok(!errs.length, 'no console errors ' + JSON.stringify(errs.slice(0, 5)));
};
