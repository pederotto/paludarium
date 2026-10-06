// N17, fixed by feat/hydro: what render/plumbing.js draws in each view layer (render/layers.js), from the meshes the camera
// would draw. Two set-ups: the starter tank's pump hose to its stream outlet with a canister filter in the cabinet, and a false
// bottom with the bed filter's tower pump. Per layer: meshes drawn; triangles of the hose run (from the merged geometry's
// userData.runRanges: the hoses behind the background and in the cabinet, their clips; an older build without runRanges counts
// every tube there); triangles of pipes that sit in the tank (other tube vertices, along.z = circuit 1 or 2: the
// overflow standpipe, the return pipe, risers, uptakes); triangles of devices (everything else); jets.
// Target (the owner, 4 Oct: hoses feeding outlets only outside the normal view; the repos doc: in-tank pipes in every view):
// Surface draws 0 hose-run triangles; in-tank pipes and devices the same in every layer, pipes > 0 with a canister; X-ray and
// Bottom draw the hose run. PASS/FAIL.
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
    const r = { meshes: 0, runTris: 0, pipeTris: 0, deviceTris: 0, jetTris: 0 };
    P.group.traverse((m) => {
      if (!m.isMesh || !shown(m) || !m.layers.test(cam.layers)) return;
      const g = m.geometry, idx = g.index, al = g.attributes.along;
      if (!idx || !idx.count) return;
      r.meshes++;
      const s0 = Math.max(0, g.drawRange.start), s1 = Math.min(idx.count, s0 + g.drawRange.count);
      if (m === P.jets) { r.jetTris += (s1 - s0) / 3; return; }
      const gh = m.name === 'plumbing-xray', pre = gh ? 'ghost' : '';
      const rk = pre ? 'ghostRunTris' : 'runTris', pk = pre ? 'ghostPipeTris' : 'pipeTris', dk = pre ? 'ghostDeviceTris' : 'deviceTris';
      r[rk] ??= 0; r[pk] ??= 0; r[dk] ??= 0;
      const rr = g.userData.runRanges;
      for (let k = s0; k < s1; k += 3) {
        const tube = al.getZ(idx.getX(k)) > 0.1;
        if (rr ? rr.some(([a, b]) => k >= a && k < b) : tube) r[rk]++; else if (tube) r[pk]++; else r[dk]++;
      }
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
    ok(R.surface.runTris === 0, `${s}: Surface draws none of the hose run (or the water in it): ${R.surface.runTris} triangles`);
    ok(R.surface.deviceTris > 0 && R.surface.deviceTris === R.xray.deviceTris, `${s}: devices drawn in Surface as in X-ray (${R.surface.deviceTris} / ${R.xray.deviceTris})`);
    ok(R.surface.pipeTris === R.xray.pipeTris && (s !== 'canister' || R.surface.pipeTris > 0), `${s}: pipes in the tank drawn in Surface as in X-ray (${R.surface.pipeTris} / ${R.xray.pipeTris})`);
    ok(R.xray.runTris > 0 && R.bottom.runTris > 0, `${s}: X-ray and Bottom draw the hose run (${R.xray.runTris} / ${R.bottom.runTris})`);
  }
};
