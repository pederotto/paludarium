// Used by `node tools/test.cjs --script=tools/interact.js`: drives the
// world and UI like a player would and reports what happened.
(() => {
  const w = window.paludarium, ui = window.paludariumUI;
  const THREE_V = w.terrain.mesh.position.constructor;
  const out = [];
  const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  // Sculpt: raise a hill on the right and dig a hollow in it.
  const f = w.terrain.field;
  // A flat-ish dry spot away from the walls.
  const dry = w.randomSpot((x, y, z, s) => s === -Infinity && y > w.water.level + 3 && Math.abs(x) < 36 && Math.abs(z) < 14 && w.terrain.normalAt(x, z).y > 0.9) ?? { x: -30, z: 0 };
  const [hx, hz] = [dry.x, dry.z];
  for (let k = 0; k < 40; k++) f.brush(hx, hz, 8, 'raise', 1);
  const hill = w.terrain.heightAt(hx, hz);
  for (let k = 0; k < 20; k++) f.brush(hx, hz, 3.5, 'lower', 0.6);
  w.groundChanged();
  ok('sculpt raise/lower', hill > w.water.level + 5, `hill=${hill.toFixed(1)} hollow=${w.terrain.heightAt(hx, hz).toFixed(1)}`);
  const pond = w.water.addPond(hx, hz);
  ok('pond in dug hollow', !!pond.pond, pond.error ?? `level=${pond.pond?.level.toFixed(1)} cells=${pond.pond?.cells.size}`);
  const fall = w.water.addFall(new THREE_V(0, 35, w.wall.zAt(0, 35) + 0.6), w.wall);
  ok('waterfall from wall', !!fall.fall, fall.error ?? `points=${fall.fall?.pts.length}`);
  // Paint moss on the wall.
  for (let k = 0; k < 30; k++) w.wall.field.brush(10, 30, 6, 'paint', 1, { mat: 4 });
  w.groundChanged();
  ok('moss tufts scattered', w.decor.tufts.count > 50, `tufts=${w.decor.tufts.count}`);
  // Placement rules.
  const land = w.randomSpot((x, y, z, s) => s === -Infinity && y > w.water.level + 2);
  const deep = w.randomSpot((x, y, z, s) => s - y > 6);
  ok('fish rejected on land', !!w.animals.placement('neon', { point: land }).error);
  ok('fish ok in water', !!w.animals.placement('neon', { point: deep }).pos);
  ok('frog rejected in water', !!w.animals.placement('dartfrog', { point: deep }).error);
  ok('vallisneria rejected on land', !!w.plants.canPlace('vallisneria', { point: land, surface: 'terrain' }, w));
  ok('fern ok on land', !w.plants.canPlace('fern', { point: land, surface: 'terrain' }, w));
  // UI click path: plant tool on the centre of the screen.
  ui.setTool('plant'); ui.sub.plant = 'fern';
  ui.mouse.set(-0.3, -0.1);
  const before = w.plants.list.length;
  ui.click();
  out.push(`INFO ui plant click: ${w.plants.list.length - before} added (toast: ${document.getElementById('toast').textContent})`);
  ui.setTool('animal'); ui.sub.animal = 'neon'; ui.mouse.set(0.3, -0.3);
  const nb = w.animals.count('neon'); ui.click();
  out.push(`INFO ui fish click: ${w.animals.count('neon') - nb} added (toast: ${document.getElementById('toast').textContent})`);
  ui.setTool('view');
  // Hardscape: a spire raises the ground under it; removing it restores it.
  const before0 = w.terrain.heightAt(-10, 12);
  const sp = w.decor.addPiece('spire', -10, 12, { size: 20 });
  w.groundChanged();
  const raised = w.terrain.heightAt(-10, 12);
  w.decor.removePiece(sp); w.groundChanged();
  ok('spire stamps and unstamps', raised > before0 + 5 && Math.abs(w.terrain.heightAt(-10, 12) - before0) < 0.01, `${before0.toFixed(1)} → ${raised.toFixed(1)} → ${w.terrain.heightAt(-10, 12).toFixed(1)}`);
  // Life cycle: an egg clutch hatches into tadpoles.
  const eggSpot = w.randomSpot((x, y, z, s) => s - y > 2);
  const egg = w.animals.add('eggs', eggSpot, { age: 0 });
  Object.assign(egg, { parent: 'dartfrog', into: 'tadpole', n: 4, hatch: 0.01, where: 'water' });
  const t0 = w.animals.count('tadpole');
  w.sim.step(30);
  ok('eggs hatch into tadpoles', w.animals.count('tadpole') >= t0 + 4, `tadpoles ${t0} → ${w.animals.count('tadpole')}`);
  // Save / load round trip.
  const json = JSON.stringify(w.serialize());
  const counts = [w.plants.list.length, w.animals.all.length, w.water.ponds.length, w.water.falls.length, w.decor.pieces.length];
  w.load(JSON.parse(json));
  const counts2 = [w.plants.list.length, w.animals.all.length, w.water.ponds.length, w.water.falls.length, w.decor.pieces.length];
  ok('save/load round trip', JSON.stringify(counts) === JSON.stringify(counts2), `${counts} → ${counts2}, ${Math.round(json.length / 1024)} KB`);
  // Water level down: fish should strand when drained.
  w.setWaterLevel(2);
  w.animals.move(0.1);
  ok('draining strands fish', w.animals.by.neon.some((a) => a.stranded));
  w.setWaterLevel(12);
  w.empty();
  ok('empty tank', w.plants.list.length === 0 && w.animals.all.length === 0);
  w.starter();
  console.warn('INTERACT\n' + out.join('\n'));
})();
