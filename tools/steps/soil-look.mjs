// Pictures of the build seen through the glass (render/soilside.js) and the foam background: the stream-bank preset (mostly
// land), each drainage (none, LECA, false bottom with its water just under the mesh, then flooded) and each substrate.
//   node tools/shot.mjs --url=http://localhost:4310/ --only=desktop --steps=tools/steps/soil-look.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const w = await window.game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'streambank', seed: 2, tier: 'standard' });
    w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 11 * 60;
    for (let t = 0; t < 5; t++) w.sim.step(1);
    window.game.setSpeed(0);
    window.__cam = (p) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, false); };
  });
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const set = async (label, o, cam = [10, 2.4, 31, 10, 2, 22]) => {
    await page.evaluate(({ o, cam }) => {
      const w = window.game.world, E = w.env;
      Object.assign(E, o);
      if (o.level != null) w.setWaterLevel(o.level === 'over' ? E.plenumH + 2 : o.level === 'under' ? E.plenumH - 1 : o.level);
      for (let t = 0; t < 3; t++) w.sim.step(1);
      window.__cam(cam);
      return { level: +w.water.level.toFixed(2), plenumH: E.plenumH, plenum: E.plenum?.state ?? null };
    }, { o, cam }).then((r) => console.log(label, JSON.stringify(r)));
    await page.waitForTimeout(3500);
    await shot(label);
  };
  await set('soil-none-soil', { drainage: 0, substrate: 'soil' });
  await set('soil-leca-abg', { drainage: 0.6, substrate: 'abg' });
  await set('soil-fb-coir', { drainage: 1, plenumH: 6, substrate: 'coir', level: 'under' });
  await set('soil-fb-sphagnum', { drainage: 1, plenumH: 6, substrate: 'sphagnum' });
  await set('soil-fb-flooded', { drainage: 1, plenumH: 6, substrate: 'abg', level: 'over' });
  await set('backdrop-foam', { backdrop: 'foam' }, [0, 30, 95, 0, 25, -10]);
  await set('backdrop-natural', { backdrop: 'natural' }, [0, 30, 95, 0, 25, -10]);
};
