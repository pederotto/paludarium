// What a walking body can stand on, layer by layer (src/sim/surfaces.js): pure numbers, no scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceMap, layersOf, CLIMB, MAX_LAYERS, limitRise } from '../src/sim/surfaces.js';

const H = 60;

test('open ground has one layer, with the whole tank above it', () => {
  const L = layersOf(3, [], H);
  assert.equal(L.length, 1);
  assert.deepEqual(L[0], { y: 3, clr: 57, n: [0, 1, 0], piece: false });
});

test('a log on the ground adds a layer at its top; the ground under it has no room', () => {
  // a log from the ground (cm 3) up to 7.5, voxels thickened a little below it
  const L = layersOf(3, [[1.5, 9]], H, () => ({ y: 7.4, n: [0, 0.98, 0.2] }));
  assert.equal(L.length, 2);
  assert.equal(L[0].clr, 0, 'a piece that reaches the ground: the ground under it is not standable');
  assert.equal(L[1].y, 7.4);
  assert.ok(L[1].piece && L[1].clr > 50);
  assert.deepEqual(L[1].n, [0, 0.98, 0.2]);
});

test('a bridge: the ground under it has room, its top is a second layer', () => {
  const L = layersOf(0, [[6, 9]], H, () => ({ y: 8.6, n: [0, 1, 0] }));
  assert.equal(L[0].clr, 6);
  assert.equal(L[1].y, 8.6);
});

test('a run wholly in the ground is not a layer', () => {
  const L = layersOf(5, [[0, 3]], H);
  assert.equal(L.length, 1);
});

test('stand: a body steps up onto a log it can climb and is stopped by one it cannot', () => {
  const m = new SurfaceMap(-22.5, -22.5, 1.5, 30, 30);
  m.set(15, 15, layersOf(3, [[1.5, 9]], H, () => ({ y: 7.4, n: [0, 1, 0] })));     // a log 4.4 cm above the ground
  m.set(16, 15, layersOf(3, [[1.5, 20]], H, () => ({ y: 19.5, n: [0, 1, 0] })));   // a post 16.5 cm above it
  m.set(14, 15, layersOf(3, [], H));
  const x = (i) => -22.5 + (i + 0.5) * 1.5, z = -22.5 + 15.5 * 1.5;
  const skink = CLIMB.skink;
  const onLog = m.stand(x(15), z, 3, skink.up, skink.down, 1.2);
  assert.ok(onLog && onLog.piece && Math.abs(onLog.y - 7.4) < 1e-5, 'onto the log');
  assert.equal(m.stand(x(16), z, 3, skink.up, skink.down, 1.2), null, 'the post is a wall');
  assert.equal(m.stand(x(15), z, 3, CLIMB.axolotl.up, CLIMB.axolotl.down, 1.2), null, 'a log too high for an axolotl is a wall too');
  const flat = m.stand(x(14), z, 3, skink.up, skink.down, 1.2);
  assert.ok(flat && !flat.piece && flat.y === 3);
});

test('stand: from on top of the log it steps down to the ground, and keeps to the layer it is on', () => {
  const m = new SurfaceMap(0, 0, 1.5, 4, 4);
  m.set(1, 1, layersOf(3, [[1.5, 9]], H, () => ({ y: 7.4 })));
  m.set(2, 1, layersOf(3, [], H));
  const a = m.stand(1.7, 1.7, 7.4, 4.5, 9, 1.2);
  assert.ok(a.piece && Math.abs(a.y - 7.4) < 1e-5, 'on the log it stays on the log');
  const b = m.stand(3.2, 1.7, 7.4, 4.5, 9, 1.2);
  assert.ok(!b.piece && b.y === 3, 'off the end of it, down to the ground');
});

test('stand: too little room above a layer, and outside the grid, is no standing place', () => {
  const m = new SurfaceMap(0, 0, 1.5, 3, 3);
  m.set(1, 1, layersOf(0, [[1, 9]], 60, () => ({ y: 8.6 })).map((l) => ({ ...l, clr: 0.8 })));
  assert.equal(m.stand(2.2, 2.2, 0, 4.5, 9, 1.2), null);
  assert.equal(m.stand(-5, 0, 0, 4.5, 9, 1), null);
  assert.equal(m.stand(2.2, 2.2, 0, 4.5, 9, 0.5) !== null, true, 'room for a thinner body');
});

test('only MAX_LAYERS layers a cell are kept', () => {
  const m = new SurfaceMap(0, 0, 1.5, 2, 2);
  m.set(0, 0, Array.from({ length: 7 }, (_, l) => ({ y: l * 3, clr: 2.5, piece: l > 0 })));
  assert.equal(m.n[0], MAX_LAYERS);
});

test('climbable is true only for a piece layer a body can step onto', () => {
  const m = new SurfaceMap(0, 0, 1.5, 3, 3);
  m.set(1, 1, layersOf(2, [[1, 6]], H, () => ({ y: 5.8 })));
  m.set(2, 1, layersOf(2, [], H));
  assert.equal(m.climbable(2.2, 2.2, 2, 4.5, 9, 1.2), true);
  assert.equal(m.climbable(3.7, 2.2, 2, 4.5, 9, 1.2), false, 'plain ground is not a piece');
});

test('a walker climbs a 5 cm cliff over its travel: no step above 1.2 cm, and it arrives on top', () => {
  const m = new SurfaceMap(0, 0, 1.5, 20, 4), room = 2.3, c = CLIMB.gecko;
  for (let k = 0; k < 4; k++) for (let i = 0; i < 20; i++) m.set(i, k, i < 10 ? layersOf(3, [], H) : layersOf(3, [[1.5, 9]], H, () => ({ y: 8.3, n: [0, 1, 0] })));
  let x = 5, y = 3, ly = 3, worst = 0;
  const hs = {};
  for (let step = 0; step < 50; step++) {
    const nx = x + 0.4, h = m.heightAt(nx, 3, ly, c.up, c.down, room, hs);
    const ny = limitRise(y, h.y, 0.4);
    worst = Math.max(worst, Math.abs(ny - y)); x = nx; y = ny; ly = hs.ly;
  }
  assert.ok(worst <= 1.2, `largest step ${worst}`);
  assert.ok(Math.abs(y - 8.3) < 0.01, `ends at ${y}`);
});

// R5b: outOfBank no longer pushes a surface walker back at a rock's lip or at the foot of what it can climb
import { notABank } from '../src/sim/surfaces.js';
test('notABank: a drop below the body is not a bank; a climbable rise ahead is not; a wall too high is; frogs unchanged', () => {
  assert.equal(notABank('gecko', 3.0, 5.91, true), true);         // snout over the lip of a boulder (R5b probe numbers)
  assert.equal(notABank('gecko', 3.0, 5.91, false), true);        // tail over a drop
  assert.equal(notABank('gecko', 6.5, 3.0, true), true);          // 3.5 cm rise ahead, gecko up = 8
  assert.equal(notABank('gecko', 12, 3.0, true), false);          // 9 cm wall: a bank
  assert.equal(notABank('gecko', 6.5, 3.0, false), false);        // the tail end in a rise behind stays a bank
  assert.equal(notABank('toad', 3.0, 5.91, true), false);         // frogs are not surface walkers
});
