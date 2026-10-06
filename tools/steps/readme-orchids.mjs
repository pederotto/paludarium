// The README's orchid picture (docs/orchids.png): the four orchids side by side on the background wall of the starter paludarium at 11:00, flowers
// open (the live flower renderer, bloom forced open as plant-scene does), the camera about 55 cm away, no UI.
// Dev server only (it imports /src modules):
//   npx vite --port 4492 --strictPort --host 127.0.0.1
//   node tools/shot.mjs --url=http://127.0.0.1:4492/ --only=desktop --steps=tools/steps/readme-orchids.mjs --out=test-output/readme
// Writes <out>/readme-orchids-desktop.png. X=cm spacing between plants (default 13), DIST=cm (default 55).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const dx = +(process.env.X || 13), dist = +(process.env.DIST || 55);
  const r = await page.evaluate(async ({ dx, dist }) => {
    const { PLANTS } = await import('/src/sim/plants.js');
    const g = window.game, W = g.world, V3 = g.camera.position.constructor;
    g.setSpeed(0);
    W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 11 * 60;
    for (let t = 0; t < 10; t++) W.sim.step(1);
    for (const p of [...W.plants.list]) W.plants.remove(p);
    const ids = ['pleurothallis', 'masdevallia', 'dracula', 'cuthbertsonii'], placed = [];
    ids.forEach((id, k) => {
      const x = (k - 1.5) * dx + 3, y = 24, z = W.wall.zAt(x, y) + 0.2;
      const P = W.plants.add(id, new V3(x, y, z), { grown: 1, scale: 1, rot: 0.7 + k * 1.3, surface: 'wall', normal: new V3(0, 0, 1) });
      if (!P) return;
      P.reach = 0; W.plants.writeInstance(P);
      P.bloom = { stage: 'open', t: 0.5, palette: 0, j: 0.5, k: 1, why: null };
      W.plants.live = true; W.plants._dirty?.add(P.id); placed.push(P);
    });
    for (let t = 0; t < 3; t++) W.sim.step(1);
    for (const P of placed) { P.bloom.stage = 'open'; W.plants.flowerDirty(P.id); }
    W.plants.flushFlowers();
    const z = W.wall.zAt(3, 24);
    g.rig.stopOrbit(); g.rig.moved = true;
    g.controls.setLookAt(3, 29, z + dist, 3, 24, z, false);
    return { placed: placed.length, drawn: ids.reduce((n, id) => n + (W.plants.flowers?.[id]?.n ?? 0), 0) };
  }, { dx, dist });
  console.log('STAMP readme-orchids placed', r.placed, 'flower heads drawn', r.drawn);
  await page.waitForTimeout(4000);
  await shot('readme-orchids');
};
