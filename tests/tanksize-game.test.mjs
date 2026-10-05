// Tank size in the game: gear sized for the tank, running costs, the career's resizing and bills, stocking advice from the
// simulation's own room per species, commission fit and what visitors make of a tank. The standard tank is the reference:
// its prices, costs and rewards are the old ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TANKS, TANK_ORDER } from '../src/content/tanks.js';
import { GEAR } from '../src/content/equipment.js';
import { gearPrice, gearScale, upsizeCost, runningCosts, foodPerDay, DEFAULT_RUN_SETTINGS, GEAR_SIZING } from '../src/content/upkeep.js';
import { Career } from '../src/game/career.js';
import { stockAdvice, crowding, canHold, speciesTarget, sizeClass, mindsCrowd } from '../src/game/stocking.js';
import { visitorAppeal } from '../src/game/appeal.js';
import { sizeFactors, roomFor } from '../src/sim/tank.js';

const T = TANKS;
const f = (id) => sizeFactors(T[id]);

// Species records as sim/animals.js has them (the fields stocking reads), so this runs without three.js.
const SP = {
  neon: { name: 'Neon tetra', kind: 'swim', cap: 60, group: 'Fish', eats: ['flake'] },
  dartfrog: { name: 'Blue dart frog', kind: 'frog', cap: 8, group: 'Amphibians', eats: ['fly'] },
  gecko: { name: 'Mourning gecko', kind: 'gecko', cap: 10, minH: 40, group: 'Reptiles', eats: ['fly'] },
  axolotl: { name: 'Axolotl', kind: 'axolotl', cap: 8, minL: 80, group: 'Amphibians', eats: ['flake'] },
  shrimp: { name: 'Cherry shrimp', kind: 'crawlWater', cap: 80, flock: [10, 80], group: 'Crustaceans', eats: ['detritus', 'biofilm', 'flake'] },
  skink: { name: 'Red-eyed crocodile skink', kind: 'skink', cap: 2, minL: 100, flock: [1, 2], territorial: true, group: 'Reptiles', eats: ['isopod'] },
  springtail: { name: 'Springtails', kind: 'crawlLand', cap: 160, crew: 0.25, group: 'Insects', eats: ['detritus'] },
  cricket: { name: 'Crickets', kind: 'crawlLand', cap: 40, feeder: true, group: 'Insects', eats: ['detritus'] },
};

test('gear costs its list price in the standard tank, more in bigger tanks and less in smaller ones', () => {
  for (const id of Object.keys(GEAR)) assert.equal(gearPrice(id, T.standard), GEAR[id].price >= 20 ? Math.round(GEAR[id].price / 5) * 5 : GEAR[id].price, id);
  for (const id of Object.keys(GEAR_SIZING)) {
    if (!GEAR[id].price) continue;
    assert.ok(gearPrice(id, T.show) > gearPrice(id, T.standard), `${id}: show tank dearer`);
    assert.ok(gearPrice(id, T.cube) < gearPrice(id, T.standard), `${id}: cube cheaper`);
  }
  // Instruments and the controller are the same in any tank.
  for (const id of ['testKit', 'logger', 'controller', 'autofeeder', 'basking']) assert.equal(gearPrice(id, T.show), gearPrice(id, T.jar), id);
  assert.equal(gearScale('filterCanister', T.standard), 1);
  assert.equal(upsizeCost('filterCanister', T.show, T.cube), 0, 'never a refund or a charge for going smaller');
  assert.equal(upsizeCost('filterCanister', T.standard, T.show), gearPrice('filterCanister', T.show) - 150);
});

test('running costs: about ¤5 a day for the standard tank, a fraction of that for a jar, about three times for the show tank', () => {
  const has = (id) => GEAR[id]?.owned;
  const run = (id, o = {}) => runningCosts(T[id], DEFAULT_RUN_SETTINGS, has, { water: 19, pump: true, ...o });
  const std = run('standard');
  assert.ok(std.total > 3.5 && std.total < 5.5, `standard ${std.total}`);
  assert.deepEqual(std.parts.map((p) => p[0]).slice(0, 3), ['Lights', 'Heater', 'Pump and filter']);
  assert.ok(run('jar', { water: 0.1, pump: false }).total < std.total / 3, 'jar');
  assert.ok(run('show', { water: 300 }).total > std.total * 2.3, 'show');
  // Settings change the bill: the heater off, the lights shorter.
  const cold = runningCosts(T.standard, { ...DEFAULT_RUN_SETTINGS, heater: false }, has, { water: 19, pump: true });
  assert.ok(!cold.parts.some((p) => p[0] === 'Heater'));
  const short = runningCosts(T.standard, { ...DEFAULT_RUN_SETTINGS, photoperiod: 6 }, has, { water: 19, pump: true });
  assert.ok(short.total < std.total);
  // Food: live-food eaters cost most; the crew and feeders nothing.
  assert.ok(foodPerDay(SP.dartfrog) > foodPerDay(SP.neon));
  assert.equal(foodPerDay(SP.springtail), 0);
  assert.equal(foodPerDay(SP.cricket), 0);
  const fed = runningCosts(T.standard, DEFAULT_RUN_SETTINGS, has, { water: 19, pump: true, animals: [[SP.dartfrog, 4], [SP.neon, 12]] });
  assert.ok(fed.parts.some((p) => p[0] === 'Food' && Math.abs(p[1] - 0.32) < 0.01));
});

