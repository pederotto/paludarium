// B4b: the swept move test `Occupancy.segmentFree(a, from, to)`. A move between two free points never crosses a solid cell, a
// free move is never refused, a move along a wall is not refused, and moves too short to cross a cell are skipped.
//   node --test tests/segment.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Occupancy, CELL } from '../src/sim/occupancy.js';
import { TANK } from '../src/sim/tank.js';

// One wall, a single cell thick (the thinnest solid the grid can hold), across the whole tank at cell column I.
const I = 10, FACE = I * CELL - TANK.w / 2;          // its left face; the right face is FACE + CELL
function wall() {
  const o = new Occupancy();
  for (let k = 0; k < o.nz; k++) for (let j = 0; j < o.ny; j++) o.data[o.idx(I, j, k)] = 1;
  o.count = o.ny * o.nz;
  return o;
}
let seed = 7;
const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const Y = () => 5 + r() * (TANK.h - 12), Z = () => -TANK.d / 2 + 5 + r() * (TANK.d - 10);   // (moves stay inside the grid: outside it is free)
const at = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });

test('a thin solid is never crossed, at any length and angle, either way', () => {
  const o = wall();
  for (let n = 0; n < 2000; n++) {
    const from = { x: FACE - 0.02 - r() * 4, y: Y(), z: Z() };
    const to = { x: FACE + CELL + 0.02 + r() * 4, y: from.y + (r() - 0.5) * 6, z: from.z + (r() - 0.5) * 6 };
    for (const [p, q] of [[from, to], [to, from]]) {
      assert.ok(!o.solidAt(p.x, p.y, p.z) && !o.solidAt(q.x, q.y, q.z));
      const t = o.segmentFree(null, p, q);
      assert.ok(t < 1, `crossed: ${JSON.stringify([p, q])}`);
      const s = at(p, q, t);
      assert.ok(t >= 0 && !o.solidAt(s.x, s.y, s.z), `stops inside: t=${t}`);
    }
  }
});

test('a free move is never refused', () => {
  const o = wall();
  for (let n = 0; n < 2000; n++) {
    const from = { x: FACE - 0.02 - r() * 8, y: Y(), z: Z() };
    const to = { x: Math.min(FACE - 0.02, from.x + (r() - 0.5) * 12), y: from.y + (r() - 0.5) * 8, z: from.z + (r() - 0.5) * 8 };
    assert.equal(o.segmentFree(null, from, to), 1);
  }
  assert.equal(new Occupancy().segmentFree(null, { x: -20, y: 5, z: 0 }, { x: 20, y: 5, z: 0 }), 1);      // empty grid
});

test('a move along a wall is not refused (beside it, or inside it on the way out)', () => {
  const o = wall();
  for (const off of [0.01, 0.3, 1]) {
    const from = { x: FACE - off, y: 6, z: -8 };
    assert.equal(o.segmentFree(null, from, { x: FACE - off, y: 6, z: 8 }), 1);             // along z
    assert.equal(o.segmentFree(null, from, { x: FACE - off, y: 14, z: 2 }), 1);            // up and along
  }
  // standing inside the wall (keepFree's business): leaving it is never refused, nor sliding along inside it
  const inside = { x: FACE + CELL / 2, y: 6, z: 0 };
  assert.equal(o.segmentFree(null, inside, { x: FACE - 3, y: 6, z: 1 }), 1);
  assert.equal(o.segmentFree(null, inside, { x: FACE + CELL / 2, y: 6, z: 9 }), 1);
});

test('moves too short to cross a cell are skipped (the caller tests the end point)', () => {
  const o = wall();
  assert.equal(o.segmentFree(null, { x: FACE - 0.1, y: 6, z: 0 }, { x: FACE + 0.3, y: 6, z: 0 }), 1);
  assert.ok(o.segmentFree(null, { x: FACE - 0.4, y: 6, z: 0 }, { x: FACE + 0.4, y: 6, z: 0 }) < 1);     // 0.8 cm: swept
  assert.ok(o.segmentFreeAt(null, FACE - 0.1, 6, 0, FACE + 0.3, 6, 0, 0) < 1);                         // min = 0: always swept
});
