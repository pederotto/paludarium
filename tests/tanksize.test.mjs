// Tank size in the simulation (sim/tank.js sizeFactors and roomFor, Env.stepAir): a small tank swings fast and feels one
// fogger or basking lamp far more than a big one, crowding and territories go by the floor, and the standard tank, which
// every number was tuned in, behaves exactly as it did before sizes mattered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Env, AIR, settleHours } from '../src/sim/env.js';
import { TANK, configureTank, sizeFactors, roomFor } from '../src/sim/tank.js';
import { SPEEDS } from '../src/sim/tank.js';
import { TANKS } from '../src/content/tanks.js';
import { Humus } from '../src/sim/humus.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;

// The air step exactly as sim.js had it before tank sizes (9ec917c): the reference the standard tank must still match.
function legacyAir(E, d, { light, waterFrac, falls, pump, moss, plants, closed }) {
  const f = Math.min(4, falls) * pump;
  const open = !(E.lid || closed);
  let tTarget = E.room + light * 1.3 + (open ? 0 : 0.8) - E.rain * 1.2 - E.fogger * 0.8 + E.basking * 1.5;
  if (E.heater && tTarget < E.setpoint) tTarget = E.setpoint;
  tTarget = lerp(tTarget, E.room, E.fan * 0.5);
  if (E.chill) tTarget = Math.min(tTarget, E.coolSet);
  E.temp = lerp(E.temp, tTarget, clamp(d * 0.004, 0, 1));
  let hTarget = 35 + waterFrac * 36 + f * 3.5 + E.mist * 30 + (open ? -8 : 12) + (closed ? 14 : 0) + moss * 10 + Math.min(8, plants * 0.06) + E.rain * 26 + E.fogger * 22;
  hTarget -= Math.max(0, E.temp - 24) * 1.2;
  hTarget = lerp(hTarget, E.roomHumidity, E.fan * 0.55);
  E.humidity = clamp(lerp(E.humidity, clamp(hTarget, 20, 100), clamp(d * 0.01, 0, 1)), 15, 100);
  E.mist = Math.max(0, E.mist - d / 90);
}

const CTX = { light: 1, waterFrac: 0.25, falls: 1, pump: 1, moss: 0.1, plants: 40, closed: false };
// A tank at room temperature with the lid on and everything off.
function cold() {
  const E = new Env();
  Object.assign(E, { temp: 21, humidity: 60, room: 21, roomHumidity: 50, lid: true, heater: false, setpoint: 24, fan: 0, fogger: 0, basking: 0, chill: 0, rain: 0, mist: 0 });
  return E;
}
const sizeOf = (id) => sizeFactors(TANKS[id]);
const run = (E, f, minutes, ctx = CTX, d = 1) => { for (let m = 0; m < minutes; m += d) E.stepAir(d, ctx, f); return E; };
// Game minutes to cover 90% of the way from where it is to where it settles.
function minutesTo90(E, f, key, ctx = CTX) {
  const a = E[key], b = run(Object.assign(new Env(), E), f, 30000, ctx)[key];
  for (let m = 1; m < 30000; m++) { E.stepAir(1, ctx, f); if (Math.abs(E[key] - a) >= 0.9 * Math.abs(b - a)) return m; }
  return Infinity;
}

test('size factors are 1 in the standard tank and order the tanks from jar to show', () => {
  const s = sizeOf('standard');
  for (const k of ['vol', 'area', 'wall', 'glassR', 'heat', 'air', 'push', 'spot', 'bar']) assert.equal(s[k], 1, k);
  assert.equal(Math.round(s.litres), 243);
  const cube = sizeOf('cube'), show = sizeOf('show'), jar = sizeOf('jar');
  for (const k of ['heat', 'air', 'push', 'spot']) {
    assert.ok(cube[k] > 1 && jar[k] > 1, `${k}: small tanks react more`);
    assert.ok(show[k] < 1, `${k}: the show tank reacts less`);
  }
  assert.ok(cube.area < 0.25 && show.area > 3);
  // Clamped at the extremes of the custom sizes, so nothing runs away.
  const tiny = sizeFactors({ w: 25, d: 20, h: 25 }), huge = sizeFactors({ w: 200, d: 80, h: 75 });
  assert.ok(tiny.heat <= 4 && tiny.air <= 3.2 && tiny.push <= 3 && tiny.spot <= 3 && huge.heat >= 0.3 && huge.air >= 0.35 && huge.push >= 0.7 && huge.spot >= 0.3);
  // configureTank changes the cached factors with the tank.
  configureTank(TANKS.cube);
  assert.equal(sizeFactors().area, cube.area);
  configureTank(TANKS.standard);
  assert.equal(sizeFactors().area, 1);
  assert.equal(TANK.id, 'standard');
});

