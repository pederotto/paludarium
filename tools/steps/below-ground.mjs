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
    // N3 look readout: the body's colour and opacity (its top sheet) next to the pool water's as drawn in X-ray. The pool's colour
    // is U.tint (render/water.js volume and surface, shaders.js fog); its opacity the surface's deep veil 0.12 + 0.35 (water.js
    // veil). The body publishes its own in material.userData.look (soilside.js makeBody); before that, its constants are read.
    const { U } = await import('/src/render/uniforms.js'), mat = S.body.material, cv = mat.colorNode?.value;
    const look = mat.userData.look?.() ?? { rgb: cv ? [cv.x ?? cv.r, cv.y ?? cv.g, cv.z ?? cv.b] : null, opacity: 0.5 };
    out.look = { body: look, pool: { rgb: [U.tint.value.r, U.tint.value.g, U.tint.value.b], opacity: 0.47 } };
    return out;
  });
  console.log(JSON.stringify(r));
  const hue = ([r0, g0, b0]) => { const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0), d = mx - mn; if (!d) return 0; const h = mx === r0 ? ((g0 - b0) / d) % 6 : mx === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4; return (h * 60 + 360) % 360; };
  const L = r.look; delete r.look;
  const f3 = (a) => a ? a.map((x) => x.toFixed(3)).join(', ') : 'unread';
  const hb = L.body.rgb ? hue(L.body.rgb) : NaN, hp = hue(L.pool.rgb), dh = Math.abs(((hb - hp + 540) % 360) - 180);
  ok(dh <= 15 && Math.abs(L.body.opacity - L.pool.opacity) <= 0.1, `look: body rgb ${f3(L.body.rgb)} hue ${hb.toFixed(0)} opacity ${L.body.opacity.toFixed(2)} vs pool rgb ${f3(L.pool.rgb)} hue ${hp.toFixed(0)} opacity ${L.pool.opacity.toFixed(2)} (hue off ${dh.toFixed(0)} deg)`);
  for (const [build, v] of Object.entries(r)) {
    ok(v.visible && v.verts > 0, `${build}: the X-ray body is shown (${v.verts} vertices)`);
    ok(Math.abs(v.uLevel - v.level) <= 0.02 && Math.abs(v.uWater - v.level) < 1e-3, `${build}: body ${v.uLevel} cm and cut-away ${v.uWater} cm = belowGround ${v.level} cm (${v.litres} L, pool ${v.pool} cm)`);
    ok(Math.abs(v.top - v.uLevel) < 1e-3, `${build}: the sheet's top reaches the level (${v.top} cm)`);
    ok(v.surfaceHidden, `${build}: hidden in Surface`);
  }
  ok(!errs.length, 'no console errors ' + JSON.stringify(errs.slice(0, 5)));
};
