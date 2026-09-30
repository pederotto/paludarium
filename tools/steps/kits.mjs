// Symmetry and kits: Mirror on, a sculpt stroke, a piece and a kit (each mirrored), one undo per kit,
// then every kit on its own, the Studio Kits tab and the Hardscape kit list.
//   node tools/shot.mjs --only=desktop --steps=tools/steps/kits.mjs --wait=2500
//   node tools/shot.mjs --only=phone   --steps=tools/steps/kits.mjs --wait=2500
export default async (page, shot, name) => {
  const log = (...a) => console.log(name, ...a);
  let fails = 0;
  const check = (label, ok, extra = '') => { log(ok ? 'ok  ' : 'FAIL', label, extra); if (!ok) fails++; };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await page.getByRole('button', { name: /starter paludarium/i }).click();
  await page.waitForTimeout(2500);
  // The starter tank is full of hardscape: clear it so there is room to build.
  await page.evaluate(() => { game.world.decor.clear(); game.world.plants.clear(); game.world.groundChanged(); game.world.undoStack.length = 0; });
  await page.waitForTimeout(500);

  // Screen position of a point on the ground.
  const scr = (x, z) => ev(([x, z]) => {
    const g = window.game, y = g.world.terrain.heightAt(x, z);
    const v = new g.camera.position.constructor(x, y, z).project(g.camera);
    const r = g.renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, z]);
  // A spot on the +x side where the piece and its mirror image both land on dry ground clear of other pieces.
  const freeSpot = (clear, avoid = [], x0 = 30, x1 = 14) => ev(([clear, avoid, x0, x1]) => {
    const g = window.game, W = g.world, T = W.terrain, wl = W.water.level;
    for (let x = x0; x >= x1; x -= 2) for (let z = -8; z <= 2; z += 2) {
      const ok = (px) => T.heightAt(px, z) > wl + 0.8 && W.decor.pieces.every((p) => Math.hypot(p.mesh.position.x - px, p.mesh.position.z - z) > clear);
      if (ok(x) && ok(-x) && avoid.every((a) => Math.hypot(a[0] - x, a[1] - z) > clear)) return [x, z];
    }
    return null;
  }, [clear, avoid, x0, x1]);
  const tool = async (label) => {
    await page.locator('.tool', { hasText: label }).click();
    await page.waitForTimeout(500);
    if (!(await page.locator('.opts').count())) { await page.locator('.vchip').click(); await page.waitForTimeout(500); }
  };
  const counts = () => ev(() => ({ pieces: game.world.decor.pieces.length, outlets: game.world.water.hydro.outlets.length, undo: game.world.undoStack.length }));
  const click = async (x, z) => {
    await ev(() => game.rig.view('front'));           // a view where the tank is clear of the panels
    await page.waitForTimeout(1200);
    const [sx, sy] = await scr(x, z);
    const el = await ev(([x, y]) => document.elementFromPoint(x, y)?.tagName, [sx, sy]);
    if (el !== 'CANVAS') log('WARN click point covered by', el, sx | 0, sy | 0); await page.mouse.click(sx, sy); await page.waitForTimeout(900); };

  // --- Mirror + sculpt ------------------------------------------------------------------------------
  await tool('Sculpt');
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  check('Mirror chip is on after pressing M', (await page.locator('.opts .chip.mirror.on').count()) === 1);
  const before = await ev(() => { const T = game.world.terrain; return [T.baseAt(-26, 4), T.baseAt(26, 4)]; });
  const [sx, sy] = await scr(-26, 4);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) { const [x, y] = await scr(-26 + i * 0.55, 4); await page.mouse.move(x, y); await page.waitForTimeout(160); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await ev(() => { const T = game.world.terrain; return [T.baseAt(-26, 4), T.baseAt(26, 4)]; });
  const dl = after[0] - before[0], dr = after[1] - before[1];
  check('sculpt stroke raised the drawn side', dl > 0.15, dl.toFixed(2));
  check('and the mirrored side by about the same', dr > 0.15 && Math.abs(dl - dr) < 0.4 * Math.max(dl, dr), dr.toFixed(2));
  await shot('kits-1-sculpt');

  // --- Mirror + one piece ----------------------------------------------------------------------------
  await tool('Hardscape');
  const c0 = await counts();
  const spot = await freeSpot(12, [], 40, 34);
  check('found a free spot for a piece', !!spot);
  await click(spot[0], spot[1]);
  const c1 = await counts();
  check('one piece placed with its mirror image', c1.pieces === c0.pieces + 2, `${c0.pieces} -> ${c1.pieces}`);
  const pair = await ev(() => { const P = game.world.decor.pieces, a = P[P.length - 2].mesh, b = P[P.length - 1].mesh; return { ax: a.position.x, bx: b.position.x, az: a.position.z, bz: b.position.z, sa: a.scale.x, sb: b.scale.x }; });
  check('mirror piece sits at -x, same z, with x scale flipped', Math.abs(pair.ax + pair.bx) < 3 && Math.abs(pair.az - pair.bz) < 0.5 && pair.sa * pair.sb < 0, JSON.stringify(pair));
  await shot('kits-2-piece');

  // --- Mirror + a kit; one undo step per kit -----------------------------------------------------------------
  await page.keyboard.press('Escape');            // deselect the piece
  await page.locator('.opts .pick', { hasText: 'Waterfall cliff' }).click();
  await page.waitForTimeout(400);
  check('kit armed: the note shows', (await page.locator('.opts .kit-armed').count()) === 1);
  const spot2 = await freeSpot(12, [spot], 28, 16);
  check('found a free spot for a kit', !!spot2);
  const k0 = await counts();
  await page.mouse.move(...(await scr(spot2[0], spot2[1])));
  await page.waitForTimeout(300);
  await shot('kits-3-hover');
  await click(spot2[0], spot2[1]);
  const k1 = await counts();
  check('waterfall kit placed with its mirror image (2 x 4 pieces)', k1.pieces === k0.pieces + 8, `${k0.pieces} -> ${k1.pieces}`);
  check('two outlets on the tops', k1.outlets === k0.outlets + 2, `${k0.outlets} -> ${k1.outlets}`);
  check('one undo step for the kit', k1.undo === k0.undo + 1, `${k0.undo} -> ${k1.undo}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await shot('kits-4-waterfall');

  // Undo takes the kit, both halves, out in one go; then the piece pair; then the sculpt pair.
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  const u1 = await counts();
  check('undo removes the kit and its mirror together', u1.pieces === k0.pieces && u1.outlets === k0.outlets, `${u1.pieces} pieces, ${u1.outlets} outlets`);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  check('undo removes the piece and its mirror together', (await counts()).pieces === c0.pieces);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(600);
  const back = await ev(() => { const T = game.world.terrain; return [T.baseAt(-26, 4), T.baseAt(26, 4)]; });
  check('undo takes back both sides of the sculpt stroke', Math.abs(back[0] - before[0]) < 0.05 && Math.abs(back[1] - before[1]) < 0.05, JSON.stringify(back));

  // --- Every kit on its own (Mirror off) ----------------------------------------------------------------------------
  await page.keyboard.press('m');
  await page.waitForTimeout(200);
  await tool('Hardscape');
  // A clean flat tank, so each kit can be judged on its own.
  await ev(() => { game.world.empty(); game.world.water.setLevel(0); game.world.groundChanged(); });
  check('Mirror is off after pressing M again', (await page.locator('.opts .chip.mirror.on').count()) === 0);
  for (const [id, label, n] of [['waterfall', 'Waterfall cliff', 4], ['arch', 'Root arch', 5], ['steps', 'Stepping stones', 7], ['spires', 'Spire cluster', 5], ['island', 'Mossy island', 4]]) {
    await page.locator('.opts .pick', { hasText: label }).click();
    await page.waitForTimeout(300);
    const s = [id === 'steps' ? 0 : 4, 0];
    const a = await counts();
    await click(s[0], s[1]);
    const b = await counts();
    check(`${id}: ${n} pieces`, b.pieces - a.pieces === n, `${a.pieces} -> ${b.pieces}`);
    await page.keyboard.press('Escape');
    // Look at it from close up, in front and a little above.
    await page.mouse.move(640, 300);
    await ev(([x, z]) => { const g = window.game; g.controls.setLookAt(x, 30, z + 62, x, 9, z, false); }, s);
    await page.waitForTimeout(700);
    log(id, JSON.stringify(await ev(() => game.world.decor.pieces.map((p) => { const b = new (game.camera.position.constructor)(); const bb = new (game.world.terrain.mesh.geometry.boundingBox.constructor)().setFromObject(p.mesh); return [p.type, +p.mesh.position.x.toFixed(1), +p.mesh.position.z.toFixed(1), +bb.min.y.toFixed(1), +bb.max.y.toFixed(1)]; }))), 'outlets', JSON.stringify(await ev(() => game.world.water.hydro.outlets.map((o) => o.pos.toArray().map((v) => +v.toFixed(1))))));
    await shot('kit-' + id);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
  }

  // A kit with Mirror on, in the clean tank: the arch and its mirror image, seen from the front.
  await page.keyboard.press('m');
  await page.locator('.opts .pick', { hasText: 'Root arch' }).click();
  await page.waitForTimeout(300);
  const m0 = await counts();
  await click(22, 4);
  const m1 = await counts();
  check('mirrored kit: 2 x 5 pieces', m1.pieces - m0.pieces === 10, `${m0.pieces} -> ${m1.pieces}`);
  await page.mouse.move(640, 300);
  await page.keyboard.press('Escape');
  await ev(() => { game.controls.setLookAt(0, 46, 92, 0, 8, 0, false); });
  await page.waitForTimeout(700);
  await shot('kits-7-mirrored-kit');

  // --- Mirror with plants, channels, pools and outlets (Mirror is on) ---------------------------------------------------------
  await ev(() => { game.world.decor.clear(); game.world.groundChanged(); });   // nothing in the way of the ray
  await tool('Plants');
  check('Plants options show the Mirror toggle', (await page.locator('.opts .chip.mirror.on').count()) === 1);
  const p0 = await ev(() => game.world.plants.list.length);
  await click(20, 4);
  const p1 = await ev(() => game.world.plants.list.length);
  check('a plant and its mirror image', p1 === p0 + 2, `${p0} -> ${p1}`);
  await tool('Water');
  check('Water options show the Mirror toggle for the channel', (await page.locator('.opts .chip.mirror.on').count()) === 1);
  const bed = () => ev(() => { const T = game.world.terrain; return [T.baseAt(-17, 0), T.baseAt(17, 0), T.baseAt(-32, -8), T.baseAt(32, -8)]; });
  const b0 = await bed();
  await ev(() => game.rig.view('front'));
  await page.waitForTimeout(1200);
  const [cx, cy] = await scr(11, -6);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { const [x, y] = await scr(11 + i * 1.5, -6 + i * 1.5); await page.mouse.move(x, y); await page.waitForTimeout(120); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  const b1 = await bed();
  check('channel dug on both sides', b0[0] - b1[0] > 0.3 && b0[1] - b1[1] > 0.3 && Math.abs(b1[0] - b1[1]) < 0.3, JSON.stringify([b0, b1].map((a) => a.map((v) => +v.toFixed(2)))));
  await page.getByRole('button', { name: 'Pool', exact: true }).click();
  await click(32, -8);
  const b2 = await bed();
  check('pool dug on both sides', b1[2] - b2[2] > 0.3 && b1[3] - b2[3] > 0.3, JSON.stringify(b2.map((v) => +v.toFixed(2))));
  await page.getByRole('button', { name: 'Outlet', exact: true }).click();
  const o0 = await counts();
  await click(22, 10);
  const o1 = await counts();
  check('outlet and its mirror image', o1.outlets === o0.outlets + 2, `${o0.outlets} -> ${o1.outlets}`);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  check('one undo removes both outlets', (await counts()).outlets === o0.outlets);

  // --- Studio > Kits ---------------------------------------------------------------------------------------------
  await page.evaluate(() => { document.querySelector('.dock button[title="Studio"]')?.click(); });
  await page.waitForTimeout(1200);
  await page.locator('.sheet-tabs button', { hasText: 'Kits' }).click();
  await page.waitForTimeout(600);
  check('Studio lists 5 kits', (await page.locator('.sheet .tile.kit').count()) === 5);
  await shot('kits-5-studio');
  await page.locator('.sheet .tile.kit .btn', { hasText: 'Place a kit' }).nth(3).click();
  await page.waitForTimeout(900);
  check('choosing a kit closes the Studio and arms it', (await page.locator('.sheet').count()) === 0 && (await page.locator('.opts .kit-armed').count()) === 1);
  await shot('kits-6-armed');

  const errs = await ev(() => window.__errs.filter((e) => !e.startsWith('warn')).slice(0, 6));
  check('no console errors', errs.length === 0, JSON.stringify(errs));
  log(fails ? `${fails} CHECKS FAILED` : 'all checks passed');
};
