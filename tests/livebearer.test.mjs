// Livebearers (sim/livebearer.js): the guppy's sexes, pregnancy, broods of fry, stored sperm and the look each fish is drawn with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initLivebearer, livebearerStep, livebearerText } from '../src/sim/livebearer.js';
import { genotypeForMorph, morphOf, makeRng } from '../src/sim/genetics.js';
import { guppyLook, parseGuppyLook } from '../src/content/guppy.js';

const SP = { name: 'Guppy', adultDays: 8, breed: 0.06, livebearer: { gestDays: 3, brood: [3, 8], store: 3, growFrom: 0.2, maleK: 2.2 / 3.2 } };
const DAY = 1440;
const fish = (morph, o = {}) => { const genes = genotypeForMorph('guppy', morph, makeRng(o.seed ?? 1), { female: o.female !== false }); return { id: o.id ?? 1, sp: 'guppy', genes, morph: morphOf('guppy', genes), age: o.age ?? 30 * DAY, pos: { clone: () => ({}) }, hunger: 0.2, ...o }; };
const world = (all, mates = new Map()) => ({ animals: { by: { guppy: all }, mateOf: (a) => mates.get(a) ?? null } });

test('founders come as trios (a male to two females), fry are about half and half', () => {
  const tank = [];
  for (let i = 0; i < 9; i++) { const a = { id: i, sp: 'guppy', age: 30 * DAY, morph: 'red' }; a.female = undefined; initLivebearer(a, SP, {}, tank); tank.push(a); }
  assert.equal(tank.filter((a) => a.female === false).length, 3);
  const rng = Math.random; let f = 0;
  for (let i = 0; i < 2000; i++) { const a = { id: i, sp: 'guppy', age: 0, morph: 'red' }; initLivebearer(a, SP, { age: 0 }, []); f += a.female ? 1 : 0; }
  assert.ok(f > 900 && f < 1100, `${f} of 2000 fry female`);
  void rng;
});

test('a female carries a brood for its gestation and drops several fry fathered by the male she met', () => {
  const male = fish('blue', { id: 2, female: false }), female = fish('red', { id: 3, female: true });
  for (const a of [male, female]) initLivebearer(a, SP, { female: a.female }, []);
  const W = world([male, female]);
  const births = [];
  let day = 0;
  while (!female.gv && day < 400) { livebearerStep(W, female, SP, DAY, true, 1, births); day++; }
  assert.ok(female.gv, 'she conceives');
  assert.equal(female.gv.sire.id, 2);
  assert.match(female.look, /gravid/);
  assert.equal(births.length, 0);
  let line = null;
  for (let d = 0; d < 5 && !line; d++) line = livebearerStep(W, female, SP, DAY, true, 1, births);
  assert.match(line, /gave birth to \d+ fry/);
  assert.ok(births.length >= 3 && births.length <= 8, `${births.length} fry`);
  assert.ok(births.every((b) => b.pa === female && b.pb.id === 2 && b.brood));
  assert.ok(!female.gv && !/gravid/.test(female.look));
});

test('she keeps the sperm for three more broods: no male needed, and the father stays the same', () => {
  const female = fish('red', { id: 3, female: true, sperm: { id: 9, genes: genotypeForMorph('guppy', 'blue', makeRng(2), { female: false }), gen: 0, n: 3 }, mated: true });
  initLivebearer(female, SP, { female: true }, []);
  const W = world([female]);
  let broods = 0;
  for (let d = 0; d < 3000 && broods < 5; d++) {
    const births = [];
    livebearerStep(W, female, SP, DAY, true, 1, births);
    if (births.length) { broods++; assert.equal(births[0].pb.id, 9); }
  }
  assert.equal(broods, 3, 'three broods from the store, then none');
  assert.match(livebearerText(female, SP), /stored sperm is used up/);
});

test('a ribbon male cannot sire: a female with only him stays empty', () => {
  const male = fish('red_ribbon', { id: 2, female: false }), female = fish('red', { id: 3, female: true });
  for (const a of [male, female]) initLivebearer(a, { ...SP, livebearer: { ...SP.livebearer, fertile: (g) => !g[21].includes('I') } }, {}, []);
  const S2 = { ...SP, livebearer: { ...SP.livebearer, fertile: (g) => !g[21].includes('I') } };
  for (let d = 0; d < 400; d++) livebearerStep(world([male, female]), female, S2, DAY, true, 1, []);
  assert.ok(!female.gv && !female.mated);
});

test('a virgin female says so; a young fish is drawn plain until it matures; males colour up', () => {
  const v = fish('red', { female: true }); initLivebearer(v, SP, { female: true }, []);
  assert.match(livebearerText(v, SP), /virgin/);
  const young = fish('tuxedo_blue_mosaic', { female: false, age: 2 * DAY }); initLivebearer(young, SP, { female: false }, []);
  assert.equal(young.look, 'juv');
  assert.ok(young.sizeK < young.sk0, 'a young male is drawn on the female body, scaled to a male');
  young.age = 9 * DAY; livebearerStep(world([young]), young, SP, 1, false, 0, []);
  assert.equal(young.look, young.morph);
  assert.equal(young.sizeK, young.sk0);
});

test('looks: a female shows ground, colour, half-black and big ears, never swords, mosaic or Moscow', () => {
  assert.equal(guppyLook('moscow_platinum_tuxedo_blue_tiger_doublesword_dumbo', { female: true }), 'female_tuxedo_blue_round_dumbo');
  assert.equal(guppyLook('albino_red', { female: true, gravid: true }), 'female_albino_red_gravid');
  assert.equal(guppyLook('gold_red', { adult: false }), 'juv_gold');
  for (const k of ['female_tuxedo_blue_round_dumbo', 'female_albino_red_gravid', 'juv_gold', 'red', 'albino_red_dumbo']) assert.ok(parseGuppyLook(k), k);
  assert.equal(parseGuppyLook('female_red_mosaic'), null);
  assert.equal(parseGuppyLook('albino_tuxedo_red'), null);
});

test('stored sperm is not the strike field: Animals.move skips an animal with a.st, and a mated female must keep swimming', () => {
  const female = fish('red', { id: 4, female: true, mated: false });
  initLivebearer(female, SP, { female: true }, []);
  const male = fish('blue', { id: 5, female: false });
  initLivebearer(male, SP, { female: false }, []);
  const W = world([female, male]);
  for (let d = 0; d < 3000 && !female.mated; d++) livebearerStep(W, female, SP, DAY, true, 1, []);
  assert.ok(female.mated && female.sperm, 'she mated and stores sperm');
  assert.equal(female.st, undefined, 'a.st stays free for strikes');
});
