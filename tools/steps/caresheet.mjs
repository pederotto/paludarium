// The care-sheet species in a real tank: puts every species added from the keeper's care sheets (2026-10) into a generated
// paludarium, runs a simulated day (sim.step + animals.move, as the game loop does), and reports per species how many are
// alive, their mean health, their stress reasons and (skink, panther crab, reed frog) the behaviour modes seen; plus the water's
// pH, hardness and current, and any console error. Then draws the tank with the camera on the water's edge.
//   node tools/shot.mjs --url=http://localhost:4377/ --only=desktop --steps=tools/steps/caresheet.mjs --wait=2500
//   CARE_DAYS=1 CARE_SOURCE=tap|soft|remin|hard CARE_FILTER=sponge|matten|canister
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  const days = +(process.env.CARE_DAYS ?? 1), source = process.env.CARE_SOURCE ?? 'tap', filter = process.env.CARE_FILTER ?? 'matten';
  const res = await page.evaluate(async ({ days, source, filter }) => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const game = window.game;
    const w = await game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'suriname', seed: 7, tier: 'standard' });
    const A = w.animals, E = w.env;
    for (const g of ['filterMatten', 'filterCanister', 'uvb', 'basking']) w.equipment.owned?.add?.(g);
    E.waterSource = source; E.filterKind = filter; E.uvb = 0.5; E.basking = 0.6;
    A.syncOccupancy(true);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    let s = 4242;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const mix = { cpd: 8, pygmy: 3, blueshrimp: 12, panther: 1, skink: 2, bumblebee: 5, reedfrog: 4, marbled: 3, purpleiso: 12, pandaking: 6, springpink: 20, springtail: 20, isopod: 10, fly: 15 };
    const placed = {};
    for (const [id, n] of Object.entries(mix)) {
      placed[id] = 0;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 200; k++) {
          const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
          const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
          if (r.pos) { A.add(id, r.pos); placed[id]++; break; }
        }
      }
    }
    const modes = {}, why = {};
    const ticks = Math.round(days * 1440);
    const t0 = performance.now();
    let worstTick = 0;
    for (let tick = 0; tick < ticks; tick++) {
      const t1 = performance.now();
      w.sim.step(1);
      A.move(0.2);
      worstTick = Math.max(worstTick, performance.now() - t1);
      if (tick % 20 === 0) for (const a of A.all) {
        const m = a.si?.mode ?? a.ci?.mode ?? (a.sp === 'reedfrog' ? (a.perch ? 'perch' : a.swimming ? 'swim' : a.fs ?? 'ground') : null);
        if (m) { const o = (modes[a.sp] ??= {}); o[m] = (o[m] ?? 0) + 1; }
        for (const r of a.why ?? []) { const o = (why[a.sp] ??= {}); o[r] = (o[r] ?? 0) + 1; }
      }
    }
    const per = {};
    for (const id of Object.keys(mix)) {
      const arr = A.by[id] ?? [];
      per[id] = { placed: placed[id], alive: arr.length, health: arr.length ? +(arr.reduce((t, a) => t + a.health, 0) / arr.length).toFixed(2) : null };
    }
    const deaths = (w.log?.list ?? w.journal ?? []).slice?.(-40)?.map?.((l) => l.text ?? l)?.filter?.((t) => /died|drown|eaten/.test(t)) ?? [];
    return { per, modes, why, water: { ph: +E.ph.toFixed(2), gh: +E.gh.toFixed(1), flow: +E.flow.toFixed(2), level: w.water.level }, ms: { total: Math.round(performance.now() - t0), perTick: +((performance.now() - t0) / ticks).toFixed(2), worstTick: +worstTick.toFixed(1) }, deaths };
  }, { days, source, filter });
  console.log(JSON.stringify(res, null, 1));
  console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
  await page.waitForTimeout(1500);
  await shot('caresheet');
};
