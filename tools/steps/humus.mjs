// Litter, humus and fertility: starter tank, a few weeks of leaf drop, then the ground close up and the fertility lens.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const look = async (label, days) => {
    const st = await page.evaluate(async (days) => {
      const g = window.game, W = g.world; g.setSpeed(0);
      for (let d = 0; d < days; d++) { W.sim.step(1440); await new Promise((r) => setTimeout(r, 5)); }
      const h = W.humus; h.summarise();
      const p = W.plants.list.find((q) => q.id === 'fernph') ?? W.plants.list[0];
      g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(p.pos.x + 2, p.pos.y + 14, p.pos.z + 18, p.pos.x, p.pos.y, p.pos.z, false);
      return { day: Math.round(W.env.tankDays), litter: +h.stats.litter.toFixed(3), humus: +h.stats.humus.toFixed(3), fert: +h.stats.fert.toFixed(3), mold: +W.env.mold.toFixed(3), plants: W.plants.list.length, leaves: W.humus.view?.mesh.count };
    }, days);
    console.log(label, JSON.stringify(st));
    await page.waitForTimeout(900);
    await shot('humus-' + label);
  };
  await look('d0', 0);
  await look('d30', 30);
  await page.evaluate(() => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, 70, 60, 0, 0, 0, false); g.lens.set('fertility'); });
  await page.waitForTimeout(1200);
  await shot('humus-fertility-lens');
};
