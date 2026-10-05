// The mourning gecko's ethogram (G3, BB/reports/G3.proposal.md): the pure brain in src/sim/herp.js over a seeded 48 hours,
// plus short scenes for fear, the keeper's camera, a prey it cannot reach, and the shared roost. Targets marked G are guesses
// (the footage, MOTION_gecko.md, shows walking, pauses, licking a surface and head-first climbing only).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/sim/herp.js';

const { herpMind, herpThink } = H;
const G = H.GECKO ?? {};
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DT = 0.1;

// Runs of equal values: [{ v, i (first step), n (steps) }].
function runsOf(log, key) {
  const out = [];
  log.forEach((e, i) => { const v = key(e); if (out.length && out[out.length - 1].v === v) out[out.length - 1].n++; else out.push({ v, i, n: 1 }); });
  return out;
}

// 48 game hours, 0.1 s steps, 1 game minute per animal second (as tests/herp.test.mjs). Lamp 08-19 h with a ramp, misting at
// 08:00 and 20:00, dew 22-02 h, a fly 8 cm off every 40 min at night (eaten on the strike), patrol legs half on the wall.
function day48(seed = 11) {
  const rnd = seeded(seed), lr = seeded(seed + 100), m = herpMind('gecko', rnd);
  const home = { x: 10, z: -20, wall: true }, pos = { x: 10, z: -20, wall: true }, spot = { x: 14, z: -26, wall: true };
  let prey = null, preyT = 0, moved = 0;
  const log = [];
  for (let k = 0; k < 28800; k++) {
    const min = k * DT, h = (min / 60) % 24;
    const light = sm(6.5, 8, h) * (1 - sm(19, 20.5, h));
    if (!prey && (h >= 20 || h < 5) && k % 400 === 0) { prey = { x: pos.x + 8, z: pos.z + 3, wall: pos.wall }; preyT = 0; }
    const legsFn = () => Array.from({ length: 6 }, (_, i) => { const a = lr() * 6.283, r = 4 + lr() * 10; return { x: pos.x + Math.sin(a) * r, z: pos.z + Math.cos(a) * r, damp: lr(), cover: lr() < 0.3 ? 1 : 0, wall: i < 3 }; });
    const s = {
      t: k * DT, dt: DT, dtMin: DT, x: pos.x, z: pos.z, moved, kind: 'gecko', onWall: pos.wall, light, rain: 0, rh: 75, temp: 24, hunger: 0.5, home, reach: 1.6,
      mist: (h >= 8 && h < 8.5) || (h >= 20 && h < 20.5) ? 1 : 0, dew: h >= 22 || h < 2 ? 0.4 : 0,
      wetSpot: { ...spot, d: Math.hypot(spot.x - pos.x, spot.z - pos.z) }, legsFn,
      prey: prey ? { ...prey, d: Math.hypot(prey.x - pos.x, prey.z - pos.z), moving: false } : null,
    };
    const it = herpThink(m, s, rnd);
    moved = 0;
    if (it.goal && it.speed > 0 && !it.calm) {
      const dx = it.goal.x - pos.x, dz = it.goal.z - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.15) { const st = Math.min(d, it.speed * DT); pos.x += dx / d * st; pos.z += dz / d * st; moved = st; }
      pos.wall = it.wantWall !== false;
    }
    if (prey && (it.strike || (preyT += DT) > 120)) prey = null;
    log.push({ h, mode: it.mode, pose: it.pose, licking: it.licking ?? null, lick: it.lick ?? 0, vertical: it.vertical, strike: !!it.strike, stalk: it.stalk ?? 0 });
  }
  return log;
}
let LOG = null;
const log48 = () => (LOG ??= day48());

