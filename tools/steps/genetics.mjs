import { openDockItem } from './_hud.mjs';
// Release red and blue guppies, run the sim: babies must inherit (purple from red x blue) and be drawn with their own morph meshes.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async () => {
    const g = window.game, W = g.world, A = W.animals;
    for (const x of A.by.guppy.slice()) A.remove(x, 'test');
    const p = W.randomSpot((x, y, z, s) => s > 0) ?? null;
    const base = p ? p.clone() : A.by.neon[0].pos.clone();
    for (let i = 0; i < 3; i++) { A.add('guppy', base.clone().setX(base.x + i * 0.4), { morph: 'red' }); A.add('guppy', base.clone().setX(base.x - i * 0.4), { morph: 'blue' }); }
    const sp = A.by.guppy;
    const before = sp.map((a) => a.morph + ':' + a.genes.join(''));
    for (let d = 0; d < 40; d++) { for (let h = 0; h < 24; h++) { W.sim.step(60); A.move(0.2); } }
    const after = {};
    for (const a of A.by.guppy) after[a.morph] = (after[a.morph] ?? 0) + 1;
    return { before, after, total: A.by.guppy.length, gens: [...new Set(A.by.guppy.map((a) => a.gen))], meshes: Object.keys(A.meshes).filter((k) => k.startsWith('guppy')), errs: window.__errs.slice(0, 5) };
  });
  console.log(JSON.stringify(r));
  await page.waitForTimeout(500);
  await openDockItem(page, 'Lab').catch(() => {});
  await page.waitForTimeout(1000);
  await page.getByText('Genetics', { exact: true }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot('genetics-lab');
};