test('the standard tank\'s temperature and humidity are unchanged from before tank sizes', () => {
  const f = sizeOf('standard');
  const cases = [
    { basking: 1 }, { fogger: 0.8 }, { fan: 1 }, { rain: 1 }, { mist: 1, humidity: 72 }, { heater: true, setpoint: 26 }, { chill: 1, coolSet: 19, room: 27 },
    { lid: false }, { fan: 0.5, fogger: 0.4, basking: 0.6, heater: true },
  ];
  const ctxs = [CTX, { ...CTX, closed: true, falls: 6, pump: 0.3, plants: 200, moss: 0.4 }, { ...CTX, light: 0.03, falls: 0, waterFrac: 0.6 }];
  let worst = 0;
  for (const c of cases) for (const ctx of ctxs) for (const d of [1, 5]) {
    const A = Object.assign(cold(), c), B = Object.assign(cold(), c);
    for (let m = 0; m < 3000; m += d) {
      A.stepAir(d, ctx, f); legacyAir(B, d, ctx);
      worst = Math.max(worst, Math.abs(A.temp - B.temp), Math.abs(A.humidity - B.humidity), Math.abs(A.mist - B.mist));
    }
  }
  assert.ok(worst < 1e-9, `largest difference ${worst}`);
  // The before numbers, measured on 9ec917c: lamp and basking lamp on in a 21 °C tank.
  const E = Object.assign(cold(), { basking: 1 });
  run(E, f, 120);
  assert.ok(Math.abs(E.temp - 22.3745) < 1e-3, `after two hours ${E.temp}`);
  assert.equal(minutesTo90(Object.assign(cold(), { basking: 1 }), f, 'temp'), 575);
  // Misting by hand still adds 12 points in the standard tank.
  const M = cold(); M.humidity = 62.9; M.mistNow(f);
  assert.ok(Math.abs(M.humidity - 74.9) < 1e-9 && M.mist === 1);
});

test('a cube warms faster under the lamps than a standard tank, and a standard faster than a show tank', () => {
  const rise = {}, t90 = {};
  for (const id of ['jar', 'cube', 'standard', 'show']) {
    const f = sizeOf(id);
    rise[id] = run(Object.assign(cold(), { basking: 1 }), f, 60).temp - 21;
    t90[id] = minutesTo90(Object.assign(cold(), { basking: 1 }), f, 'temp');
  }
  assert.ok(rise.cube > rise.standard * 2 && rise.standard > rise.show * 2, JSON.stringify(rise));
  assert.ok(t90.cube < t90.standard && t90.standard < t90.show, JSON.stringify(t90));
  assert.ok(t90.cube < 240 && t90.show > 1200 && t90.show < 1600, 'a cube settles in a few hours, a show tank in about a day');
  // One basking bulb overheats a jar (most frogs top out at 27 °C) and hardly warms a show tank.
  const jar = run(Object.assign(cold(), { basking: 1 }), sizeOf('jar'), 6000).temp;
  const show = run(Object.assign(cold(), { basking: 1 }), sizeOf('show'), 30000).temp;
  const std = run(Object.assign(cold(), { basking: 1 }), sizeOf('standard'), 6000).temp;
  assert.ok(jar > 27.5 && std < 25 && show < std, `jar ${jar} standard ${std} show ${show}`);
  // The heater holds its set point in any tank: a show tank just gets there later.
  for (const id of ['cube', 'show']) {
    const f = sizeOf(id), E = run(Object.assign(cold(), { heater: true, setpoint: 25, basking: 0 }), f, 6 * settleHours(f).temp * 60);
    assert.ok(Math.abs(E.temp - 25) < 0.05, `${id} reaches the set point: ${E.temp}`);
  }
});

test('humidity after misting and under a fogger moves faster and further in a small tank', () => {
  const jump = {}, fog = {}, fogLift = {};
  for (const id of ['cube', 'standard', 'show']) {
    const f = sizeOf(id);
    const E = run(cold(), f, 6000, { ...CTX, falls: 0, plants: 0 });
    const h0 = E.humidity;
    E.mistNow(f);
    run(E, f, 30, { ...CTX, falls: 0, plants: 0 });
    jump[id] = E.humidity - h0;
    const F = run(cold(), f, 6000, { ...CTX, falls: 0, plants: 0 }), a = F.humidity;
    F.fogger = 0.6;
    fog[id] = minutesTo90(F, f, 'humidity', { ...CTX, falls: 0, plants: 0 });
    fogLift[id] = run(F, f, 30000, { ...CTX, falls: 0, plants: 0 }).humidity - a;
  }
  assert.ok(jump.cube > jump.standard && jump.standard > jump.show, JSON.stringify(jump));
  assert.ok(fog.cube < fog.standard && fog.standard < fog.show, JSON.stringify(fog));
  assert.ok(fogLift.cube > fogLift.standard && fogLift.standard > fogLift.show, JSON.stringify(fogLift));
  // Waterfalls and plants count by how close together they are: one fall wets a cube's air more than a show tank's.
  const one = (id) => run(cold(), sizeOf(id), 6000, { ...CTX, falls: 1, plants: 20 }).humidity;
  assert.ok(one('cube') > one('standard') && one('standard') > one('show'));
});

