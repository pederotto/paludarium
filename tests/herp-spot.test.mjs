// B1b: where a click puts a newt, marbled newt, fire salamander or axolotl (the pure rule behind Animals.placement; animals.js
// cannot be imported under Node, so the rule lives in sim/placement.js herpSpot and is driven here on a stub tank with a pool).
import test from 'node:test';
import assert from 'node:assert/strict';
import { herpSpot } from '../src/sim/placement.js';
import { HABITAT } from '../src/content/habitats.js';

const WL = 0;                                                      // water level, cm
const ground = (x, z) => { const r = Math.hypot(x / 1.5, z); return r < 15 ? -10 + 10 * (r / 15) ** 2 : (r - 15) * 0.3; };   // a bowl: pool floor -10, shore at r = 15
const surfAt = (x, z) => (ground(x, z) < WL ? WL : -Infinity);   // as World.water.surfaceAt: no water here = nothing above the ground
const nearWater = (x, z) => (d) => { if (ground(x, z) < WL) return true; for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; if (ground(x + Math.sin(a) * d, z + Math.cos(a) * d) < WL) return true; } return false; };
const ctx = (x, z) => ({ ground: ground(x, z), surf: surfAt(x, z), wl: WL, nearWater: nearWater(x, z) });

function points(n, seed) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: n }, () => [(r() - 0.5) * 88, (r() - 0.5) * 42]);
}
const PTS = points(200, 7);

// The rule animals.js had before B1b (case 'newt' and case 'axolotl' of placement()), kept here as the reference.
function legacy(kind, x, z) {
  const g = ground(x, z), s = surfAt(x, z), depth = WL - g;
  if (kind === 'newt') {
    if (s > g) return { y: g + Math.min(1, (s - g) * 0.3) };
    if (!nearWater(x, z)(8)) return { error: 'Newts need water nearby.' };
    return { y: g };
  }
  if (depth < 4) return { error: 'Axolotls need water at least 4 cm deep.' };
  return { y: g };
}

test('the stub tank has a pool and dry land, and the old rule put a fire salamander on the pool floor', () => {
  const wet = PTS.filter(([x, z]) => surfAt(x, z) - ground(x, z) > HABITAT.firesal.maxDepth).length;
  const bad = PTS.filter(([x, z]) => { const r = legacy('newt', x, z); return r.y != null && surfAt(x, z) - r.y > HABITAT.firesal.maxDepth; }).length;
  console.log(`# old rule: ${bad} of ${PTS.length} firesal placements under water (${wet} clicks were on the pool)`);
  assert.ok(wet > 40 && wet < 160, `pool clicks ${wet}`);
  assert.equal(bad, wet);
});

test('fire salamander: never under water, never on the pool floor, any dry spot accepted', () => {
  const h = HABITAT.firesal;
  let refused = 0, placed = 0;
  for (const [x, z] of PTS) {
    const c = ctx(x, z), depth = c.surf - c.ground, r = herpSpot(h, c);
    if (depth > h.maxDepth) { assert.ok(r.error, `pool click at ${x.toFixed(1)},${z.toFixed(1)} must be refused`); refused++; continue; }
    assert.equal(r.error, undefined, `dry click at ${x.toFixed(1)},${z.toFixed(1)}: ${r.error}`);
    assert.equal(r.y, c.ground);
    assert.ok(!(c.surf - r.y > h.maxDepth), 'under water');
    placed++;
  }
  console.log(`# new rule: firesal refused ${refused}, placed ${placed}, under water 0`);
  assert.ok(refused > 40 && placed > 40);
});

test('newt and marbled newt: same spots as before; axolotl: same spots as before', () => {
  for (const [id, kind] of [['newt', 'newt'], ['marbled', 'newt'], ['axolotl', 'axolotl']]) {
    let ok = 0, no = 0;
    for (const [x, z] of PTS) {
      const want = legacy(kind, x, z), got = herpSpot(HABITAT[id], ctx(x, z));
      assert.equal(got.error, want.error, `${id} ${x.toFixed(1)},${z.toFixed(1)}`);
      if (want.error) no++; else { assert.ok(Math.abs(got.y - want.y) < 1e-9, `${id} y`); ok++; }
    }
    assert.ok(ok > 20 && no > 20, `${id} ok ${ok} refused ${no}`);
    console.log(`# ${id}: ${ok} placed, ${no} refused, identical to the old rule`);
  }
});

test('the rows decide: newt and marbled need water within 8 cm on dry ground, axolotl needs its minDepth', () => {
  assert.equal(HABITAT.newt.zone, 'shore'); assert.equal(HABITAT.newt.water, 8);
  assert.equal(HABITAT.marbled.zone, 'shore'); assert.equal(HABITAT.marbled.water, 8);
  assert.equal(HABITAT.axolotl.zone, 'water'); assert.equal(HABITAT.axolotl.minDepth, 4);
  assert.equal(HABITAT.firesal.zone, 'land');
  assert.ok(herpSpot(HABITAT.axolotl, { ground: -3.9, surf: 0, wl: 0, nearWater: () => true }).error);
  assert.equal(herpSpot(HABITAT.axolotl, { ground: -4, surf: 0, wl: 0, nearWater: () => true }).y, -4);
});
