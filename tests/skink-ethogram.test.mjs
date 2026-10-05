// The red-eyed crocodile skink's ethogram (task S3): the pure brain in src/sim/skink.js stepped with hand-made senses and a
// seeded generator; the walking is simulated here. Numbers: docs/agents/lizards/MOTION_skink.md (the footage) and the
// species data (src/content/species-info.js, src/content/habitats.js, the SPECIES row in src/sim/animals.js).
// Two clocks, kept apart: seconds (dt) for the freeze, the dash and the forage rhythm; game minutes (dtMin) for drying,
// warming and the day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINK, skinkMind, skinkThink } from '../src/sim/skink.js';

const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ACTIVE = new Set(['forage', 'hunt', 'soak', 'bask', 'avoid']);

// The tank: a shallow pool and three hides. The home sits 31 cm from the water's edge, so a free wander can leave its reach.
const POOL = { x: -10, z: 0, r: 4 };
const COVERS = [{ x: 24, z: -8 }, { x: -18, z: 12 }, { x: 2, z: 14 }];
const nearest = (p, list, max) => {
  let b = null;
  for (const c of list) { const d = dist(p, c); if (d <= max && (!b || d < b.d)) b = { ...c, d }; }
  return b;
};
const depthAt = (p) => (dist(p, POOL) < POOL.r ? 2 : -1);
// What animals.js gives as `shore`: the nearest water 0.5-4 cm deep, searched within 35 cm.
const shoreOf = (p) => {
  const d = dist(p, POOL), k = Math.min(1, (POOL.r - 1) / (d || 1));
  const q = { x: POOL.x + (p.x - POOL.x) * k, z: POOL.z + (p.z - POOL.z) * k }, dq = dist(p, q);
  return dq > 35 ? null : { ...q, d: dq };
};
const lightAt = (h) => (h < 6 || h >= 20 ? 0 : h < 7 ? h - 6 : h >= 19 ? 20 - h : 1);

// Steps the mind for `sec` seconds; `scene(t, pos)` overrides senses. `refuge` is the nearest cover within 25 cm (the
// sense the world hunk adds).
function live({ sec, dt = 0.1, warp = 1, seed = 11, start = { x: 0, z: 0 }, mind = {}, scene = () => ({}), covers = COVERS, home = COVERS[0], hour0 = 0 } = {}) {
  const rnd = seeded(seed), m = Object.assign(skinkMind(rnd), mind), pos = { ...start }, log = [];
  const dtMin = (dt * warp) / 60;
  for (let i = 0, n = Math.round(sec / dt); i < n; i++) {
    const t = i * dt, hour = (hour0 + (i * dtMin) / 60) % 24;
    const s = {
      t, dt, dtMin, x: pos.x, z: pos.z, depth: depthAt(pos), wetGround: 0.5, light: lightAt(hour), rain: 0, rh: 88, temp: 25,
      cover: 0, hunger: 0.2, threat: null, home, refuge: nearest(pos, covers, 25), shore: shoreOf(pos), warm: null, ...scene(t, pos),
    };
    const it = skinkThink(m, s, rnd);
    if (it.goal && it.speed > 0) {
      const dx = it.goal.x - pos.x, dz = it.goal.z - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.25) { const st = Math.min(d, it.speed * dt); pos.x += (dx / d) * st; pos.z += (dz / d) * st; }
    }
    log.push({ t, hour, light: s.light, mode: it.mode, it, pos: { ...pos } });
  }
  return { log, m, pos };
}
// The mode the first freeze turns into.
const afterFreeze = (log) => {
  const i = log.findIndex((e) => e.mode === 'freeze');
  const j = i < 0 ? -1 : log.findIndex((e, k) => k > i && e.mode !== 'freeze');
  return j < 0 ? null : log[j].mode;
};

