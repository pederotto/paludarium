// The flowering cycle (src/sim/bloom.js): stage order and timing over simulated days, what stops a plant flowering, bud blast,
// the daily opening, the look of each stage, and the save round trip (old saves start afresh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, cycleOf, newBloom, stepBloom, bloomLook, bloomBlock, dayOpen, packBloom, unpackBloom, MATURE } from '../src/sim/bloom.js';
import { rng } from '../src/util/math.js';

// A throwaway flowering species (the real ones live in sim/plants.js and sim/flowering.js).
const STUB = {
  palettes: [[0xffffff, 0xff0000, 0xffff00], [0xff00ff, 0x00ff00, 0xffffff]],
  daily: 'day',
  cycle: { budDays: 4, openDays: 3, fadeDays: 2, restDays: 10, season: 'wet', minLight: 0.5, minHumidity: 70 },
  after: 'keiki',
};
const GOOD = { light: 0.9, humidity: 85, season: 'wet', health: 1, grown: 1 };

// Run `days` in steps of `dt` days; returns the transitions [day, event, stage].
function run(b, days, cond, dt = 0.05, seed = 3) {
  const r = rng(seed), cyc = cycleOf(STUB), log = [];
  for (let d = 0; d < days; d += dt) {
    const c = typeof cond === 'function' ? cond(d) : cond;
    const ev = stepBloom(b, cyc, c, dt, r);
    if (ev) log.push([+d.toFixed(2), ev, b.stage]);
  }
  return log;
}
const fresh = () => ({ stage: 'rest', t: 0, palette: 0, j: 0.5, k: 1 });

test('a healthy, mature plant cycles rest → bud → open → fade → (drop) → rest at the species pace', () => {
  const b = fresh();
  const log = run(b, 60, GOOD);
  const evs = log.map((e) => e[1]);
  assert.deepEqual(evs.slice(0, 8), ['bud', 'open', 'fade', 'drop', 'bud', 'open', 'fade', 'drop']);
  // first cycle at k = 1: bud after the 10 rest days, open 4 later, fade 3 later, petals drop 2 later
  const at = Object.fromEntries(log.slice(0, 4).map(([d, e]) => [e, d]));
  assert.ok(Math.abs(at.bud - 10) < 0.2 && Math.abs(at.open - 14) < 0.2 && Math.abs(at.fade - 17) < 0.2 && Math.abs(at.drop - 19) < 0.2, JSON.stringify(at));
  // later cycles get a length factor of 0.8 … 1.25, so neighbours drift apart
  assert.ok(b.k >= 0.8 && b.k <= 1.25);
  assert.equal(log.length >= 8 && log.length <= 14, true, 'two to three cycles in 60 days');
});

test('conditions that stop a plant setting buds', () => {
  for (const [what, c] of [
    ['young', { ...GOOD, grown: MATURE - 0.1 }], ['weak', { ...GOOD, health: 0.5 }], ['dark', { ...GOOD, light: 0.3 }],
    ['dry air', { ...GOOD, humidity: 50 }], ['dry season', { ...GOOD, season: 'dry' }],
  ]) {
    const b = fresh();
    const log = run(b, 40, c);
    assert.equal(log.length, 0, `${what}: no bud in 40 days`);
    assert.equal(b.stage, 'rest');
    assert.ok(bloomBlock(cycleOf(STUB), c), `${what} has a reason`);
  }
  // water plants are not asked about the air; 'any' season flowers in either
  assert.equal(bloomBlock(cycleOf({ cycle: { season: 'any', minHumidity: 90 } }), { ...GOOD, humidity: null, season: 'dry' }), null);
});

test('a bud stalls in poor light and withers if the plant sickens (bud blast); a weak plant drops its flowers sooner', () => {
  const cyc = cycleOf(STUB);
  const b = { ...fresh(), stage: 'bud', t: 0 };
  stepBloom(b, cyc, { ...GOOD, light: 0.2 }, 1);
  assert.ok(Math.abs(b.t - 0.25 / 4) < 1e-9, 'stalled bud grows at a quarter of the pace');
  assert.equal(stepBloom(b, cyc, { ...GOOD, health: 0.3 }, 0.01), 'blast');
  assert.equal(b.stage, 'rest');
  const o1 = { ...fresh(), stage: 'open' }, o2 = { ...fresh(), stage: 'open' };
  stepBloom(o1, cyc, GOOD, 1); stepBloom(o2, cyc, { ...GOOD, health: 0.45 }, 1);
  assert.ok(o2.t > o1.t * 1.9);
});

