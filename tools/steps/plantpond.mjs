// Two ponds diverge in nitrate: one planted, one not (same start, same days). Prints a table and takes a water-quality lens shot.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  const res = await page.evaluate(async () => {
    const g = window.game, W = g.world; g.setSpeed(0);
    const B = W.water.bodies, H = W.water.hydro;
    const ponds = B.list.filter((b) => b.kind === 'pool' && b.cells?.length > 8).sort((a, b) => b.vol - a.vol);
    if (ponds.length < 2) return { error: 'need two ponds, found ' + ponds.length };
    const [A, C] = ponds;
    const inBody = (p, b) => B.bodyFor(p.pos.x, p.pos.z, 6) === b;
    // Clear every plant that draws on pond C; plant pond A thickly.
    for (const p of [...W.plants.list]) if (inBody(p, C)) W.plants.remove(p);
    const have = W.plants.list.filter((p) => inBody(p, A)).length;
    for (let k = 0; k < 6; k++) {
      const n = A.cells[(k * 7) % A.cells.length], [x, z] = H.cellXZ(n);
      const y = W.terrain.heightAt(x, z);
      W.plants.add('vallisneria', new (W.plants.list[0].pos.constructor)(x, y, z), { grown: 1, scale: 1 });
    }
    for (const b of [A, C]) { b.nitrate = 40; b.ammonia = 0.3; }
    // Isolate them from the pump for the experiment (a flushed pond just takes the main pool's water).
    H.pump.on = false;
    H.ledger.links = [];   // the ledger is only refreshed while the water runs: cut the links by hand
    const out = [];
    const snap = (day) => out.push({ day, [A.name]: { nitrate: +A.nitrate.toFixed(1), ammonia: +A.ammonia.toFixed(2), co2: +A.co2.toFixed(1) }, [C.name]: { nitrate: +C.nitrate.toFixed(1), ammonia: +C.ammonia.toFixed(2), co2: +C.co2.toFixed(1) } });
    snap(0);
    for (let d = 1; d <= 4; d++) { W.sim.step(1440); snap(d); await new Promise((r) => setTimeout(r, 30)); }
    return { A: A.name, C: C.name, plantsA: W.plants.list.filter((p) => inBody(p, A)).length, plantsC: W.plants.list.filter((p) => inBody(p, C)).length, had: have, out, envNitrate: +W.env.nitrate.toFixed(1) };
  });
  console.log(JSON.stringify(res));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(() => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, 40, 80, 0, 5, 0, false); g.lens.set('quality'); });
  await page.waitForTimeout(800);
  await shot('plantpond');
};
