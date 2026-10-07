// S1 (run "sets"): builds every premade set at its `ref` tank (seed 1 unless SEED), lets it settle, and writes per set the plants
// by id, animals by id (alive after settle), animals inside the default camera, hardscape pieces, litres and the climate/water
// numbers, plus a default-camera screenshot (file `<id>-desktop.png`). Writes BB/reports/S1.counts.json for tools/set-audit.mjs.
//   export REPO=... BB=...; cd "$REPO"; sh "$BB/tools/gate.sh" S1 sh "$BB/tools/with-server.sh" sh -c 'SEED=1 node tools/shot.mjs --url="$SERVER_URL" --only=desktop --steps=tools/steps/set-counts.mjs --wait=2500 --out="$BB/shots/S1/before"'
// Env: SEED (default 1), SETS (comma list, default all), SETTLE (game minutes, default 720), COUNTS_OUT (json path).
// Stamp: `_stamp` in the json = the worktree HEAD plus "dirty" if src differs.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const fs = await import('node:fs');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  const seed = +(process.env.SEED || 1), settle = +(process.env.SETTLE || 720);
  const only = (process.env.SETS ?? '').split(',').filter(Boolean);
  const ids = await page.evaluate(async () => (await import('/src/content/presets.js')).PRESET_ORDER);
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 600000 }).catch(() => {});
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });   // click through the title: play view, no room
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(async () => { try { await window.game.settle?.(); } catch { /* no settle */ } });   // shaders built before the first picture
  const res = {};
  for (const id of ids) {
    if (only.length && !only.includes(id)) continue;
    const r = await page.evaluate(async ({ id, seed, settle }) => {
      document.querySelector('#ui').style.display = 'none';
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const { PRESETS } = await import('/src/content/presets.js');
      const P = PRESETS[id], game = window.game;
      const w = await game.loadTank(P.ref, { layout: 'empty' });
      const info = generateTerrarium(w, { preset: id, seed, tier: P.ref });
      game.rig.stopOrbit(); game.setSpeed?.(0);
      for (let k = 0; k < 3; k++) { w.sim.step(settle / 3); w.animals.move(0.05); }
      w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 11 * 60; for (let k = 0; k < 10; k++) w.sim.step(1);   // 11:00: pictures at night are black
      game.rig.view('front', false);
      const { TANK } = await import('/src/sim/tank.js');
      let wet = 0, cells = 0;   // share of the floor under water (surface above the ground), 40 x 20 samples
      for (let i = 0; i < 40; i++) for (let j = 0; j < 20; j++) { const x = (i / 39 - 0.5) * TANK.w * 0.96, z = (j / 19 - 0.5) * TANK.d * 0.96; const sf = w.water.surfaceAt(x, z); cells++; if (sf !== -Infinity && sf > w.terrain.heightAt(x, z) + 0.3) wet++; }
      const plants = {};
      for (const p of w.plants.list) { const k = p.id ?? p.type ?? p.sp?.id; plants[k] = (plants[k] ?? 0) + 1; }
      const animals = {}, visible = {};
      game.camera.updateMatrixWorld(); game.camera.matrixWorldInverse.copy(game.camera.matrixWorld).invert();
      for (const [k, v] of Object.entries(w.animals.by)) {
        if (!v.length) continue;
        animals[k] = v.length;
        for (const a of v) {
          try { const q = a.pos.clone().project(game.camera); if (Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1) visible[k] = (visible[k] ?? 0) + 1; } catch { /* no position */ }
        }
      }
      const env = {};
      for (const [k, v] of Object.entries(w.env)) if (typeof v === 'number' && /temp|rh|hum|^ph$|^gh$|setpoint|flow|nitrate/i.test(k)) env[k] = +v.toFixed(2);
      const cl = {};
      try { for (const [k, v] of Object.entries(w.climate)) if (typeof v === 'number' && /temp|rh|hum|air|water/i.test(k)) cl[k] = +v.toFixed(2); } catch { /* no climate */ }
      return { waterShare: +(wet / cells).toFixed(2), tank: P.ref, litres: info.litres, level: info.level, falls: info.falls, pools: info.pools, pieces: info.pieces, plants, animals, visible, env, climate: cl, warnings: info.warnings, requested: info.animals, gear: info.gear };
    }, { id, seed, settle });
    res[id] = r;
    console.log(id, JSON.stringify({ litres: r.litres, pieces: r.pieces, plants: Object.values(r.plants).reduce((a, b) => a + b, 0), animals: r.animals, visible: r.visible }));
    await page.evaluate(async () => { try { await window.game.settle?.(); } catch { /* ok */ } });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.game.camera.updateMatrixWorld());
    await shot(id);
  }
  const { execSync } = await import('node:child_process');
  let head = '?';
  try { head = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src').toString().trim() ? ' dirty' : ''); } catch { /* no git */ }
  res._stamp = `${head} seed ${seed} settle ${settle} min`;
  const outp = process.env.COUNTS_OUT || `${process.env.BB}/reports/S1.counts.json`;
  fs.writeFileSync(outp, JSON.stringify(res, null, 1));
  console.log(`set-counts: ${Object.keys(res).length - 1} sets, stamp ${res._stamp}, errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);
};