test('the career sizes gear for its biggest tank and resizes what it owns when it buys a bigger one', () => {
  const c = new Career();
  c.funds = 1e6; c.rep = 1e6;                       // every rank
  assert.equal(c.gearTank(), 'jar');
  assert.equal(c.info('gear', 'filterCanister').price, gearPrice('filterCanister', T.jar));
  assert.equal(c.buy('gear', 'filterCanister'), null);
  assert.equal(c.gearFor.filterCanister, 'jar');
  // A bigger tank costs its price plus resizing the canister.
  const info = c.info('tank', 'standard');
  assert.equal(info.upsize, 150 - gearPrice('filterCanister', T.jar));
  assert.equal(info.price, T.standard.price + info.upsize);
  const before = c.funds;
  assert.equal(c.buy('tank', 'standard'), null);
  assert.equal(before - c.funds, info.price);
  assert.equal(c.gearFor.filterCanister, 'standard');
  // A smaller tank resizes nothing, and new gear is priced for the standard tank now.
  assert.equal(c.info('tank', 'cube').upsize, 0);
  assert.equal(c.info('gear', 'fogger').price, 95);
  // Not enough funds: the message says what the price is made of.
  const poor = Career.load(c.serialize()); poor.funds = 10;
  assert.match(poor.buy('tank', 'show'), /to resize your gear/);
});

test('a save from before sized gear loads without charging again', () => {
  const old = { mode: 'career', funds: 500, rep: 5000, gear: ['filterCanister', 'ledPro'], tanks: ['jar', 'standard'] };
  const c = Career.load(old);
  assert.equal(c.gearFor.filterCanister, 'standard');
  assert.equal(c.upsize('standard').total, 0);
  assert.ok(c.upsize('show').total > 0);
});