test('48 h: hidden or resting by day, out at dusk and night, active mostly on vertical surfaces', (t) => {
  const L = log48();
  const day = L.filter((e) => e.h >= 8 && e.h < 19), night = L.filter((e) => e.h >= 19 || e.h < 6), act = L.filter((e) => e.mode !== 'hide' && e.mode !== 'rest');
  const hid = day.filter((e) => e.mode === 'hide' || e.mode === 'rest').length / day.length;
  const out = night.filter((e) => e.mode !== 'hide').length / night.length;
  const vert = act.filter((e) => e.vertical === true).length / act.length;
  t.diagnostic(`gecko 48 h: day hidden/resting ${(100 * hid).toFixed(1)}%, dusk+night out ${(100 * out).toFixed(1)}%, active on vertical ${(100 * vert).toFixed(1)}%`);
  assert.ok(hid >= 0.9, `day hidden ${hid}`);
  assert.ok(out >= 0.85, `night out ${out}`);
  assert.ok(vert >= 0.7, `active on vertical ${vert} (target G)`);
});

test('48 h: licks of wet surfaces and drops in bouts of 0.7-1.5 s, tongue out about 0.2 s a flick', (t) => {
  const L = log48();
  const bouts = runsOf(L, (e) => e.licking).filter((r) => ['surface', 'wet', 'drop'].includes(r.v) && L[r.i + r.n] && L[r.i + r.n].mode === L[r.i].mode && L[r.i - 1]?.mode === L[r.i].mode);
  const secs = bouts.map((r) => r.n * DT);
  t.diagnostic(`lick bouts ${secs.length} (${[...new Set(bouts.map((r) => r.v))].join('/')}), ${Math.min(...secs).toFixed(1)}-${Math.max(...secs).toFixed(1)} s`);
  assert.ok(secs.length >= 10, `bouts ${secs.length}`);
  assert.ok(bouts.some((r) => r.v === 'wet') && bouts.some((r) => r.v === 'drop'), 'wet surfaces and drops are both licked');
  for (const x of secs) assert.ok(x >= 0.7 - 1e-6 && x <= 1.6 + 1e-6, `bout ${x} s`);
  const flicks = runsOf(L, (e) => e.lick > 0.5).filter((r) => r.v && L[r.i + r.n]?.licking);
  assert.ok(flicks.length > 0 && flicks.every((r) => r.n * DT >= 0.1 - 1e-6 && r.n * DT <= 0.3 + 1e-6), 'tongue flicks of about 0.2 s');
});

test('48 h: stalk, crouch, strike, swallow, with durations inside the sheet; no stalk over the limit', (t) => {
  const L = log48();
  const P = runsOf(L, (e) => e.pose);
  const strikes = P.map((r, k) => [r, k]).filter(([r]) => r.v === 'strike');
  t.diagnostic(`strikes ${strikes.length}, stalk steps ${L.filter((e) => e.stalk > 0).length}`);
  assert.ok(strikes.length >= 3, `strikes ${strikes.length}`);
  for (const [r, k] of strikes) {
    assert.ok(r.n * DT >= 0.1 - 1e-6 && r.n * DT <= 0.2 + 1e-6, `strike ${r.n * DT}`);
    assert.equal(P[k - 1].v, 'crouch');
    assert.ok(P[k - 1].n * DT >= 0.3 - 1e-6 && P[k - 1].n * DT <= 0.9 + 1e-6, `crouch ${P[k - 1].n * DT}`);
    assert.equal(P[k + 1].v, 'swallow');
    assert.ok(P[k + 1].n * DT >= 2 - 1e-6 && P[k + 1].n * DT <= 4.1 + 1e-6, `swallow ${P[k + 1].n * DT}`);
  }
  for (const r of runsOf(L, (e) => e.mode).filter((r) => r.v === 'hunt')) {
    const first = L.slice(r.i, r.i + r.n).findIndex((e) => e.strike);
    assert.ok((first < 0 ? r.n : first) * DT <= (G.stalkS ?? 0) + 0.1 + 1e-6, `stalk ${(first < 0 ? r.n : first) * DT} s`);
  }
});

