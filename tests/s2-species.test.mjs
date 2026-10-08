// Run "sets", S2: the stream fish (tanichthys, zacco, hillloach, bullhead) and the plants (nidus, crypt, hartstongue, miscanthus):
// every table has a row, the numbers sit inside the sourced data (BB/reports/S2.data.md), every body builds finite and the
// plant meshes build inside a triangle budget. The `flowMin` care rule is checked on the source text of sim.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { BODIES } from '../src/render/creatures/bodies/index.js';
import { HABITAT } from '../src/content/habitats.js';
import { ANIMALS, PLANTS as PLANT_ROWS } from '../src/content/economy.js';
import { ANIMAL_INFO } from '../src/content/species-info.js';
import { PLANT_INFO } from '../src/content/plant-info.js';
import { CONCEPTS } from '../src/content/concepts.js';

// sim/animals.js and sim/plants.js read import.meta.env (Vite): load them through a Vite server in middleware mode.
globalThis.location ??= { href: 'http://localhost/', search: '' };   // render/assets.js builds URLs from it
const noop = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop()), apply: () => noop(), construct: () => noop(), set: () => true });
globalThis.document ??= noop();
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { SPECIES } = await vite.ssrLoadModule('/src/sim/animals.js');
const { PLANTS: PLANT_DEFS } = await vite.ssrLoadModule('/src/sim/plants.js');
test.after(() => vite.close());

const FISH = ['tanichthys', 'zacco', 'hillloach', 'bullhead', 'bedotia'];
const INVERT = ['matanoshrimp', 'tylomelania', 'cambarellus'];
const ALL = [...FISH, ...INVERT];
const PLANTS = ['nidus', 'crypt', 'hartstongue', 'miscanthus', 'heliconia', 'aponogeton', 'pandanus', 'limnobium', 'sago', 'tussock', 'crowfoot'];

test('each new animal has a species row, habitat, shop row, field guide entry and body', () => {
  for (const id of ALL) {
    assert.ok(SPECIES[id], `${id}: SPECIES`);
    assert.equal(SPECIES[id].group, FISH.includes(id) ? 'Fish' : id === 'tylomelania' ? 'Molluscs' : 'Crustaceans');
    assert.ok(HABITAT[id], `${id}: HABITAT`);
    assert.ok(ANIMALS[id], `${id}: shop row`);
    assert.ok(ANIMAL_INFO[id]?.sci && ANIMAL_INFO[id].facts.length >= 3, `${id}: field guide`);
    assert.ok(!ANIMAL_INFO[id].lesson || CONCEPTS[ANIMAL_INFO[id].lesson], `${id}: lesson card`);
    assert.ok(BODIES[id], `${id}: body`);
  }
});

test('the new fish stay inside their sourced ranges', () => {
  const S = SPECIES;
  assert.deepEqual(S.tanichthys.temp, [14, 24]); assert.ok(S.tanichthys.school && S.tanichthys.flock[0] >= 6);
  assert.ok(S.zacco.temp[1] <= 26 && S.zacco.size >= 10 && S.zacco.school);
  assert.ok(S.hillloach.flowMin >= 0.5 && S.hillloach.flow === 1 && S.hillloach.temp[1] <= 24);
  assert.ok(S.bullhead.temp[1] <= 17 && S.bullhead.territorial && S.bullhead.eats.includes('shrimp') && S.bullhead.band === 'bottom');
  assert.ok(S.bedotia.school && S.bedotia.temp[0] >= 20 && S.bedotia.flock[0] >= 6);
  assert.ok(S.matanoshrimp.temp[0] >= 26 && S.matanoshrimp.ph[0] >= 7.5 && S.matanoshrimp.shrimp);
  assert.ok(S.tylomelania.size >= 2 && S.tylomelania.ph[0] >= 7.5 && S.tylomelania.kind === 'crawlWater');
  assert.ok(S.cambarellus.temp[1] <= 26 && S.cambarellus.scale > 1 && S.cambarellus.territorial);
  assert.ok(S.panther.eats.includes('matanoshrimp') && S.panther.eats.includes('snail'), 'the panther crab hunts Matano shrimp and snails');
  for (const id of ALL) { const s = S[id]; assert.ok(s.temp[0] < s.temp[1] && s.ph[0] < s.ph[1] && s.gh[0] < s.gh[1] && s.flock[0] <= s.flock[1], id); }
  for (const id of ['hillloach', 'bullhead', 'zacco']) assert.ok(S[id].flowMin <= S[id].flow, `${id}: flowMin <= flow`);
});

test('each new animal body builds with a finite SDF and a colour', () => {
  for (const id of ALL) {
    const d = BODIES[id]();
    let inside = 0;
    for (let x = d.lo[0]; x < d.hi[0]; x += d.cell * 2) for (let y = d.lo[1]; y < d.hi[1]; y += d.cell * 2) for (let z = d.lo[2]; z < d.hi[2]; z += d.cell * 2) {
      const v = d.sdf(x, y, z); assert.ok(Number.isFinite(v), `${id}: sdf ${x},${y},${z}`); if (v < 0) inside++;
    }
    assert.ok(inside > 100, `${id}: has a body`);
    assert.equal(d.color(0, 0, 0).length, 3);
  }
});

test('each new plant has a shop row, a field guide entry and a spread row', () => {
  const src = fs.readFileSync(new URL('../src/sim/plants.js', import.meta.url), 'utf8');
  for (const id of PLANTS) {
    assert.ok(PLANT_ROWS[id], `${id}: shop row`);
    assert.ok(PLANT_INFO[id]?.sci && PLANT_INFO[id].facts.length >= 2, `${id}: plant info`);
    assert.ok(!PLANT_INFO[id].lesson || CONCEPTS[PLANT_INFO[id].lesson], `${id}: lesson card`);
    assert.match(src, new RegExp(`\\b${id}: \\[[\\d., ]+\\]`), `${id}: SPREAD row`);
  }
});

test('each new plant mesh builds inside a triangle budget', () => {
  for (const id of PLANTS) {
    const P = PLANT_DEFS[id];
    assert.ok(P, `${id}: PLANTS`);
    const g = P.build(), n = g.getAttribute('position').count;
    assert.ok(n > 100 && n < 30000, `${id}: ${n} vertices`);
    g.computeBoundingBox();
    const h = g.boundingBox.max.y - g.boundingBox.min.y;
    assert.ok(Number.isFinite(h) && h > 2 && h < 40, `${id}: height ${h}`);
    console.log(`# ${id}: ${n} vertices, height ${h.toFixed(1)}`);
  }
});

test('careStress has the flowMin clause beside the max-flow one', () => {
  const src = fs.readFileSync(new URL('../src/sim/sim.js', import.meta.url), 'utf8');
  assert.match(src, /sp\.flowMin != null && fl < sp\.flowMin/);
});
