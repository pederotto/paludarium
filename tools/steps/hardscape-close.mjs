// Close looks at one piece of each hardscape kind in the starter tank (UI hidden, paused, noon), framed by its bounding box.
export default async (page, shot) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const n = await page.evaluate(() => {
    const g = window.game, W = g.world; g.setSpeed(0);
    const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
    window.__hs = [];
    const seen = {};
    for (const p of W.decor.pieces) {
      seen[p.type] = (seen[p.type] ?? 0) + 1;
      if (seen[p.type] > 2) continue;
      const o = p.mesh; if (!o) continue;
      o.updateMatrixWorld(true);
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const c = bb.getCenter(o.position.clone()), s = bb.getSize(o.position.clone());
      window.__hs.push({ name: p.type + seen[p.type], c: [c.x, c.y, c.z], r: Math.max(s.x, s.y, s.z) });
    }
    return window.__hs.length;
  });
  for (let i = 0; i < n; i++) {
    const name = await page.evaluate((i) => {
      const g = window.game, t = window.__hs[i], d = Math.max(8, t.r * 1.1);
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(t.c[0] + d * 0.25, t.c[1] + d * 0.15, t.c[2] + d * 0.95, t.c[0], t.c[1], t.c[2], false);
      return t.name;
    }, i);
    await page.waitForTimeout(900);
    await shot('hs-' + name);
  }
};
