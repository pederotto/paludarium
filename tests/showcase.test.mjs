// Run "sets" S3: the two showcase sets (canyon, highland) are complete recipes whose lists the species and plants really have,
// within the climate of their place, on tiers their layout is built for. The water itself is measured in a browser
// (tools/steps/showcase-flow.mjs: span, litres, speed, 72 h drift).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOWCASE_LAYOUTS, SHOWCASE_SETS, SHOWCASE_BIOTOPES } from '../src/content/presets-showcase.js';
import { HABITAT } from '../src/content/habitats.js';
import { PLANT_INFO } from '../src/content/plant-info.js';
import { TANKS } from '../src/content/tanks.js';

const IDS = Object.keys(SHOWCASE_SETS);

test('canyon and highland: layout, recipe and biotope exist for each id', () => {
  assert.ok(IDS.includes('canyon'));
  for (const id of IDS) {
    assert.ok(SHOWCASE_LAYOUTS[id], `${id} layout`);
    const b = SHOWCASE_BIOTOPES[SHOWCASE_LAYOUTS[id].biotope];
    assert.ok(b, `${id} biotope`);
    const s = SHOWCASE_SETS[id];
    for (const k of ['featured', 'place', 'ref', 'water', 'climate', 'plants', 'animals']) assert.ok(s[k] !== undefined, `${id}.${k}`);
    assert.ok(SHOWCASE_LAYOUTS[id].tiers.includes(s.ref), `${id} ref ${s.ref} is one of its tiers`);
    for (const t of SHOWCASE_LAYOUTS[id].tiers) assert.ok(TANKS[t], `${id} tier ${t} exists`);
  }
});

test('every species and plant a showcase set lists exists and is in its biotope', () => {
  for (const id of IDS) {
    const s = SHOWCASE_SETS[id], b = SHOWCASE_BIOTOPES[SHOWCASE_LAYOUTS[id].biotope];
    for (const a of s.animals) { assert.ok(HABITAT[a], `${id}: species ${a} exists`); assert.ok(b.animals.includes(a), `${id}: ${a} in biotope`); }
    for (const p of s.plants) { assert.ok(PLANT_INFO[p], `${id}: plant ${p} exists`); assert.ok(b.plants.includes(p), `${id}: ${p} in biotope`); }
    for (const f of s.featured) assert.ok(s.animals.includes(f), `${id}: featured ${f} listed`);
  }
});

test('the set climate holds the species it stocks (care limits tMax / rhMin from habitats.js)', () => {
  for (const id of IDS) {
    const s = SHOWCASE_SETS[id];
    for (const a of s.animals) {
      const H = HABITAT[a];
      if (H.tMax != null) assert.ok(s.climate.temp[0] <= H.tMax, `${id}: ${a} tMax ${H.tMax} vs set low ${s.climate.temp[0]}`);
      if (H.rhMin != null) assert.ok(s.climate.rh[1] >= H.rhMin, `${id}: ${a} rhMin ${H.rhMin}`);
    }
  }
});

test('canyon: the targets are declared (layered massifs, a wall fall onto a shelf stream, a deep lagoon, rheophilic fauna)', () => {
  const c = SHOWCASE_SETS.canyon, l = SHOWCASE_LAYOUTS.canyon;
  assert.deepEqual(['long', 'show'].filter((t) => !l.tiers.includes(t)), []);   // only tiers run clean (showcase-flow.mjs)
  assert.equal(c.ref, 'long');
  assert.ok(c.animals.includes('hillloach') && c.animals.includes('zacco'), 'rheophilic animals');
  assert.ok(!c.animals.includes('tanichthys'), 'tanichthys is Guangdong, not Taiwan');
  assert.match(c.place, /Taroko/);
});
