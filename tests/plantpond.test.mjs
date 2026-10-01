// Plants read the pond they stand in, draw it down; litter rots into humus and fertility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterBodies } from '../src/sim/waterbodies.js';
import { waterCondition, plantUnits, emergentBoost } from '../src/sim/plantpond.js';
import { Humus, tempFactor, moistFactor } from '../src/sim/humus.js';
import { TANK } from '../src/sim/tank.js';

const pond = (o = {}) => ({ ammonia: 0, nitrite: 0, nitrate: 10, oxygen: 7, co2: 4, vol: 1.5, depth: 5, plantUse: 0, ...o });

test('plants judge the water of their own pond, not the mean', () => {
  const sp = { nutrients: 1 };
  const lush = waterCondition(sp, pond({ nitrate: 12 }));
  const burnt = waterCondition(sp, pond({ ammonia: 3, nitrate: 12 }));
  const suffocating = waterCondition(sp, pond({ oxygen: 1 }));
  assert.ok(lush.ok > burnt.ok * 2, `ammonia burns: ${lush.ok} vs ${burnt.ok}`);
  assert.ok(burnt.why.some((w) => /ammonia/.test(w)));
  assert.ok(suffocating.ok < lush.ok);
  assert.ok(emergentBoost(pond({ nitrate: 40 })) > emergentBoost(pond({ nitrate: 0 })));
  assert.ok(plantUnits({ grown: 1, scale: 1 }, 'floating') > plantUnits({ grown: 1, scale: 1 }, 'emergent'));
});

test('a planted pond cleans itself over days while an unplanted one stays dirty', () => {
  const B = new WaterBodies({}, {});
  const planted = pond({ nitrate: 30, ammonia: 0.4, plantUse: 4 }), bare = pond({ nitrate: 30, ammonia: 0.4, plantUse: 0 });
  for (let t = 0; t < 3 * 24 * 12; t++) for (const b of [planted, bare]) B.plantUptake(b, 5, 0.8);
  assert.ok(planted.nitrate < 8, `planted nitrate ${planted.nitrate}`);
  assert.ok(planted.ammonia < 0.05, `planted ammonia ${planted.ammonia}`);
  assert.ok(planted.co2 < 4, 'plants draw CO2 down');
  assert.equal(bare.nitrate, 30);
  assert.equal(bare.ammonia, 0.4);
  // The uptake slows in clean water: it never goes negative.
  assert.ok(planted.nitrate >= 0 && planted.co2 >= 0);
});

test('bodyFor finds the body at the plant or the nearest one its roots reach', () => {
  const B = new WaterBodies({}, {});
  const a = { name: 'Pond A' };
  B.at = (x, z) => (x > 10 && x < 20 ? a : null);
  assert.equal(B.bodyFor(15, 0), a);
  assert.equal(B.bodyFor(8, 0), null);
  assert.equal(B.bodyFor(8, 0, 4), a, 'emergent roots reach it');
  assert.equal(B.bodyFor(0, 0, 4), null);
});

// --- Humus ------------------------------------------------------------------
function fakeWorld({ T = 23, soil = 0.6, isopods = 0, springtails = 0 } = {}) {
  const cs = 3, nx = Math.ceil(TANK.w / cs), nz = Math.ceil(TANK.d / cs), n = nx * nz;
  const C = {
    cs, nx, nz, litter: new Float32Array(n), humus: new Float32Array(n), fert: new Float32Array(n),
    soil: new Float32Array(n).fill(soil), temp: new Float32Array(n).fill(T), f: { water: new Float32Array(n) },
    idx(x, z) { const i = Math.max(0, Math.min(nx - 1, Math.floor((x + TANK.w / 2) / cs))), j = Math.max(0, Math.min(nz - 1, Math.floor((z + TANK.d / 2) / cs))); return j * nx + i; },
    sample(map, x, z) { return map[this.idx(x, z)]; },
    splat() {},
  };
  const env = { detritus: 0, mold: 0, humidity: 70, fan: 0, lid: false };
  return { climate: C, env, plants: { list: [] }, terrain: { heightAt: () => 3 }, animals: { count: (id) => (id === 'isopod' ? isopods : id === 'springtail' ? springtails : 0) } };
}
const run = (w, days, drop = 0) => {
  const h = new Humus(w);
  for (let d = 0; d < days; d++) { if (drop) h.drop(0, 0, drop, false); for (let k = 0; k < 48; k++) h.process(30); }
  return { h, c: w.climate.idx(0, 0) };
};

test('litter rots faster warm and damp than cold or dry, and the crew speeds it up', () => {
  const left = (o) => { const w = fakeWorld(o); const h = new Humus(w); h.drop(0, 0, 1); h.process(30 * 24 * 2 * 3); return { L: w.climate.litter[w.climate.idx(0, 0)], H: w.climate.humus[w.climate.idx(0, 0)] }; };
  const warm = left({ T: 25, soil: 0.7 }), cold = left({ T: 10, soil: 0.7 }), dry = left({ T: 25, soil: 0.05 }), crew = left({ T: 25, soil: 0.7, isopods: 20 });
  assert.ok(warm.L < cold.L, 'cold keeps litter');
  assert.ok(warm.L < dry.L, 'dry keeps litter');
  assert.ok(crew.L < warm.L, 'isopods eat litter');
  assert.ok(warm.H > 0.1 && warm.H > cold.H, 'rot becomes humus');
  assert.ok(tempFactor(30) > tempFactor(15) && moistFactor(0.6) > moistFactor(0.1));
});

test('humus builds fertility, plants use it, and a steady supply of leaves stays bounded', () => {
  const w = fakeWorld({ T: 23, soil: 0.6 });
  const { h, c } = run(w, 60, 0.12);
  const C = w.climate;
  assert.ok(C.fert[c] > 0.1, `fertility ${C.fert[c]}`);
  assert.ok(C.litter[c] < 2 && C.humus[c] <= 1 && C.fert[c] <= 1, 'bounded');
  const f0 = h.fertilityAt(0, 0);
  h.take(0, 0, 0.05);
  assert.ok(h.fertilityAt(0, 0) < f0);
  // Fertility creeps to lower neighbours; flooded cells lose litter into detritus.
  const w2 = fakeWorld(); const h2 = new Humus(w2); const c0 = w2.climate.idx(0, 0);
  w2.climate.litter[c0] = 1; w2.climate.f.water[c0] = 1; h2.process(60);
  assert.equal(w2.climate.litter[c0], 0); assert.ok(w2.env.detritus > 0);
  // Save and load round trip.
  const o = h.serialize(), w3 = fakeWorld(), h3 = new Humus(w3);
  assert.ok(h3.load(JSON.parse(JSON.stringify(o))));
  assert.ok(Math.abs(w3.climate.fert[c] - C.fert[c]) < 0.002);
});

test('stale wet litter grows mould unless the crew eats it', () => {
  const mould = (isopods) => { const w = fakeWorld({ soil: 0.85, isopods }); w.env.humidity = 97; const h = new Humus(w); w.climate.litter.fill(1.4); for (let k = 0; k < 24 * 4; k++) { h.process(30); w.climate.litter.fill(1.4); } return w.env.mold; };
  assert.ok(mould(0) > 0.2, 'mould in stale air');
  assert.ok(mould(40) < mould(0), 'the crew keeps it down');
});
