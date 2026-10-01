// Lays out every hardscape variant in a row to choose pieces by eye.
//   GEN_PIECE=boulder GEN_SIZE=16 node tools/shot.mjs --steps=tools/steps/gen-pieces.mjs --only=desktop --wait=1500 --out=test-output/gen
export default async (page, shot, name) => {
  const type = process.env.GEN_PIECE || 'boulder';
  const size = +(process.env.GEN_SIZE || 16);
  const rep = await page.evaluate(async ({ type, size }) => {
    document.querySelector('#ui').style.display = 'none';
    const w = await window.game.loadTank('grand', { layout: 'empty' });
    window.game.rig.stopOrbit();
    const parts = w.decor.parts[type];
    const n = parts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = -60 + (i + 0.5) * (120 / n);
      const p = w.decor.addPiece(type, x, 0, { variant: i, size, rot: 0.3, sink: 0.05 });
      const bb = p.mesh.geometry.boundingBox;
      out.push([i, +(bb.max.x - bb.min.x).toFixed(2), +(bb.max.y - bb.min.y).toFixed(2), +(bb.max.z - bb.min.z).toFixed(2)]);
    }
    w.groundChanged();
    return { n, out };
  }, { type, size });
  console.log(type, JSON.stringify(rep));
  await page.evaluate(() => { window.game.rig.controls.setLookAt(0, 26, 92, 0, 10, 0, false); });
  await page.waitForTimeout(2000);
  await shot(`pieces-${type}`);
};