test('48 game hours: hidden by day, out at dusk and night, active within reach of water and cover', () => {
  const { log } = live({ sec: (48 * 3600) / 120, dt: 0.5, warp: 120, start: COVERS[0], mind: { mode: 'hide' }, hour0: 12 });
  const day = log.filter((e) => e.light >= 0.5), dark = log.filter((e) => e.light < 0.5), act = log.filter((e) => ACTIVE.has(e.mode));
  const hidden = day.filter((e) => e.mode === 'hide').length / day.length;
  const active = dark.filter((e) => ACTIVE.has(e.mode)).length / dark.length;
  // Reach is checked on forage time (the soak trips go to a pool 14 cm from the nearest hide: printed, not asserted).
  const fg = log.filter((e) => e.mode === 'forage');
  const wet = (l) => l.filter((e) => dist(e.pos, POOL) - POOL.r <= SKINK.waterReach + 1e-6).length / l.length;
  const hid = (l) => l.filter((e) => nearest(e.pos, COVERS, SKINK.coverReach + 1e-6)).length / l.length;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`skink 48 h: day hidden ${pct(hidden)}, dusk+night active ${pct(active)}; forage within ${SKINK.waterReach} cm of water ${pct(wet(fg))}, within ${SKINK.coverReach} cm of cover ${pct(hid(fg))}; all active time: water ${pct(wet(act))}, cover ${pct(hid(act))}`);
  assert.ok(hidden >= 0.85, `hidden by day ${pct(hidden)}`);
  assert.ok(active >= 0.75, `active at dusk and night ${pct(active)}`);
  assert.ok(wet(fg) >= 0.95, `forage time within reach of water ${pct(wet(fg))}`);
  assert.ok(hid(fg) >= 0.9, `forage time within reach of cover ${pct(hid(fg))}`);
});

test('a startle freezes it within 0.3 s, propped and scanning, for the sheet\'s 5 s or more, even when the threat goes', () => {
  assert.ok(SKINK.freeze[0] >= 5, 'MOTION_skink.md: an alert stand of at least 5.0 s');
  const P = { x: 4, z: 0 };
  const { log } = live({ sec: 12, seed: 3, covers: [], home: null, mind: { mode: 'hide' }, scene: (t, p) => ({ light: 1, threat: t >= 1 && t < 1.5 ? { ...P, d: dist(p, P) } : null }) });
  const first = log.find((e) => e.mode === 'freeze');
  assert.ok(first && first.t - 1 <= 0.3 + 1e-9, 'frozen within 0.3 s');
  const held = log.filter((e) => e.t >= first.t && e.t < first.t + SKINK.freeze[0]);
  assert.ok(held.every((e) => e.mode === 'freeze' && e.it.speed === 0 && e.it.propped >= 0.5 && e.it.pose === 'propped'), 'still and propped for the whole freeze');
  const yaw = held.map((e) => e.it.scan);
  assert.ok(Math.max(...yaw) > 0.5 && Math.min(...yaw) < -0.5, 'the head scans both ways (+-30-45 deg)');
});

