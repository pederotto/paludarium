// The simulation's seeded stream (util/rng.js): the same seed gives the same numbers, and the simulation draws only from it (a stray
// Math.random in src/sim makes two runs of the same tank part; tools/steps/replay.mjs checks the whole game end to end).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rand, seedRng, rngSeed, rngState, setRngState, simClock, simNow } from '../src/util/rng.js';

test('the same seed gives the same stream; another seed another', () => {
  seedRng(777); const a = Array.from({ length: 1000 }, rand);
  seedRng(777); const b = Array.from({ length: 1000 }, rand);
  seedRng(778); const c = Array.from({ length: 1000 }, rand);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(rngSeed(), 778);
  for (const x of a) assert.ok(x >= 0 && x < 1);
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
});

test('the state can be saved and restored mid-stream', () => {
  seedRng(5); rand(); rand();
  const st = rngState(), next = [rand(), rand(), rand()];
  setRngState(st);
  assert.deepEqual([rand(), rand(), rand()], next);
});

test('a replay runs the throttles on the simulation clock; normal play on the wall clock', () => {
  seedRng(1, true); simClock.ms = 1234;
  assert.equal(simNow(), 1234);
  seedRng(1, false);
  assert.notEqual(simNow(), 1234);
});

test('the simulation draws only from the seeded stream (no Math.random in src/sim)', () => {
  const dir = fileURLToPath(new URL('../src/sim/', import.meta.url));
  const bad = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    src.forEach((l, i) => { if (/Math\.random/.test(l) && !/drawing only/.test(l)) bad.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});

test('animals are numbered per tank, not across tanks (a module-wide counter made a second tank replay differently)', () => {
  const src = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^let nextId/m);
  assert.match(src, /this\.nextId/);
});
