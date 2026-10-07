// The red-eyed tree frog climbing the front glass, in close-ups (its own baked climbing body and key set: util/climb.js CRAWL_SETS.redeye), the simulation stepped by hand and the
// interface hidden: a picture every STEP sim seconds (default 0.4) while it climbs, from outside the pane. The files are test-output/<name>-redeye-<n>.png.
//   node tools/shot.mjs --url=http://localhost:4660/ --only=desktop --steps=tools/steps/redeye-look.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const N = +(process.env.N ?? 16), STEP = +(process.env.STEP ?? 0.4);
  await page.evaluate(([p, v, d]) => { window.__pane = p; window.__view = v; window.__dist = d; }, [process.env.PANE ?? '', process.env.VIEW ?? '', +(process.env.DIST ?? 7)]);
  const ok = await page.evaluate(async () => {
    const g = window.game, W = g.world, A = W.animals, { TANK } = await import('/src/sim/tank.js'), { SPECIES } = await import('/src/sim/animals.js');
    const V = Object.values(A.by).flat().find((a) => a.pos).pos.constructor;
    for (const arr of Object.values(A.by)) for (const x of [...arr]) A.remove(x);
    const hz = TANK.d / 2, hx = TANK.w / 2, S = SPECIES.redeye;
    // (the same three panes and starting points as tools/steps/glass-cling.mjs: the first one with a route; the frog is looked at from outside that pane)
    const cases = [
      { name: 'front', N: new V(0, 0, -1), yaw: 0, from: [-20, 8], top: [-20, 30, hz - 0.12], cam: [2, 6, 8] },
      { name: 'left', N: new V(1, 0, 0), yaw: -Math.PI / 2, from: [-30, -4], top: [-hx + 0.12, 28, -4], cam: [-8, 6, 2] },
      { name: 'right', N: new V(-1, 0, 0), yaw: Math.PI / 2, from: [30, -4], top: [hx - 0.12, 26, -4], cam: [8, 6, 2] },
    ];
    let a = null, used = null;
    for (const c of cases) {
      if (window.__pane && c.name !== window.__pane) continue;
      const f = A.add('redeye', new V(c.from[0], W.terrain.heightAt(c.from[0], c.from[1]) + 0.2, c.from[1]), { age: 1e6 });
      const r = A.perchRoute(f, S, { top: new V(...c.top), glassN: c.N, glassYaw: c.yaw });
      if (!r) { A.remove(f); continue; }
      f.perch = { ph: 'go', top: r.p, plant: r.plant, piece: r.piece, glassN: r.glassN, glassYaw: r.glassYaw, up: r.up, base: r.base, path: r.path, near: Infinity, stuck: 0 };
      f.fs = null; f.perchLike = 'glass'; f.yaw = Math.atan2(r.base.x - f.pos.x, r.base.z - f.pos.z);   // (set facing its route: a 160 deg turn at the crawl's 25 deg/s outlasts the sim's 3 s no-headway limit)
      a = f; used = c; break;
    }
    if (!a) return false;
    window.__frog = a; window.__cam = used.cam;
    g.setSpeed(0);
    return used.name + ':' + (a.perch?.ph ?? '-');
  });
  console.log('pane and phase at the start:', ok);
  if (!ok) throw new Error('redeye-look: no route to the front pane in this layout');
  for (let i = 0; i < N; i++) {
    await page.evaluate(async (STEP) => {
      const g = window.game, W = g.world, A = W.animals, a = window.__frog;
      for (let k = 0; k < Math.round(STEP / 0.2); k++) { W.sim.step(0.2); A.move(0.2); }
      const p = a.pos; window.__ph = a.perch?.ph ?? '-'; g.rig.stopOrbit(); g.rig.moved = true;
      const c = window.__cam, y = a.yaw ?? 0;
      // VIEW=side: from the frog's right, square to its heading, low (a walk read as the owner's clip is: side-on); otherwise the pane's own offset
      if (window.__view === 'side') g.controls.setLookAt(p.x + Math.cos(y) * +(window.__dist ?? 7), p.y + 2.2, p.z - Math.sin(y) * +(window.__dist ?? 7), p.x, p.y + 0.4, p.z, false);
      else g.controls.setLookAt(p.x + c[0], p.y + c[1], p.z + c[2], p.x, p.y, p.z, false);
    }, STEP);
    await page.waitForTimeout(700);
    console.log(i, await page.evaluate(() => window.__ph + (window.__frog.climbOn ? ' (crawl)' : '')));
    await shot('redeye-' + i);
  }
};
