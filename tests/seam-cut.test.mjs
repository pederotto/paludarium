// The fused contacts of a scan cut and capped (tools/rig/seam-cut.mjs): two closed boxes joined by a bridging wall (each box has one face replaced by the wall's rim) follow two
// bones that are not neighbours: the wall is removed and each box is closed again by a cap wound outward, every edge used once in each direction (a closed, consistently
// wound surface), the boxes two pieces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutSeams } from '../tools/rig/seam-cut.mjs';

const cube = (o, z0) => {   // 8 vertices at z0 and z0 + 1, the outward faces without the top (z = z0 + 1) or, for the second box, without the bottom
  const P = []; for (let i = 0; i < 8; i++) P.push([i & 1, (i >> 1) & 1, z0 + ((i >> 2) & 1)]);
  const F = { bottom: [[0, 2, 3], [0, 3, 1]], top: [[4, 5, 7], [4, 7, 6]], front: [[0, 1, 5], [0, 5, 4]], back: [[2, 7, 3], [2, 6, 7]], left: [[0, 4, 6], [0, 6, 2]], right: [[1, 3, 7], [1, 7, 5]] };
  return { P, F: F, o };
};
test('a bridge between two parts is cut and each side capped: a closed, consistently wound surface of two pieces', () => {
  const A = cube(0, 0), B = cube(8, 1.05), pos = [], idx = [];
  for (const c of [A, B]) for (const p of c.P) pos.push(...p);
  const add = (c, names) => { for (const nm of names) for (const t of c.F[nm]) idx.push(t[0] + c.o, t[1] + c.o, t[2] + c.o); };
  add(A, ['bottom', 'front', 'back', 'left', 'right']); add(B, ['top', 'front', 'back', 'left', 'right']);
  // the wall: A's top rim 4, 5, 7, 6 (counter-clockwise from above) up to B's bottom rim 8 + 0, 1, 3, 2
  const ra = [4, 5, 7, 6], rb = [8, 9, 11, 10];
  for (let k = 0; k < 4; k++) { const p = ra[k], q = ra[(k + 1) % 4], bp = rb[k], bq = rb[(k + 1) % 4]; idx.push(p, q, bq, p, bq, bp); }
  const dom = new Int16Array(16).map((_, i) => (i < 8 ? 0 : 1));
  const bones = [{ name: 'thighR', parent: null, head: [0.5, 0.5, 0], tail: [0.5, 0.5, 1] }, { name: 'footR', parent: null, head: [0.5, 0.5, 1.05], tail: [0.5, 0.5, 2.05] }];
  const r = cutSeams({ pos: Float32Array.from(pos), idx: Uint32Array.from(idx), dom, bones, radius: {}, minPiece: 1 });
  assert.equal(r.stats.facesRemoved, 8, `${r.stats.facesRemoved} bridging faces removed`);
  assert.equal(r.stats.caps, 2);
  assert.equal(r.idx.length / 3, 24, `${r.idx.length / 3} faces`);
  const dir = new Map(); for (let t = 0; t < r.idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const k = `${r.idx[t + a]},${r.idx[t + b]}`; dir.set(k, (dir.get(k) ?? 0) + 1); }
  for (const [k, n] of dir) { const [a, b] = k.split(','); assert.equal(n, 1, `edge ${k} used ${n} times`); assert.equal(dir.get(`${b},${a}`), 1, `edge ${k} has no opposite: the surface is not closed and consistently wound`); }
  assert.equal(r.pure.size, 8, 'the rim vertices follow their own bone alone');
});
test('neighbouring bones are cut only where listed, far from their joint', () => {
  const pos = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 5, 1, 0, 5, 0, 1, 5]), idx = Uint32Array.from([0, 1, 2, 2, 1, 4, 2, 4, 5, 2, 5, 3]);
  const dom = Int16Array.from([0, 0, 0, 1, 1, 1]), bones = [{ name: 'thighR', parent: null, head: [0, 0, 0], tail: [0, 0, 1] }, { name: 'shinR', parent: 'thighR', head: [0, 0, 1], tail: [0, 0, 6] }];
  // the face (2, 1, 4) and (2, 4, 5) join the two bones 4-5 units from their joint: a bridge when the pair is listed, left when it is not
  assert.ok(cutSeams({ pos, idx, dom, bones, radius: {}, pairs: new Set(['thigh,shin']), minPiece: 1 }).stats.facesRemoved > 0);
  assert.equal(cutSeams({ pos, idx, dom, bones, radius: {}, pairs: new Set(['shin,foot']), minPiece: 1 }).stats.facesRemoved, 0);
});
