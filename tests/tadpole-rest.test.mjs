// B2: tadpoles rest on the floor between swim bouts (src/sim/swimrest.js, called from Animals.swim for species with `young`).
// Pure tests always run. With DUMP=<state dump .jsonl> (tools/steps/state-dump-run.mjs --mix='tadpole:6,...' --only=...) the
// resting share of the tadpole rows is checked against the target windows, and with BASE=<dump from before the change> the
// bottom-rest share of the bottom-band fish (FISH=cory,loach,... ) is compared with it. The windows are GUESSES (no project
// or published source): day 30-50 %, night 55-80 % of tadpole samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { restStep, REST_LABEL } from '../src/sim/swimrest.js';

const DAY = [0.30, 0.50], NIGHT = [0.55, 0.80];
const tad = (i) => ({ phase: i * 0.7371 + 0.11, pos: { x: 0, y: 0, z: 0 }, bh: 0.25 });
const noDanger = () => null;

// The share of time spent resting by n tadpoles over `secs` animal seconds, sampled every 10 s as the state dump does.
function share(n, secs, ctx, dt = 0.1) {
  let rest = 0, all = 0;
  for (let i = 0; i < n; i++) {
    const a = tad(i);
    for (let t = 0, k = 0; t < secs; t += dt, k++) {
      const r = restStep(a, dt, ctx);
      if (k % Math.round(10 / dt) === 0) { all++; if (r.resting) rest++; }
    }
  }
  return rest / all;
}

test('by day a tadpole rests 30-50 % of the time, by night 55-80 % (guessed windows)', () => {
  const d = share(24, 720, { night: false, hungry: false, danger: noDanger, bh: 0.25 });
  const n = share(24, 720, { night: true, hungry: false, danger: noDanger, bh: 0.25 });
  console.log(`# pure model: day ${(d * 100).toFixed(1)} %, night ${(n * 100).toFixed(1)} % of samples resting`);
  assert.ok(d >= DAY[0] && d <= DAY[1], `day ${d}`);
  assert.ok(n >= NIGHT[0] && n <= NIGHT[1], `night ${n}`);
});

test('it still has swim bouts and rest bouts of a believable length (a rest of about 7-21 s, never frozen for good)', () => {
  const a = tad(3), runs = [];
  let cur = null, len = 0;
  for (let t = 0; t < 3000; t += 0.1) {
    const r = restStep(a, 0.1, { night: false, hungry: false, danger: noDanger, bh: 0.25 });
    if (cur !== null && r.resting !== cur) { runs.push([cur, len]); len = 0; }
    cur = r.resting; len += 0.1;
  }
  runs.shift();                                    // (the first bout starts part way through)
  const rests = runs.filter(([k]) => k).map(([, l]) => l), swims = runs.filter(([k]) => !k).map(([, l]) => l);
  assert.ok(rests.length > 10 && swims.length > 10);
  assert.ok(Math.min(...rests) >= 6.5 && Math.max(...rests) <= 21.5, `rest bouts ${Math.min(...rests)}-${Math.max(...rests)}`);
  assert.ok(Math.max(...swims) <= 40, `longest swim ${Math.max(...swims)}`);
});

test('a hungry tadpole with food in the tank never rests (it still feeds)', () => {
  const a = tad(1);
  for (let t = 0; t < 600; t += 0.1) assert.equal(restStep(a, 0.1, { night: true, hungry: true, danger: noDanger, bh: 0.25 }).resting, false);
});

test('a resting tadpole wakes within 0.4 s when a threat comes near, flees away from it, and does not settle again for 3.5 s', () => {
  const a = tad(2);
  let t = 0;
  while (!restStep(a, 0.1, { night: true, hungry: false, danger: noDanger, bh: 0.25 }).resting) t += 0.1;
  const threat = () => ({ x: 2, z: 0 });
  let woke = null;
  for (let k = 0; k < 4 && !woke; k++) { const r = restStep(a, 0.1, { night: true, hungry: false, danger: threat, bh: 0.25 }); if (!r.resting) woke = r; }
  assert.ok(woke, 'still resting 0.4 s after the threat arrived');
  assert.ok(woke.flee && Math.abs(woke.flee.x + 1) < 1e-9 && Math.abs(woke.flee.z) < 1e-9, `flee ${JSON.stringify(woke.flee)}`);
  for (let k = 0; k < 35; k++) assert.equal(restStep(a, 0.1, { night: true, hungry: false, danger: noDanger, bh: 0.25 }).resting, false, `settled again after ${k / 10} s`);
});

