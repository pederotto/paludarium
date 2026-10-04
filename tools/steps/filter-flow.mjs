// Filter flow (sim/filterflow.js, render/plumbing.js): what each filter's pump really moves and how fast the water runs in
// each hose. Two ways to run it:
//   node tools/steps/filter-flow.mjs                     the numbers alone (no browser): per filter kind, the flow at clog
//                                                        0 / 0.5 / 1 and at two head heights, the water speed in each hose
//   node tools/shot.mjs --steps=tools/steps/filter-flow.mjs --only=desktop [--query=?webgl]
//                                                        in the game: E.filterFlow at clog 0 / 0.5 / 1 for each kind, the
//                                                        hose radii and speeds baked into the plumbing mesh, and pictures of
//                                                        the filter in the cabinet and of its fittings in the pool
import { pathToFileURL } from 'node:url';

const KINDS = ['sponge', 'matten', 'canister'];

async function table() {
  const { filterFlow } = await import('../../src/sim/filterflow.js');
  const { FILTERS } = await import('../../src/content/equipment.js');
  for (const kind of KINDS) {
    const F = FILTERS[kind];
    for (const level of [12, 30]) {
      const rows = [0, 0.5, 1].map((clog) => {
        const r = filterFlow({ filter: true, filterKind: kind, filterDirt: clog * F.hold, mediaBio: 0.5, prefilter: false }, level);
        return `clog ${clog}: ${Math.round(r.lph)} L/h (head ${r.head.toFixed(1)} cm; ` + r.hoses.map((h) => `${h.role} ${h.id}/${h.od} mm ${h.v.toFixed(1)} cm/s ${h.dir}`).join(', ') + '; stages ' + r.stages.map((s) => `${s.id} ${s.clog.toFixed(2)}`).join(' ') + ')';
      });
      console.log(`${kind} (rated ${F.lph} L/h) level ${level} cm`);
      for (const r of rows) console.log('   ' + r);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await table();

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const hideUi = await page.addStyleTag({ content: '#ui{display:none!important}' });
  const webgl = await page.evaluate(() => /webgl/.test(location.search));
  const tag = webgl ? '-webgl' : '';
  // The baked hoses: radius (from the tube's vertices) and speed per hose, from the plumbing mesh's `along` attribute.
  const hoses = () => page.evaluate(() => {
    const P = window.game.world.plumbing, g = P.mesh.geometry, a = g.attributes.along, p = g.attributes.position;
    if (!a) return null;
    const by = new Map();
    for (let i = 0; i < a.count; i++) {
      const v = a.itemSize >= 2 ? a.getY(i) : null, s = a.getX(i);
      if (!(s > 0.01)) continue;
      const k = a.itemSize >= 3 ? `${a.getZ(i)}|${v?.toFixed(1)}` : 'all';
      const e = by.get(k) ?? { v, circuit: a.itemSize >= 3 ? a.getZ(i) : null, n: 0, ymin: 1e9, ymax: -1e9 };
      e.n++; e.ymin = Math.min(e.ymin, p.getY(i)); e.ymax = Math.max(e.ymax, p.getY(i));
      by.set(k, e);
    }
    return [...by.values()].map((e) => ({ ...e, ymin: +e.ymin.toFixed(1), ymax: +e.ymax.toFixed(1) }));
  });
  const res = [];
  for (const kind of KINDS) {
    const r = await page.evaluate((k) => {
      const g = window.game, W = g.world, E = W.env;
      g.setSpeed(0);
      E.filter = true; E.filterKind = k; E.prefilter = false;
      const F = { sponge: 24, matten: 60, canister: 40 }[k];
      const out = {};
      for (const c of [0, 0.5, 1]) {
        E.filterDirt = c * F; W.sim.step(0.01);
        out['clog' + c] = { lph: Math.round(E.filterLph), ff: E.filterFlow ? { head: +E.filterFlow.head.toFixed(1), hoses: E.filterFlow.hoses.map((h) => `${h.role} ${h.id}/${h.od} ${h.v.toFixed(1)}cm/s ${h.dir}`), stages: E.filterFlow.stages.map((s) => `${s.id} ${s.clog.toFixed(2)}`) } : null };
      }
      E.filterDirt = 0.5 * F; W.sim.step(0.01);
      W.plumbing.t = 99; W.plumbing.sig = '';
      return { kind: k, level: +W.water.level.toFixed(1), ...out };
    }, kind);
    await page.waitForTimeout(400);
    r.mesh = await hoses();
    res.push(r);
    console.log(name, JSON.stringify(r));
    // Where the filter and its fittings are, from the mesh: the cabinet part below the tank floor, the fittings in the pool.
    const at = await page.evaluate(() => {
      const P = window.game.world.plumbing, p = P.mesh.geometry.attributes.position, lv = window.game.world.water.level;
      const al = P.mesh.geometry.attributes.along;
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], fx = 0, fz = 0, fn = 0, rx = 0, ry = 0, rz = 0, rn = 0;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (al.itemSize >= 3 && al.getZ(i) > 1.5 && y > 0) { rx += x; ry += y; rz += z; rn++; }
        if (y < -25) { lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)]; }
        if (y > -2.5 && y < -0.5) { fx += x; fz += z; fn++; }
      }
      return { lo, hi, fit: fn ? [fx / fn, fz / fn] : null, riser: rn ? [rx / rn, ry / rn, rz / rn] : null, lv };
    });
    // `free`: lift the camera's boundary for a close look into the cabinet (a player's camera stays over y -4: 'player').
    const look = async (label, pos, tgt, free = false) => {
      await page.evaluate(([p, t, f]) => {
        const g = window.game, R = g.rig;
        R.stopOrbit(); R.moved = true;
        // The ground guard (rig.solid) lifts a target under the tank onto the ground: off for the close looks, back after.
        if (f) { R._solidOff ??= R.solid; R.solid = null; g.controls.setBoundary(); } else if (R._solidOff) { R.solid = R._solidOff; R._solidOff = null; R.freeLimits?.(); }
        g.controls.setLookAt(...p, ...t, false);
      }, [pos, tgt, free]);
      await page.waitForTimeout(1600);
      await shot(`ff-${kind}-${label}${tag}`);
    };
    if (at.lo[0] < 1e8) {
      const c = [(at.lo[0] + at.hi[0]) / 2, (at.lo[1] + at.hi[1]) / 2, (at.lo[2] + at.hi[2]) / 2];
      await look('cabinet', [c[0] + 22, c[1] + 16, c[2] + 72], c, true);
      await look('under', [c[0] + 30, -30, c[2] + 105], [c[0], -38, c[2]], true);
      await look('player', [c[0] + 12, -3.5, 50], [c[0], c[1], c[2]]);
    }
    if (at.fit) await look('pool', [at.fit[0] + 8, at.lv + 16, at.fit[1] + 26], [at.fit[0], at.lv - 3, at.fit[1]]);
    else if (at.riser) { const [x, y, z] = at.riser; await look('pool', [x - Math.sign(x) * 18, y + 18, z + 30], [x, y - 2, z]); }
  }
  // The false bottom's tower: its water line (Env.plenumLevel, or the pool's level without it), seen from above.
  const tw = await page.evaluate(() => {
    const W = window.game.world, E = W.env;
    E.filterKind = 'sponge'; E.drainage = 1; E.plenumH = Math.round(W.water.level + 1); W.plumbing.sig = ''; W.plumbing.t = 99;
    return { level: W.water.level, plenumLevel: E.plenumLevel ?? null };
  });
  await page.waitForTimeout(500);
  const tp = await page.evaluate(() => {
    const g = window.game.world.plumbing.mesh.geometry, p = g.attributes.position, c = g.attributes.color;
    let n = 0, x = 0, y = -1e9, z = 0;
    for (let i = 0; i < p.count; i++) if (c.getX(i) > 0.75 && c.getZ(i) > 0.7) { n++; x += p.getX(i); z += p.getZ(i); y = Math.max(y, p.getY(i)); }
    return n ? [x / n, y, z / n] : null;
  });
  console.log(name, 'tower', JSON.stringify({ ...tw, top: tp }));
  if (tp) {
    await page.evaluate(([p, t]) => { const g = window.game; window.__S.layer.value = 'bottom'; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, ...t, false); }, [[tp[0] - Math.sign(tp[0]) * 5, tp[1] + 22, tp[2] + 9], tp]);
    await page.waitForTimeout(1600);
    await shot('ff-tower' + tag);
  }
  // The Flow panel's filter loop: a canister half clogged.
  await page.evaluate(() => { const W = window.game.world, E = W.env; window.__S.layer.value = 'surface'; E.filterKind = 'canister'; E.filterDirt = 20; W.sim.step(0.01); window.__S.modal.value = 'flow'; });
  await hideUi.evaluate((e) => e.remove());
  await page.waitForTimeout(900);
  await shot('ff-panel' + tag);
};
