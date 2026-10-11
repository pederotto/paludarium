// R8: the spatial contract. One predicate (Occupancy.canOccupy, on the 2.5D layer map) for the movers' step test, the goals the minds
// commit and insideSolid's gate; the goal protocol (sim/goals.js: animal.abortGoal, each mind's own abort); inGlass moves X and Z only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three/webgpu';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Occupancy, CELL, clearNeed, bellyOf } from '../src/sim/occupancy.js';
import { abortGoal, banned, CLOCK, BAN_R, validGoal } from '../src/sim/goals.js';
import { shrimpMind } from '../src/sim/shrimp.js';
import { fishMind } from '../src/sim/fishmind.js';
import { skinkMind } from '../src/sim/skink.js';
import { crabMind } from '../src/sim/crab.js';
import { herpMindFor } from '../src/sim/herp.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// A 6 x 2 x 6 cm slab whose underside is `gap` cm over flat ground at y = 2: a low ledge.
function ledge(gap) {
  const g = new THREE.BoxGeometry(6, 2, 6);
  g.computeBoundsTree();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.position.set(0, 2 + gap + 1, 0);
  const occ = new Occupancy();
  occ.rebuild({ occupancyVersion: 1, pieces: [{ type: 'root', mesh }] }, {});
  occ.bakeSurfaces(() => 2);
  return occ;
}

test('the ground under a ledge has room for a flat crawler and none for a tall snail', () => {
  const occ = ledge(3);
  const flat = { bh: 0.4, rad: 0.3 }, snail = { bh: 3.2, rad: 0.8 };
  assert.equal(occ.layerAt(0, 0, 2), 0);
  assert.ok(occ.canOccupy(0, 0, 0, flat, 2));
  assert.equal(occ.canOccupy(0, 0, 0, snail, 2), false);
  assert.ok(occ.canOccupy(20, 0, 0, snail, 2), 'open ground');
});

test('on top of the piece is a layer of its own, with the room above it', () => {
  const occ = ledge(3);
  const top = occ.layerAt(0, 0, 7.1);
  assert.equal(top, 1);
  assert.ok(occ.canOccupy(0, 0, top, { bh: 3, rad: 0.5 }));
  assert.equal(occ.canOccupy(0, 0, 5, { bh: 1 }), false, 'a layer the cell has not');
});

test('a piece top is no floor where something taller stands in the same cell', () => {
  const occ = ledge(3);                    // slab top at 7 cm over the middle
  const t = occ.layerAt(0, 0, 7.1);
  assert.ok(occ.runTop(0, 0, 7) - 7 <= 3 * CELL);
  assert.ok(occ.canOccupy(0, 0, t, { bh: 1 }));
  // a 10 cm post standing in the slab's middle cell: that cell's baked top is unchanged, but its voxels run 10 cm higher
  const i = occ.cellX(0), k = occ.cellZ(0);
  for (let j = occ.cellY(7); j < occ.cellY(17); j++) occ.mark(i, j, k);
  assert.equal(occ.canOccupy(0, 0, t, { bh: 1 }), false);
});

test('the real top under a body, and inside = the nearest face seen from behind', () => {
  const occ = ledge(3);                    // slab 6 x 2 x 6 cm, top at 7
  assert.ok(Math.abs(occ.topBelow(0.4, -0.3, 9) - 7) < 1e-6);
  assert.equal(occ.topBelow(0.4, -0.3, 6.5) < 7, true, 'a top above the height asked is not under it');
  assert.equal(occ.topBelow(20, 0, 9), -Infinity);
  assert.ok(occ.inside(0.3, 6, 0.2));
  assert.equal(occ.inside(0.3, 7.6, 0.2), false, 'on top, in the thickened cell: outside');
  assert.equal(occ.inside(0.3, 4.6, 0.2), false, 'under it, in the thickened cell: outside');
  assert.equal(occ.inside(0.3, 6, 0.2, occ.shells[0].piece), false, 'the piece skipped');
});

test('a clinging body: room along the contact normal, its own perch skipped', () => {
  const occ = ledge(3);                    // slab x -3..3, y 5..7
  const frog = { bh: 2.8 }, piece = occ.shells[0].piece;
  // on the slab's side (x = 3), facing +x: the body stands out into free air
  assert.ok(occ.roomAlong(3.05, 6, 0, { x: 1, y: 0, z: 0 }, frog, piece));
  // facing back into the slab (a wrong normal): inside it, unless that is the perch it clings to
  assert.equal(occ.roomAlong(3.05, 6, 0, { x: -1, y: 0, z: 0 }, frog), false);
  assert.ok(occ.roomAlong(3.05, 6, 0, { x: -1, y: 0, z: 0 }, frog, piece));
  // under the slab, facing down from the ground: free
  assert.ok(occ.roomAlong(0, 2.05, 0, { x: 0, y: 1, z: 0 }, { bh: 1 }, null));
});

