// B5c smoke: every filter kind (content/equipment.js FILTERS) stands in the starter tank in turn and render/plumbing.js builds it
// without throwing; the hang-on-back and internal ones leave an intake and a return port in the pool, the bed filter (a false bottom is
// fitted for it) a return port and a flow. PASS/FAIL per kind.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const ok = (c, t) => console.log(name, (c ? 'PASS ' : 'FAIL ') + t);
  const r = await page.evaluate(async () => {
    const { FILTERS } = await import('/src/content/equipment.js');
    const g = window.game, W = g.world, E = W.env, P = W.plumbing;
    g.setSpeed(0);
    const keep = { filter: E.filter, filterKind: E.filterKind, drainage: E.drainage, plenumH: E.plenumH, prefilter: E.prefilter };
    const out = {}, errs0 = window.__errs.length;
    for (const k of Object.keys(FILTERS)) {
      const row = {};
      try {
        E.filter = true; E.filterKind = k; E.prefilter = false;
        if (FILTERS[k].mount === 'bed') { E.drainage = 1; E.plenumH = Math.round((W.water.level + 1) * 2) / 2; E.plenumLevel = undefined; }
        W.sim.step(10);
        const t0 = performance.now();
        P.rebuild();
        row.ms = Math.round((performance.now() - t0) * 10) / 10;
        const pt = W.water.hydro.ports ?? {};
        Object.assign(row, { mount: FILTERS[k].mount, children: P.group.children.length, lph: Math.round(E.filterLph ?? 0), intake: !!pt.intake, ret: !!pt.ret, blocked: E.filterFlow?.blocked ?? null });
        if (FILTERS[k].prefilter) { E.prefilter = true; P.rebuild(); row.prefilter = !!W.water.hydro.ports?.intake; }
      } catch (e) { row.err = String(e).slice(0, 220); }
      out[k] = row;
    }
    Object.assign(E, keep);
    try { P.rebuild(); } catch (e) { out.restore = String(e).slice(0, 120); }
    return { out, errs: window.__errs.slice(errs0).slice(0, 6) };
  });
  console.log(JSON.stringify(r.out));
  for (const [k, v] of Object.entries(r.out)) {
    if (k === 'restore') { ok(false, 'restoring the tank: ' + v); continue; }
    ok(!v.err, `${k} builds without throwing ${v.err ?? ''}`);
    ok(v.lph > 0, `${k} moves water (${v.lph} L/h)`);
    if (['rim', 'internal'].includes(v.mount)) ok(v.intake && v.ret, `${k} leaves an intake and a return port in the pool`);
    if (v.mount === 'bed') ok(v.ret, `${k} leaves its return port at a spout over the pool`);
  }
  ok(!r.errs.length, 'no console errors or warnings while building ' + JSON.stringify(r.errs));
};
