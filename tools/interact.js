// Used by `node tools/test.cjs --script=tools/interact.js`: drives the
// world and UI like a player would and reports what happened.
(() => {
  const w = window.paludarium, ui = window.paludariumUI, H = w.water.hydro;
  const V = w.terrain.mesh.position.constructor;
  const out = [];
  const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  const run = (sec) => { for (let k = 0; k < sec * 30; k++) H.step(1 / 30); w.water.syncLevel(); };
  const f = w.terrain.field;

  // Sculpt a hill on dry land and dig a pool into it.
  const dry = w.randomSpot((x, y, z, s) => s === -Infinity && y > w.water.level + 3 && Math.abs(x) < 34 && z > -8 && z < 14 && w.terrain.normalAt(x, z).y > 0.85 && !f.stamped[H.cellOf(x, z)] && Math.abs(w.terrain.baseAt(x, z) - y) < 0.2, 2000) ?? { x: -30, z: 6 };
  const [hx, hz] = [dry.x, dry.z];
  w.pushUndo();
  for (let k = 0; k < 16; k++) f.brush(hx, hz, 8, 'raise', 1);
  w.groundChanged();
  const hill = w.terrain.heightAt(hx, hz);
  ok('sculpt raise', hill > w.water.level + 6, `hill=${hill.toFixed(1)}`);
  const b0 = w.terrain.baseAt(hx, hz);
  w.terrain.digBasin(hx, hz, 4, 2.5);
  const b1 = w.terrain.baseAt(hx, hz);
  w.groundChanged();
  out.push(`INFO basin base ${b0.toFixed(2)} -> ${b1.toFixed(2)} -> h ${w.terrain.heightAt(hx, hz).toFixed(2)} at ${hx.toFixed(1)},${hz.toFixed(1)}`);
  const fill = w.water.fillAt(hx, hz);
  H.findPools();
  const pit = H.trace(hx, hz, { maxPits: 1 }).pits[0];
  ok('dig a pool and fill it', !fill.error && H.poolAt(hx, hz), (fill.error ?? `${fill.litres.toFixed(3)} L`) + ` pit ${pit?.cells.length} cells level ${pit?.level.toFixed(1)} bottom ${pit?.bottom.toFixed(1)} h=${w.terrain.heightAt(hx, hz).toFixed(1)}`);
  // Undo takes the ground back.
  w.undo();
  ok('undo', Math.abs(w.terrain.heightAt(hx, hz) - dry.y) < 0.3, `${dry.y.toFixed(1)} → ${hill.toFixed(1)} → ${w.terrain.heightAt(hx, hz).toFixed(1)}`);

  // A channel always runs downhill from its first point.
  const a = w.randomSpot((x, y, z, s) => s === -Infinity && y > w.water.level + 4 && Math.abs(x) < 30 && z < -4, 2000);
  if (a) {
    const pts = [new V(a.x, 0, a.z), new V(a.x + 4, 0, a.z + 5), new V(a.x + 2, 0, a.z + 10)];
    w.terrain.carveChannel(pts, 1.5, 1);
    w.groundChanged();
    const hs = pts.map((p) => w.terrain.baseAt(p.x, p.z));
    ok('channel bed runs downhill', hs[0] > hs[1] && hs[1] > hs[2], hs.map((v) => v.toFixed(1)).join(' → '));
  } else ok('channel bed runs downhill', false, 'no spot');

  // Water is conserved while the pump runs it around.
  const t0 = H.total();
  run(8);
  const t1 = H.total();
  ok('water is conserved', Math.abs(t1 - t0) / t0 < 0.01 && H.pump.running, `${(t0 / 1000).toFixed(3)} L → ${(t1 / 1000).toFixed(3)} L, pump ${H.pump.running}`);
  ok('pools and falls form', H.pools.length >= 2 && w.water.falls.length >= 2, `pools ${H.pools.length}, falls ${w.water.falls.length}`);
  // A new outlet on the background makes a spring down the wall.
  const nOut = H.outlets.length;
  w.water.addOutlet(new V(-40, 40, w.wall.zAt(-40, 40) + 0.6), true);
  run(2);
  w.water.syncFalls(true);
  ok('wall outlet', H.outlets.length === nOut + 1 && w.water.falls.some((r) => r.pts[0].y > 38), `falls ${w.water.falls.length}`);
  w.water.removeOutlet(H.outlets[H.outlets.length - 1]);
  // Lower the main pool below the pump: it runs dry and the falls stop.
  const L0 = w.water.level;
  w.setWaterLevel(1.5);
  run(1);
  ok('pump runs dry when the pool is low', !H.pump.running);
  w.setWaterLevel(L0);

  // Moss: painted moss tufts, then moss spreading in damp air.
  for (let k = 0; k < 30; k++) w.wall.field.brush(10, 30, 6, 'paint', 1, { mat: 4 });
  w.groundChanged();
  ok('moss tufts scattered', w.decor.tufts.count > 50, `tufts=${w.decor.tufts.count}`);
  const m0 = (() => { w.updateMoss(); return w.mossFraction(); })();
  w.env.humidity = 95;
  for (let k = 0; k < 10; k++) w.sim.eco.growMoss(24, 1);
  w.updateMoss();
  ok('moss spreads in damp air', w.mossFraction() > m0 * 1.02, `${(m0 * 100).toFixed(1)}% → ${(w.mossFraction() * 100).toFixed(1)}%`);

  // Placement rules.
  const land = w.randomSpot((x, y, z, s) => s === -Infinity && y > w.water.level + 2);
  const deep = w.randomSpot((x, y, z, s) => w.water.inMainPool(x, z) && s - y > 6);
  ok('fish rejected on land', !!w.animals.placement('neon', { point: land }).error);
  ok('fish ok in water', !!w.animals.placement('neon', { point: deep }).pos);
  ok('frog rejected in water', !!w.animals.placement('dartfrog', { point: deep }).error);
  ok('vallisneria rejected on land', !!w.plants.canPlace('vallisneria', { point: land, surface: 'terrain' }, w));
  ok('fern ok on land', !w.plants.canPlace('fern', { point: land, surface: 'terrain' }, w));

  // Frogs: no hops into water; one dropped in the lagoon swims out.
  const fr = w.animals.by.dartfrog[0];
  if (fr) {
    const toWater = w.animals.hopTo(fr, { kind: 'frog', size: 1.4 }, deep.clone());
    ok('dart frog never hops into water', !toWater);
    fr.hop = null;
    fr.pos.set(deep.x, w.water.level - 0.4, deep.z);
    const wetAt = () => w.water.depthAt(fr.pos.x, fr.pos.z) > 0.6;
    let k = 0;
    const trail = [];
    for (; k < 1800 && (wetAt() || fr.hop); k++) {
      w.animals.move(1 / 30);
      if (k % 150 === 0) trail.push(`${fr.pos.toArray().map((v) => v.toFixed(1))}${fr.hop ? 'H' : ''}${fr.swimming ? 'S' : ''}${fr.shore ? '→' + fr.shore.x.toFixed(0) + ',' + fr.shore.z.toFixed(0) : ''}${fr.dead ? 'DEAD' : ''}`);
    }
    out.push('INFO frog trail ' + trail.join(' | '));
    ok('a frog in the water swims to shore', !wetAt(), `after ${(k / 30).toFixed(1)} s at ${fr.pos.toArray().map((v) => v.toFixed(1))}`);
  }

  // UI click path: plant tool near the centre of the screen.
  ui.setTool('plant'); ui.sub.plant = 'fern';
  ui.mouse.set(-0.3, -0.1);
  const before = w.plants.list.length;
  ui.click();
  out.push(`INFO ui plant click: ${w.plants.list.length - before} added (toast: ${document.getElementById('toast').textContent})`);
  ui.setTool('animal'); ui.sub.animal = 'neon'; ui.mouse.set(0.3, -0.3);
  const nb = w.animals.count('neon'); ui.click();
  out.push(`INFO ui fish click: ${w.animals.count('neon') - nb} added (toast: ${document.getElementById('toast').textContent})`);
  ui.setTool('view');

  // Hardscape: stamping, moving, stacking, duplicating.
  const sx = -10, sz = 12;
  const before0 = w.terrain.heightAt(sx, sz);
  const sp = w.decor.addPiece('spire', sx, sz, { size: 20 });
  w.groundChanged();
  const raised = w.terrain.heightAt(sx, sz);
  sp.mesh.position.x += 8;
  w.decor.restamp(sp); w.groundChanged();
  ok('moving a piece moves its stamp', raised > before0 + 5 && Math.abs(w.terrain.heightAt(sx, sz) - before0) < 0.01 && w.terrain.heightAt(sx + 8, sz) > before0 + 4,
    `${before0.toFixed(1)} → ${raised.toFixed(1)}; after move ${w.terrain.heightAt(sx, sz).toFixed(1)} / ${w.terrain.heightAt(sx + 8, sz).toFixed(1)}`);
  const top = w.terrain.heightAt(sx + 8, sz);
  const st = w.decor.addPiece('boulder', sx + 8, sz, { size: 5, y: top - 0.4 });
  w.groundChanged();
  ok('stacking', w.terrain.heightAt(sx + 8, sz) > top + 1, `${top.toFixed(1)} → ${w.terrain.heightAt(sx + 8, sz).toFixed(1)}`);
  const dup = w.decor.duplicate(sp);
  ok('duplicate', w.decor.pieces.includes(dup) && dup.stamp?.idx.length > 0);
  for (const p of [st, dup, sp]) w.decor.removePiece(p);
  w.groundChanged();
  ok('removing restores the ground', Math.abs(w.terrain.heightAt(sx + 8, sz) - w.terrain.baseAt(sx + 8, sz)) < 0.01);

  // Plants spread.
  const fb = w.plants.list.find((p) => p.id === 'frogbit');
  if (fb) {
    fb.grown = 1; fb.health = 1;
    const n0 = w.plants.count('frogbit');
    for (let k = 0; k < 20; k++) w.plants.offshoot(fb, [1, 5, 40], w);
    ok('plants spread', w.plants.count('frogbit') > n0, `${n0} → ${w.plants.count('frogbit')}`);
  }

  // Life cycle: an egg clutch hatches into tadpoles.
  const egg = w.animals.add('eggs', deep, { age: 0 });
  Object.assign(egg, { parent: 'dartfrog', into: 'tadpole', n: 4, hatch: 0.01, where: 'water' });
  const tp0 = w.animals.count('tadpole');
  w.sim.step(30);
  ok('eggs hatch into tadpoles', w.animals.count('tadpole') >= tp0 + 4, `tadpoles ${tp0} → ${w.animals.count('tadpole')}`);

  // Save / load round trip.
  const json = JSON.stringify(w.serialize());
  const counts = [w.plants.list.length, w.animals.all.length, H.outlets.length, w.decor.pieces.length];
  const tot = H.total();
  w.load(JSON.parse(json));
  const counts2 = [w.plants.list.length, w.animals.all.length, w.water.hydro.outlets.length, w.decor.pieces.length];
  ok('save/load round trip', JSON.stringify(counts) === JSON.stringify(counts2) && Math.abs(w.water.hydro.total() - tot) / tot < 0.02,
    `${counts} → ${counts2}, ${(tot / 1000).toFixed(2)} L → ${(w.water.hydro.total() / 1000).toFixed(2)} L, ${Math.round(json.length / 1024)} KB`);

  // Draining strands fish.
  w.setWaterLevel(2);
  w.animals.move(0.1);
  ok('draining strands fish', w.animals.by.neon.some((a) => a.stranded));
  w.setWaterLevel(12);
  w.empty();
  w.sim.eco.updateStage();
  ok('new tank', w.plants.list.length === 0 && w.animals.all.length === 0 && w.sim.eco.stage === 'bare' && w.env.cycle === 0, `stage ${w.sim.eco.stage} water ${w.water.volumeLitres().toFixed(2)} L plants ${w.plants.list.length}`);
  w.starter();
  console.warn('INTERACT\n' + out.join('\n'));
})();
