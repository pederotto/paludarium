// Fruit fly life cycle in a starter tank with fruit (Care > Flies) vs a control tank without flies, 30 simulated days.
// Prints egg / maggot / pupa / adult counts every few days and the litter / humus / fertility change, then screenshots maggots in the litter.
//   node tools/shot.mjs --only=desktop --steps=tools/steps/flies.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const DAYS = +(process.env.DAYS ?? 30);
  const run = (withFlies) => page.evaluate(async ({ withFlies, DAYS }) => {
    const g = window.game;
    const W = await g.loadTank('standard', { layout: 'starter' });
    g.setSpeed(0);
    W.env.culture = false;                                   // only the flies we release
    for (const a of [...W.animals.by.fly]) W.animals.remove(a);
    if (withFlies) { const { Care } = await import('/src/app/actions.js'); console.log(Care.flies(g)); }
    const tot = (m) => m.reduce((s, v) => s + v, 0);
    const C = W.climate;
    const start = { L: tot(C.litter), H: tot(C.humus), F: tot(C.fert) };
    const rows = [];
    for (let d = 1; d <= DAYS; d++) {
      for (let h = 0; h < 24; h++) for (let k = 0; k < 6; k++) { W.sim.step(10); for (let j = 0; j < 2; j++) W.animals.move(0.2); }
      if (d % 2 === 0 || d === 1) { W.flies.summarise(); const s = W.flies.stats; rows.push(`d${d}: egg ${s.eggs} larva ${s.larvae} pupa ${s.pupae} adult ${s.adults} fruit ${s.fruit}`); }
      if (d % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const end = { L: tot(C.litter), H: tot(C.humus), F: tot(C.fert) };
    return { rows, start, end, deaths_by: W.flies.stats.deaths, laid: W.flies.stats.laid, emerged: W.flies.stats.emerged, nitrate: W.env.nitrate, deaths: W.stats.deaths, hunters: ['dartfrog', 'strawberry', 'gecko', 'newt'].map((id) => W.animals.count(id)) };
  }, { withFlies, DAYS });
  const ctl = await run(false);
  console.log('CONTROL (no flies):', JSON.stringify({ start: ctl.start, end: ctl.end, nitrate: ctl.nitrate, deaths: ctl.deaths }));
  const fl = await run(true);
  console.log('FLIES + fruit:\n  ' + fl.rows.join('\n  '));
  console.log('FLIES deaths by cause:', JSON.stringify(fl.deaths_by));
  console.log('FLIES summary:', JSON.stringify({ start: fl.start, end: fl.end, laid: fl.laid, emerged: fl.emerged, nitrate: fl.nitrate, deaths: fl.deaths, hunters: fl.hunters }));
  const dH = (o) => +(o.end.H - o.start.H).toFixed(2), dF = (o) => +(o.end.F - o.start.F).toFixed(2), dL = (o) => +(o.end.L - o.start.L).toFixed(2);
  console.log(`change over ${DAYS} d  litter ${dL(ctl)} -> ${dL(fl)}   humus ${dH(ctl)} -> ${dH(fl)}   fertility ${dF(ctl)} -> ${dF(fl)}   (control -> with flies)`);
  // Close-ups: a new tank with fruit, wait for maggots, then look at them in the litter.
  await page.evaluate(async () => {
    const g = window.game;
    const W = await g.loadTank('standard', { layout: 'starter' });
    g.setSpeed(0); W.env.culture = false;
    const { Care } = await import('/src/app/actions.js'); Care.flies(g);
    for (let d = 0; d < 3 * 24; d++) for (let k = 0; k < 6; k++) { W.sim.step(10); for (let j = 0; j < 2; j++) W.animals.move(0.2); }
    // Give the maggots something to show: make sure some sit on fruit and litter.
    const lv = W.animals.by.flylarva;
    console.log('maggots', lv.length, 'pupae', W.animals.by.flypupa.length);
  });
  const view = async (label, sp, dist = 4.5) => {
    const ok = await page.evaluate(([sp, dist]) => {
      const g = window.game, W = g.world, list = W.animals.by[sp];
      if (!list.length) return false;
      // The spot with most neighbours.
      let best = list[0], bn = -1;
      for (const a of list) { const n = list.filter((b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 3).length; if (n > bn) { bn = n; best = a; } }
      const p = best.pos;
      W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 780;   // early afternoon, lamp on
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.minDistance = 0.3; g.camera.near = Math.min(g.camera.near, 0.1); g.camera.updateProjectionMatrix();
      g.controls.setLookAt(p.x + dist * 0.2, p.y + dist * 0.9, p.z + dist * 0.5, p.x, p.y, p.z, false);
      return true;
    }, [sp, dist]);
    await page.waitForTimeout(1500);
    if (ok) await shot('flies-' + label);
  };
  await view('larvae-litter', 'flylarva', 4);
  await view('larvae-wide', 'flylarva', 12);
  await page.evaluate(async () => { const W = window.game.world; for (let d = 0; d < 4 * 24; d++) for (let k = 0; k < 6; k++) { W.sim.step(10); for (let j = 0; j < 2; j++) W.animals.move(0.2); } });
  await view('pupae', 'flypupa', 4.5);
};