test('what each stage looks like', () => {
  assert.equal(bloomLook({ stage: 'rest', t: 0.5 }).show, false);
  const b0 = bloomLook({ stage: 'bud', t: 0 }), b1 = bloomLook({ stage: 'bud', t: 0.99 });
  assert.ok(b0.show && b0.scale < b1.scale && b0.green > 0.9 && b1.green < 0.05 && b0.open === 0, 'a bud swells and colours');
  const o = bloomLook({ stage: 'open', t: 0.5 });
  assert.ok(o.open === 1 && o.fade === 0 && o.petals === 1 && Math.abs(o.scale - 1) < 1e-9);
  const f0 = bloomLook({ stage: 'fade', t: 0.3 }), f1 = bloomLook({ stage: 'fade', t: 1 });
  assert.ok(f0.fade > 0 && f0.petals === 1 && f1.fade === 1 && f1.petals === 0, 'fades, then the petals drop');
  for (const s of STAGES) for (let t = 0; t <= 1; t += 0.1) {
    const l = bloomLook({ stage: s, t });
    for (const k of ['open', 'green', 'fade', 'petals', 'scale']) assert.ok(l[k] >= 0 && l[k] <= 1, `${s} ${t} ${k}`);
  }
});

test('day flowers open over an hour after the lamp comes on and shut over an hour before it goes off', () => {
  const env = { lights: 'auto', lightsOn: 480, lightsOff: 1200 };
  assert.equal(dayOpen(0, env), 0);
  assert.equal(dayOpen(480, env), 0);
  assert.ok(dayOpen(540, env) > 0.4 && dayOpen(540, env) < 0.6);
  assert.equal(dayOpen(720, env), 1);
  assert.equal(dayOpen(1200 - 20, env), 0);
  assert.equal(dayOpen(23 * 60, env), 0);
  // smooth: no jump bigger than a minute's worth of a one-hour ramp
  for (let m = 0; m < 1440; m++) assert.ok(Math.abs(dayOpen(m + 1, env) - dayOpen(m, env)) < 0.03);
  // a schedule over midnight, and the lamp left on or off
  assert.equal(dayOpen(2 * 60, { lights: 'auto', lightsOn: 20 * 60, lightsOff: 8 * 60 }), 1);
  assert.equal(dayOpen(600, { lights: 'on' }), 1);
  assert.equal(dayOpen(600, { lights: 'off' }), 0);
});

test('new plants: mature ones arrive in flower or bud, young ones rest; save and load round trip; old saves start afresh', () => {
  const r = rng(11);
  let open = 0;
  for (let i = 0; i < 200; i++) {
    const b = newBloom(STUB, 1, r);
    if (b.stage === 'open') open++;
    assert.ok(b.palette >= 0 && b.palette < STUB.palettes.length);
    assert.equal(newBloom(STUB, 0.3, r).stage, 'rest');
  }
  assert.ok(open > 90 && open < 150, 'most mature plants arrive in flower: ' + open);
  const b = { stage: 'fade', t: 0.4567, palette: 1, j: 0.12345, k: 1.1 };
  const back = unpackBloom(JSON.parse(JSON.stringify(packBloom(b))), STUB);
  assert.equal(back.stage, 'fade');
  assert.ok(Math.abs(back.t - b.t) < 1e-3 && Math.abs(back.j - b.j) < 1e-3);
  assert.equal(back.palette, 1);
  assert.equal(unpackBloom(undefined, STUB), null);
  assert.equal(unpackBloom([9, 0, 0, 0], STUB), null);
  assert.equal(unpackBloom([1, 0.5, 7, 0.5], STUB).palette, 1, 'a palette index past the species list is clamped');
});
