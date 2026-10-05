// Every tank size, one after the other in one running game: loads each preset tank (and custom extremes) with a generated
// terrarium, takes a front picture of the room view (the free camera with the cabinet and the floor, as on the title screen)
// and of the play view, runs the simulation for a few game days and a few real seconds at 60x, and prints PASS/FAIL lines:
// no console errors, no NaN, animals inside the glass, the camera inside its limits with the tank in view, and everything
// built to a size built to THIS tank's size (nothing left over from the tank before). Then a save made in one size is
// loaded from another, and Home goes back to the title tank. Prints a summary table (sizes, fill of the screen, frame time).
//
//   node tools/shot.mjs --url=http://127.0.0.1:5173/ --steps=tools/steps/tank-sizes.mjs --only=desktop --out=test-output/tank-sizes
//   TANKS=jar,show,custom:25x20x25 DAYS=1 node tools/shot.mjs ... (a subset; custom:WxDxH is a custom size)
//
// Env: TANKS (default: every preset tank, then custom 25x20x25, 200x20x25 and 200x80x75), DAYS (game days, default 2),
// FAST (real seconds at 60x, default 3), SEED (default 1). Exit code 1 (from shot.mjs) only on console errors; the PASS/FAIL
// lines and the final "TANK-SIZES n FAIL" line are the verdict. About 15 s a tank on an M1.
const DEFAULT = ['jar', 'cube', 'nano', 'tall', 'standard', 'long', 'wide', 'grand', 'show', 'custom:25x20x25', 'custom:200x20x25', 'custom:200x80x75'];

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const list = (process.env.TANKS ? process.env.TANKS.split(',') : DEFAULT).map((s) => s.trim()).filter(Boolean);
  const days = +(process.env.DAYS ?? 2), fast = +(process.env.FAST ?? 3), seed = +(process.env.SEED ?? 1);
  let fails = 0;
  const ok = (label, pass, detail = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); };
  await page.waitForFunction(() => window.game?.world && window.__director, null, { timeout: 90000 });
  const rows = [], mems = [];

  for (const entry of list) {
    const [tier, size] = entry.split(':');
    const label = size ? `custom-${size}` : tier;
    // 1. Build the tank from a generated preset (the title's "generated terrarium" path), then look at it from the room.
    const r = await page.evaluate(async ({ tier, size, seed }) => {
      const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(f) && !n.includes('.map')).pop() ?? '/src' + f;
      const tk = await import(url('/content/tanks.js'));
      const { PRESETS, PRESET_ORDER } = await import(url('/content/presets.js'));
      const g = window.game, D = window.__director;
      const e0 = window.__errs.length;
      if (size) { const [w, d, h] = size.split('x').map(Number); tk.setCustomTank(w, d, h, { remember: false }); }
      // A preset that suits the tier: the cascade where it can (it has falls), the jar's own in the jar, else the first.
      const preset = tier === 'custom' ? 'cascade' : PRESETS.cascade.tiers.includes(tier) ? 'cascade' : PRESET_ORDER.find((p) => PRESETS[p].tiers.includes(tier));
      const t0 = performance.now();
      await D.startSandbox('preset', tier, { id: preset, seed });
      const buildMs = Math.round(performance.now() - t0);
      g.rig.stopOrbit(); g.rig.freeZone(); g.setRoom(true); g.rig.view('front', false);
      document.getElementById('ui').style.visibility = 'hidden';
      // Every visible object with its shaders before the picture (game.settle lets a few slow pipelines finish later).
      const c = g.gfx.compiler; c.budget = 40;
      const settled = await c.settled(20000, { stragglers: 0, grace: 0 }).finally(() => { c.budget = 8; });
      await new Promise((res) => setTimeout(res, 600));
      window.__tsErr = e0;
      (window.__tsWorlds ??= []).push(new WeakRef(g.world));   // checked at the end: a tank that is gone must be collectable
      return { preset, buildMs, settled };
    }, { tier, size, seed });
    const roomLook = await page.evaluate(lookFn);
    await shot(`room-${label}`);

    // 2. The play view, as the player gets it (interface shown).
    await page.evaluate(async () => {
      const g = window.game;
      document.getElementById('ui').style.visibility = '';
      window.__director.enterPlay();
      const c = g.gfx.compiler; c.budget = 40;
      await c.settled(20000, { stragglers: 0, grace: 0 }).finally(() => { c.budget = 8; });
      await new Promise((res) => setTimeout(res, 2200));   // the camera eases into the tank framing
    });
    const playLook = await page.evaluate(lookFn);
    await shot(`play-${label}`);

    // 3. Checks on what was built, then the simulation: whole days in big steps, then real frames at 60x.
    const c = await page.evaluate(async ({ days, fast }) => {
      const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(f) && !n.includes('.map')).pop() ?? '/src' + f;
      const { TANK, TERRAIN_RES, WALL_RES } = await import(url('/sim/tank.js'));
      const g = window.game, W = g.world;
      const out = { tank: `${TANK.id} ${TANK.w}x${TANK.d}x${TANK.h}`, litres: Math.round(TANK.w * TANK.d * TANK.h / 1000) };
      // Everything sized at construction must have this tank's size.
      const sized = [];
      const want = (what, a, b, tol = 0.01) => { if (!(Math.abs(a - b) <= tol)) sized.push(`${what} ${+a.toFixed?.(2) || a} != ${+b.toFixed?.(2) || b}`); };
      want('terrain nx', W.terrain.field.nx, TERRAIN_RES.nx); want('terrain ny', W.terrain.field.ny, TERRAIN_RES.nz);
      want('wall nx', W.wall.field.nx, WALL_RES.nx); want('wall ny', W.wall.field.ny, WALL_RES.ny);
      const sp = W.water.surface?.geometry?.parameters;
      if (sp) { want('water surface w', sp.width, TANK.w - 0.1, 0.5); want('water surface d', sp.height, TANK.d - 0.1, 0.5); }
      const cp = g.fx?.causMesh?.geometry?.parameters;
      if (cp) { want('caustics grid w', cp.width, TANK.w, 0.5); want('caustics grid d', cp.height, TANK.d, 0.5); }
      want('climate nx', W.climate.nx, Math.max(4, Math.ceil(TANK.w / W.climate.cs)), 0); want('climate nz', W.climate.nz, Math.max(4, Math.ceil(TANK.d / W.climate.cs)), 0);
      if (W.animals.occ) { const o = W.animals.occ; want('occupancy nx', o.nx, Math.ceil(TANK.w / 1.5), 0); want('occupancy ny', o.ny, Math.ceil(TANK.h / 1.5), 0); want('occupancy nz', o.nz, Math.ceil(TANK.d / 1.5), 0); }
      if (g.lens) { want('lens nx', g.lens.nx, W.climate.nx, 0); want('lens nz', g.lens.nz, W.climate.nz, 0); }
      // Objects of the world that reach well outside the glass (a mesh built for another size would). The cabinet below the
      // tank (y < 0) and the plumbing behind it are allowed some room.
      const outside = [];
      g.worldRoot.updateMatrixWorld(true);
      g.worldRoot.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || !o.visible || !o.geometry) return;
        if (o.isInstancedMesh && o.count === 0) return;
        const gb = o.geometry.boundingBox ?? (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        if (!gb || !Number.isFinite(gb.min.x)) return;
        const b = gb.clone().applyMatrix4(o.matrixWorld);
        if (o.isInstancedMesh) return;   // (instance matrices are checked through the animals and plants below)
        const mx = TANK.w / 2 + 12, mzF = TANK.d / 2 + 12, mzB = TANK.d / 2 + 40;
        if (b.min.x < -mx || b.max.x > mx || b.max.z > mzF || b.min.z < -mzB || b.max.y > TANK.h + 25) outside.push(`${o.name || o.type}[${b.min.x.toFixed(0)}..${b.max.x.toFixed(0)},${b.min.z.toFixed(0)}..${b.max.z.toFixed(0)},y<${b.max.y.toFixed(0)}]`);
      });
      out.sized = sized; out.outside = outside.slice(0, 6);
      // Water: the level under the lid, the pump and the outlets inside the glass.
      const H = W.water.hydro, inX = (x, m = 0) => Math.abs(x) <= TANK.w / 2 + m, inZ = (z, m = 0) => Math.abs(z) <= TANK.d / 2 + m;
      out.water = { level: +W.water.level.toFixed(1), litres: +W.water.volumeLitres().toFixed(1), outlets: H.outlets.length, falls: W.water.ribbons?.size ?? 0 };
      out.waterBad = [];
      if (W.water.level > TANK.h - 5.9) out.waterBad.push('level ' + W.water.level.toFixed(1));
      if (H.pump.intake && !(inX(H.pump.intake.x) && inZ(H.pump.intake.z))) out.waterBad.push('pump ' + JSON.stringify(H.pump.intake));
      for (const o of H.outlets) if (!(inX(o.pos.x) && inZ(o.pos.z) && o.pos.y <= TANK.h + 0.5 && o.pos.y >= 0)) out.waterBad.push('outlet ' + o.pos.toArray().map((v) => v.toFixed(1)));
      const escaped = () => W.animals.all.filter((a) => !(inX(a.pos.x, 0.3) && inZ(a.pos.z, 0.3) && a.pos.y >= -0.5 && a.pos.y <= TANK.h + 0.5)).map((a) => `${a.sp}@${a.pos.toArray().map((v) => v.toFixed(1))}`);
      const plantsOut = () => W.plants.list.filter((p) => !(inX(p.pos.x, 0.5) && inZ(p.pos.z, 0.5) && p.pos.y >= -0.5 && p.pos.y <= TANK.h + 0.5)).map((p) => p.id);
      const nan = () => {
        const bad = Object.entries(W.env).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => 'env.' + k);
        for (const k of ['hum', 'temp', 'light']) if (W.climate[k]?.some?.((v) => !Number.isFinite(v))) bad.push('climate.' + k);
        for (const p of W.plants.list) if (![p.pos.x, p.pos.y, p.pos.z, p.grown, p.health].every(Number.isFinite)) { bad.push('plant:' + p.id); break; }
        for (const a of W.animals.all) if (![a.pos.x, a.pos.y, a.pos.z, a.health, a.hunger].every(Number.isFinite)) { bad.push('animal:' + a.sp); break; }
        if (!Number.isFinite(W.water.level) || !Number.isFinite(H.total())) bad.push('water');
        return bad;
      };
      const count = () => W.animals.all.length;
      out.start = { animals: count(), plants: W.plants.list.length, escaped: escaped(), plantsOut: plantsOut(), nan: nan() };
      const t0 = performance.now();
      for (let d = 0; d < days; d++) { W.sim.step(1440); for (let k = 0; k < 3; k++) W.animals.move(0.05); }
      out.simMs = Math.round(performance.now() - t0);
      // Real frames at 60x: the frame loop's own path (water, mist, plumbing, lens, the animals' moves).
      g.setSpeed(4);
      let n = 0; const f0 = performance.now();
      await new Promise((res) => { const f = () => { n++; if (performance.now() - f0 > fast * 1000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      g.setSpeed(1);
      out.fps = +(n / fast).toFixed(1);
      out.frameMs = +(g.gfx.stats?.frameMs ?? 0).toFixed?.(1);
      out.end = { animals: count(), plants: W.plants.list.length, escaped: escaped(), plantsOut: plantsOut(), nan: nan() };
      const errs = window.__errs.slice(window.__tsErr);
      out.errors = errs.filter((e) => !e.startsWith('warn')).slice(0, 4);
      out.warns = errs.filter((e) => e.startsWith('warn')).map((e) => e.slice(0, 160));
      const mem = g.renderer.info?.memory ?? {};
      out.mem = { geo: mem.geometries, tex: mem.textures, texMB: Math.round((mem.texturesSize ?? 0) / 1e6), scene: g.scene.children.length };
      return out;
    }, { days, fast });

    console.log(`\n== ${label}: ${c.tank} (${c.litres} l), preset ${r.preset}, built in ${r.buildMs} ms${r.settled ? '' : ' (shaders still building after 20 s: the pictures may miss parts)'}`);
    console.log(JSON.stringify({ room: roomLook, play: playLook }));
    console.log(JSON.stringify({ water: c.water, start: { animals: c.start.animals, plants: c.start.plants }, end: { animals: c.end.animals, plants: c.end.plants }, simMs: c.simMs, fps: c.fps, frameMs: c.frameMs, mem: c.mem }));
    ok(`${label}: no console errors`, c.errors.length === 0, c.errors.join(' | '));
    if (c.warns.length) console.log(`      ${c.warns.length} warnings: ${[...new Set(c.warns)].slice(0, 3).join(' | ')}`);
    ok(`${label}: everything is built to this tank's size`, c.sized.length === 0, c.sized.join('; '));
    ok(`${label}: nothing in the world reaches far outside the glass`, c.outside.length === 0, c.outside.join(' '));
    ok(`${label}: water level, pump and outlets inside the tank`, c.waterBad.length === 0, c.waterBad.join('; '));
    ok(`${label}: no NaN before or after the run`, !c.start.nan.length && !c.end.nan.length, [...c.start.nan, ...c.end.nan].join(' '));
    ok(`${label}: animals inside the glass (start, after ${days} days and ${fast} s at 60x)`, !c.start.escaped.length && !c.end.escaped.length, [...c.start.escaped, ...c.end.escaped].slice(0, 5).join(' '));
    ok(`${label}: plants inside the glass`, !c.start.plantsOut.length && !c.end.plantsOut.length, [...c.start.plantsOut, ...c.end.plantsOut].slice(0, 5).join(' '));
    ok(`${label}: room camera inside its limits, tank in view`, roomLook.inLimits && roomLook.inView, JSON.stringify(roomLook.why));
    ok(`${label}: play camera inside its limits, tank in view`, playLook.inLimits && playLook.inView, JSON.stringify(playLook.why));
    mems.push(c.mem);
    rows.push({ tank: label, size: c.tank.split(' ')[1], litres: c.litres, animals: c.start.animals, plants: c.start.plants, roomFill: roomLook.fill, playFill: playLook.fill, playDist: playLook.dist, fps: c.fps, frameMs: c.frameMs, simMs: c.simMs, buildMs: r.buildMs });
  }

  // GPU memory: a tank that is gone must take its textures with it (each load used to leave the old post-processing
  // pipeline's screen-sized render targets behind: 36 textures, about 118 MB a tank at 1280x720). three counts a texture until
  // it is disposed, not until it is collected, so a few stay in the count that the garbage collector frees once the old World
  // is unreachable (checked below): the old Stage's LED shadow map (2 textures, 34 MB, until engine/stage.js disposes its
  // lights) and three's own copies of the depth buffer for the water's refraction (6, 22 MB). Hence the margin.
  if (mems.length > 2) {
    const per = (mems.at(-1).tex - mems[1].tex) / (mems.length - 2), perMB = (mems.at(-1).texMB - mems[1].texMB) / (mems.length - 2);
    ok('GPU textures do not pile up from tank to tank', per <= 12 && perMB <= 70, `${per.toFixed(1)} textures, ${perMB.toFixed(0)} MB more per tank by three's count (${mems.map((m) => m.tex).join(' ')})`);
  }

  // 4. A save made in one size, loaded while another size is open, comes back at its own size and with its contents.
  if (list.length > 1) {
    const s = await page.evaluate(async () => {
      const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(f) && !n.includes('.map')).pop() ?? '/src' + f;
      const { TANK } = await import(url('/sim/tank.js'));
      const g = window.game, D = window.__director;
      const dims = () => `${TANK.id} ${TANK.w}x${TANK.d}x${TANK.h}`;
      const before = { dims: dims(), plants: g.world.plants.list.length, animals: g.world.animals.all.length, nx: g.world.terrain.field.nx };
      await D.save();
      await D.startSandbox('empty', before.dims.startsWith('jar') ? 'show' : 'jar');
      const other = dims();
      await D.load(); D.enterPlay();
      const after = { dims: dims(), plants: g.world.plants.list.length, animals: g.world.animals.all.length, nx: g.world.terrain.field.nx };
      return { before, other, after };
    });
    console.log('\n' + JSON.stringify(s));
    ok('a save from one size loads at its own size from another size', s.after.dims === s.before.dims && s.after.nx === s.before.nx && s.other !== s.before.dims);
    ok('the loaded save has its plants and animals', s.after.plants === s.before.plants && Math.abs(s.after.animals - s.before.animals) <= Math.max(2, s.before.animals * 0.05), `${s.before.plants}/${s.before.animals} -> ${s.after.plants}/${s.after.animals}`);
  }

  // 5. Home: back to the title's standard tank, then a new game reuses it (Game.restartTank) at the standard size.
  const h = await page.evaluate(async () => {
    const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(f) && !n.includes('.map')).pop() ?? '/src' + f;
    const { TANK, TERRAIN_RES } = await import(url('/sim/tank.js'));
    const g = window.game, D = window.__director;
    await D.goHome();
    const w0 = g.world, title = `${TANK.id} ${TANK.w}x${TANK.d}x${TANK.h}`;
    await D.startSandbox('starter', 'standard'); D.enterPlay();
    await g.settle(6000);
    return { title, reused: g.world === w0, nx: g.world.terrain.field.nx, want: TERRAIN_RES.nx, sp: g.world.water.surface?.geometry?.parameters?.width, w: TANK.w, mem: { geo: g.renderer.info?.memory?.geometries, tex: g.renderer.info?.memory?.textures } };
  });
  console.log('\n' + JSON.stringify(h));
  ok('Home shows the standard tank again', h.title.startsWith('standard 90x45x60'));
  ok('a new game from the title reuses the title tank at its size', h.reused && h.nx === h.want && Math.abs(h.sp - (h.w - 0.1)) < 0.5);
  await shot('home-standard');

  // Nothing keeps a tank that is gone alive (a Lens subscription used to keep every World ever left, with its Stage and mist).
  const cdp = await page.context().newCDPSession(page);
  for (let k = 0; k < 3; k++) { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); }
  const alive = await page.evaluate(() => (window.__tsWorlds ?? []).filter((r) => { const w = r.deref(); return w && w !== window.game.world; }).length);
  ok('worlds of the tanks that were left are garbage collected', alive === 0, `${alive} of ${list.length} still in memory`);

  console.log('\n' + ['tank', 'size', 'litres', 'animals', 'plants', 'roomFill', 'playFill', 'playDist', 'fps', 'frameMs', 'simMs', 'buildMs'].join('\t'));
  for (const r of rows) console.log(Object.values(r).join('\t'));
  console.log(`\nTANK-SIZES ${fails} FAIL`);
};

