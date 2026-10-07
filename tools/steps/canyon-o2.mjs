// Why does a canyon build lose its animals to 'low oxygen' (run "sets")? Builds PRESET:SEED:TIER (GEN_LIST like gen-check, GEN_KNOBS for recipe knobs),
// steps game days and prints every water body's oxygen terms, then where each animal sits. node tools/shot.mjs --steps=tools/steps/canyon-o2.mjs
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const list = (process.env.GEN_LIST || 'canyon:3:long').split(',').map((s) => { const [preset, seed, tier] = s.split(':'); return { preset, seed: +seed, tier }; });
  const process_filter = !!process.env.FILTER, process_hourly = !!process.env.HOURLY, days = +(process.env.GEN_DAYS || 3), knobs = process.env.GEN_KNOBS ? JSON.parse(process.env.GEN_KNOBS) : null;
  for (const { preset, seed, tier } of list) {
    const r = await page.evaluate(async ({ preset, seed, tier, days, knobs, process_hourly, process_filter }) => {
      await new Promise((res) => { const t = setInterval(() => { if (document.getElementById('loading')?.classList.contains('gone') && window.game?.world) { clearInterval(t); setTimeout(res, 800); } }, 200); });
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const { PRESETS } = await import('/src/content/presets.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      window.game.rig.stopOrbit();
      if (knobs?.[preset]) Object.assign(PRESETS[preset], knobs[preset]);
      const info = generateTerrarium(w, { preset, seed, tier });
      const B = w.water.bodies, snap = (tag) => ({ tag, E: +w.env.oxygen.toFixed(2), bodies: B.list.map((b) => ({ k: b.kind, vol: +(b.vol ?? 0).toFixed(1), n: b.n, depth: +(b.depth ?? 0).toFixed(1), falls: b.falls, o2: +b.oxygen.toFixed(2), fishLoad: +(b.fishLoad ?? 0).toFixed(2), temp: +b.temp.toFixed(1) })) });
      const E0 = w.env, filt = { filter: E0.filter, kind: E0.filterKind, flow: E0.filterFlow, lph: E0.filterLph, media: E0.mediaBio, pump: w.water.hydro.pump?.rate };
      if (process_filter) { w.sim.step(300); const sb = B.sump; return { name: info.name, litres: info.litres, sump: { falls: sb.falls, plantUse: +sb.plantUse.toFixed(1), o2: +sb.oxygen.toFixed(2), fl: +sb.fishLoad.toFixed(0) }, hydroFalls: w.water.falls.length, pumpOn: w.water.hydro.pump?.running }; }
      const out = [snap('built')];
      if (process_hourly) {   // the first day hour by hour: the sump's oxygen and who dies of what
        const rm = w.animals.remove.bind(w.animals); let hr = 0; const log = [];
        w.animals.remove = (a, cause) => { if (cause && !/^eaten|hatched|metamorph|moved/.test(cause)) log.push(`h${hr} ${a.sp} ${cause}`); return rm(a, cause); };
        const series = [];
        for (hr = 1; hr <= 30; hr++) { w.sim.step(60); for (let k = 0; k < 2; k++) w.animals.move(0.05); const sb = B.sump; series.push(`h${hr} o2 ${sb.oxygen.toFixed(2)} fl ${sb.fishLoad.toFixed(0)} amm ${sb.ammonia.toFixed(2)} nit ${sb.nitrite.toFixed(2)} t ${sb.temp.toFixed(1)} alive ${w.animals.all.filter((x) => ['zacco', 'hillloach', 'shrimp'].includes(x.sp)).length}`); }
        return { name: info.name, series, log: log.slice(0, 12), mix: Object.fromEntries(['zacco', 'hillloach', 'shrimp'].map((k) => [k, (w.animals.by[k] ?? []).length])) };
      }
      for (let d = 0; d < days; d++) { w.sim.step(1440); for (let k = 0; k < 3; k++) w.animals.move(0.05); out.push(snap('day' + (d + 1))); }
      const where = {};
      for (const a of w.animals.all) { const b = B.at(a.pos.x, a.pos.z); (where[a.sp] ??= []).push(b ? b.kind + ':' + b.oxygen.toFixed(1) : 'none'); }
      const small = (sn) => ({ tag: sn.tag, E: sn.E, big: sn.bodies.filter((b) => b.vol > 1 || b.k === 'sump').map((b) => `${b.k} v${b.vol} d${b.depth} f${b.falls} o2 ${b.o2} fl${b.fishLoad} t${b.temp}`), cups: sn.bodies.filter((b) => b.vol <= 1 && b.k !== 'sump').length, minCupO2: Math.min(...sn.bodies.filter((b) => b.vol <= 1 && b.k !== 'sump').map((b) => b.o2)) });
      const tally = (l) => l.reduce((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {});
      return { name: info.name, litres: info.litres, snaps: [out[0], out[1], out[out.length - 1]].map(small), where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, tally(v)])), gear: info.gear, filter: w.env.filter, F: w.env.filterKind, falls: w.water.falls.length };
    }, { preset, seed, tier, days, knobs, process_hourly, process_filter });
    console.log('O2', `${preset}:${seed}:${tier}`, JSON.stringify(r));
  }
};
