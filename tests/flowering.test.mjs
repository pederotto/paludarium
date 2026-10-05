// The flowering plants' data (src/sim/flowering.js, the flower contract of team-plants): every body and flower head builds,
// stays inside its triangle budget, carries leaf coordinates on its petals and a palette mask that sums to 1; palettes,
// heads and bloom cycles are valid; the plant tables (prices, field guide) have a row for every new species.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Builder } from '../src/render/geo.js';
import { rng } from '../src/util/math.js';
import { FLOWERING, BROMELIAD_FLOWER, previewGeometry, headMatrix } from '../src/sim/flowering.js';
import { PLANTS as PLANT_ROWS } from '../src/content/economy.js';
import { PLANT_INFO } from '../src/content/plant-info.js';
import { CONCEPTS } from '../src/content/concepts.js';
import { BIOTOPES } from '../src/content/biotopes.js';

const BODY_TRIS = 480, HEAD_TRIS = 240;   // run orchids, decisions 7 and 9
const flowers = { ...Object.fromEntries(Object.entries(FLOWERING).map(([id, d]) => [id, d.flower])), bromeliad: BROMELIAD_FLOWER };

test('every flowering body builds within its budget', () => {
  for (const [id, d] of Object.entries(FLOWERING)) {
    const g = d.build(), n = g.attributes.position.count;
    assert.equal(n % 3, 0, id);
    assert.ok(n / 3 <= BODY_TRIS, `${id}: ${n / 3} body triangles`);
    for (const k of ['normal', 'color', 'sway']) assert.ok(g.attributes[k]?.count === n, `${id}: ${k}`);
    assert.ok(g.attributes.leaf, `${id}: leaf coordinates for the veins`);
    for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v), `${id}: finite positions`);
    g.computeBoundingBox();
    const b = g.boundingBox;
    assert.ok(b.min.y > -8 && b.max.y < 30 && b.max.x - b.min.x < 40, `${id}: a plant-sized body`);
  }
});

test('every flower head builds within its budget with a palette mask and leaf coords on the petals', () => {
  for (const [id, f] of Object.entries(flowers)) {
    const b = new Builder();
    f.build(b, rng(1));
    const n = b.pos.length / 3;
    assert.ok(n > 0 && n % 3 === 0, id);
    assert.ok(n / 3 <= HEAD_TRIS, `${id}: ${n / 3} head triangles`);
    assert.equal(b.col.length, n * 3, id); assert.equal(b.leaf.length, n * 2, id); assert.equal(b.sway.length, n, id);
    let petals = 0;
    for (let i = 0; i < n; i++) {
      const [r, g, bl] = b.col.slice(i * 3, i * 3 + 3);
      assert.ok(r >= -1e-6 && g >= -1e-6 && bl >= -1e-6 && Math.abs(r + g + bl - 1) < 1e-4, `${id}: mask ${r},${g},${bl} at vertex ${i}`);
      const u = b.leaf[i * 2], v = b.leaf[i * 2 + 1];
      if (v >= 0) { petals++; assert.ok(u >= -1 - 1e-6 && u <= 1 + 1e-6 && v <= 1 + 1e-6, `${id}: leaf coords ${u},${v}`); }
      else assert.equal(v, -1, id);
    }
    assert.ok(petals > n * 0.3, `${id}: petals carry leaf coordinates`);
    for (const v of b.pos) assert.ok(Number.isFinite(v), `${id}: finite`);
  }
});

test('palettes, heads, cycles and needs are valid', () => {
  for (const [id, f] of Object.entries(flowers)) {
    assert.ok(f.palettes.length >= 2 && f.palettes.length <= 6, `${id}: 2-6 colour forms`);
    for (const p of f.palettes) {
      assert.ok(p.length === 3 || p.length === 4, id);   // [main, accent, centre, pattern code?]
      for (const c of p.slice(0, 3)) assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff, id);
      if (p.length === 4) assert.ok(Number.isInteger(p[3]) && p[3] >= 0 && p[3] <= 7, `${id}: pattern code 0-7`);
    }
    assert.equal(new Set(f.palettes.map((p) => p.join())).size, f.palettes.length, `${id}: distinct forms`);
    assert.ok(f.translucent >= 0 && f.translucent <= 1, id);
    assert.ok([null, 'day', 'night'].includes(f.daily), id);
    assert.ok([null, 'keiki', 'seed', 'pup', 'berry'].includes(f.after), id);
    const c = f.cycle;
    for (const k of ['budDays', 'openDays', 'fadeDays', 'restDays']) assert.ok(c[k] > 0 && c[k] < 400, `${id}: ${k}`);
    assert.ok(['any', 'wet', 'dry'].includes(c.season), id);
    assert.ok(c.minLight >= 0 && c.minLight <= 1 && c.minHumidity >= 0 && c.minHumidity <= 100, id);
    assert.deepEqual(f.heads(rng(2), 0.2), [], `${id}: a young plant does not flower`);
    for (let s = 1; s < 6; s++) {
      const hs = f.heads(rng(s), 1);
      assert.ok(hs.length >= 1 && hs.length <= 15, `${id}: ${hs.length} heads`);
      for (const h of hs) {
        assert.equal(h.length, 7, id);
        for (const v of h) assert.ok(Number.isFinite(v), id);
        assert.ok(Math.abs(Math.hypot(h[3], h[4], h[5]) - 1) < 1e-3, `${id}: unit facing`);
        assert.ok(h[6] > 0.3 && h[6] < 2, `${id}: head scale`);
        const m = headMatrix(h).elements;
        assert.ok(Math.abs(m[4] - h[3] * h[6]) < 1e-6 && Math.abs(m[5] - h[4] * h[6]) < 1e-6, `${id}: +Y to the facing`);
      }
    }
  }
  for (const [id, d] of Object.entries(FLOWERING)) {
    assert.ok(d.name && d.note && d.habitat && d.humidity?.length === 2 && d.light > 0 && d.light <= 1, id);
    assert.ok(d.habitat.split('|').every((h) => ['land', 'wall', 'emergent', 'aquatic', 'floating'].includes(h)), id);
  }
});

test('each flowering species merges with its flowers into a preview, and every colour form shows', () => {
  for (const [id, d] of Object.entries(FLOWERING)) {
    const g = previewGeometry(d);
    assert.ok(g.attributes.position.count > d.build().attributes.position.count * d.flower.palettes.length, id);
  }
});

test('every new species has a shop row and a field-guide page; biotopes list real plants', () => {
  for (const id of Object.keys(FLOWERING)) {
    assert.ok(PLANT_ROWS[id]?.price > 0 && PLANT_ROWS[id].name, `${id}: economy row`);
    const info = PLANT_INFO[id];
    assert.ok(info?.sci && info.region && info.facts?.length && info.care?.length, `${id}: plant-info`);
    assert.ok(!info.lesson || CONCEPTS[info.lesson], `${id}: lesson ${info.lesson}`);
  }
  const known = new Set([...Object.keys(PLANT_ROWS)]);
  for (const [bid, b] of Object.entries(BIOTOPES)) for (const p of b.plants) assert.ok(known.has(p), `${bid}: ${p}`);
});
