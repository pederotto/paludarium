// Erosion over 30 and 90 simulated days on generated tanks (cascade, stream, swamp): screenshots at
// day 0, 30 and 90 (top view) and statistics of volume drift and height change.
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/erosion-aging.mjs --wait=2500
//   EROSION_PRESETS=cascade,stream EROSION_DAYS=30,90 node tools/shot.mjs ...
//
// The flow field is the steady circuit and one game minute counts as one second of flow, so the
// result does not depend on the game speed: the loop runs frames at the time-lapse rate (600x) for
// speed; at 20x the same days take longer in real time but erode the same.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const presets = (process.env.EROSION_PRESETS || 'cascade,stream,swamp').split(',');
  const marks = (process.env.EROSION_DAYS || '30,90').split(',').map(Number);
  await page.waitForFunction(() => window.game?.world, null, { timeout: 60000 });
  for (const preset of presets) {
    await page.evaluate(async ({ preset, strength }) => {
      document.querySelector('#ui').style.display = 'none';
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const w = await window.game.loadTank('standard', { layout: 'empty' });
      window.game.rig.stopOrbit();
      generateTerrarium(w, { preset, seed: 1, tier: 'standard' });
      window.game.setSpeed(0);
      if (strength !== null) w.water.setErosion(strength);
      const f = w.terrain.field;
      window.__ero = { w, base0: f.base.slice(), v0: w.water.erosion.volume(), water0: w.water.hydro.total(), day: 0, mat0: f.mat.slice() };
      w.water.erosion.stats.eroded = w.water.erosion.stats.deposited = w.water.erosion.stats.slumped = 0;
    }, { preset, strength: process.env.EROSION_STRENGTH ? +process.env.EROSION_STRENGTH : null });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.game.rig.view('top', false));
    await page.waitForTimeout(1500);
    await shot(`erosion-${preset}-d0`);
    let day = 0;
    for (const mark of marks) {
      const rep = await page.evaluate(async ({ days }) => {
        const { w } = window.__ero, E = w.water.erosion, f = w.terrain.field;
        const t0 = performance.now();
        const frames = Math.round(days * 1440 / 30);
        const logs0 = w.logs.length;
        let ticks = 0;
        for (let k = 0; k < frames; k++) {
          w.sim.step(30);
          w.water.animate(0.05, 600);
          if (k % 40 === 0) await new Promise((r) => setTimeout(r, 0));
          ticks++;
        }
        window.__ero.day += days;
        // Make sure the last pending changes are on the ground and the mesh.
        w.groundChanged();
        const { base0, v0, water0 } = window.__ero;
        let sum = 0, abs = 0, mx = 0, mn = 0, n05 = 0, n2 = 0, mats = 0;
        const N = f.base.length;
        for (let n = 0; n < N; n++) {
          const d = f.base[n] - base0[n];
          sum += d; abs += Math.abs(d); if (d > mx) mx = d; if (d < mn) mn = d;
          if (Math.abs(d) > 0.5) n05++; if (Math.abs(d) > 2) n2++;
        }
        for (let i = 0; i < f.mat.length; i++) mats += Math.abs(f.mat[i] - window.__ero.mat0[i]);
        const area = E.area;
        const v1 = E.volume();
        return {
          day: window.__ero.day, seconds: +((performance.now() - t0) / 1000).toFixed(1), frames: ticks,
          volumeDriftPct: +(((v1 - v0) / v0) * 100).toFixed(4), volumeDriftCm3: +(v1 - v0).toFixed(1), groundVolumeCm3: +(v0).toFixed(0),
          meanAbsChangeCm: +(abs / N).toFixed(3), maxRiseCm: +mx.toFixed(2), maxDropCm: +mn.toFixed(2), cellsOver05cm: n05, cellsOver2cm: n2, cellsTotal: N,
          eroded: +E.stats.eroded.toFixed(1), deposited: +E.stats.deposited.toFixed(1), slumped: +E.stats.slumped.toFixed(1), suspended: +E.stats.suspended.toFixed(3),
          materialShift: +(mats / N / 2).toFixed(3),
          waterDriftPct: +(((w.water.hydro.total() - water0) / water0) * 100).toFixed(2),
          turbidity: +E.turb.toFixed(3), hanging: w.decor.pieces.filter((p) => p.unsupported).length, settledPieces: w.water.support.stats.settled,
          slumpLogs: w.logs.filter((l) => /slumped|hardscape settled/.test(l.msg)).length, newLogs: w.logs.length - logs0,
          area,
        };
      }, { days: mark - day });
      day = mark;
      console.log(preset, JSON.stringify(rep));
      await page.evaluate(() => window.game.rig.view('top', false));
      await page.waitForTimeout(1800);
      await shot(`erosion-${preset}-d${mark}`);
    }
  }
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs?.slice(0, 5) ?? null)));
};
