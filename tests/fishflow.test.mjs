// Fish in moving water (B5a): the water carries a fish, its own swimming is chosen by energy (src/sim/fishmind.js), and where it
// points follows where it swims, never the current itself. The mind is pure: a scene is a flow field function plus a few callbacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fishMind, fishThink, fishOwn, fishEnergy, fishCarry, fishAfter, SLACK, SPENT, REST_LABEL } from '../src/sim/fishmind.js';
import { currentAt } from '../src/sim/currentat.js';

const NEON = { speed: 5, size: 3.2, school: true };
const uniform = (vx, vz = 0) => (x, y, z, o = {}) => { o.x = vx; o.y = 0; o.z = vz; return o; };
const box = (hx, hz) => (x, y, z) => Math.abs(x) < hx && Math.abs(z) < hz;

// Walk one fish to a goal with fishOwn alone (its behaviour asks for 0.6 x cruising speed toward the goal, as swim() does).
function leg(field, gx, gz, { sp = NEON, sec = 60, dt = 0.05, seed = 0.3 } = {}) {
  const m = fishMind(sp, seed), p = { x: 0, y: 5, z: 0 }, w = {}, own = {}, d = { x: 0, y: 0, z: 0 };
  let t = 0, yaw = 0, hc = 0, hs = 0, gsum = 0, fc = 0;
  for (; t < sec; t += dt) {
    const dx = gx - p.x, dz = gz - p.z, l = Math.hypot(dx, dz);
    if (l < 0.5) break;
    field(p.x, p.y, p.z, w);
    d.x = dx / l * 0.6 * sp.speed; d.z = dz / l * 0.6 * sp.speed;
    fishOwn(m, d, w, m.Us, 0, own);
    fishEnergy(m, Math.hypot(own.x, own.y, own.z), dt);
    if (Math.hypot(own.x, own.z) > 0.05) yaw = Math.atan2(own.x, own.z);
    const sx = (own.x + w.x) * dt, sz = (own.z + w.z) * dt, sd = Math.hypot(sx, sz), fd = Math.atan2(w.x, w.z), gb = Math.atan2(dx, dz);
    hc += Math.cos(yaw - fd) * sd; hs += Math.sin(yaw - fd) * sd; gsum += sd; fc += Math.cos(yaw - gb) * sd;
    p.x += sx; p.z += sz;
  }
  return { work: m.work, time: t, F: m.F, p, hc, hs, gsum, fc };
}

