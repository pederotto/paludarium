// Fast-forward the starter tank and report the ecosystem; fails on NaN or exceptions.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  const rep = await page.evaluate(async () => {
    const W = window.game.world, out = [];
    const t0 = performance.now();
    for (let d = 1; d <= 24; d++) {
      W.sim.step(1440);
      W.animals.move(0.05);
      if (d % 4 === 0) {
        const E = W.env, C = W.climate.mean;
        out.push({ d, temp: +E.temp.toFixed(1), rh: Math.round(E.humidity), hum: C.humRange.map(Math.round), soil: +E.soil.toFixed(2), mold: +E.mold.toFixed(2), cond: +E.condense.toFixed(2),
          nh3: +E.ammonia.toFixed(2), no3: Math.round(E.nitrate), algae: +E.algae.toFixed(2), moss: +W.mossFraction().toFixed(2),
          animals: Object.fromEntries(Object.entries(W.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])), plants: W.plants.list.length, water: +W.water.volumeLitres().toFixed(1) });
      }
    }
    return { ms: Math.round(performance.now() - t0), out, nan: Object.entries(W.env).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k) };
  });
  console.log(JSON.stringify(rep, null, 0).replace(/\},\{/g, '},\n{'));
  await shot('sim');
};