test('bills: whole coins as they add up, never below zero, a weekly line in the journal, nothing in the sandbox', () => {
  const c = new Career();
  const f0 = c.funds;
  assert.equal(c.payBills(0.1, 4.8, [['Lights', 2]], 1), 0, 'under a coin owed: nothing paid yet');
  assert.equal(c.payBills(1, 4.8, [['Lights', 2]], 2), 5);
  assert.equal(f0 - c.funds, 5);
  assert.equal(c.stats.billsPaid, 5);
  c.payBills(6, 4.8, [['Lights', 2], ['Heater', 1.2]], 8);
  assert.match(c.journal[0].text, /Running costs, days 1–7: ¤\d+ \(lights/);
  c.funds = 3;
  c.payBills(10, 4.8, [], 9);
  assert.equal(c.funds, 0, 'an unpaid bill is forgiven');
  const s = new Career({ mode: 'sandbox' });
  assert.equal(s.payBills(5, 4.8), 0);
  assert.equal(s.funds, 0);
});

test('stocking advice uses the simulation\'s own room: three dart frogs fill a cube, twelve fit the standard tank', () => {
  assert.equal(stockAdvice('dartfrog', SP.dartfrog, 0, f('cube')).room, roomFor(SP.dartfrog, f('cube')).crowd);
  assert.equal(stockAdvice('dartfrog', SP.dartfrog, 0, f('standard')).room, 12);
  assert.ok(stockAdvice('dartfrog', SP.dartfrog, 0, f('show')).room > 30);
  assert.equal(stockAdvice('dartfrog', SP.dartfrog, 2, f('standard')).verdict, 'ok');
  assert.equal(stockAdvice('dartfrog', SP.dartfrog, 3, f('cube')).verdict, 'full');
  assert.equal(stockAdvice('dartfrog', SP.dartfrog, 5, f('cube')).verdict, 'over');
  // Too small or too low for the keeper's sheet (the same tolerances as Sim.tankRules).
  assert.equal(stockAdvice('axolotl', SP.axolotl, 0, f('cube')).verdict, 'small');
  assert.equal(stockAdvice('axolotl', SP.axolotl, 0, f('nano')).verdict, 'ok');
  assert.equal(stockAdvice('gecko', SP.gecko, 0, f('cube')).verdict, 'small');
  // A swimmer needs water; a colony wants its group; the crew and feeders never crowd.
  assert.equal(stockAdvice('neon', SP.neon, 0, f('standard'), { water: 0 }).verdict, 'small');
  assert.equal(stockAdvice('shrimp', SP.shrimp, 4, f('standard'), { water: 19 }).verdict, 'lonely');
  assert.equal(stockAdvice('springtail', SP.springtail, 300, f('jar')).verdict, 'free');
  assert.equal(stockAdvice('cricket', SP.cricket, 50, f('jar')).verdict, 'free');
  assert.ok(!mindsCrowd('springtail', SP.springtail) && mindsCrowd('shrimp', SP.shrimp) && mindsCrowd('neon', SP.neon));
  // Territorial males: room for more of them on a bigger floor.
  assert.equal(stockAdvice('skink', SP.skink, 1, f('standard')).territories, 1);
  assert.ok(stockAdvice('skink', SP.skink, 1, f('show')).territories >= 3);
});

test('crowding lists who is over their room in this tank, and the standard starter\'s stock is not', () => {
  const starter = { neon: 12, shrimp: 12, dartfrog: 2, gecko: 2, springtail: 40 };
  assert.deepEqual(crowding(starter, SP, f('standard')).over, []);
  const cube = crowding({ dartfrog: 6, neon: 4 }, SP, f('cube'));
  assert.deepEqual(cube.over.map((o) => o.id), ['dartfrog']);
  assert.ok(cube.worst > 1);
});

test('commission fit: what a tank of each size can hold', () => {
  assert.equal(canHold(T.standard, [{ id: 'dartfrog', n: 2 }], SP).ok, true);
  assert.equal(canHold(T.cube, [{ id: 'dartfrog', n: 6 }], SP).ok, false);
  assert.match(canHold(T.cube, [{ id: 'axolotl', n: 2 }], SP).why[0], /80 L or more/);
  assert.equal(canHold(T.show, [{ minL: 400 }], SP).ok, true);
  assert.equal(canHold(T.standard, [{ minL: 400 }], SP).ok, false);
  assert.equal(canHold(T.nano, [{ maxL: 120 }], SP).ok, true);
  assert.equal(canHold(T.grand, [{ maxL: 120 }], SP).ok, false);
});

test('the Curator asks for about 8 species in the standard tank, fewer in small tanks and more in big ones', () => {
  assert.equal(speciesTarget(f('standard')), 8);
  assert.ok(speciesTarget(f('jar')) <= 4 && speciesTarget(f('cube')) <= 4);
  assert.equal(speciesTarget(f('show')), 12);
  let last = 0;
  for (const id of TANK_ORDER) { const t = speciesTarget(f(id)); assert.ok(t >= 3 && t <= 12); if (id !== 'tall' && id !== 'long') { assert.ok(t >= last, id); last = t; } }
  assert.equal(sizeClass(T.jar.w * T.jar.d * T.jar.h / 1000), 'small');
  assert.equal(sizeClass(243), 'medium');
  assert.equal(sizeClass(1134), 'large');
});

test('visitors: the standard tank at a B pays the old reward, a perfect small tank and a big varied one pay more', () => {
  const base = { funds: 20, rep: 25 };
  assert.deepEqual([visitorAppeal(base, { litres: 243, grade: 'B', species: 8, target: 8 }).funds, visitorAppeal(base, { litres: 243, grade: 'B', species: 8, target: 8 }).rep], [20, 25]);
  const jarA = visitorAppeal(base, { litres: 34, grade: 'A', species: 4, target: 4 });
  const jarC = visitorAppeal(base, { litres: 34, grade: 'C', species: 4, target: 4 });
  const showB = visitorAppeal(base, { litres: 1134, grade: 'B', species: 12, target: 12 });
  assert.ok(jarA.funds > 20 && jarC.funds < 20, `${jarA.funds} ${jarC.funds}`);
  assert.ok(showB.funds > jarA.funds);
  assert.match(jarA.text, /little tank/);
});

test('bills: a new tank with its own clock starts a new week instead of waiting for the old day count', () => {
  const c = new Career();
  c.payBills(1, 5, [['Lights', 2]], 40);
  c.payBills(1, 5, [['Lights', 2]], 2);
  assert.equal(c.bills.since, 2);
  c.payBills(7, 5, [['Lights', 2]], 9);
  assert.match(c.journal[0].text, /Running costs, days 2–8/);
});
