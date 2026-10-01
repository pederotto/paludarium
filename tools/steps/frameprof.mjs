// Where does frame time go? Times the pieces of Game.frame on the starter tank, averaged over many calls.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const g = window.game, W = g.world;
    const t = (f, n = 60) => { const s = performance.now(); for (let i = 0; i < n; i++) f(); return +((performance.now() - s) / n).toFixed(2); };
    const out = {};
    out.simStep = t(() => W.sim.step(1 / 60 * 1));
    out.animalsMove = t(() => W.animals.move(1 / 60));
    out.waterAnimate = t(() => W.water.animate(1 / 60, 1));
    out.fxStep = t(() => g.fx.step());
    out.lens = t(() => g.lens?.update(1 / 60));
    out.mist = t(() => g.mist.update(1 / 60));
    out.frameHooks = t(() => g.frameHooks.forEach((f) => f(1 / 60)));
    out.render = t(() => g.gfx.render(), 20);
    out.fullFrame = t(() => g.frame(1 / 60), 30);
    out.animals = Object.values(W.animals.by).reduce((s, a) => s + a.length, 0);
    return out;
  });
  console.log(JSON.stringify(r));
};