// A short scene: night, home on the wall at x 12, start at x 5.
function scene(sec, f, { seed = 7, start = { x: 5, z: -10 } } = {}) {
  const rnd = seeded(seed), m = herpMind('gecko', rnd), pos = { ...start }, log = [];
  for (let k = 0; k * DT < sec; k++) {
    const tt = k * DT;
    const it = herpThink(m, { t: tt, dt: DT, dtMin: DT, x: pos.x, z: pos.z, kind: 'gecko', onWall: true, light: 0, rh: 75, temp: 25, hunger: 0.2, home: { x: 12, z: -10, wall: true }, ...f(tt, pos) }, rnd);
    if (it.goal && it.speed > 0 && !it.calm) { const dx = it.goal.x - pos.x, dz = it.goal.z - pos.z, d = Math.hypot(dx, dz); if (d > 0.15) { const st = Math.min(d, it.speed * DT); pos.x += dx / d * st; pos.z += dz / d * st; } }
    log.push({ t: tt, mode: it.mode, it, fear: m.fear });
  }
  return log;
}

test('a prey it cannot reach: it gives up within the limit, without a strike, and leaves it for a while', () => {
  const L = scene(60, (tt, p) => ({ hunger: 0.8, prey: { x: p.x + 10, z: p.z, d: 10, moving: true, wall: true } }));
  const hunt = runsOf(L, (e) => e.mode).find((r) => r.v === 'hunt');
  assert.ok(hunt, 'it stalks');
  assert.ok(hunt.n * DT <= (G.stalkS ?? 0) + 0.1 + 1e-6, `stalked ${hunt.n * DT} s`);
  assert.ok(!L.some((e) => e.it.strike), 'no strike at a prey out of reach');
  const after = L.slice(hunt.i + hunt.n, hunt.i + hunt.n + Math.round((G.giveUpS ?? 0) / DT) - 1);
  assert.ok(after.length > 0 && after.every((e) => e.mode !== 'hunt'), 'leaves it for a while');
});

test('fear: a predator coming closer gets a freeze first, then flight in 25 cm/s bursts with stops', () => {
  const L = scene(8, (tt) => ({ threat: tt < 5 ? { x: 2, z: -10, d: Math.max(3.2, 7 - tt * 1.2) } : null }));
  const a = L.findIndex((e) => e.mode === 'alert'), f = L.findIndex((e) => e.mode === 'flee');
  assert.ok(a >= 0 && f > a, `freeze at ${a}, flee at ${f}`);
  assert.equal(L[a].it.pose, 'freeze');
  assert.ok(L[a].it.alertAt, 'the head has a point to watch');
  const fl = L.filter((e) => e.mode === 'flee');
  assert.equal(Math.max(...fl.map((e) => e.it.speed)), G.burst);
  assert.ok(G.burst === 25 && fl.some((e) => e.it.speed === 0), 'bursts with stops');
});

test('the keeper\'s camera: a swoop only freezes it; a camera that follows it, or a camera jump, is ignored', () => {
  const swoop = scene(6, (tt) => ({ threat: tt < 2 ? { x: 2, z: -10, d: 4, cam: true } : null }));
  assert.ok(swoop.some((e) => e.mode === 'alert') && !swoop.some((e) => e.mode === 'flee'), 'freeze, no flight');
  const follow = scene(6, () => ({ threat: { x: 4, z: -10, d: 1.5, cam: true }, followed: true }));
  assert.ok(follow.every((e) => e.mode !== 'alert' && e.mode !== 'flee' && e.fear === 0), 'followed: no fear at all');
  const cut = scene(3, () => ({ threat: { x: 4, z: -10, d: 2, cam: true }, camCut: true }));
  assert.ok(cut.every((e) => e.fear === 0), 'a camera jump is no swoop');
});