test('it sits on the floor (body touching: rest height = half body height) and the timer never reads Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try {
    const a = tad(4);
    let y = null;
    for (let t = 0; t < 200; t += 0.1) { const r = restStep(a, 0.1, { night: false, hungry: false, danger: noDanger, bh: 0.25 }); if (r.resting) y = r.y; }
    assert.equal(y, 0.25);
    assert.equal(restStep({ phase: 0.5, pos: { x: 0, z: 0 }, bh: 0.02 }, 0.1, { night: false, hungry: false, danger: noDanger, bh: 0.02 }).y, 0.1);
  } finally { Math.random = real; }
});

test('each animal has its own seeded stream: same phase, same bouts; another phase, other bouts', () => {
  const seq = (phase) => { const a = { phase, pos: { x: 0, z: 0 } }; let s = ''; for (let t = 0; t < 400; t += 0.5) s += restStep(a, 0.5, { night: false, hungry: false, danger: noDanger, bh: 0.25 }).resting ? 'r' : 's'; return s; };
  assert.equal(seq(0.3), seq(0.3));
  assert.notEqual(seq(0.3), seq(0.9));
});

test('B3: a salamander larva uses the same rest model (restStep is species-blind): same windows, belly on the floor', () => {
  const d = share(24, 720, { night: false, hungry: false, danger: noDanger, bh: 0.4 });
  const n = share(24, 720, { night: true, hungry: false, danger: noDanger, bh: 0.4 });
  assert.ok(d >= DAY[0] && d <= DAY[1] && n >= NIGHT[0] && n <= NIGHT[1], `day ${d} night ${n}`);
  const a = { phase: 1.3, pos: { x: 0, z: 0 } };
  let r = null;
  for (let t = 0; t < 200 && !r?.resting; t += 0.1) r = restStep(a, 0.1, { night: true, hungry: false, danger: noDanger, bh: 0.4 });
  assert.ok(r.resting); assert.equal(r.y, 0.4);
});

// ---- the end-to-end check, on a state dump (see the header) -----------------------------------------------------------------
const rows = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((o) => o.sp && !o.hdr && !o.end);
const isRest = (o) => o.doing === REST_LABEL && o.speed < 0.3;
const isDay = (o) => o.hour >= 8 && o.hour < 20;

test('DUMP: tadpole rows rest 30-50 % by day and 55-80 % by night, and are not all at rest or all moving', { skip: !process.env.DUMP }, () => {
  const T = rows(process.env.DUMP).filter((o) => o.sp === 'tadpole' && o.inWater);
  const day = T.filter(isDay), night = T.filter((o) => !isDay(o));
  const sd = day.filter(isRest).length / Math.max(1, day.length), sn = night.filter(isRest).length / Math.max(1, night.length);
  console.log(`# dump: tadpole rest share day ${(sd * 100).toFixed(1)} % of ${day.length} rows, night ${(sn * 100).toFixed(1)} % of ${night.length} rows`);
  assert.ok(day.length >= 100 && night.length >= 100, `rows day ${day.length} night ${night.length}`);
  assert.ok(sd >= DAY[0] && sd <= DAY[1], `day share ${sd}`);
  assert.ok(sn >= NIGHT[0] && sn <= NIGHT[1], `night share ${sn}`);
});

test('DUMP+BASE: the bottom-band fish rest as often as before (shares, not rows) and never show the tadpole rest text', { skip: !(process.env.DUMP && process.env.BASE) }, () => {
  const fish = (process.env.FISH ?? 'cory,loach,oto,pygmy').split(',');
  for (const id of fish) {
    const A = rows(process.env.DUMP).filter((o) => o.sp === id), B = rows(process.env.BASE).filter((o) => o.sp === id);
    assert.ok(A.length > 50 && B.length > 50, `${id}: rows ${A.length} / ${B.length}`);
    assert.equal(A.filter((o) => o.doing === REST_LABEL).length, 0, `${id} shows the rest text`);
    const slow = (R) => R.filter((o) => o.speed < 0.3).length / R.length;
    const pa = slow(A), pb = slow(B), p = (pa + pb) / 2, tol = 0.05 + 3 * Math.sqrt(p * (1 - p) * (1 / A.length + 1 / B.length));
    console.log(`# ${id}: slow-sample share after ${(pa * 100).toFixed(1)} %, before ${(pb * 100).toFixed(1)} % (tolerance ${(tol * 100).toFixed(1)} points)`);
    assert.ok(Math.abs(pa - pb) <= tol, `${id} ${pa} vs ${pb}`);
  }
});
