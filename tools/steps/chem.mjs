export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  const rep = await page.evaluate(() => {
    const W = window.game.world, out = [];
    const E = W.env;
    out.push({ start: { cycle: E.cycle, media: E.mediaBio, detritus: E.detritus, nh3: E.ammonia, no3: E.nitrate, litres: W.water.volumeLitres() } });
    for (let h = 0; h < 30; h++) {
      W.sim.step(60);
      if (h % 4 === 0) out.push({ h, cycle: +E.cycle.toFixed(3), detritus: +E.detritus.toFixed(2), nh3: +E.ammonia.toFixed(3), no2: +E.nitrite.toFixed(3), no3: +E.nitrate.toFixed(1), plants: W.plants.list.length, fish: W.animals.by.neon.length, use: +(W.sim.plantOut?.nitrateUse ?? 0).toFixed(1) });
    }
    return out;
  });
  console.log(rep.map((r) => JSON.stringify(r)).join('\n'));
};