test('a wide body needs the room at its radius too (beyond the shells\' one-cell margin)', () => {
  const occ = ledge(0.2);                   // a slab lying almost on the ground: its cells are a wall
  const x = 3 + 4;                          // 4 cm off the slab's side
  assert.ok(occ.canOccupy(x, 0, 0, { bh: 0.5, rad: 0.4 }, 2));
  assert.equal(occ.canOccupy(x, 0, 0, { bh: 0.5, rad: CELL + 4.2 }, 2), false);
});

test('the invariant: wherever canOccupy lets a ground body stand, none of the cells its body fills is solid', () => {
  // (insideSolid's gate is canOccupy itself; this checks the predicate against the voxels it was baked from, at random bodies and spots)
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const gap of [0.4, 1.1, 2.0, 3.3]) {
    const occ = ledge(gap);
    let allowed = 0;
    for (let n = 0; n < 400; n++) {
      const x = (rnd() - 0.5) * 14, z = (rnd() - 0.5) * 14, b = { bh: 0.1 + rnd() * 3.5, rad: 0 };
      if (!occ.canOccupy(x, z, occ.layerAt(x, z, 2), b, 2)) continue;
      allowed++;
      for (let y = 2 + bellyOf(b); y <= 2 + clearNeed(b); y += 0.05) assert.equal(occ.solidAt(x, y, z), false, `gap ${gap} body ${b.bh.toFixed(2)} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
    }
    assert.ok(allowed > 50);
  }
});

test('abortGoal: the animal drops its target, its mind its own goal, and a cooldown bans the spot it failed at', () => {
  for (const m of [shrimpMind(), fishMind({ speed: 3 }), skinkMind(), crabMind(), herpMindFor('newt', Math.random, 'newt')]) {
    m.goal = { x: 5, z: 5 };
    const a = { pos: { x: 1, z: 2 }, target: { x: 5, z: 5 }, mind: m, abortGoal };
    CLOCK.t = 100;
    a.abortGoal('relocated', 20000);
    assert.equal(m.goal, null);
    assert.equal(a.target, null);
    assert.ok(banned(a, 1 + BAN_R * 0.9, 2));
    assert.equal(banned(a, 1 + BAN_R * 1.1, 2), false);
    CLOCK.t = 120.1;
    assert.equal(banned(a, 1, 2), false, 'the ban runs out');
  }
  { // a goal it could not get to is banned where it was, not where the animal stands
    const m = crabMind(); m.goal = { x: 9, z: 9 }; m.burst = 2;
    const a = { pos: { x: 0, z: 0 }, target: null, mind: m, abortGoal };
    CLOCK.t = 200;
    a.abortGoal('no way out', 25000, { x: 9, z: 9 });
    assert.equal(m.goal, null); assert.equal(m.burst, 0);
    assert.ok(banned(a, 9.5, 9)); assert.equal(banned(a, 0, 0), false);
  }
  const plain = { pos: { x: 0, z: 0 }, target: { x: 1, z: 1 }, abortGoal };   // a crawler with no mind
  plain.abortGoal('blocked');
  assert.equal(plain.target, null);
  assert.equal(validGoal({ valid: (x) => x > 0 }, -1, 0), false);
  assert.equal(validGoal({}, -1, 0), true);
});

test('animals.js: one predicate, the protocol, and the boundary invariant', () => {
  const src = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
  const body = (name) => { const i = src.indexOf(`\n  ${name}(`); return src.slice(i, src.indexOf('\n  }\n', i)); };
  assert.match(body('insideSolid'), /this\.occ\.canOccupy\(x, z, this\.layerUnder\(a\), a, a\.pos\.y\)/);
  assert.match(body('insideSolid'), /a\.perch && a\.perch\.ph !== 'go'\) return !!a\.normal && this\.perchInside\(a\)/);
  assert.match(body('perchInside'), /!this\.occ\.roomAlong\(/);
  assert.match(body('perchRoute'), /this\.occ\.roomAlong\(q\.x, q\.y, q\.z, q\.n \?\? UP, a, c\.piece \?\? null\)/);
  for (const f of ['nudge', 'outOfStems']) assert.match(body(f), /canStep|okFor\([^)]*, 0, a\)/, `${f} steps by the contract`);
  assert.match(body('canStep'), /this\.occ\.canOccupy\(x, z, this\.stepLayer\(a, x, z\), a, g\)/);
  assert.match(body('okFor'), /this\.canStep\(body, x, z\)/);
  const rel = body('relocate');
  assert.match(rel, /a\.abortGoal\('relocated', RELOCATE_BAN_MS\)/);
  for (const f of ['a.sm', 'a.fm', 'a.sk', 'a.cb', 'a.hm', 'a.hh']) assert.equal(rel.includes(f), false, `relocate does not reach into ${f}`);
  // the engine never drops a mind's goal itself: it asks the animal (abortGoal), and the mind clears its own fields
  assert.equal(/\bm\.goal = null/.test(src), false, 'no m.goal = null in animals.js');
  assert.equal(/\bm\.coll\b/.test(src), false, 'the pocket count is on the animal');
  const glass = body('inGlass');
  assert.equal(/pos\.y\s*[+\-]?=/.test(glass), false, 'inGlass never writes the height');
  assert.equal(glass.includes('standOn'), false);
});
