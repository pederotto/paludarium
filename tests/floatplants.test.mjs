// Floating plants ride the water (owner, 11 Oct 2026: "water plants are floating above the water" on the live build 3752c94). The land
// frogs' rule (Gen.tuneLand) moved the main level AFTER the flora was placed (reedpool: lilies 4 cm over the water; canopypool: frogbit
// 25 cm over it) and only the Kids pond tool re-seated floaters. Plants.followWater puts every floater on the water under it (on the mud
// when dry); the generator calls it whenever it moves the level, and the sim step calls it every tick, so the pump, evaporation and old
// saves cannot leave one hanging either. sim/plants.js pulls in the renderer, so the method is read from its source and run on stubs.
// Headless check of the real sets: tools/steps/float-plants.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(new URL(`../src/sim/${f}`, import.meta.url), 'utf8');
const PLANTS_SRC = src('plants.js'), GEN_SRC = src('generator.js');

// The body of a class method `name(args) {`, up to its closing brace at two spaces.
function method(text, name) {
  const m = text.match(new RegExp(`^  ${name}\\(([^)]*)\\) \\{$`, 'm'));
  assert.ok(m, `no method ${name}`);
  const start = m.index + m[0].length, end = text.indexOf('\n  }\n', start);
  return { args: m[1], body: text.slice(start, end) };
}

// followWater bound to a stub Plants with the given plants, against a stub world.
function follower(list, PLANTS) {
  const { args, body } = method(PLANTS_SRC, 'followWater');
  const fn = new Function('PLANTS', `return function (${args}) {${body}\n};`)(PLANTS);
  const self = { list, writes: 0, writeInstance() { this.writes++; } };
  return (world) => fn.call(self, world) ?? self;
}

const PLANTS = { frogbit: { habitat: 'floating' }, lily: { habitat: 'floating' }, sword: { habitat: 'aquatic' }, cattail: { habitat: 'emergent' } };
const at = (id, x, y) => ({ id, pos: { x, y, z: 0 } });
// A tank whose main pool fills x < 0 up to `level`; x >= 0 is a bank at 20 cm.
const world = (level) => ({
  terrain: { heightAt: (x) => (x < 0 ? 4 : 20) },
  water: { surfaceAt: (x) => (x < 0 && level > 4.05 ? level : -Infinity) },
});

test('a floater placed on the old level rides the new one, up or down', () => {
  const list = [at('lily', -10, 22.09), at('frogbit', -20, 38)];
  const go = follower(list, PLANTS);
  assert.equal(go(world(17.95)), 2);
  assert.deepEqual(list.map((p) => p.pos.y), [17.95, 17.95]);
  assert.equal(go(world(25)), 2);
  assert.deepEqual(list.map((p) => p.pos.y), [25, 25]);
});

test('a stranded floater sits on the mud; rooted plants are never moved', () => {
  const list = [at('frogbit', 5, 30), at('sword', -10, 4), at('cattail', -5, 4)];
  const go = follower(list, PLANTS);
  assert.equal(go(world(12)), 1);
  assert.deepEqual(list.map((p) => p.pos.y), [20, 4, 4]);
});

test('a floater already on its water is left alone (no instance rewrite every tick)', () => {
  const list = [at('lily', -10, 17.95), at('lily', -12, 17.96)];
  assert.equal(follower(list, PLANTS)(world(17.95)), 0);
});

test('whoever moves the level re-seats the floaters: the land tuning, the settle, the sim step', () => {
  const tune = method(GEN_SRC, 'tuneLand').body;
  const last = tune.lastIndexOf('probe(best.L)');
  assert.ok(last > 0 && tune.indexOf('W.plants.onWaterChanged(W)', last) > last, 'tuneLand re-seats the floaters after its last probe');
  const settle = GEN_SRC.slice(GEN_SRC.indexOf('function settleAndPrune('), GEN_SRC.indexOf('\n}\n', GEN_SRC.indexOf('function settleAndPrune(')));
  assert.match(settle, /W\.plants\.onWaterChanged\(W\)/, 'settleAndPrune re-seats the floaters after settling the water');
  const gen = GEN_SRC.slice(GEN_SRC.indexOf('export function generateTerrarium('));
  const fin = gen.indexOf('g.tuneLand();');
  assert.ok(fin > 0 && /strandedFloater\(W, p\)/.test(gen.slice(fin, fin + 400)), 'a new set prunes floaters the final tuning left on the mud');
  assert.match(method(PLANTS_SRC, 'step').body, /this\.followWater\(world\)/, 'Plants.step keeps floaters on the water every tick');
  assert.match(method(PLANTS_SRC, 'onWaterChanged').body, /this\.followWater\(world\)/);
});
