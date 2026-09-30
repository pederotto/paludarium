export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  const rep = await page.evaluate(() => {
    const W = window.game.world;
    const out = [];
    const before = Object.fromEntries(Object.entries(W.animals.by).map(([k, v]) => [k, v.length]));
    for (let h = 0; h < 24 * 3; h++) {
      W.sim.step(60);
      if (h % 12 === 0) {
        const E = W.env;
        out.push({ h, temp: +E.temp.toFixed(2), rh: Math.round(E.humidity), o2: +E.oxygen.toFixed(2), nh3: +E.ammonia.toFixed(2), no2: +E.nitrite.toFixed(2),
          n: Object.fromEntries(Object.entries(W.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])),
          why: Object.fromEntries(Object.entries(W.animals.by).filter(([k, v]) => v.length && ['neon','dartfrog','shrimp','newt'].includes(k)).map(([k, v]) => [k, [v[0].why, +v[0].health.toFixed(2), +v[0].T?.toFixed(1), Math.round(v[0].RH ?? 0)]])) });
      }
    }
    return { before, out, logs: W.logs.slice(0, 12).map((l) => l.msg) };
  });
  console.log(JSON.stringify(rep, null, 0).replace(/\},\{/g, '},\n{'));
};
