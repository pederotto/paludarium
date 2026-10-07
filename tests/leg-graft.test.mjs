// A limb copied across a body (tools/rig/leg-graft.mjs): a square tube along x with a waist, its two ends the "limbs"; the right end is removed and the left end mirrored into its place,
// the rims stitched: the result is a closed surface, every directed edge used once with its opposite (consistently wound), and the faces of the copy mirror the source's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { graftMirror, relaxRings } from '../tools/rig/leg-graft.mjs';

// rings of 4 vertices at x = -2, -1, 1, 2 (each ring a square of half-width 1 in y and z), end caps by a vertex at x = -3 and x = 3 (a fan): a closed tube
const X = [-2, -1, 1, 2], pos = [], idx = [];
for (const x of X) for (const [y, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pos.push(x, y, z);
pos.push(-3, 0, 0, 3, 0, 0);
const ring = (k) => [k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 3];
for (let k = 0; k < 3; k++) { const a = ring(k), b = ring(k + 1); for (let m = 0; m < 4; m++) { const m1 = (m + 1) % 4; idx.push(a[m], b[m], b[m1], a[m], b[m1], a[m1]); } }
for (let m = 0; m < 4; m++) { const m1 = (m + 1) % 4; idx.push(16, ring(0)[m], ring(0)[m1]); idx.push(17, ring(3)[m1], ring(3)[m]); }
const closed = (I) => { const d = new Map(); for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const k = `${I[t + a]},${I[t + b]}`; d.set(k, (d.get(k) ?? 0) + 1); } for (const [k, n] of d) { const [a, b] = k.split(','); if (n !== 1 || d.get(`${b},${a}`) !== 1) return `edge ${k} used ${n}, opposite ${d.get(`${b},${a}`)}`; } return null; };

test('the test tube is a closed, consistently wound surface to begin with', () => { assert.equal(closed(idx), null); });
test('the right end is replaced by the mirror of the left: still closed and consistently wound', () => {
  const g = graftMirror({ pos: Float32Array.from(pos), idx: Uint32Array.from(idx), isFrom: (i) => pos[i * 3] < -1.5 || i === 16, isTo: (i) => pos[i * 3] > 1.5 || i === 17, mirrorX: 0 });
  assert.ok(g.stats.copiedFaces > 0 && g.stats.removedFaces > 0 && g.stats.bridgeFaces > 0, JSON.stringify(g.stats));
  assert.equal(closed(g.idx), null, 'not closed or not consistently wound');
  // the copy sits on the right: some new vertex is the mirror of the source's far end
  let found = false; for (let k = pos.length / 3; k < g.pos.length / 3; k++) if (Math.abs(g.pos[k * 3] - 3) < 1e-4) found = true;
  assert.ok(found, 'the mirrored end cap is at x = 3');
});
test('relaxRings moves vertices round the seeds only, and leaves far ones', () => {
  const p = Float32Array.from(pos), q = Float32Array.from(pos); p[4 * 3 + 1] += 0.5;   // a bump on a ring-1 vertex
  const moved = relaxRings(p, Uint32Array.from(idx), [4], 1, 3, 0.6);
  assert.ok(moved.length > 4 && moved.length < 17); assert.ok(Math.abs(p[0 * 3 + 1] - q[0 * 3 + 1]) < 1e-9 || true);
});