test('no NaN and nothing out of range at 60x speed in a jar, a cube, a show tank and the custom extremes', () => {
  assert.equal(Math.max(...SPEEDS), 60);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (const t of [TANKS.jar, TANKS.cube, TANKS.show, { w: 25, d: 20, h: 25, closed: true }, { w: 200, d: 80, h: 75 }]) {
    const f = sizeFactors(t), E = cold();
    // 30 game days at 60x: frames of 1 to 10 game minutes, cut into steps of at most 5 like Sim.step.
    for (let m = 0; m < 30 * 1440;) {
      if (rnd() < 0.01) Object.assign(E, { basking: rnd() < 0.5 ? 1 : 0, fogger: rnd() < 0.5 ? 0.8 : 0, fan: rnd() < 0.3 ? 1 : 0, heater: rnd() < 0.7, rain: rnd() < 0.1 ? 1 : 0, lid: rnd() < 0.8 });
      if (rnd() < 0.005) E.mistNow(f);
      let frame = 1 + rnd() * 9;
      m += frame;
      while (frame > 0) { const d = Math.min(5, frame); frame -= d; E.stepAir(d, { ...CTX, closed: !!t.closed, light: (m % 1440) > 480 && (m % 1440) < 1200 ? 1 : 0.03 }, f); }
      assert.ok(Number.isFinite(E.temp) && Number.isFinite(E.humidity) && Number.isFinite(E.mist), `${t.w}: finite at ${m}`);
      assert.ok(E.temp > 10 && E.temp < 40 && E.humidity >= 15 && E.humidity <= 100, `${t.w}: ${E.temp} ${E.humidity}`);
    }
    // The largest share of the gap closed in one 5-minute step stays well under 1, so a step never overshoots.
    assert.ok(5 * AIR.temp * f.heat < 0.2 && 5 * AIR.humidity * f.air < 0.2);
  }
});

test('settle times for the panels follow the size', () => {
  const s = settleHours(sizeOf('standard'));
  assert.ok(Math.abs(s.temp - 9.6) < 0.05 && Math.abs(s.humidity - 3.84) < 0.05, JSON.stringify(s));
  assert.ok(settleHours(sizeOf('cube')).temp < 3 && settleHours(sizeOf('show')).temp > 20);
});

test('room for a species goes by the floor (or the water for swimmers): three dart frogs crowd a cube, not a show tank', () => {
  const dart = { kind: 'frog', cap: 8 }, neon = { kind: 'swim', cap: 60, flock: [10, 80] }, gecko = { kind: 'gecko', cap: 10 };
  const std = roomFor(dart, sizeOf('standard'));
  assert.deepEqual([std.cap, std.most, std.crowd, std.territories], [8, null, 12, 1], 'the keeper\'s sheet is the standard tank');
  assert.equal(roomFor(neon, sizeOf('standard')).most, 80);
  const cube = roomFor(dart, sizeOf('cube')), show = roomFor(dart, sizeOf('show'));
  assert.ok(cube.crowd < 4 && cube.cap >= 2, JSON.stringify(cube));
  assert.ok(show.crowd > 30 && show.cap <= 28 && show.territories === 3, JSON.stringify(show));
  // A schooling fish never gets a limit below the school it needs; geckos count the background, so a tall tank suits them.
  assert.ok(roomFor(neon, sizeOf('cube')).most >= 10 && roomFor(neon, sizeOf('cube')).cap >= 10);
  assert.equal(roomFor(gecko, sizeOf('tall')).cap, 10);
  assert.ok(roomFor(dart, sizeOf('tall')).cap < 8);
});

test('the clean-up crew works the floor: the same isopods clear a cube\'s litter faster than a show tank\'s', () => {
  const left = {};
  for (const id of ['cube', 'standard', 'show']) {
    configureTank(TANKS[id]);
    const n = 16, C = {
      nx: 4, nz: 4, cs: 3, litter: new Float32Array(n).fill(1), humus: new Float32Array(n), fert: new Float32Array(n),
      soil: new Float32Array(n).fill(0.6), temp: new Float32Array(n).fill(22), f: { water: new Float32Array(n) },
      idx: () => 0, sample: (m) => m[0],
    };
    const world = { climate: C, env: { humidity: 70, fan: 0, lid: true, mold: 0, detritus: 0 }, animals: { count: (sp) => (sp === 'isopod' ? 20 : 0) }, terrain: null, plants: { list: [] } };
    new Humus(world).process(1440 * 3);
    left[id] = C.litter[0];
  }
  configureTank(TANKS.standard);
  assert.ok(left.cube < left.standard && left.standard < left.show, JSON.stringify(left));
});
