// Habitat rules (sim/habitat.js over content/habitats.js): where each animal may be put, what is wrong with a spot and where
// the nearest right one is. The world is replaced by plain sample objects, so this runs under Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HABITAT } from '../src/content/habitats.js';
import { habitatCheck, zoneViolations, findHabitat, needsOf, nightActivity, hideScore, COVER_OK, sentence } from '../src/sim/habitat.js';

// A damp, cool, covered bank beside a pool: suits nearly everything that lives on land.
const bank = { depth: 0, waterDist: 4, landDist: 0, rh: 80, temp: 20, cover: 0.9, wall: false };
const pool = { ...bank, depth: 6, waterDist: 0, landDist: 9, cover: 0 };
const shallows = { ...bank, depth: 1, waterDist: 0, landDist: 2, cover: 0 };
const dryLedge = { ...bank, waterDist: 60, rh: 52, cover: 0 };

test('every species has a habitat rule, and every rule belongs to a species', () => {
  const text = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
  const block = text.slice(text.indexOf('export const SPECIES = {'), text.indexOf('export const ONE ='));
  const ids = [...block.matchAll(/^  ([a-z]+): \{$/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 27, `found ${ids.length} species`);
  for (const id of ids) {
    const h = HABITAT[id];
    assert.ok(h, `no habitat for ${id}`);
    assert.ok(h.noun && h.zone && h.need, `${id} is missing noun, zone or need`);
    assert.ok(['water', 'shore', 'land', 'wall', 'air', 'any'].includes(h.zone), `${id}: zone ${h.zone}`);
  }
  for (const id of Object.keys(HABITAT)) assert.ok(ids.includes(id), `habitat for unknown species ${id}`);
});

test('fish and other water animals need water deep enough, and only that', () => {
  for (const id of ['neon', 'cardinal', 'ember', 'guppy', 'betta', 'cory', 'loach', 'oto', 'tadpole', 'tanichthys', 'zacco', 'hillloach', 'bullhead', 'bedotia']) {
    assert.ok(habitatCheck(id, pool).ok, id);
    assert.ok(!habitatCheck(id, bank).ok, `${id} on land`);
    assert.ok(!habitatCheck(id, { ...pool, depth: 2 }).ok, `${id} in 2 cm`);
    assert.ok(!habitatCheck(id, { ...pool, depth: 20, wall: true }).ok, `${id} on the wall`);
  }
  for (const id of ['shrimp', 'snail']) { assert.ok(habitatCheck(id, { ...pool, depth: 1.5 }).ok); assert.ok(!habitatCheck(id, bank).ok); }
  assert.match(habitatCheck('neon', bank).hint, /neon tetra needs open water at least 3 cm deep/i);
});

test('the axolotl wants cold, deep water and refuses a hot tank', () => {
  assert.ok(habitatCheck('axolotl', { ...pool, depth: 5, temp: 19 }).ok);
  assert.ok(!habitatCheck('axolotl', { ...pool, depth: 3 }).ok);
  const hot = habitatCheck('axolotl', { ...pool, depth: 8, temp: 29 });
  assert.ok(!hot.ok && hot.why.includes('too hot here') && /axolotl is too warm here/.test(hot.hint), hot.hint);
});

test('a fire salamander needs cool, damp ground with a hide, and never a pool', () => {
  assert.ok(habitatCheck('firesal', bank).ok);
  const wet = habitatCheck('firesal', pool);
  assert.ok(!wet.ok && wet.why.includes('in deep water') && /fire salamander can't swim well/.test(wet.hint), wet.hint);
  assert.ok(habitatCheck('firesal', { ...bank, depth: 0.4 }).ok, 'a wet edge is fine');
  const open = habitatCheck('firesal', { ...bank, cover: 0 });
  assert.ok(!open.ok && open.why.includes('no cover') && /hide/.test(open.hint));
  assert.ok(habitatCheck('firesal', { ...bank, cover: COVER_OK + 0.01 }).ok);
  const dry = habitatCheck('firesal', { ...bank, rh: 40 });
  assert.ok(!dry.ok && dry.why.includes('air too dry here'));
  const hot = habitatCheck('firesal', { ...bank, temp: 29 });
  assert.ok(!hot.ok && hot.why.includes('too hot here'));
  // Water far away is only a worry, not a refusal.
  const far = habitatCheck('firesal', { ...bank, waterDist: 90 });
  assert.ok(far.ok && far.level === 'warn' && far.why.includes('far from water'));
  // Without the air (the simulation judges that itself) only the place counts.
  assert.ok(habitatCheck('firesal', { ...bank, rh: 10, temp: 35 }, { env: false }).ok);
  // Not hiding right now (out at night): no cover needed.
  assert.ok(habitatCheck('firesal', { ...bank, cover: 0 }, { cover: false }).ok);
});

test('the paddle-tail newt lives in water or right beside it', () => {
  assert.ok(habitatCheck('newt', pool).ok && habitatCheck('newt', { ...pool, depth: 25 }).ok);
  assert.ok(habitatCheck('newt', shallows).ok);
  assert.ok(habitatCheck('newt', { ...bank, waterDist: 6 }).ok);
  const far = habitatCheck('newt', dryLedge);
  assert.ok(!far.ok && far.why.includes('far from water'), far.hint);
});

test('a crab needs land with water in reach and shallows no deeper than a few centimetres', () => {
  assert.ok(habitatCheck('crab', bank).ok && habitatCheck('crab', { ...shallows, depth: 3 }).ok);
  assert.ok(!habitatCheck('crab', { ...pool, depth: 9 }).ok, 'too deep for a crab');
  assert.ok(!habitatCheck('crab', dryLedge).ok, 'a dry ledge far from water');
  assert.ok(!habitatCheck('crab', { ...bank, rh: 30 }).ok);
});

test('poison frogs refuse deep water; the toad swims but wants a bank', () => {
  for (const id of ['dartfrog', 'strawberry', 'leucomelas', 'auratus']) {
    assert.ok(habitatCheck(id, bank).ok, id);
    assert.ok(habitatCheck(id, { ...bank, depth: 0.5 }).ok, `${id} in a puddle`);
    assert.ok(!habitatCheck(id, { ...pool, depth: 4 }).ok, `${id} in 4 cm of water`);
    assert.ok(!habitatCheck(id, { ...bank, rh: 30 }).ok, `${id} in dry air`);
  }
  assert.ok(habitatCheck('toad', pool).ok);
  const stranded = habitatCheck('toad', { ...pool, landDist: 90 });
  assert.ok(stranded.ok && stranded.level === 'warn' && stranded.why.includes('no bank to climb out'));
  assert.ok(habitatCheck('toad', { ...bank, waterDist: 18 }).ok);
  assert.ok(!habitatCheck('toad', { ...bank, waterDist: 70 }).ok);
});

test('geckos take the wall or dry ground; land crawlers take land only', () => {
  assert.ok(habitatCheck('gecko', { ...bank, wall: true, depth: 0, waterDist: Infinity }).ok);
  assert.ok(habitatCheck('gecko', bank).ok);
  assert.ok(!habitatCheck('gecko', pool).ok);
  for (const id of ['isopod', 'springtail']) { assert.ok(habitatCheck(id, bank).ok); assert.ok(!habitatCheck(id, pool).ok); }
  assert.ok(habitatCheck('fly', { ...bank, depth: 20 }).ok, 'flies are not judged by the water under them');
  assert.ok(habitatCheck('eggs', pool).ok);
  assert.ok(habitatCheck('nobody', pool).ok, 'an unknown species is not refused');
});

test('fit falls as more is wrong, and the hint names the first hard problem', () => {
  const good = habitatCheck('firesal', bank), one = habitatCheck('firesal', { ...bank, cover: 0 }), two = habitatCheck('firesal', { ...bank, cover: 0, rh: 40 });
  assert.equal(good.fit, 1);
  assert.ok(one.fit < good.fit && two.fit < one.fit && two.fit > 0);
  assert.equal(good.hint, '');
  assert.match(sentence('axolotl', 'is cold'), /^An axolotl is cold\.$/);
  assert.match(sentence('dartfrog', 'sits'), /^A blue dart frog sits\.$/);
});

test('needsOf says which measurements a rule reads', () => {
  assert.deepEqual(needsOf('neon'), { cover: false, water: false, land: false, rh: false, temp: false });
  assert.ok(needsOf('firesal').cover && needsOf('firesal').rh && needsOf('firesal').temp);
  assert.ok(needsOf('toad').land && needsOf('crab').water);
  assert.deepEqual(needsOf('nobody'), {});
});

// A square tank 100 x 60 with a round pool of radius 12 at the origin and a hide at (30, 0).
const world = (x, z) => {
  if (Math.abs(x) > 50 || Math.abs(z) > 30) return null;
  const r = Math.hypot(x, z), depth = Math.max(0, 6 - r * 0.5);              // 6 cm deep in the middle, dry beyond r = 12
  const hide = Math.max(0, 1 - Math.hypot(x - 30, z) / 6);
  return { depth, waterDist: depth > 0 ? 0 : Math.max(0, r - 12), landDist: depth > 0 ? Math.max(0, 12 - r) : 0, rh: 75, temp: 20, cover: hide, wall: false };
};

test('findHabitat walks outward and returns the nearest suitable spot', () => {
  // A newt dropped in the middle of the pool is fine where it is; a salamander there must go to the cover.
  assert.equal(findHabitat('firesal', 0, 0, world, { maxR: 20 }), null, 'no hide within 20 cm of the pool centre');
  const far = findHabitat('firesal', 0, 0, world, { maxR: 40 });
  assert.ok(far && Math.hypot(far.x - 30, far.z) < 7 && far.dist >= 20, `the hide is about 26 cm away, got ${JSON.stringify(far)}`);
  const near = findHabitat('firesal', 24, 0, world, { maxR: 40 });
  assert.ok(near && Math.hypot(near.x - 30, near.z) < 7, `salamander goes to the hide, got ${JSON.stringify(near)}`);
  assert.ok(near.dist <= 14);
  // A dart frog in the pool finds the bank: the first ring that is dry (depth <= 1.2 cm means r >= 9.6).
  const f = findHabitat('dartfrog', 0, 0, world, { maxR: 40 });
  assert.ok(f && f.dist >= 9 && f.dist <= 12, JSON.stringify(f));
  // `ok` lets the caller veto spots (somebody is sitting there).
  const v = findHabitat('dartfrog', 0, 0, world, { maxR: 40, ok: (x) => x > 0 });
  assert.ok(v && v.x > 0);
  // Points outside the tank are skipped, and nothing is found when nothing fits.
  assert.equal(findHabitat('neon', 45, 0, (x, z) => (Math.abs(x) > 50 ? null : { depth: 0 }), { maxR: 20 }), null);
});

test('findHabitat is deterministic and never returns a refused spot', () => {
  for (const id of ['dartfrog', 'firesal', 'crab', 'newt', 'toad', 'gecko', 'isopod']) {
    for (const [x, z] of [[0, 0], [5, 3], [-8, 8], [20, -10]]) {
      const a = findHabitat(id, x, z, world, { maxR: 45 }), b = findHabitat(id, x, z, world, { maxR: 45 });
      assert.deepEqual(a, b);
      if (a) assert.ok(habitatCheck(id, world(a.x, a.z), { env: false }).ok, `${id} sent to a refused spot`);
    }
  }
});

test('nocturnal animals come out on dark, damp nights and after rain, and hide in the light', () => {
  const day = nightActivity(1, 0, 80, 70), night = nightActivity(0.05, 0, 80, 70), rainy = nightActivity(1, 1, 85, 70), dryNight = nightActivity(0.05, 0, 40, 70);
  assert.ok(night > 0.6 && day < 0.15, `night ${night}, day ${day}`);
  assert.ok(rainy > day + 0.3, 'rain brings them out by day');
  assert.ok(dryNight < night, 'a dry night keeps them in');
  for (let l = 0; l <= 1; l += 0.1) for (const rain of [0, 1]) for (const rh of [20, 60, 100]) { const a = nightActivity(l, rain, rh, 70); assert.ok(a >= 0 && a <= 1); }
});

test('the best place to hide is covered, shaded, damp, cool and close', () => {
  const base = { cover: 0.5, light: 0.5, rh: 70, rhIdeal: 70, temp: 20, tIdeal: 18, dist: 10 };
  const s = (o) => hideScore({ ...base, ...o });
  assert.ok(s({ cover: 1 }) > s({ cover: 0.2 }));
  assert.ok(s({ light: 0 }) > s({ light: 1 }));
  assert.ok(s({ rh: 85 }) > s({ rh: 45 }));
  assert.ok(s({ temp: 17 }) > s({ temp: 27 }));
  assert.ok(s({ dist: 2 }) > s({ dist: 40 }));
  assert.ok(zoneViolations('firesal', bank).length === 0);
});
