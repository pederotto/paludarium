export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  const rep = await page.evaluate(async () => {
    const W = window.game.world, C = W.climate;
    const f = W.animals.by.strawberry[0];
    const out = { humRange: C.mean.humRange, need: 80, samples: [] };
    // how much of the floor meets the need?
    let ok = 0; for (let i = 0; i < C.hum.length; i++) if (C.hum[i] >= 80) ok++;
    out.fracOk = +(ok / C.hum.length).toFixed(2);
    for (let h = 0; h < 30; h++) {
      const p0 = f.pos.clone();
      for (let k = 0; k < 6; k++) { W.sim.step(10); for (let j = 0; j < 5; j++) W.animals.move(0.2); }
      if (h % 3 === 0) out.samples.push({ h, moved: +f.pos.distanceTo(p0).toFixed(1), pos: f.pos.toArray().map((v) => +v.toFixed(0)), RH: Math.round(f.RH), hp: +f.health.toFixed(2), state: f.state, hop: !!f.hop, why: f.why?.join() });
    }
    return out;
  });
  console.log(JSON.stringify(rep));
};
