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
  // N3b sand readout (X-ray, plain substrate, noon, speed 0): two frames, the body drawn and the body's material hidden. The
  // footprint is every pixel the body changes (> 6/255); its inner pixels (5x5 all in it) are used. The sand's texture: the
  // high-pass luminance (pixel minus its 5x5 mean) with the body regressed on that without (gain = cov/var; an overlay of
  // opacity a gives 1 - a; the body's own edges add uncorrelated noise and do not raise it), and the mean luminance the body adds. Rule: texture kept
  // >= 0.70 and added luminance <= +0.03 (wet sand reads darker or equal, never a pale block). Columns of the footprint taller than
  // half the frame are listed (the "column" C1 saw), skipping pixels that change between two body-hidden frames (animation); the
  // side walls' screen x is printed next to them. Metric frozen at N3b step 1 run 2 (regression gain). Stamp: the served tree's HEAD and whether soilside.js is dirty.
  {
    const { execSync } = await import('node:child_process');
    const sh = (c) => { try { return execSync(c, { cwd: process.cwd() }).toString().trim(); } catch { return '?'; } };
    console.log(name, `STAMP below-ground N3b head ${sh('git rev-parse --short HEAD')} soilside ${sh('git status --porcelain src/render/soilside.js') ? 'dirty' : 'clean'} lookKeys ${await page.evaluate(() => Object.keys(window.game.world.soilSide.body.material.userData.look?.() ?? {}).join('+'))}`);
    await page.evaluate(async () => {
      const g = window.game, W = g.world, E = W.env; g.setSpeed?.(0);
      E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60; E.drainage = 0; E.plenumLevel = undefined; E.groundLevel = undefined;
      W.sim.step(10); g.layers.set('xray');
    });
    const settle = () => page.evaluate(() => new Promise((res) => { let k = 0; const f = () => (++k >= 20 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await settle(); await page.waitForTimeout(600);
    const a = (await page.screenshot({ type: 'png' })).toString('base64');
    await page.evaluate(() => { window.game.world.soilSide.body.material.visible = false; }); await settle(); await page.waitForTimeout(600);
    const b = (await page.screenshot({ type: 'png' })).toString('base64');
    await settle(); await page.waitForTimeout(600);
    const b2 = (await page.screenshot({ type: 'png' })).toString('base64');
    await page.evaluate(() => { window.game.world.soilSide.body.material.visible = true; });
    // Where the body's side walls (soilside.js rebuildBody rim, 1.5 cm in from the side glass) land on screen, for the column list.
    const walls = await page.evaluate(() => {
      const g = window.game, S = g.world.soilSide, cam = [g.camera, g.view?.camera, g.cam?.camera, g.world.camera, ...Object.values(g)].find((v) => v?.isCamera);
      if (!cam) return 'no camera';
      cam.updateMatrixWorld(); const P = cam.projectionMatrix.elements, V = cam.matrixWorldInverse.elements, pos = S.body.geometry.getAttribute('position'), up = S.body.geometry.getAttribute('up');
      const px = (x, y, z) => { const v = [0, 1, 2, 3].map((r) => V[r] * x + V[4 + r] * y + V[8 + r] * z + V[12 + r]); const c = [0, 3].map((r) => P[r] * v[0] + P[4 + r] * v[1] + P[8 + r] * v[2] + P[12 + r] * v[3]); return Math.round((c[0] / c[1] * 0.5 + 0.5) * innerWidth); };
      let xmax = -1e9, xmin = 1e9; for (let k = 0; k < pos.count; k++) { const x = pos.getX(k); xmax = Math.max(xmax, x); xmin = Math.min(xmin, x); }
      const side = (X) => { const xs = []; for (let k = 0; k < pos.count; k++) if (up.getX(k) < 0.5 && Math.abs(pos.getX(k) - X) < 1e-3) xs.push(px(X, S.u.level.value / 2, pos.getZ(k))); return xs.length ? [Math.min(...xs), Math.max(...xs)] : null; };
      return { right: side(xmax), left: side(xmin), viewW: innerWidth };
    });
    const s = await page.evaluate(async ([a, b, b2]) => {
      const read = async (b64) => { const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = new OffscreenCanvas(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height); };
      const A = await read(a), B = await read(b), B2 = await read(b2), w = A.width, h = A.height;
      const lum = (D) => { const o = new Float32Array(w * h); for (let i = 0; i < w * h; i++) o[i] = (0.2126 * D.data[i * 4] + 0.7152 * D.data[i * 4 + 1] + 0.0722 * D.data[i * 4 + 2]) / 255; return o; };
      const la = lum(A), lb = lum(B), mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) { const d = Math.max(Math.abs(A.data[i * 4] - B.data[i * 4]), Math.abs(A.data[i * 4 + 1] - B.data[i * 4 + 1]), Math.abs(A.data[i * 4 + 2] - B.data[i * 4 + 2])); mask[i] = d > 6 ? 1 : 0; }
      const hp = (l, x, y) => { let m = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) m += l[(y + j) * w + x + i]; return l[y * w + x] - m / 25; };
      let n = 0, ea = 0, eb = 0, ma = 0, mb = 0, ra = 0, rb = 0, ga = 0, gb = 0, bA = 0, bB = 0;
      for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { const i = y * w + x; if (!mask[i]) continue; let inner = 1; for (let j = -2; j <= 2 && inner; j++) for (let k = -2; k <= 2; k++) if (!mask[i + j * w + k]) { inner = 0; break; } if (!inner) continue; n++; const p = hp(la, x, y), q = hp(lb, x, y); ea += p * q; eb += q * q; ma += la[i]; mb += lb[i];
        ra += A.data[i * 4]; rb += B.data[i * 4]; bA += A.data[i * 4 + 2]; bB += B.data[i * 4 + 2]; }
      const cols = []; let run = null;
      const still = (i) => Math.max(Math.abs(B.data[i * 4] - B2.data[i * 4]), Math.abs(B.data[i * 4 + 1] - B2.data[i * 4 + 1]), Math.abs(B.data[i * 4 + 2] - B2.data[i * 4 + 2])) <= 6;
      for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) c += mask[y * w + x] && still(y * w + x) ? 1 : 0; const tall = c > h * 0.5; if (tall && !run) run = [x, x]; else if (tall) run[1] = x; else if (run) { cols.push(run); run = null; } }
      if (run) cols.push(run);
      return { w, h, n, keep: n ? ea / eb : NaN, dL: n ? (ma - mb) / n : NaN, dBR: n ? ((bA - ra) - (bB - rb)) / n / 255 : NaN, cols };
    }, [a, b, b2]);
    ok(s.n > 500 && s.keep >= 0.7 && s.dL <= 0.03, `sand under the body (plain, X-ray, noon): texture kept ${s.keep.toFixed(2)} (>= 0.70), luminance ${s.dL >= 0 ? '+' : ''}${s.dL.toFixed(3)} (<= +0.03), blue-red shift ${s.dBR.toFixed(3)}, footprint ${s.n} px of ${s.w}x${s.h}, tall columns (animated px masked) ${JSON.stringify(s.cols)} side walls on screen ${JSON.stringify(walls)}`);
  }
  ok(!errs.length, 'no console errors ' + JSON.stringify(errs.slice(0, 5)));
};