// The camera now: inside the controls' limits (distance, tilt, target in its box), and the tank in view, with how much of the
// screen's width the front glass takes (the "fill", 1 = edge to edge) and the camera's distance to its target.
function lookFn() {
  const g = window.game, c = g.controls, cam = g.camera;
  const V = cam.position.constructor;
  return (async () => {
    const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(f) && !n.includes('.map')).pop() ?? '/src' + f;
    const { TANK } = await import(url('/sim/tank.js'));
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const why = [];
    const dist = c.distance, polar = c.polarAngle;
    if (dist > c.maxDistance + 0.05) why.push(`distance ${dist.toFixed(1)} > max ${c.maxDistance.toFixed(1)}`);
    if (dist < c.minDistance - 0.05) why.push(`distance ${dist.toFixed(1)} < min ${c.minDistance}`);
    if (polar < c.minPolarAngle - 1e-3 || polar > c.maxPolarAngle + 1e-3) why.push(`tilt ${polar.toFixed(2)} outside ${c.minPolarAngle.toFixed(2)}..${c.maxPolarAngle.toFixed(2)}`);
    const t = c.getTarget(new V()), B = c._boundary;
    if (B && !B.containsPoint(t)) why.push(`target ${t.toArray().map((v) => v.toFixed(1))} outside its box`);
    if (cam.position.y < -1) why.push(`camera under the floor y=${cam.position.y.toFixed(1)}`);
    const inLimits = why.length === 0;
    // The front glass projected on the screen.
    const pts = [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sy]) => new V(sx * TANK.w / 2, sy * TANK.h, TANK.d / 2).project(cam));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.max(-1, Math.min(...xs)), x1 = Math.min(1, Math.max(...xs)), y0 = Math.max(-1, Math.min(...ys)), y1 = Math.min(1, Math.max(...ys));
    const centre = new V(0, TANK.h * 0.4, 0).project(cam);
    const fill = +((Math.max(...xs) - Math.min(...xs)) / 2).toFixed(2);
    const inView = Math.abs(centre.x) < 1 && Math.abs(centre.y) < 1 && centre.z < 1 && (x1 - x0) > 0.2 && (y1 - y0) > 0.2;
    if (!inView) why.push(`tank off screen: centre ${centre.x.toFixed(2)},${centre.y.toFixed(2)} visible span ${(x1 - x0).toFixed(2)}x${(y1 - y0).toFixed(2)}`);
    return { inLimits, inView, fill, dist: +dist.toFixed(1), cam: cam.position.toArray().map((v) => +v.toFixed(1)), why };
  })();
}
