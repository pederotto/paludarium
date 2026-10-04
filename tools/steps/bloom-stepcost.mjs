// What the bloom cycle costs Plants.step, measured in one page (dev server) so machine load hits both sides alike: the starter
// tank with six flowering water lilies, Plants.step timed with the flower code on and off, alternating, 8 rounds of 1000 steps.
//   node tools/shot.mjs --steps=tools/steps/bloom-stepcost.mjs --only=desktop --url=http://127.0.0.1:4491/   (dev server only)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async () => {
    const { PLANTS } = await import('/src/sim/plants.js');
    const g = window.game, W = g.world, P = W.plants, V = P.list[0].pos.constructor;
    g.setSpeed(0);
    for (const [x, z] of [[-24, 6], [-14, 12], [-4, 4], [8, 12], [18, 4], [30, 10]]) P.add('lily', new V(x, W.water.level, z), { grown: 1, scale: 1 });
    const F = PLANTS.lily.flower, lilies = P.list.filter((p) => p.id === 'lily');
    const on = () => { PLANTS.lily.flower = F; for (const p of lilies) if (p._b) { p.bloom = p._b; delete p._b; } };
    const off = () => { delete PLANTS.lily.flower; for (const p of lilies) { p._b = p.bloom; delete p.bloom; } };
    const time = (n) => { const t = performance.now(); for (let i = 0; i < n; i++) P.step(1 / 60, W.env, W); return (performance.now() - t) / n * 1000; };
    time(300);
    const a = [], b = [];
    for (let k = 0; k < 8; k++) { off(); a.push(time(1000)); on(); b.push(time(1000)); }
    const med = (x) => +[...x].sort((p, q) => p - q)[x.length >> 1].toFixed(1);
    return { plants: P.list.length, lilies: lilies.length, offUs: a.map((x) => +x.toFixed(1)), onUs: b.map((x) => +x.toFixed(1)), medOff: med(a), medOn: med(b) };
  });
  console.log('stepcost µs per Plants.step', JSON.stringify(r));
};
