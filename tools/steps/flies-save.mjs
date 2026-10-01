// Save and load keep the fly life cycle: maggots, pupae (on the wall too), hidden eggs and fruit; also a vacation run stays plausible.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(async () => {
    const g = window.game, W = g.world;
    g.setSpeed(0);
    const { Care } = await import('/src/app/actions.js');
    Care.flies(g);
    for (let d = 0; d < 11 * 24; d++) for (let k = 0; k < 6; k++) { W.sim.step(10); W.animals.move(0.1); }
    const c = () => { const f = W.flies; f.summarise(); return { ...Object.fromEntries(['fly', 'flylarva', 'flypupa'].map((id) => [id, W.animals.by[id].length])), eggs: f.stats.eggs, fruit: f.stats.fruit, wallPupae: W.animals.by.flypupa.filter((a) => a.onWall).length }; };
    const before = c();
    const save = JSON.parse(JSON.stringify(W.serialize()));
    W.load(save);
    const after = c();
    return { before, after };
  });
  console.log(JSON.stringify(r));
};