// A fish run by its mind in a field, as swim() runs it (glass at the box edge clamps the position).
function swimRun(field, { sp = NEON, sec = 60, dt = 0.05, F0 = 0, start = { x: 0, z: 0 }, want = null, ok, edge = () => false, gx = 20, gz = 20, seed = 0.3 } = {}) {
  const m = fishMind(sp, seed);
  m.F = F0;
  const a = { pos: { x: start.x, y: 5, z: start.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 }, w = {}, d = { x: 0, y: 0, z: 0 };
  const labels = new Set();
  for (let t = 0; t < sec; t += dt) {
    field(a.pos.x, a.pos.y, a.pos.z, w);
    const I = fishThink(m, { dt, x: a.pos.x, y: a.pos.y, z: a.pos.z, w, want, probe: field, ok: ok ?? box(gx - 1, gz - 1), edge });
    d.x = I.dir ? I.dir.x * 0.6 * sp.speed : 0; d.y = 0; d.z = I.dir ? I.dir.z * 0.6 * sp.speed : 0;
    fishOwn(m, d, w, I.escape ? I.burst : I.cap, I.hold ? 2 : 0, a.vel);
    a.pos.x = Math.max(-gx, Math.min(gx, a.pos.x + (a.vel.x + w.x) * dt));
    a.pos.z = Math.max(-gz, Math.min(gz, a.pos.z + (a.vel.z + w.z) * dt));
    if (Math.hypot(a.vel.x, a.vel.z) > 0.05) a.yaw = Math.atan2(a.vel.x, a.vel.z);
    fishAfter(m, a, w, dt, edge, t);
    if (I.label) labels.add(I.label);
  }
  return { m, a, labels, w: field(a.pos.x, a.pos.y, a.pos.z, {}) };
}

test('an idle fish in a uniform current drifts with it', () => {
  const m = fishMind(NEON, 0.3), w = { x: 5, y: 0, z: 0 }, own = {};
  let x = 0;
  for (let t = 0; t < 10; t += 0.05) { fishOwn(m, { x: 0, y: 0, z: 0 }, w, m.Us, 0, own); x += (own.x + w.x) * 0.05; }
  assert.ok(x / 10 >= 4, `mean drift ${(x / 10).toFixed(2)} cm/s`);
});

test('the same ground distance costs more upstream than downstream, and riding beats still water', () => {
  const up = leg(uniform(2.5), -30, 0), down = leg(uniform(2.5), 30, 0), still = leg(uniform(0), 30, 0);
  console.log(`  work up ${up.work.toFixed(2)} (${up.time.toFixed(1)} s), down ${down.work.toFixed(2)} (${down.time.toFixed(1)} s), still ${still.work.toFixed(2)} (${still.time.toFixed(1)} s)`);
  assert.ok(Math.abs(up.p.x + 30) < 1 && Math.abs(down.p.x - 30) < 1, 'both arrive');
  assert.ok(up.work >= 2 * down.work, 'upstream at least twice the work');
  assert.ok(down.time < up.time, 'downstream is quicker');
  assert.ok(down.work < still.work, 'a downstream goal costs less effort than the same trip in still water');
});

test('heading follows the goal, not the current (40 fish, random goals)', () => {
  const out = [];
  for (const cur of [1.5, 2.5]) {
    let C = 0, S = 0, D = 0, G = 0, dc = 0, dd = 0, seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let k = 0; k < 40; k++) for (let j = 0; j < 6; j++) {
      const a = rnd() * 2 * Math.PI, r = 8 + 12 * rnd(), L = leg(uniform(cur), Math.sin(a) * r, Math.cos(a) * r, { seed: rnd() });
      C += L.hc; S += L.hs; D += L.gsum; G += L.fc;
      if (Math.cos(a - Math.PI / 2) > Math.SQRT1_2) { dc += L.hc; dd += L.gsum; }   // goals within 45° of downstream (+x)
    }
    const R = Math.hypot(C, S) / D, follow = G / D, down = dc / dd;
    console.log(`  current ${cur} cm/s: resultant of heading vs flow ${R.toFixed(3)}, cos to goal ${follow.toFixed(3)}, downstream legs cos to flow ${down.toFixed(3)}`);
    out.push({ cur, R, follow, down });
  }
  // A fish crossing a current points partly upstream (the ferry angle, own = ground - water), so R grows with current / ground speed by
  // physics; a heading locked to the flow gives R = 1 and cos -1 on downstream legs. Threshold 0.3 (the proposal's 0.25 was a guess).
  for (const { cur, R, follow, down } of out) {
    assert.ok(follow > 0.8, `heading follows the goal at ${cur} cm/s`);
    assert.ok(down > 0.5, `on downstream legs it faces downstream at ${cur} cm/s`);
    if (cur === 1.5) assert.ok(R < 0.3, 'heading not locked to the flow');
  }
});

test('a tired fish finds a slack refuge in reach and recovers there', () => {
  const field = (x, y, z, o = {}) => { o.x = 0; o.y = 0; o.z = Math.hypot(x - 8, z) < 3 ? 0 : 5; return o; };
  const r = swimRun(field, { F0: 0.8, sec: 60 });
  const d = Math.hypot(r.a.pos.x - 8, r.a.pos.z);
  console.log(`  ends ${d.toFixed(2)} cm from the refuge, F 0.8 -> ${r.m.F.toFixed(2)}, labels ${[...r.labels].join('|')}`);
  assert.ok(d < 3, 'in the refuge');
  assert.ok(r.m.F <= 0.5, 'recovered by at least 0.3');
  assert.ok(r.labels.has(REST_LABEL));
});

