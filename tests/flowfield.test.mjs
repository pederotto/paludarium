// Flow fields (sim/flowfield.js): the flood from the refuges, the step rules it shares with the movers, and the walk downhill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeField, buildField, descend, cellOf, cx, cz, canPass } from '../src/sim/flowfield.js';

const grid = (nx, nz, f) => { const F = makeField(nx, nz, 1, 0, 0); F.up = 1; F.down = 1; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const c = k * nx + i; F.open[c] = 1; f?.(F, c, i, k); } return F; };

test('cost is the cheapest walk to the nearest refuge; a cell with no way has none', () => {
  const F = grid(10, 3, (F, c, i) => { if (i === 9) F.target[c] = 1; });
  buildField(F);
  assert.equal(F.dist[cellOf(F, 9.5, 1.5)], 0);
  assert.ok(Math.abs(F.dist[cellOf(F, 0.5, 1.5)] - 9) < 1e-5);
  const G = grid(10, 3, (F, c, i) => { if (i === 9) F.target[c] = 1; if (i === 5) F.open[c] = 0; });   // a wall across
  buildField(G);
  assert.equal(G.dist[cellOf(G, 0.5, 1.5)], Infinity);
  assert.equal(descend(G, cellOf(G, 0.5, 1.5), 5), -1, 'no way: no goal, never a goal it cannot reach');
});

test('a wall with a gap is gone round, not through, and no corner is cut past a closed cell', () => {
  const F = grid(10, 10, (F, c, i, k) => { if (i === 9 && k === 0) F.target[c] = 1; if (i === 5 && k < 9) F.open[c] = 0; });
  buildField(F);
  const start = cellOf(F, 0.5, 0.5);
  assert.ok(F.dist[start] > 9 + 8, `round the wall: ${F.dist[start]}`);
  let c = start;
  for (let s = 0; s < 60 && !F.target[c]; s++) { const n = descend(F, c, 1); assert.ok(F.open[n]); c = n; }
  assert.equal(F.target[c], 1, 'downhill always arrives');
});

test('steps follow the movers rules: a bank too high is no way up, and too steep no way down unless it is a drop (a newt slides into water)', () => {
  // ground at 0 on the left, a 3 cm step down to the water (the target) on the right
  const mk = (drop) => grid(6, 1, (F, c, i) => { F.h[c] = i < 3 ? 3 : 0; if (i === 5) F.target[c] = 1; if (i === 3) F.drop[c] = drop ? 1 : 0; });
  const A = buildField(mk(false)), B = buildField(mk(true));
  assert.equal(A.dist[0], Infinity, 'refused like walkBlocked');
  assert.ok(B.dist[0] < Infinity, 'a drop cell lets it slide down');
  assert.equal(canPass(B, 3, 2), false, 'and it is no way back up');
});

test('the walk downhill prefers the way away from a threat when two ways are as good', () => {
  const F = grid(9, 9, (F, c, i, k) => { if ((i === 0 || i === 8) && k === 4) F.target[c] = 1; });
  buildField(F);
  const c = cellOf(F, 4.5, 4.5), threat = { x: 1, z: 4.5 };
  const pen = (q) => Math.max(0, 6 - Math.hypot(cx(F, q) - threat.x, cz(F, q) - threat.z)) * 2;
  const end = descend(F, c, 20, pen);
  assert.ok(cx(F, end) > 4.5, `away from the threat: ${cx(F, end)}`);
});

test('wading cost: deep water costs more than the long way round on land', () => {
  const F = grid(9, 5, (F, c, i, k) => { if (i === 8 && k === 2) F.target[c] = 1; if (k >= 1 && k <= 3 && i >= 2 && i <= 6) F.wcost[c] = 10; });
  buildField(F);
  const end = descend(F, cellOf(F, 0.5, 2.5), 3);
  assert.ok(cz(F, end) < 1 || cz(F, end) > 4, 'it goes round the deep water');
});
