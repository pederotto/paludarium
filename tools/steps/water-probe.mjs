// Pump, outlets, valves and filters in the starter tank: each scenario prints what the hydraulics, the visible plumbing,
// the falls and the chemistry do, and PASS/FAIL where the answer is clear.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(5000);
  const res = await page.evaluate(async () => {
    const g = window.game, W = g.world, H = W.water.hydro, E = W.env, Wt = W.water;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    const check = (label, ok, info = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label}${info ? ': ' + info : ''}`);
    const note = (label, v) => out.push(`.... ${label}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    const run = (s) => { for (let t = 0; t < s; t += 1 / 30) H.step(1 / 30); Wt.syncFalls(); W.plumbing?.update(2); };
    const ribbons = () => [...Wt.ribbons.keys()];
    const paths = () => (H.ledger.paths ?? []).map((p) => `${p.from}>${p.to} ${p.lph.toFixed(0)}`);
    const big = () => H.ledger.links.filter((l) => l.lph > 200).map((l) => `${l.kind} ${l.from}>${l.to} ${l.lph.toFixed(0)} inst ${l.inst.toFixed(0)}`);
    note('start paths', paths());
    note('start big links', big());
    note('start', { level: +H.level.toFixed(2), outlets: H.outlets.map((o) => ({ wall: o.wall, q: +(o.q * 3.6).toFixed(0), head: +o.head.toFixed(1) })), running: H.pump.running, ribbons: ribbons(), filter: E.filter, kind: E.filterKind });

    // 1. Pump off: nothing should pour from the outlets.
    H.pump.on = false;
    run(6); await wait(600);
    const wallRib = ribbons().filter((k) => k[0] === 'o');
    check('pump off: no waterfall from the background spring', wallRib.length === 0, `ribbons ${JSON.stringify(ribbons())}`);
    check('pump off: outlets deliver 0', H.outlets.every((o) => o.q === 0));
    check('pump off: hose highlight fades', (W.plumbing?.run.value ?? 0) < 0.2, `run ${W.plumbing?.run.value.toFixed(2)}`);
    H.pump.on = true; run(6);
    check('pump on: background spring pours again', ribbons().some((k) => k[0] === 'o'), JSON.stringify(ribbons()));

    // 2. Valve closed on the wall outlet.
    const wo = H.outlets.find((o) => o.wall);
    if (wo) { wo.valve = 0; run(6); check('valve shut: no waterfall from that spring', !ribbons().some((k) => k === 'o' + wo.id), JSON.stringify(ribbons())); wo.valve = 1; run(3); }

    // 3. Filter off: covered by tests/hydro-quality.test.mjs (env values are copied back into the bodies here, so an A/B in
    // the page is not clean).
    const B = Wt.bodies;

    // 4. Markers after an erosion-style rebuild while another tool is active.
    window.__tools?.setTool?.("view");
    Wt.updateMarkers();
    check('outlet markers stay hidden outside the Water tool after updateMarkers', Wt.outletMeshes.every((m) => !m.visible), `${Wt.outletMeshes.filter((m) => m.visible).length} visible`);
    check('pump box marker hidden outside the Water tool', !Wt.pumpMesh.visible);

    // 5. Low water: the intake goes dry.
    const L0 = H.level, tot0 = H.total();
    Wt.setLevel(H.f.h[H.seed] + 0.2);
    run(4);
    note('low water', { level: +H.level.toFixed(2), floor: +H.f.h[H.seed].toFixed(2), submerge: +H.pump.submerge.toFixed(2), running: H.pump.running, ribbons: ribbons(), warn: H.ledger.warnings.map((w) => w.text) });
    check('dry intake: pump not running', !H.pump.running);
    check('dry intake: no background waterfall', !ribbons().some((k) => k[0] === 'o'), JSON.stringify(ribbons()));
    Wt.setLevel(L0); run(4);
    note('level restored', { level: +H.level.toFixed(2), total: +(H.total() / 1000).toFixed(2), was: +(tot0 / 1000).toFixed(2) });

    // 6. Move the pump onto dry land (high ground): it should refuse or keep the water.
    const pumpXZ0 = H.cellXZ(H.seed);
    const tA = H.total();
    let hi = 0;
    for (let n = 0; n < H.N; n++) if (H.f.h[n] > H.f.h[hi]) hi = n;
    const [hx, hz] = H.cellXZ(hi);
    note('inMainPool at high ground', Wt.inMainPool(hx, hz));
    Wt.setPump(hx, hz);
    run(3);
    note('pump on high ground', { level: +H.level.toFixed(2), resVol: +(H.resVol / 1000).toFixed(2), total: +(H.total() / 1000).toFixed(2), before: +(tA / 1000).toFixed(2), running: H.pump.running, submerge: +H.pump.submerge.toFixed(2), poolCells: H.res.reduce((s, v) => s + v, 0), plumbingVisible: W.plumbing?.group.visible });
    check('moving the pump keeps every litre', Math.abs(H.total() - tA) < 50, `${(tA / 1000).toFixed(2)} -> ${(H.total() / 1000).toFixed(2)} L`);
    Wt.setPump(...pumpXZ0); run(3);
    note('pump back', { level: +H.level.toFixed(2), total: +(H.total() / 1000).toFixed(2), poolCells: H.res.reduce((s, v) => s + v, 0) });
    check('pump moved back: level returns', Math.abs(H.level - L0) < 0.6, `${L0.toFixed(2)} -> ${H.level.toFixed(2)}`);

    // 6b. Move the pump into a pond (the editor refuses while the pool has water; with the tank drained it is allowed).
    run(6);
    const pond = H.pools.slice().sort((a, b) => b.litres - a.litres)[0];
    if (pond) {
      const c = pond.cells[Math.floor(pond.cells.length / 2)];
      const [qx, qz] = H.cellXZ(c);
      const tB = H.total(), pondL = pond.litres;
      Wt.setPump(qx, qz); run(3);
      note('pump in pond', { pondL: +pondL.toFixed(2), resVol: +(H.resVol / 1000).toFixed(2), level: +H.level.toFixed(2), pondSurface: +pond.level.toFixed(2), running: H.pump.running });
      check('pump moved into a pond: that pond becomes the main pool', H.resVol / 1000 > pondL * 0.8 && Math.abs(H.level - pond.level) < 1, `resVol ${(H.resVol / 1000).toFixed(2)} L, level ${H.level.toFixed(2)} vs pond ${pond.level.toFixed(2)}`);
      check('pump into a pond keeps every litre', Math.abs(H.total() - tB) < 50, `${(tB / 1000).toFixed(2)} -> ${(H.total() / 1000).toFixed(2)}`);
      Wt.setPump(...pumpXZ0); run(3);
      check('pump back from the pond: level returns', Math.abs(H.level - L0) < 0.6, `${L0.toFixed(2)} -> ${H.level.toFixed(2)}`);
    }

    // 6c. Undo after moving the pump inside the pool.
    const [ux, uz] = H.cellXZ(H.seed);
    W.pushUndo();
    let other = -1;
    for (let n = 0; n < H.N; n++) if (H.res[n] && H.level - H.f.h[n] > 4) { const [x, z] = H.cellXZ(n); if (Math.hypot(x - ux, z - uz) > 15) { other = n; break; } }
    if (other >= 0) {
      Wt.setPump(...H.cellXZ(other)); run(2);
      const lv = H.level;
      W.undo(); run(2);
      const [bx, bz] = H.cellXZ(H.seed);
      check('undo puts the pump back and keeps the level', Math.hypot(bx - ux, bz - uz) < 2 && Math.abs(H.level - lv) < 0.3, `pump ${bx.toFixed(1)},${bz.toFixed(1)} vs ${ux.toFixed(1)},${uz.toFixed(1)}; level ${lv.toFixed(2)} -> ${H.level.toFixed(2)}`);
    }

    // 7. Filter kinds: plumbing draws each kind.
    for (const k of ['sponge', 'matten', 'canister']) {
      E.filterKind = k; W.plumbing.t = 99; W.plumbing.update(0.1);
      note('filter ' + k, { verts: W.plumbing.mesh.geometry.attributes.position.count, sig: W.plumbing.sig.split('|').slice(4, 6).join('|') });
    }
    E.filterKind = 'sponge';

    // 8. Flow numbers the panel shows.
    run(3);
    const Lg = H.ledger;
    note('ledger pump', Lg.pump);
    note('warnings', Lg.warnings.map((w) => w.level + ': ' + w.text));
    note('paths', (Lg.paths ?? []).map((p) => `${p.from}>${p.to} ${p.lph.toFixed(0)}`));

    // 9. Save and load keep the pump, filter, valves.
    H.outlets[0].valve = 0.4; H.pump.rate = 220; E.filterKind = 'canister'; E.prefilter = true;
    const snap = JSON.stringify(W.serialize ? W.serialize() : g.save?.());
    run(20);
    note('end paths', paths());
    note('end big links', big());
    for (const b of B.list) if (b.outLph > 200 || b.inLph > 200) note('big body ' + b.key, { name: b.name, kind: b.kind, vol: b.vol, n: b.n, in: b.inLph, out: b.outLph, cx: b.cx, cz: b.cz, surf: b.surfY, bottom: b.bottom });
    note('save size', snap?.length);
    return out;
  });
  for (const l of res) console.log(name, l);
};