test('a fish released in the return jet is not pinned: it crosses out and keeps energy', () => {
  const jet = (x, y, z, o = {}) => { o.x = 20 * Math.exp(-0.693 * z * z / 9); o.y = 0; o.z = 0; return o; };
  const edge = (x, y, z, mg) => x > 30 - mg || Math.abs(z) > 20 - mg;
  const r = swimRun(jet, { want: { x: 1, z: 0 }, edge, gx: 30, sec: 40 });
  const wl = Math.hypot(r.w.x, r.w.z);
  console.log(`  ends in ${wl.toFixed(2)} cm/s water at (${r.a.pos.x.toFixed(1)}, ${r.a.pos.z.toFixed(1)}), F ${r.m.F.toFixed(2)}, longest pin ${r.m.st.pinMax.toFixed(2)} s`);
  assert.ok(wl < SLACK * r.m.Us, 'ends in slack water');
  assert.ok(r.m.F < SPENT, 'energy left');
  assert.ok(r.m.st.pinMax <= 5, 'never held at the glass in the jet for 5 s');
});

test('a body resting on the floor is not swept along: the floor layer slows the water, the body grips', () => {
  const N = 4, H = { vx: new Float32Array(N).fill(5), vz: new Float32Array(N), d: new Float32Array(N).fill(10), cellOf: () => 0, ports: null };
  const W = { water: { hydro: H }, terrain: { heightAt: () => 0 } };
  const lo = currentAt(W, 0, 0.25, 0, {}), hi = currentAt(W, 0, 5, 0, {});
  console.log(`  water at 0.25 cm ${lo.x.toFixed(2)}, at 5 cm ${hi.x.toFixed(2)} cm/s`);
  assert.ok(Math.abs(hi.x - 5) < 1e-6 && lo.x < 0.5 * hi.x, 'slower in the floor layer');
  assert.equal(Math.hypot(...Object.values(fishCarry(lo, true))), 0, 'a resting body holds');
  assert.ok(fishCarry({ x: 12, y: 0, z: 0 }, true).x === 12, 'a torrent still moves it');
  assert.ok(fishCarry(hi, false).x === 5, 'a swimming body is carried');
});

test('the mind uses no Math.random (its stream is seeded)', () => {
  const R = Math.random;
  Math.random = () => { throw new Error('Math.random'); };
  try { swimRun(uniform(3), { sec: 5 }); } finally { Math.random = R; }
});

test('a fish in the main pool next to a filter return feels the jet (the pool keeps its water as level, its d is a film)', async () => {
  const { poolCurrent } = await import('../src/sim/filterflow.js');
  // sim/hydro.js:673-685 and tests/plantbend.test.mjs fakeWorld: main pool cells are `res`, d a 0.05 cm film, water to `level`.
  const N = 16, ports = { lph: 900, ret: { x: 0.2, y: 2, z: 1.5, dx: 1, dz: 0, D: 1.2 } };
  const H = { N, d: new Float32Array(N), vx: new Float32Array(N), vz: new Float32Array(N), ports, res: new Uint8Array(N), level: 4,
    cellOf: (x, z) => Math.max(0, Math.min(3, Math.floor(z))) * 4 + Math.max(0, Math.min(3, Math.floor(x))) };
  for (const c of [4, 5, 6, 7, 8, 9, 10, 11]) { H.res[c] = 1; H.d[c] = 0.05; }
  const W = { water: { hydro: H, inMainPool: (x, z) => H.res[H.cellOf(x, z)] === 1 }, terrain: { heightAt: () => 0 } };
  const jet = poolCurrent(H, 3, 2, 1.5, { x: 0, y: 0, z: 0 }), v = currentAt(W, 3, 2, 1.5, {});
  console.log(`  pool fish 2.8 cm down the return: jet ${Math.hypot(jet.x, jet.z).toFixed(2)}, currentAt ${Math.hypot(v.x, v.z).toFixed(2)} cm/s`);
  assert.ok(Math.hypot(jet.x, jet.z) > 1, 'the fixture has a jet there');
  assert.ok(Math.abs(v.x - jet.x) < 1e-6 && Math.abs(v.z - jet.z) < 1e-6, 'currentAt returns the jet, not 0');
  ports.lph = 0;
  const off = currentAt(W, 3, 2, 1.5, {});
  assert.equal(Math.hypot(off.x, off.z), 0, 'filter off: still water');
});