test('a threat that stays: after the freeze it dashes at 1.5 body lengths a second to the nearest cover, in short bursts', () => {
  assert.equal(SKINK.dash, 1.5 * SKINK.svl);
  const P = { x: 4, z: 0 }, near = { x: -8, z: 0 }, far = { x: 30, z: 0 };
  const { log } = live({ sec: 15, seed: 4, home: far, covers: [near, far], mind: { mode: 'hide' }, scene: (t, p) => ({ light: 1, threat: { ...P, d: dist(p, P) } }) });
  const runs = log.filter((e) => e.mode === 'flee' && e.it.speed > 0);
  assert.ok(runs.length > 0, 'it runs');
  assert.ok(runs.every((e) => e.it.speed === SKINK.dash && e.it.dash && e.it.pose === 'dash'), 'at the dash speed');
  assert.deepEqual({ x: runs[0].it.goal.x, z: runs[0].it.goal.z }, near, 'to the nearest cover, not the far home');
  assert.ok(log.some((e) => dist(e.pos, near) <= SKINK.inCover), 'it gets there');
  let len = 0;
  for (const e of log) {
    if (e.mode === 'flee' && e.it.speed > 0) { len += 0.1; continue; }
    if (len > 0) {
      assert.ok(len <= SKINK.burst[1] + 0.15, `a burst of ${len.toFixed(1)} s`);
      assert.ok(e.mode === 'freeze' || dist(e.pos, near) <= SKINK.inCover + 0.3, 'a burst ends in cover or in a freeze');
      len = 0;
    }
  }
  // No refuge sense yet: it falls back to its home.
  const home = { x: -8, z: 0 };
  const b = live({ sec: 10, seed: 5, home, covers: [], mind: { mode: 'hide' }, scene: (t, p) => ({ light: 1, refuge: null, threat: { ...P, d: dist(p, P) } }) });
  assert.deepEqual(b.log.find((e) => e.mode === 'flee' && e.it.speed > 0).it.goal, home);
});

test('it plays dead only when cornered by a very close threat, and not every time', () => {
  let dead = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const scene = (t, p) => ({ light: 1, threat: { x: p.x + 1, z: p.z, d: 1 } });
    const a = live({ sec: 10, seed, home: { x: 60, z: 0 }, covers: [], mind: { mode: 'hide' }, scene });
    const next = afterFreeze(a.log);
    assert.ok(next === 'dead' || next === 'flee', `cornered: ${next}`);
    if (next === 'dead') { dead++; assert.ok(a.log.filter((e) => e.mode === 'dead').every((e) => e.it.dead && e.it.roll === 1 && e.it.pose === 'dead')); }
    const b = live({ sec: 20, seed, home: { x: 60, z: 0 }, covers: [{ x: -8, z: 0 }], mind: { mode: 'hide' }, scene });
    assert.ok(b.log.every((e) => e.mode !== 'dead'), 'with cover in reach it never plays dead');
  }
  assert.ok(dead > 0 && dead < 20, `cornered: plays dead in some runs, not all (${dead}/20)`);
});

test('the surface rule: a wall or glass point is never a goal, and the surface is always the ground', () => {
  const wall = { x: 6, z: 0, wall: true }, glass = { x: -6, z: 0, glass: true }, wet = { x: 0, z: 9, wall: true }, P = { x: 3, z: 3 };
  const runs = [
    live({ sec: 30, seed: 6, home: wall, covers: [], mind: { mode: 'hide' }, scene: (t, p) => ({ light: 1, refuge: { ...glass, d: dist(p, glass) } }) }),
    live({ sec: 30, seed: 7, home: wall, covers: [], scene: (t, p) => ({ light: 0, refuge: { ...glass, d: dist(p, glass) }, shore: { ...wet, d: dist(p, wet) }, threat: t > 2 && t < 3 ? { ...P, d: dist(p, P) } : null }) }),
  ];
  for (const { log } of runs) for (const e of log) {
    assert.equal(e.it.surface, 'ground');
    if (e.it.goal) for (const bad of [wall, glass, wet]) assert.ok(dist(e.it.goal, bad) > 1e-6, `goal on a wall or glass at ${e.t.toFixed(1)} s (${e.mode})`);
  }
});

test('territorial (SPECIES row): another male close by is walked away from, not frozen at', () => {
  const R = { x: 3, z: 0 };
  const { log } = live({ sec: 6, seed: 8, covers: [], home: null, scene: (t, p) => ({ light: 0, rival: { ...R, d: dist(p, R) } }) });
  assert.equal(log[0].mode, 'avoid');
  assert.ok(log.every((e) => e.mode !== 'freeze' && e.it.speed <= SKINK.speed + 1e-9));
  assert.ok(dist(log.at(-1).pos, R) > 3, 'it ends farther from the rival');
});
