// The floor: the build seen through the front glass (render/soilside.js: false bottom, mesh, substrate, the plenum's water
// at its simulated level, sim/plenum.js) and the ground's surface (render/shaders.js substrateMaterial). Prints numbers:
//   plenum  the false bottom's water over a game day: rain, pump on and off, flooded (E.plenumLevel, cm over the glass)
//   look    the ground seen from straight above (about 60 cm of it) with everything but the ground hidden: `rep` the
//           strongest repeat of its detail (the picture minus a 9-px blur, normalised autocorrelation at shifts of 8 … 50 %
//           of the crop: a tiled texture peaks at its period, a random one stays near 0), `macro` the spread of 32-px block
//           means (a flat one-colour floor is near 0), `fine` the spread inside blocks.
//   node tools/shot.mjs --url=http://localhost:4483/ --only=desktop --steps=tools/steps/floor-look.mjs --wait=2500 --out=<dir> [--query=?webgl]
import sharp from 'sharp';

async function lookNumbers(buf) {
  const { data, info } = await sharp(buf).resize(320, 200).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels, n = W * H;
  const g = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { g[i] = 0.3 * data[i * ch] + 0.59 * data[i * ch + 1] + 0.11 * data[i * ch + 2]; mean += g[i]; }
  mean /= n;
  // High-pass: subtract a 9-px box blur, so large smooth patches do not count as a repeat.
  const hp = new Float32Array(n), R = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, k = 0;
    for (let v = Math.max(0, y - R); v <= Math.min(H - 1, y + R); v++) for (let u = Math.max(0, x - R); u <= Math.min(W - 1, x + R); u++) { s += g[v * W + u]; k++; }
    hp[y * W + x] = g[y * W + x] - s / k;
  }
  g.set(hp);
  let v0 = 0;
  for (let i = 0; i < n; i++) v0 += g[i] * g[i];
  let rep = 0;
  for (let dy = -100; dy <= 100; dy += 2) for (let dx = -160; dx <= 160; dx += 2) {
    if (Math.hypot(dx / W, dy / H) < 0.08) continue;
    let s = 0, k = 0;
    for (let y = Math.max(0, -dy); y < Math.min(H, H - dy); y++) for (let x = Math.max(0, -dx); x < Math.min(W, W - dx); x++) { s += g[y * W + x] * g[(y + dy) * W + x + dx]; k++; }
    rep = Math.max(rep, (s / k) / (v0 / n));
  }
  // Colour spread: block means (macro) and within blocks (fine), on all three channels.
  const B = 32, bm = [];
  let fine = 0, fk = 0;
  for (let by = 0; by + B <= H; by += B) for (let bx = 0; bx + B <= W; bx += B) {
    const m = [0, 0, 0];
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) for (let c = 0; c < 3; c++) m[c] += data[(y * W + x) * ch + c];
    for (let c = 0; c < 3; c++) m[c] /= B * B;
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { let d = 0; for (let c = 0; c < 3; c++) d += (data[(y * W + x) * ch + c] - m[c]) ** 2; fine += d; fk++; }
    bm.push(m);
  }
  const mm = [0, 1, 2].map((c) => bm.reduce((a, m) => a + m[c], 0) / bm.length);
  const macro = Math.sqrt(bm.reduce((a, m) => a + [0, 1, 2].reduce((b, c) => b + (m[c] - mm[c]) ** 2, 0), 0) / bm.length);
  return { rep: +rep.toFixed(3), macro: +macro.toFixed(1), fine: +Math.sqrt(fine / fk).toFixed(1), rgb: mm.map((v) => Math.round(v)) };
}

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const setup = (preset, seed) => page.evaluate(async ({ preset, seed }) => {
    const gen = await import('/src/sim/generator.js');
    const w = await window.game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset, seed, tier: 'standard' });
    w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 11 * 60;
    for (let t = 0; t < 5; t++) w.sim.step(1);
    window.game.setSpeed(0);
    window.__tank = await import('/src/sim/tank.js');
    window.__cam = (p) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, false); };
    return { level: +w.water.level.toFixed(2) };
  }, { preset, seed });
  console.log('tank', JSON.stringify(await setup('streambank', 2)));
  await page.addStyleTag({ content: '#ui{display:none!important}' });

  // --- Renders ---------------------------------------------------------------------------------------------------------
  const set = async (label, o, cam) => {
    const r = await page.evaluate(({ o, cam }) => {
      const w = window.game.world, E = w.env;
      Object.assign(E, o);
      if (o.level != null) w.setWaterLevel(o.level === 'over' ? E.plenumH + 1.5 : o.level === 'under' ? E.plenumH - 1.5 : o.level);
      for (let t = 0; t < 3; t++) w.sim.step(1);
      E.minute = Math.floor(E.minute / 1440) * 1440 + 11 * 60;
      window.__cam(cam);
      return { level: +w.water.level.toFixed(2), plenumH: E.plenumH, plenumLevel: E.plenumLevel ?? null, plenum: E.plenum?.state ?? null };
    }, { o, cam });
    console.log(label, JSON.stringify(r));
    await page.waitForTimeout(3000);
    await shot(label);
  };
  // Through the glass (front or a side) where the land is highest against it.
  const F = await page.evaluate(() => {
    const T = window.game.world.terrain, { TANK } = window.__tank, hw = TANK.w / 2 - 0.1, hd = TANK.d / 2 - 0.1;
    let best = { h: -1 };
    for (let x = -hw + 8; x < hw - 8; x += 1) { const h = T.baseAt(x, hd); if (h > best.h) best = { h, cam: [x, 0, hd + 11], at: [x, 0, hd + 0.7], far: [x, 0, hd + 40] }; }
    for (const sx of [-1, 1]) for (let z = -hd + 6; z < hd - 6; z += 1) { const h = T.baseAt(sx * hw, z); if (h > best.h) best = { h, cam: [sx * (hw + 11), 0, z], at: [sx * (hw + 0.7), 0, z], far: [sx * (hw + 40), 0, z] }; }
    return best;
  });
  console.log('glass spot', JSON.stringify(F));
  const front = [F.cam[0], 5.5, F.cam[2], F.at[0], 4.5, F.at[2]];   // the false bottom and the soil over it (the target outside the glass: the camera lifts one under the ground)
  await set('floor-front-fb', { drainage: 1, plenumH: 6, substrate: 'abg', level: 'under' }, front);
  await set('floor-front-fb-flooded', { drainage: 1, plenumH: 6, substrate: 'abg', level: 'over' }, front);
  await set('floor-front-leca', { drainage: 0.6, substrate: 'coir', level: 4 }, front);
  await set('floor-front-fb-far', { drainage: 1, plenumH: 6, substrate: 'abg', level: 'under' }, [F.far[0], F.h * 0.6, F.far[2], F.at[0], F.h * 0.5, F.at[2]]);
  // The ground's surface close up (as in the user's photo of the blue frog) and the whole tank (the flat green floor photo).
  const G = await page.evaluate(() => { const w = window.game.world; let best = null; for (let x = -40; x <= 40; x += 4) for (let z = -10; z <= 15; z += 3) { const h = w.terrain.heightAt(x, z), wet = w.water.surfaceAt(x, z) > h; if (!wet && (!best || h < best.h + 0.5 && Math.abs(x) < Math.abs(best.x))) best = { x, z, h }; } return best; });
  console.log('ground spot', JSON.stringify(G));
  await set('floor-ground', { drainage: 1, plenumH: 6, level: 'under' }, [G.x + 4, G.h + 9, G.z + 22, G.x, G.h, G.z]);
  await set('floor-ground-low', {}, [G.x - 6, G.h + 5, G.z + 16, G.x - 2, G.h, G.z]);   // a frog's eye view of the floor
  await set('floor-tank', {}, [0, 34, 105, 0, 12, -5]);

  // --- The ground alone from above: the look numbers ------------------------------------------------------------------
  await page.evaluate((G) => {
    const w = window.game.world, keep = w.terrain.mesh;
    window.__hidden = [];
    window.game.scene?.traverse?.((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o !== keep && o.visible) { o.visible = false; window.__hidden.push(o); } });
    window.__cam([G.x + 0.01, G.h + 55, G.z + 0.5, G.x, G.h, G.z]);
  }, G);
  await page.waitForTimeout(3000);
  const buf = await page.screenshot({ clip: { x: 320, y: 160, width: 640, height: 400 } });
  await shot('floor-top');
  console.log('look', JSON.stringify(await lookNumbers(buf)));
  await page.evaluate(() => { for (const o of window.__hidden ?? []) o.visible = true; });
  // --- The plenum's water over a game day (numbers) ------------------------------------------------------------------
  const day = await page.evaluate(() => {
    const w = window.game.world, E = w.env, H = w.water.hydro;
    const lv = () => (E.plenumLevel ?? (E.plenum ? E.plenumH + E.plenum.rel : null));
    const out = {};
    const run = (label, minutes, before) => {
      before?.();
      const rows = [];
      for (let t = 0; t < minutes; t++) { w.sim.step(1); if (t % Math.max(1, minutes / 6 | 0) === 0 || t === minutes - 1) rows.push(+(lv() ?? NaN).toFixed(2)); }
      out[label] = { level: rows, state: E.plenum?.state ?? null, L: E.plenumL != null ? +E.plenumL.toFixed(1) : null, pumpLph: Math.round(H.pump.lph) };
    };
    E.drainage = 1; E.plenumH = Math.round(w.water.level + 2); E.substrate = 'abg';
    delete E.plenumLevel;
    run('fitted', 60);
    run('pump-on-6h', 360, () => { H.pump.on = true; });
    run('pump-off-6h', 360, () => { H.pump.on = false; });
    run('rain-1h-pump-off', 60, () => { E.rainUntil = E.minute + 60; });
    run('after-rain-5h', 300);
    H.pump.on = true;
    run('pump-on-again-6h', 360);
    run('pool-over-mesh-1h', 60, () => { w.setWaterLevel(E.plenumH + 1.5); });
    w.setWaterLevel(E.plenumH - 2);
    run('pool-back-2h', 120);
    return out;
  });
  for (const [k, v] of Object.entries(day)) console.log('plenum', k, JSON.stringify(v));

};
