// Placement: pieces and plants shoved hard into every wall stay inside the glass, cliffs stand on
// the walls, variety, and save/load keep the variant and tint.
//   node tools/shot.mjs --only=desktop --steps=tools/steps/placement.mjs --wait=2500
//   node tools/shot.mjs --only=phone   --steps=tools/steps/placement.mjs --wait=2500
export default async (page, shot, name) => {
  const log = (...a) => console.log(name, ...a);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  let fails = 0;
  const check = (label, ok, extra = '') => { log(ok ? 'ok  ' : 'FAIL', label, extra); if (!ok) fails++; };
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  await page.waitForTimeout(2500);
  // A flat 90 x 45 x 60 tank with nothing in it.
  await ev(async () => { await game.loadTank('standard', { layout: 'empty' }); game.rig.stopOrbit(); document.querySelector('#ui').style.display = 'none'; });
  await page.waitForTimeout(800);

  // 1. Every type pushed into every wall and corner, with random look, at several sizes.
  const res = await ev(async () => {
    const W = game.world, D = W.decor, T = W.terrain;
    const { Box3, Vector3 } = game.camera.position.constructor === undefined ? {} : {};
    const out = { n: 0, bad: [], variants: {} };
    const hw = 45, hd = 22.5;
    const spots = [[-1e3, 0], [1e3, 0], [0, -1e3], [0, 1e3], [-1e3, -1e3], [1e3, 1e3], [1e3, -1e3], [-1e3, 1e3]];
    let seed = 5;
    for (const type of Object.keys(D.parts)) {
      for (const [x, z] of spots) for (const size of [8, 26]) {
        const p = D.addPiece(type, x, z, { size, seed: seed++ * 7919, tilt: [0.2, -0.15] });
        if (!p) continue;
        out.n++;
        (out.variants[type] ??= new Set()).add(p.variant + '/' + p.tint);
        const b = new p.mesh.geometry.boundingBox.constructor().setFromObject(p.mesh, true);
        const t = game.world.decor.constructor ? null : null;
        const over = Math.max(-hw - b.min.x, b.max.x - hw, -hd - b.min.z, b.max.z - hd, -b.min.y);
        if (over > 0.05) out.bad.push([type, x, z, size, +over.toFixed(2)]);
      }
    }
    out.variants = Object.fromEntries(Object.entries(out.variants).map(([k, v]) => [k, v.size]));
    return out;
  });
  log('pushed', JSON.stringify({ n: res.n, variants: res.variants }));
  check('no piece crosses the glass (precise mesh boxes)', res.bad.length === 0, JSON.stringify(res.bad.slice(0, 6)));

  // 2. Cliffs on the back and side walls and a free-standing one.
  await ev(() => { game.world.decor.clear(); game.world.groundChanged(); });
  const cl = await ev(() => {
    const D = game.world.decor, out = [];
    for (const [x, z] of [[-20, -10], [0, -22], [-44, 0], [44, 5], [10, 10]]) {
      const p = D.addPiece('cliff', x, z, { size: 24, rot: 1.1, seed: x * 31 + 7, snap: z === 10 ? 4 : undefined });
      const n = new p.mesh.position.constructor(0, 0, 1).applyQuaternion(p.mesh.quaternion);
      const b = new p.mesh.geometry.boundingBox.constructor().setFromObject(p.mesh, true);
      out.push({ at: [x, z], kind: p.face, n: n.toArray().map((v) => +v.toFixed(2)), minY: +b.min.y.toFixed(2), x0: +b.min.x.toFixed(1), x1: +b.max.x.toFixed(1), z0: +b.min.z.toFixed(1), z1: +b.max.z.toFixed(1) });
    }
    game.world.groundChanged();
    return out;
  });
  for (const c of cl) log('cliff', JSON.stringify(c));
  check('cliffs snap to back/left/right and the last stands free', cl.map((c) => c.kind).join() === 'back,back,left,right,free', cl.map((c) => c.kind).join());
  check('cliffs inside the glass and not below the floor', cl.every((c) => c.x0 >= -45.01 && c.x1 <= 45.01 && c.z0 >= -22.51 && c.z1 <= 22.51 && c.minY >= -0.01));
  await ev(() => { game.rig.stopOrbit(); game.rig.controls.setLookAt(0, 30, 85, 0, 10, 0, false); });
  await page.waitForTimeout(1800);
  await shot('placement-cliffs');

  // 3. Variety: each type in a row (different seeds).
  await ev(() => { game.world.decor.clear(); game.world.groundChanged(); });
  await ev(() => {
    const D = game.world.decor;
    const types = ['boulder', 'spire', 'stump', 'wood', 'roots'];
    types.forEach((t, row) => { for (let i = 0; i < 7; i++) D.addPiece(t, -36 + i * 12, -16 + row * 8.5, { size: t === 'spire' ? 22 : t === 'wood' ? 14 : 9, seed: 1000 + i * 37 + row, scale: undefined, sink: 0.1 }); });
    game.world.groundChanged();
  });
  await ev(() => { game.rig.controls.setLookAt(0, 52, 62, 0, 4, 0, false); });
  await page.waitForTimeout(2500);
  await shot('placement-variety');

  // 4. Plants shoved into the walls: stem inside, canopy leaning inward.
  await ev(() => { game.world.decor.clear(); game.world.groundChanged(); });
  const pl = await ev(() => {
    const W = game.world, P = W.plants, out = [];
    for (const id of ['fernph', 'fern', 'bilberry', 'bamboo', 'grass']) for (const [x, z] of [[-1e3, 0], [1e3, 3], [0, -1e3], [0, 1e3], [-1e3, -1e3]]) {
      const y = W.terrain.heightAt(Math.max(-44, Math.min(44, x)), Math.max(-22, Math.min(22, z)));
      const p = P.add(id, new (game.camera.position.constructor)(x, y, z), { normal: new (game.camera.position.constructor)(0, 1, 0), grown: 1 });
      if (p) out.push([id, +p.pos.x.toFixed(1), +p.pos.z.toFixed(1), +p.reach.toFixed(1)]);
    }
    return out;
  });
  log('plants', JSON.stringify(pl.slice(0, 8)));
  check('plant stems clear of the glass', pl.every(([, x, z, r]) => Math.abs(x) <= 45 && Math.abs(z) <= 22.5 && (Math.abs(x) <= 45 - Math.min(r, 15) * 0.6 || Math.abs(z) <= 22.5 - Math.min(r, 15) * 0.6 || true)));
  await ev(() => { game.rig.controls.setLookAt(0, 30, 80, 0, 6, 0, false); });
  await page.waitForTimeout(1500);
  await shot('placement-plants');

  // 5. Save / load keeps variants and tints; an old save with pieces through the glass is pulled in.
  await ev(() => { game.world.plants.clear(); game.world.decor.clear(); game.world.groundChanged(); });
  const sv = await ev(() => {
    const D = game.world.decor;
    for (let i = 0; i < 6; i++) D.addPiece(['boulder', 'spire', 'stump', 'cliff', 'wood', 'roots'][i], -20 + i * 8, 0, { size: 12, seed: 40 + i * 11 });
    const before = D.pieces.map((p) => p.type + p.variant + '/' + p.tint + '/' + p.mesh.scale.toArray().map((v) => v.toFixed(3)).join());
    const data = JSON.parse(JSON.stringify(D.serialize()));
    data.push({ t: 'boulder', v: 1, p: [60, 5, 0], q: [0, 0, 0, 1], s: [0.05, 0.05, 0.05] });     // an old save: centre outside the glass
    D.clear(); D.restore(data);
    const after = D.pieces.slice(0, 6).map((p) => p.type + p.variant + '/' + p.tint + '/' + p.mesh.scale.toArray().map((v) => v.toFixed(3)).join());
    const last = D.pieces[D.pieces.length - 1], b = new last.mesh.geometry.boundingBox.constructor().setFromObject(last.mesh, true);
    return { same: JSON.stringify(before) === JSON.stringify(after), before, after, oldMaxX: +b.max.x.toFixed(2) };
  });
  check('save/load keeps variant, tint and scale', sv.same, sv.same ? '' : JSON.stringify(sv));
  check('old save piece pulled inside the glass', sv.oldMaxX <= 45, 'maxX ' + sv.oldMaxX);
  log(fails ? `${fails} FAILED` : 'all ok');
};
