export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  const rep = await page.evaluate(async () => {
    const W = window.game.world;
    const before = Object.fromEntries(Object.entries(W.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
    const log = [];
    for (let h = 0; h < 72; h++) {
      W.sim.step(60);
      W.animals.move(0.05);
      if (h % 6 === 0) {
        const worst = Object.entries(W.animals.by).flatMap(([id, a]) => a.filter((x) => (x.why ?? []).length).slice(0, 1).map((x) => `${id}:${x.why.join('+')} T${x.T?.toFixed(1)} RH${Math.round(x.RH ?? 0)} hp${x.health.toFixed(2)}`));
        log.push({ h, rh: Math.round(W.env.humidity), deaths: W.stats.deaths, worst: worst.slice(0, 4) });
      }
    }
    const after = Object.fromEntries(Object.entries(W.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
    return { before, after, log, msgs: W.logs.filter((l) => /died/.test(l.msg)).slice(0, 8).map((l) => l.msg) };
  });
  console.log(JSON.stringify(rep, null, 1));
};
