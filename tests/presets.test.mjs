// N15: premade sets are realistic biotopes. Every animal species in the game is the featured animal of at least one set;
// a set only holds plants and animals its real place has (its biotope's lists in content/biotopes.js), so the generator,
// which drops anything not in the set's lists (sim/generator.js Gen.allowPlant / allowAnimal), never builds a stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_ORDER, presetsForTier } from '../src/content/presets.js';
import { BIOTOPES } from '../src/content/biotopes.js';
import { HABITAT } from '../src/content/habitats.js';
import { PLANT_INFO } from '../src/content/plant-info.js';
import { TANKS } from '../src/content/tanks.js';

// Feeders, life stages and egg clutches are not species to feature.
const NOT_SPECIES = new Set(['tadpole', 'larva', 'eggs', 'flylarva', 'flypupa', 'fly', 'cricket', 'dubia', 'earthworm', 'waxworm']);
const SPECIES = Object.keys(HABITAT).filter((id) => !NOT_SPECIES.has(id));
const BLOCKERS = new Set(['N9', 'N10', 'N11', 'N16']);

test('the game has animal species (counted from HABITAT, not hard-coded)', () => assert.ok(SPECIES.length >= 35));

test('every animal species is the featured animal of at least one set', () => {
  const featured = new Set(Object.values(PRESETS).flatMap((p) => p.featured ?? []));
  const missing = SPECIES.filter((id) => !featured.has(id));
  assert.deepEqual(missing, [], `${missing.length} of ${SPECIES.length} species not featured: ${missing.join(' ')}`);
});

test('every set is in the menu order', () => {
  assert.deepEqual([...PRESET_ORDER].sort(), Object.keys(PRESETS).sort());
});

for (const p of Object.values(PRESETS)) {
  test(`set ${p.id}: a real place, its biotope's plants and animals only`, () => {
    const b = BIOTOPES[p.biotope];
    assert.ok(b, `biotope ${p.biotope} exists`);
    assert.ok(p.place && typeof p.place === 'string', 'names its real place');
    assert.ok(Array.isArray(p.featured) && p.featured.length >= 1 && p.featured.length <= 4, 'one featured animal (crew jar: up to four)');
    assert.ok(Array.isArray(p.plants) && Array.isArray(p.animals), 'lists its plants and animals');
    for (const id of p.featured) assert.ok(p.animals.includes(id), `featured ${id} is stocked`);
    for (const id of p.animals) {
      assert.ok(HABITAT[id], `animal ${id} exists`);
      assert.ok(b.animals.includes(id), `animal ${id} belongs to ${b.name}`);
    }
    for (const id of p.plants) {
      assert.ok(PLANT_INFO[id], `plant ${id} exists`);
      assert.ok(b.plants.includes(id), `plant ${id} belongs to ${b.name}`);
    }
    for (const [from, to] of Object.entries(p.swap ?? {})) assert.ok(p.plants.includes(to), `swap ${from} -> ${to} lands on a listed plant`);
    assert.ok(TANKS[p.ref] && p.tiers.includes(p.ref), `reference tank ${p.ref} exists and suits the set`);
    for (const t of p.tiers) assert.ok(TANKS[t], `tier ${t} exists`);
    assert.ok(p.water >= 0 && p.water <= 1, 'water share 0..1');
    const [t0, t1] = p.climate?.temp ?? [];
    assert.ok(t0 < t1 && t0 >= 5 && t1 <= 32, 'air temperature range');
    for (const id of p.blockedBy ?? []) assert.ok(BLOCKERS.has(id), `blocked by a known open bug (${id})`);
  });
}

test('a hidden set (needs an asset to exist at all) is not in any menu', () => {
  for (const t of Object.keys(TANKS)) for (const p of presetsForTier(t)) assert.ok(!p.hidden, `${p.id} hidden but listed for ${t}`);
});
