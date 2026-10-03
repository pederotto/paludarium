// The second care-sheet pass (2026-10) in a real tank: the reed-pool preset (false bottom, reed frogs) stocked with the
// feeders' eaters and the new crew, the new pieces and plants, a canister with a pre-filter, ABG mix and a foam background.
// Feeds every kind of food, runs a simulated day, then floods the false bottom; reports who ate what, where the reed frogs
// sat, the seashore springtails on the water, isopods that fell in, the plenum and the land share, and console errors.
// Then pictures: the front with the soil profile, the filter, a frog perch, the feeders, the plants.
//   node tools/shot.mjs --url=http://localhost:4310/ --only=desktop --steps=tools/steps/caresheet2.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const res = await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const { Care } = await import('/src/app/actions.js');
    const game = window.game;
    const w = await game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'reedpool', seed: 3, tier: 'standard' });
    const A = w.animals, E = w.env, D = w.decor;
    for (const g of ['filterMatten', 'filterCanister', 'uvb', 'basking', 'falseBottom']) w.equipment.owned?.add?.(g);
    E.drainage = 1; E.plenumH = 0; E.filterKind = 'canister'; E.prefilter = true; E.substrate = 'abg'; E.backdrop = 'foam'; E.uvb = 0.5; E.basking = 0.6;
    E.minute = Math.floor(E.minute / 1440) * 1440 + 9 * 60;
    let s = 977;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    // Pieces and plants.
    const pieces = {};
    for (const [type, n] of [['bamboopole', 2], ['floatlog', 1], ['pebbles', 2]]) {
      pieces[type] = 0;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 60; k++) {
          const x = (rnd() - 0.5) * (TANK.w - 14), z = (rnd() - 0.5) * (TANK.d - 14);
          const wet = w.water.surfaceAt(x, z) > w.terrain.heightAt(x, z);
          if (type === 'floatlog' ? !wet : type === 'bamboopole' ? wet : false) continue;
          if (D.addPiece(type, x, z, { vary: true })) { pieces[type]++; break; }
        }
      }
    }
    w.groundChanged?.();
    const plants = {};
    for (const [id, n, wet] of [['fissidens', 3, true], ['rotala', 3, true], ['monstera', 2, false], ['anubias', 2, true], ['javamoss', 2, true]]) {
      plants[id] = 0;
      for (let i = 0; i < n; i++) for (let k = 0; k < 80; k++) {
        const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8), y = w.terrain.heightAt(x, z);
        const isWet = w.water.surfaceAt(x, z) > y + 2;
        if (isWet !== wet) continue;
        const P = w.plants.list[0]?.pos.constructor ?? Object;
        if (w.plants.add(id, new P(x, y, z), { grown: 1, scale: 1 })) { plants[id]++; break; }
      }
    }
    A.syncOccupancy(true);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    const mix = { reedfrog: 4, skink: 1, firesal: 2, toad: 3, marbled: 3, pygmy: 3, cpd: 8, panther: 1, springsea: 25, pandaking: 8, isopod: 10 };
    const placed = {};
    for (const [id, n] of Object.entries(mix)) {
      placed[id] = 0;
      for (let i = 0; i < n; i++) for (let k = 0; k < 200; k++) {
        const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
        const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
        if (r.pos) { A.add(id, r.pos, { hunger: 0.6 }); placed[id]++; break; }
      }
    }
    // Every kind of food.
    const fed = {};
    for (const k of ['flake', 'pellet', 'bloodworm']) fed[k] = Care.feed(game, k);
    for (const k of ['cricket', 'dubia', 'earthworm', 'waxworm']) fed[k] = Care.feeders(game, k);
    const items0 = {};
    for (const f of A.food) items0[f.kind] = (items0[f.kind] ?? 0) + 1;
    const feeders0 = Object.fromEntries(['cricket', 'dubia', 'earthworm', 'waxworm'].map((k) => [k, A.by[k].length]));
    // A simulated day; watch the perches, the springtails, the isopods.
    const perchKinds = {}, seaOnWater = [], sunk = new Set(), eatLog = {};
    const origLog = w.log.bind(w);
    w.log = (t, k) => { if (k === 'eat') { const m = /(took|caught) an? (.*)\./.exec(t); if (m) eatLog[m[2]] = (eatLog[m[2]] ?? 0) + 1; } return origLog(t, k); };
    const orig = A.consume.bind(A);
    const eaten = {};
    A.consume = (a, sp, pid, p) => { const key = `${a.sp}>${pid}`; eaten[key] = (eaten[key] ?? 0) + 1; return orig(a, sp, pid, p); };
    const t0 = performance.now();
    for (let tick = 0; tick < 1440; tick++) {
      w.sim.step(1);
      A.move(0.2);
      if (tick % 15 === 0) {
        for (const a of A.by.reedfrog) if (a.perch?.ph === 'sit') { const k = a.perch.glassN ? 'glass' : a.perch.piece ? a.perch.piece.type : a.perch.plant ? 'plant:' + a.perch.plant.id : '?'; perchKinds[k] = (perchKinds[k] ?? 0) + 1; }
        let on = 0;
        for (const a of A.by.springsea) if (w.water.surfaceAt(a.pos.x, a.pos.z) > w.terrain.heightAt(a.pos.x, a.pos.z) + 0.3) on++;
        seaOnWater.push(A.by.springsea.length ? +(on / A.by.springsea.length).toFixed(2) : 0);
        for (const a of A.by.pandaking) if (a.sunk) sunk.add(a.id);
      }
    }
    const ms = Math.round(performance.now() - t0);
    A.consume = orig; w.log = origLog;
    const items1 = {};
    for (const f of A.food) items1[f.kind] = (items1[f.kind] ?? 0) + 1;
    const per = {};
    for (const id of Object.keys(mix)) { const arr = A.by[id]; per[id] = { placed: placed[id], alive: arr.length, health: arr.length ? +(arr.reduce((t, a) => t + a.health, 0) / arr.length).toFixed(2) : null, hunger: arr.length ? +(arr.reduce((t, a) => t + a.hunger, 0) / arr.length).toFixed(2) : null, why: [...new Set(arr.flatMap((a) => a.why ?? []))].slice(0, 4) }; }
    const before = { plenum: E.plenum ? { ...E.plenum } : null, plenumH: E.plenumH, level: w.water.level, soil: +E.soil.toFixed(2), film: +(E.film ?? 0).toFixed(3), land: +w.landShare().toFixed(2), uvb: A.by.skink.map((a) => +(a.uvAvg ?? 0).toFixed(2)), bask: A.by.skink.map((a) => +(a.baskAvg ?? 0).toFixed(2)) };
    // Flood the false bottom: water 2 cm over its mesh for a few hours.
    w.setWaterLevel(E.plenumH + 2);
    for (let tick = 0; tick < 240; tick++) { w.sim.step(1); A.move(0.2); }
    const soilLand = (() => { let n = 0, wet = 0; const C = w.climate; for (let i = 0; i < 30; i++) { const x = ((i + 0.5) / 30 - 0.5) * TANK.w, z = -TANK.d / 4; if (w.water.surfaceAt(x, z) > w.terrain.heightAt(x, z)) continue; n++; if (C.soilAt(x, z) > 0.9) wet++; } return n ? +(wet / n).toFixed(2) : null; })();
    const flooded = { plenum: E.plenum, drainEff: E.drainEff, soilLandWet: soilLand, plantsWaterlogged: w.plants.list.filter((p) => (p.why ?? []).some((x) => /waterlogged/.test(x))).length };
    w.setWaterLevel(E.plenumH - 1);
    for (let tick = 0; tick < 30; tick++) { w.sim.step(1); A.move(0.2); }
    game.setSpeed(0);
    return { pieces, plants, placed, fed, items0, items1, feeders0, feeders1: Object.fromEntries(['cricket', 'dubia', 'earthworm', 'waxworm'].map((k) => [k, A.by[k].length])), eaten, perchKinds, seaOnWater: seaOnWater.filter((_, i) => i % 12 === 0), sunk: sunk.size, per, before, flooded, after: E.plenum, msDay: ms, foodMeshes: Object.fromEntries(Object.entries(A.foodMeshes).map(([k, m]) => [k, m.count])) };
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 10) : 'none');
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.evaluate(() => { window.__cam = (p) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, false); }; });
  const look = async (label, fn, arg = {}) => { const ok = await page.evaluate(fn, arg); await page.waitForTimeout(1500); if (ok !== false) await shot(label); };
  await look('cs2-front', () => window.__cam([0, 24, 100, 0, 9, 0]));
  await look('cs2-profile', () => window.__cam([-22, 7, 40, -22, 5, 20]));
  await look('cs2-filter', () => { const m = window.game.world.plumbing.mesh.geometry.attributes.position; if (!m) return false; let x = 0, y = 0, z = 0, k = 0; for (let i = 0; i < m.count; i += 50) { x += m.getX(i); y += m.getY(i); z += m.getZ(i); k++; } window.__cam([x / k + 10, y / k + 12, z / k + 30, x / k, y / k, z / k]); });
  await look('cs2-perch', () => { const a = window.game.world.animals.by.reedfrog.find((b) => b.perch?.ph === 'sit') ?? window.game.world.animals.by.reedfrog[0]; if (!a) return false; const p = a.pos; window.__cam([p.x + 3, p.y + 3, p.z + 11, p.x, p.y, p.z]); });
  await look('cs2-feeders', () => { const A = window.game.world.animals; const a = A.by.cricket[0] ?? A.by.dubia[0] ?? A.by.earthworm[0] ?? A.by.waxworm[0]; if (!a) return false; const p = a.pos; window.__cam([p.x + 2, p.y + 4, p.z + 7, p.x, p.y, p.z]); });
  for (const id of ['monstera', 'rotala', 'fissidens', 'anubias']) {
    await look('cs2-plant-' + id, (id) => { const p = window.game.world.plants.list.find((q) => q.id === id); if (!p) return false; const s = id === 'fissidens' ? 6 : id === 'anubias' ? 9 : 16; window.__cam([p.pos.x + s * 0.3, p.pos.y + s * 0.6, p.pos.z + s, p.pos.x, p.pos.y + s * 0.25, p.pos.z]); }, id);
  }
  for (const type of ['bamboopole', 'floatlog', 'pebbles']) {
    await look('cs2-piece-' + type, (type) => { const pc = window.game.world.decor.pieces.find((q) => q.type === type); if (!pc) return false; const p = pc.mesh.position; window.__cam([p.x + 8, p.y + 14, p.z + 26, p.x, p.y + 4, p.z]); }, type);
  }
};
