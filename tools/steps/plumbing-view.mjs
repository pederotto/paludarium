// N17: what render/plumbing.js draws in each view layer (render/layers.js), from the meshes the camera would draw. Two set-ups:
// the starter tank's pump hose to its stream outlet with a canister filter in the cabinet, and a false bottom with the bed
// filter's tower pump. Per layer: meshes drawn, triangles of hoses and pipes (tube vertices carry along.z = circuit 1 or 2, and
// the moving water band is drawn on exactly those), triangles of devices (everything else in the merged mesh), jets.
// Target: Surface draws 0 tube triangles; devices the same in every layer; X-ray and Bottom as before. PASS/FAIL.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const ok = (c, t) => console.log(name, (c ? 'PASS ' : 'FAIL ') + t);
  const setup = (s) => page.evaluate(async (s) => {
    const { FILTERS } = await import('/src/content/equipment.js');
    const W = window.game.world, E = W.env, P = W.plumbing;
    window.game.setSpeed(0);
    const kinds = Object.keys(FILTERS);
    E.filter = true; E.prefilter = false;
    if (s === 'canister') { E.filterKind = kinds.find((k) => /canister/i.test(k)) ?? kinds[0]; E.drainage = 0; }
    else { E.filterKind = kinds.find((k) => FILTERS[k].mount === 'bed'); E.drainage = 1; E.plenumH = Math.round((W.water.level + 1) * 2) / 2; E.plenumLevel = undefined; }
    W.sim.step(10); P.show = true; P.sig = ''; P.t = 1e9;
    return { kind: E.filterKind, outlets: W.water.hydro.outlets.map((o) => (o.wall ? 'wall' : 'ground')).join(',') };
  }, s);
  const count = () => page.evaluate(() => {
    const W = window.game.world, P = W.plumbing, cam = window.game.camera;
    const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    const r = { meshes: 0, tubeTris: 0, deviceTris: 0, jetTris: 0 };
    P.group.traverse((m) => {
      if (!m.isMesh || !shown(m) || !m.layers.test(cam.layers)) return;
      const g = m.geometry, idx = g.index, al = g.attributes.along;
      if (!idx || !idx.count) return;
      r.meshes++;
      const s0 = Math.max(0, g.drawRange.start), s1 = Math.min(idx.count, s0 + g.drawRange.count);
      if (m === P.jets) { r.jetTris += (s1 - s0) / 3; return; }
      const gh = m.name === 'plumbing-xray', tk = gh ? 'ghostTubeTris' : 'tubeTris', dk = gh ? 'ghostDeviceTris' : 'deviceTris';
      r[tk] ??= 0; r[dk] ??= 0;
      for (let k = s0; k < s1; k += 3) { if (al.getZ(idx.getX(k)) > 0.1) r[tk]++; else r[dk]++; }
      r[m.name] = (r[m.name] ?? 0) + 1; r.clips = P.clips;
    });
    return r;
  });
  const res = {};
  for (const s of ['canister', 'bed']) {
    const info = await setup(s);
    res[s] = { info };
    for (const l of ['surface', 'xray', 'bottom']) {
      await page.evaluate((v) => { window.__S.layer.value = v; }, l);
      await page.waitForTimeout(2200);
      res[s][l] = await count();
    }
    await page.evaluate(() => { window.__S.layer.value = 'surface'; window.game.world.plumbing.show = false; });
    await page.waitForTimeout(1500);
    res[s].surfaceShowOff = await count();
    await page.evaluate(() => { window.game.world.plumbing.show = true; });
    console.log(name, s, JSON.stringify(res[s]));
  }
  for (const s of ['canister', 'bed']) {
    const R = res[s];
    ok(R.surface.tubeTris === 0, `${s}: Surface draws no hose or pipe (or the water in it): ${R.surface.tubeTris} tube triangles`);
    ok(R.surface.deviceTris > 0 && R.surface.deviceTris === R.xray.deviceTris, `${s}: devices drawn in Surface as in X-ray (${R.surface.deviceTris} / ${R.xray.deviceTris})`);
    ok(R.xray.tubeTris > 0 && R.bottom.tubeTris > 0, `${s}: X-ray and Bottom draw the hoses and pipes (${R.xray.tubeTris} / ${R.bottom.tubeTris})`);
  }
};
