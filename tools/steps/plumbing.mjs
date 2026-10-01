// The visible pump circuit: overview, the pump housing and intake in the pool, a wall hose and the overflow standpipe.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const info = await page.evaluate(() => {
    const g = window.game, W = g.world, H = W.water.hydro;
    g.setSpeed(0);
    const [px, pz] = W.plumbing.pumpXZ();
    const y = W.terrain.heightAt(px, pz);
    const o = H.outlets.find((q) => q.wall) ?? H.outlets[0];
    // Make the bypass visible: one valve half shut.
    for (const q of H.outlets) q.valve = 0.3;
    return { pump: [px, y, pz], outlet: o ? o.pos.toArray() : null, outlets: H.outlets.length, level: H.level, weir: W.plumbing.weir, show: W.plumbing.show, verts: W.plumbing.mesh.geometry.attributes.position?.count };
  });
  console.log(name, JSON.stringify(info));
  const look = async (label, pos, tgt) => {
    await page.evaluate(([p, t]) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, ...t, false); }, [pos, tgt]);
    await page.waitForTimeout(1200);
    await shot('plumbing-' + label);
  };
  await page.waitForTimeout(1500);
  await shot('plumbing-overview');
  const [px, py, pz] = info.pump;
  await look('pump', [px + 2, py + 9, pz + 15], [px, py + 1, pz]);
  if (info.weir) await look('weir', [info.weir.x + 2, info.level + 5, info.weir.z + 14], [info.weir.x, info.level - 1, info.weir.z]);
  if (info.outlet) { const [wx, wy, wz] = info.outlet; await look('wallrun', [wx - 4, wy * 0.45, wz + 38], [wx, wy * 0.45, wz]); }
  if (info.outlet) { const [ox, oy, oz] = info.outlet; await look('outlet', [ox + 6, oy + 5, oz + 20], [ox, oy - 3, oz]); }
};
