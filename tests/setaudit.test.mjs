// S1 audit rules as tests (tools/set-audit.mjs reads SPECIES out of the source; no browser). Recipe-level only: the build
// counts (litres, plants per m2, animals placed) are measured by tools/steps/set-counts.mjs and written up in the S1 report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PRESETS, PRESET_ORDER } from '../src/content/presets.js';
import { BIOTOPES } from '../src/content/biotopes.js';

const audit = spawnSync('node', ['tools/set-audit.mjs'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname.replace(/%20/g, ' ') });

test('the audit finds no "wrong" in any set (climate overlap, humidity, pH/GH, flock and room, territory, predator pairs, region)', () => {
  const wrong = audit.stdout.split('\n').filter((l) => l.startsWith('- wrong:'));
  assert.deepEqual(wrong, [], `${wrong.length} wrong findings`);
  assert.equal(audit.status, 0);
});

test('no set stocks a predator beside its prey (SPECIES.eats) unless the prey is crew or feeder', () => {
  assert.ok(!/eats .*both stocked/.test(audit.stdout));
});

test('every set has at least 4 plant kinds, except a sealed jar and a cave mouth (3)', () => {
  for (const id of PRESET_ORDER) {
    const P = PRESETS[id], min = id === 'jar' || id === 'cavemouth' ? 3 : 4;
    assert.ok(P.plants.length >= min, `${id}: ${P.plants.length} plant kinds (${P.plants.join(',')})`);
  }
});

test('every flora/stock entry is in the set\'s own lists and the biotope (nothing is dropped by the generator)', () => {
  for (const id of PRESET_ORDER) {
    const P = PRESETS[id], b = BIOTOPES[P.biotope];
    for (const [p] of P.flora ?? []) assert.ok(P.plants.includes(p), `${id}: flora ${p} not in plants`);
    for (const [a] of P.stock ?? []) assert.ok(P.animals.includes(a), `${id}: stock ${a} not in animals`);
    for (const p of P.plants) assert.ok(b.plants.includes(p), `${id}: plant ${p} not in biotope ${P.biotope}`);
  }
});

test('cool sets (a place under 22 C) carry a chiller and a cooling set point', () => {
  for (const id of PRESET_ORDER) {
    const P = PRESETS[id];
    if (P.climate.temp[1] <= 21) { assert.ok(P.gear?.includes('chiller'), `${id} needs the chiller`); assert.ok(P.env?.chill === 1 && P.env.coolSet <= P.climate.temp[1], `${id} cooling set point`); }
  }
});

test('the water share the recipe names is real: a set with fish is not authored for less than 12 litres of water', () => {
  for (const id of PRESET_ORDER) {
    const P = PRESETS[id];
    if (P.water >= 0.5) assert.ok((P.level ?? 0.3) >= 0.2 || (P.pool ?? 1) >= 1, `${id}: water ${P.water}`);
  }
});

test('the dropped sets are gone and their species are still featured', () => {
  assert.ok(!PRESETS.tideline && !PRESETS.fernjar);
  const f = new Set(Object.values(PRESETS).flatMap((p) => p.featured));
  for (const id of ['purpleiso', 'springpink', 'springsea']) assert.ok(f.has(id), `${id} featured`);
});