test('home: it walks onto its own spot (within 1.2 cm), not the edge of a shared 2.5 cm disc', () => {
  const L = scene(5, () => ({ light: 1 }), { start: { x: 10, z: -10 } });   // 2 cm from home
  assert.ok(L[1].it.goal && !L[1].it.tuck, 'at 2 cm it is not home yet');
  const last = L[L.length - 1].it;
  assert.equal(last.tuck, 1);
  assert.equal(last.pose, 'roost');
});

test('roost: a group of at most 4, homes at least 3 cm apart, the next roost 10 cm away', () => {
  assert.equal(typeof H.geckoRoost, 'function');
  assert.deepEqual([G.roostCap, G.roostGap, G.roostRadius, G.roostApart], [4, 3, 6, 10]);
  const R = (x, y) => ({ x, y, z: 0, wall: true });
  const four = [R(0, 0), R(3.5, 0), R(0, 3.5), R(3.5, 3.5)];
  assert.equal(H.geckoRoost(R(1, 1), four), -1, 'too close to a roost-mate');
  assert.equal(H.geckoRoost(R(1.8, 6.8), four), -1, 'a fifth');
  assert.equal(H.geckoRoost(R(10, 2), four), -1, 'next to a full roost but not 10 cm away');
  assert.equal(H.geckoRoost(R(14.5, 2), four), 0, 'a new roost');
  assert.equal(H.geckoRoost(R(6.6, 0), four.slice(0, 2)), 0.25, 'joins a roost with room');
  // 16 geckos choose homes one by one in a 30 x 30 cm patch (cover random): never a pile, some groups.
  const rnd = seeded(5), homes = [];
  for (let g = 0; g < 16; g++) {
    let best = null, bs = -1;
    for (let k = 0; k < 40; k++) { const h = R(rnd() * 30, rnd() * 30), r = H.geckoRoost(h, homes); if (r < 0) continue; const sc = rnd() * 0.5 + r; if (sc > bs) { bs = sc; best = h; } }
    if (best) homes.push(best);
  }
  for (const h of homes) {
    const near = homes.filter((o) => o !== h && Math.hypot(o.x - h.x, o.y - h.y) < 6);
    assert.ok(near.length <= 3, `roost of ${near.length + 1}`);
    assert.ok(homes.every((o) => o === h || Math.hypot(o.x - h.x, o.y - h.y) >= 3), 'homes 3 cm apart');
  }
  assert.ok(homes.some((h) => homes.some((o) => o !== h && Math.hypot(o.x - h.x, o.y - h.y) < 6)), 'they do group');
});

test('N2b: a camera jump or a following lens never sends a frozen, frightened gecko running; a predator still does', () => {
  const run = (extra, sec = 1.5) => {
    const rnd = seeded(5), m = herpMind('gecko', rnd);
    Object.assign(m, { mode: 'alert', modeT: 1, fear: 0.9, alertLeft: 0 });   // frozen, fear above fleeAt, the freeze over
    const modes = [];
    for (let k = 0; k * DT < sec; k++) {
      const it = herpThink(m, { t: k * DT, dt: DT, dtMin: DT, x: 5, z: -10, kind: 'gecko', onWall: true, light: 0, rh: 75, temp: 25, hunger: 0.2, home: { x: 12, z: -10, wall: true }, ...extra }, rnd);
      modes.push(it.mode);
    }
    return modes;
  };
  const lens = { x: 5, z: -8.2, d: 1.8, cam: true };
  assert.ok(!run({ threat: lens, camCut: true }).includes('flee'), 'camCut, lens 1.8 cm: no bolt');
  assert.ok(!run({ threat: lens, followed: true }).includes('flee'), 'followed, lens 1.8 cm: no bolt');
  assert.ok(run({ threat: { x: 5, z: -8.2, d: 1.8 }, camCut: true }).includes('flee'), 'a real predator during a cut still causes flight');
});
