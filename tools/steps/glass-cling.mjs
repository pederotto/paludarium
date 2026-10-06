// A frog climbing a glass pane is ON the glass: the belly plane the frog is drawn from stays GLASS_GAP (0.12 cm) off the pane, from the moment it turns
// belly to the glass until it sits (owner, 6 Oct 2026: frogs "climbing the glass" floated off it; measured before the fix: 0.7 cm off while sitting, and the path to the top started further out).
// Sends a red-eyed tree frog up each pane by Animals.perchRoute and reads the gap every tick; a pane with no route in this layout is skipped.
//   node tools/shot.mjs --url=http://localhost:4310/ --only=desktop --steps=tools/steps/glass-cling.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const spId = 'redeye';
  const res = await page.evaluate(async ([spId]) => {
  const g = window.game, W = g.world, A = W.animals, { TANK } = await import('/src/sim/tank.js'), { SPECIES } = await import('/src/sim/animals.js');
  const V = Object.values(A.by).flat().find((a) => a.pos).pos.constructor;
  for (const arr of Object.values(A.by)) for (const x of [...arr]) A.remove(x);
  const hz = TANK.d / 2, hx = TANK.w / 2, S = SPECIES[spId];
  // front pane, left pane, right pane; one frog each, set down on the ground 6 cm in front of its pane
  const cases = [
    { name: 'front', N: new V(0, 0, -1), yaw: 0, from: [-20, 8], top: [-20, 30, hz - 0.12], gap: (a) => hz - a.pos.z },
    { name: 'left', N: new V(1, 0, 0), yaw: -Math.PI / 2, from: [-30, -4], top: [-hx + 0.12, 28, -4], gap: (a) => a.pos.x + hx },
    { name: 'right', N: new V(-1, 0, 0), yaw: Math.PI / 2, from: [30, -4], top: [hx - 0.12, 26, -4], gap: (a) => hx - a.pos.x },
  ];
  const frogs = cases.map((c, i) => { const a = A.add(spId, new V(c.from[0], W.terrain.heightAt(c.from[0], c.from[1]) + 0.2, c.from[1]), { age: 1e6 }); return a; });
  const res = [];
  cases.forEach((c, i) => {
    const a = A.by[spId][i], top = new V(...c.top);
    const r = A.perchRoute(a, S, { top, glassN: c.N, glassYaw: c.yaw });
    if (!r) { res.push({ name: c.name, err: 'no route' }); return; }
    a.perch = { ph: 'go', top: r.p, plant: r.plant, piece: r.piece, glassN: r.glassN, glassYaw: r.glassYaw, up: r.up, base: r.base, path: r.path, near: Infinity, stuck: 0 };
    a.fs = null; a.perchLike = 'glass';
    c.a = a; c.rec = { name: c.name, belly: [], phases: {} };
  });
  for (let tick = 0; tick < 1500; tick++) {
    W.sim.step(0.2); A.move(0.2);
    for (const c of cases) {
      const a = c.a; if (!a?.perch?.glassN) continue;
      const P = a.perch, k = P.ph + (a.normal && a.normal.dot(P.glassN) > 0.99 ? ':belly' : ''); c.rec.phases[k] = (c.rec.phases[k] ?? 0) + 1;
      if (k === 'up:belly' || k === 'sit:belly') c.rec.belly.push(+c.gap(a).toFixed(2));
      if (P.ph === 'sit') c.rec.sat = (c.rec.sat ?? 0) + 1;
    }
    if (cases.every((c) => !c.a || c.rec.sat > 20)) break;
  }
  return cases.map((c) => c.rec && { name: c.name, phases: c.rec.phases, n: c.rec.belly.length, max: Math.max(...c.rec.belly), mean: +(c.rec.belly.reduce((s, v) => s + v, 0) / Math.max(1, c.rec.belly.length)).toFixed(2), first: c.rec.belly.slice(0, 8), last: c.rec.belly.slice(-3), stuck: !c.rec.sat });
}, [spId]);
  console.log(JSON.stringify(res));
  const clung = res.filter((r) => r && r.n > 0);
  if (!clung.length) throw new Error('glass-cling: no frog reached a pane in this layout');
  for (const r of clung) if (r.max > 0.2) throw new Error(`glass-cling: ${r.name} frog ${r.max} cm off the glass (want <= 0.2)`);
};
