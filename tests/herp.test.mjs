// The salamander, newt, axolotl and gecko minds (src/sim/herp.js): what they do at the hour, in the weather, when hungry,
// frightened, dry or thirsty. The minds are pure, so a scene is a function that says what they sense.
import test from 'node:test';
import assert from 'node:assert/strict';
import { herpMind, herpThink, PROFILES, dryRate, awake } from '../src/sim/herp.js';

// A seeded random source so a run is repeatable.
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// Run a mind for `sec` seconds of animal time (0.1 s steps, 1 game minute per second). `scene(t, m, last)` returns the senses;
// the walking is simulated here: it moves toward the goal at the intent's speed. Returns the log of intents.
function run(id, sec, scene, { seed = 7, start = {} } = {}) {
  const rnd = seeded(seed), m = herpMind(id, rnd);
  Object.assign(m, start.mind ?? {});
  const pos = { x: start.x ?? 0, z: start.z ?? 0 }, yaw = { v: 0 };
  const log = [];
  let moved = 0;
  for (let t = 0; t < sec; t += 0.1) {
    const s = { t, dt: 0.1, dtMin: 0.1, x: pos.x, z: pos.z, yaw: yaw.v, moved, depth: 0, light: 0, rain: 0, rh: 85, temp: 16, hunger: 0.2, cover: 0, toSurface: m.mode === 'air' ? Math.max(0.3, 8 - m.modeT * 1.5) : 8, ...scene(t, pos, m) };
    const it = herpThink(m, s, rnd);
    moved = 0;
    if (it.goal && it.speed > 0 && !it.calm) {
      const dx = it.goal.x - pos.x, dz = it.goal.z - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.2) { const st = Math.min(d, it.speed * 0.1); pos.x += dx / d * st; pos.z += dz / d * st; yaw.v = Math.atan2(dx, dz); moved = st; }
    }
    log.push({ t, mode: it.mode, it, pos: { ...pos } });
  }
  return { log, m, pos };
}
const share = (log, mode) => log.filter((e) => e.mode === mode).length / log.length;
const modes = (log) => new Set(log.map((e) => e.mode));

const HOME = { x: 10, z: 0, wall: false };

test('fire salamander: sits in its hide by day, comes out on a damp night', () => {
  const day = run('firesal', 120, () => ({ light: 1, rh: 60, temp: 21, home: HOME, hunger: 0.2 }), { start: { x: 10 } });
  assert.ok(share(day.log, 'hide') > 0.9, 'in the light and dry air it stays put in its hide');
  const night = run('firesal', 180, () => ({ light: 0, rh: 88, rain: 0.5, temp: 14, home: HOME, hunger: 0.2 }), { start: { x: 10 } });
  assert.ok(share(night.log, 'forage') > 0.5, 'on a damp dark night it forages');
  assert.ok(Math.hypot(night.pos.x - HOME.x, night.pos.z - HOME.z) > 0 || modes(night.log).has('forage'));
});

test('fire salamander: out of its hide in the day only when starving', () => {
  const hungry = run('firesal', 60, () => ({ light: 1, rh: 80, temp: 18, home: HOME, hunger: 0.95 }), { start: { x: 10 } });
  assert.ok(!modes(hungry.log).has('hide') || share(hungry.log, 'hide') < 0.9, 'hunger drives it out at the wrong hour');
});

test('fire salamander: heat sends it into the shade', () => {
  const hot = run('firesal', 120, () => ({ light: 0, rh: 90, temp: 26, home: HOME }), { start: { x: 10 } });
  assert.ok(share(hot.log, 'hide') > 0.8, 'too warm to be out even at night');
});

test('fire salamander: warns first (freezes, arches), then withdraws; never runs at once', () => {
  const near = { x: 3, z: 0, d: 4 };
  const r = run('firesal', 20, (t) => ({ light: 0, rh: 85, temp: 15, home: HOME, threat: t < 8 ? near : null }), { start: { x: 0 } });
  const first = r.log.find((e) => e.mode !== 'rest' && e.mode !== 'forage');
  assert.equal(first.mode, 'warn');
  const warn = r.log.filter((e) => e.mode === 'warn');
  assert.ok(warn.length > 15, 'it holds the pose for a while');
  assert.ok(warn.every((e) => e.it.speed === 0), 'frozen: no walking while it warns');
  const arch = Math.max(...warn.map((e) => Math.abs(e.it.bend)));
  assert.ok(arch > 0.3, 'the body arches');
  assert.ok(modes(r.log).has('retreat'), 'then it withdraws to its hide');
});

test('fire salamander: dry skin sends it to the water edge, where it sits until wet', () => {
  const shore = { x: 6, z: 0, d: 6 };
  let wetAt = null;
  let wetMax = 0;
  const r = run('firesal', 240, (t, p, m) => {
    wetMax = Math.max(wetMax, m.wet);
    const inShallows = Math.hypot(p.x - shore.x, p.z - shore.z) < 1.3;
    if (inShallows && wetAt === null && m.mode === 'soak') wetAt = t;
    return { light: 0, rh: 80, temp: 15, home: HOME, shore: { ...shore, d: Math.hypot(p.x - shore.x, p.z - shore.z) }, depth: inShallows ? 0.8 : 0 };
  }, { start: { x: 0, mind: { wet: 0.2 } } });
  assert.ok(modes(r.log).has('soak'));
  assert.ok(wetAt !== null && wetAt < 60, 'it walks to the shallows');
  assert.ok(wetMax > 0.85, 'and sits there until the skin is wet again');
});

test('skin dries faster in dry, hot, bright air and slower on wet ground', () => {
  const P = PROFILES.firesal;
  assert.ok(dryRate(P, 50, 22, 1) > dryRate(P, 85, 15, 0) * 2);
  assert.ok(dryRate(P, 70, 18, 0, 1) < dryRate(P, 70, 18, 0, 0) * 0.4);
});

test('hunting: creeps in stops, stops short of the prey and holds still for the strike', () => {
  const prey = (p) => ({ x: 14, z: 0, d: Math.hypot(14 - p.x, 0 - p.z), moving: false, mine: true });
  const r = run('firesal', 90, (t, p) => ({ light: 0, rh: 85, temp: 15, hunger: 0.8, reach: 2, prey: prey(p), home: HOME }), { start: { x: 0 } });
  assert.ok(modes(r.log).has('hunt'));
  const moving = r.log.filter((e) => e.mode === 'hunt' && e.it.speed > 0 && !e.it.calm).length;
  const still = r.log.filter((e) => e.mode === 'hunt' && e.it.calm).length;
  assert.ok(moving > 20 && still > 20, 'creeping is move-and-freeze, not a steady walk');
  const d = 14 - r.pos.x;
  assert.ok(d < 3 && d > 0.8, `it stops within striking range, not on top of the prey (stopped ${d.toFixed(2)} cm away)`);
  const last = r.log[r.log.length - 1].it;
  assert.ok(last.calm === 1 && Math.abs(last.head) < 0.6, 'and then holds still looking at it');
});

test('a prey that moves makes it freeze', () => {
  const still = (moving) => run('firesal', 40, (t, p) => ({ light: 0, rh: 85, temp: 15, hunger: 0.8, reach: 2, home: HOME, prey: { x: 16, z: 0, d: Math.hypot(16 - p.x, p.z), moving, mine: true } }), { start: { x: 6 }, seed: 11 });
  const a = still(false), b = still(true);
  assert.ok(b.pos.x < a.pos.x, 'it closes in more slowly on prey that is moving');
});

test('axolotl: breathes air at the surface now and then, then goes back to the bottom', () => {
  let surfaced = 0;
  const r = run('axolotl', 300, (t, p, m) => ({ depth: 14, light: 0.2, rh: 100, temp: 17, hunger: 0.2 }), { start: { mind: { air: 0.9 } } });
  assert.ok(modes(r.log).has('air'), 'it rises for a breath');
  const gulps = r.log.filter((e) => e.it.gulp).length;
  assert.ok(gulps > 0, 'the gulp happens at the surface');
  assert.ok(r.log.some((e) => e.mode === 'air' && e.it.rise && e.it.swim), 'swimming up');
  const after = r.log.slice(r.log.findIndex((e) => e.it.gulp) + 40);
  assert.ok(after.length && after.every((e) => e.mode !== 'air' || e.t > 150) || share(r.log, 'air') < 0.3, 'and it does not stay up');
  assert.ok(r.log.every((e) => e.it.mode !== 'air' || e.it.bottom === false), 'on the way up it is off the bottom');
  surfaced++;
  assert.ok(surfaced);
});

test('axolotl: shuns the lamp, forages in the dim', () => {
  const lit = run('axolotl', 200, () => ({ depth: 14, light: 1, rh: 100, temp: 17, home: { x: 3, z: 0 }, hunger: 0.3 }), { start: { x: 3 } });
  const dim = run('axolotl', 200, () => ({ depth: 14, light: 0, rh: 100, temp: 17, home: { x: 3, z: 0 }, hunger: 0.3 }), { start: { x: 3 } });
  assert.ok(share(lit.log, 'forage') < 0.1, 'under the lamp it stays put');
  assert.ok(share(dim.log, 'forage') > 0.2, 'in the dark it patrols the bottom');
});

test('axolotl: too warm and it drifts about instead of foraging', () => {
  const r = run('axolotl', 120, () => ({ depth: 14, light: 0, rh: 100, temp: 25, hunger: 0.2, home: { x: 3, z: 0 } }), { start: { x: 3 } });
  assert.ok(share(r.log, 'forage') < 0.2);
});

test('newt: rests on the bottom by day, patrols at night, and may wander the bank on a wet night', () => {
  const day = run('newt', 120, () => ({ depth: 10, light: 1, rh: 90, temp: 18, home: { x: 2, z: 0 } }), { start: { x: 2 } });
  assert.ok(share(day.log, 'hide') > 0.8);
  const night = run('newt', 200, () => ({ depth: 10, light: 0, rh: 90, temp: 18, home: { x: 2, z: 0 }, hunger: 0.3 }), { start: { x: 2 } });
  assert.ok(share(night.log, 'forage') > 0.3);
});

test('newt in water too warm for it hides and lowers its activity', () => {
  const hot = run('newt', 120, () => ({ depth: 10, light: 0, rh: 90, temp: 28, home: { x: 2, z: 0 }, hunger: 0.2 }), { start: { x: 2 } });
  assert.ok(share(hot.log, 'forage') < 0.2);
});

test('gecko: asleep by day (eyes shut, curled), awake and patrolling after the lamp goes out', () => {
  const day = run('gecko', 90, () => ({ light: 1, rh: 70, temp: 25, onWall: true, home: { x: 5, z: -10, wall: true } }), { start: { x: 5, z: -10 } });
  const last = day.log[day.log.length - 1].it;
  assert.equal(last.mode, 'hide');
  assert.ok(last.eye > 0.8, 'eyes shut');
  assert.ok(Math.abs(last.bend) > 0.3, 'curled up');
  const night = run('gecko', 200, () => ({ light: 0, rh: 75, temp: 25, onWall: true, home: { x: 5, z: -10, wall: true } }), { start: { x: 5, z: -10 } });
  assert.ok(share(night.log, 'patrol') > 0.4);
  const darts = night.log.filter((e) => e.mode === 'patrol' && e.it.speed > 0 && !e.it.calm).length, pauses = night.log.filter((e) => e.mode === 'patrol' && e.it.calm).length;
  assert.ok(darts > 15 && pauses > 40, 'darts and pauses, not a steady walk');
});

test('gecko: licks its eyes now and then during pauses', () => {
  const r = run('gecko', 400, () => ({ light: 0, rh: 75, temp: 25, onWall: true, home: { x: 5, z: -10, wall: true } }), { start: { x: 5, z: -10 } });
  const licks = r.log.filter((e) => e.it.eye > 0.4 && e.mode === 'patrol' && Math.abs(e.it.head) > 0.5).length;
  assert.ok(licks > 3, 'the head turns and the eye shuts as it cleans it');
});

test('gecko: thirsty after rain, goes to the droplets and drinks until it is no longer thirsty', () => {
  const spot = { x: 12, z: -14, wall: true };
  const r = run('gecko', 200, (t, p) => ({ light: 0, rh: 90, rain: 0.6, temp: 24, onWall: true, wetSpot: { ...spot, d: Math.hypot(p.x - spot.x, p.z - spot.z) }, home: { x: 5, z: -10, wall: true } }), { start: { x: 5, z: -10, mind: { thirst: 0.95 } } });
  assert.ok(modes(r.log).has('drink'));
  assert.ok(r.log.some((e) => e.it.drink), 'it licks the water');
  assert.ok(r.m.thirst < 0.2, 'and stops when it has had enough');
});

test('gecko: stalks with its tail waving, then holds still for the pounce', () => {
  const r = run('gecko', 60, (t, p) => ({ light: 0, rh: 75, temp: 25, onWall: true, hunger: 0.8, reach: 1.7, home: { x: 5, z: -10, wall: true }, prey: { x: 14, z: -10, d: Math.hypot(14 - p.x, -10 - p.z), moving: false, mine: true, wall: true } }), { start: { x: 5, z: -10 } });
  const hunt = r.log.filter((e) => e.mode === 'hunt');
  assert.ok(hunt.length > 20);
  const waves = Math.max(...hunt.map((e) => Math.abs(e.it.tail)));
  assert.ok(waves > 0.06, 'the tail waves while it fixes on the prey');
  assert.ok(14 - r.pos.x < 3, 'and it ends in striking distance');
});

test('gecko: frightened, it runs to its retreat', () => {
  const r = run('gecko', 12, (t) => ({ light: 0, rh: 75, temp: 25, onWall: true, home: { x: 12, z: -10, wall: true }, threat: t < 3 ? { x: 2, z: -10, d: 3 } : null }), { start: { x: 5, z: -10 } });
  assert.equal(r.log.find((e) => e.mode === 'flee')?.mode, 'flee');
  const fast = Math.max(...r.log.filter((e) => e.mode === 'flee').map((e) => e.it.speed));
  assert.ok(fast >= PROFILES.gecko.dash * 0.9);
});

test('activity: night and rain raise it, light and heat lower it, hunger overrides', () => {
  const P = PROFILES.firesal;
  assert.ok(awake(P, { light: 0, rain: 0, rh: 85, temp: 14 }) > awake(P, { light: 1, rain: 0, rh: 85, temp: 14 }) + 0.3);
  assert.ok(awake(P, { light: 1, rain: 0.8, rh: 95, temp: 14 }) > awake(P, { light: 1, rain: 0, rh: 95, temp: 14 }));
  assert.ok(awake(P, { light: 0, rain: 0, rh: 85, temp: 26 }) < awake(P, { light: 0, rain: 0, rh: 85, temp: 14 }));
  assert.ok(awake(P, { light: 1, rain: 0, rh: 60, temp: 16, hunger: 0.95 }) > awake(P, { light: 1, rain: 0, rh: 60, temp: 16, hunger: 0.2 }) + 0.2);
});

test('the minds are deterministic for a given random source and keep their numbers sane', () => {
  const a = run('gecko', 100, () => ({ light: 0, rh: 75, temp: 25, onWall: true }), { seed: 3 });
  const b = run('gecko', 100, () => ({ light: 0, rh: 75, temp: 25, onWall: true }), { seed: 3 });
  assert.deepEqual(a.log.map((e) => e.mode), b.log.map((e) => e.mode));
  for (const id of ['firesal', 'newt', 'axolotl', 'gecko']) {
    const r = run(id, 150, (t) => ({ depth: id === 'gecko' || id === 'firesal' ? 0 : 10, light: t < 60 ? 1 : 0, rh: 80, temp: 18, onWall: id === 'gecko', hunger: 0.4 + t / 400, home: { x: 3, z: 0, wall: id === 'gecko' } }), { seed: 5 });
    for (const e of r.log) {
      for (const k of ['head', 'headP', 'bend', 'tail', 'throat', 'eye']) assert.ok(Number.isFinite(e.it[k]), `${id} ${k}`);
      assert.ok(Math.abs(e.it.head) <= 1.2 && Math.abs(e.it.headP) <= 1 && Math.abs(e.it.bend) <= 0.8 && Math.abs(e.it.tail) <= 0.3, `${id} posture within the rig's range`);
      assert.ok(e.it.speed >= 0 && e.it.speed <= PROFILES[id].dash * 1.01);
    }
  }
});

test('doing: every mode has words for the inspector', async () => {
  const { doing } = await import('../src/sim/herp.js');
  for (const mode of ['warn', 'retreat', 'flee', 'air', 'soak', 'drink', 'hunt', 'hide', 'shore', 'return', 'forage', 'patrol', 'rest']) {
    const t = doing(mode, 'gecko', { prey: 'a fly' });
    assert.ok(typeof t === 'string' && t.length > 4, mode);
  }
  assert.match(doing('hunt', 'newt', { prey: 'a fly' }), /fly/);
  assert.match(doing('hide', 'gecko', { asleep: true }), /Asleep/);
});

// --- Skin, tail, courtship, larvae ----------------------------------------------------------------------------------------
test('skin: dulls for the last two days, then it is shed at home (writhing, then eaten) and the cycle restarts', () => {
  const r = run('gecko', 120, () => ({ light: 0, rh: 75, temp: 25, onWall: true, home: { x: 0, z: 0, wall: true } }), { start: { mind: { shedIn: 0.0003 } } });
  const k = r.log;
  assert.ok(k.some((e) => e.mode === 'shed'), 'it sheds');
  assert.ok(Math.max(...k.map((e) => e.it.dull)) > 0.5, 'the skin is dull before it comes off');
  assert.equal(k.filter((e) => e.it.shed).length, 1, 'one shed');
  assert.equal(k[k.length - 1].it.dull, 0, 'bright again');
  assert.ok(r.m.shedIn > 5, 'the next one is weeks away');
  const peel = k.filter((e) => e.mode === 'shed' && e.it.calm === 1);
  assert.ok(Math.max(...peel.map((e) => Math.abs(e.it.head))) > 0.4, 'the head rubs');
  assert.ok(Math.max(...peel.map((e) => e.it.throat)) > 0.8, 'and the skin is swallowed');
});

test('skin: not due, not dull', () => {
  const r = run('newt', 30, () => ({ depth: 10, light: 0, rh: 90, temp: 17 }), { start: { mind: { shedIn: 9 } } });
  assert.ok(r.log.every((e) => e.it.dull === 0 && e.mode !== 'shed'));
});

test('gecko: caught (a threat within 2.8 cm) it drops its tail once, then the tail regrows short and blunt', () => {
  const r = run('gecko', 6, (t) => ({ light: 0, rh: 75, temp: 25, onWall: true, home: { x: 12, z: -10, wall: true }, threat: t < 2 ? { x: 1.5, z: 0, d: 1.8 } : null }), { start: { x: 0, z: 0 } });
  assert.equal(r.log.filter((e) => e.it.dropTail).length, 1, 'one tail');
  assert.ok(r.m.tailF < 0.2);
  // regrowth over 40 game days
  const m = herpMind('gecko', seeded(2)); m.tailF = 0.1;
  for (let i = 0; i < 40; i++) herpThink(m, { t: i, dt: 0.1, dtMin: 1440, x: 0, z: 0, light: 0, rh: 75, temp: 25, onWall: true, kind: 'gecko', hunger: 0.2 }, seeded(i));
  assert.ok(m.tailF > 0.8 && m.tailF <= 0.85, `regrown to ${m.tailF.toFixed(2)} of the tail, never all of it`);
  const w = herpThink(Object.assign(herpMind('gecko'), { tailF: 0.2 }), { t: 0, dt: 0.1, dtMin: 0, x: 0, z: 0, kind: 'gecko', onWall: true }, seeded(1));
  assert.ok(Math.abs(w.tail) < 0.05, 'a stump hardly waves');
});

// Two animals that sense each other: the harness moves both toward their goals.
function pair(id, { sec = 240, rndSeed = 5, femaleRnd = null, depth = 0, kind = id } = {}) {
  const rnd = seeded(rndSeed);
  const A = { m: herpMind(id, rnd), p: { x: 0, z: 0 }, yaw: 0, male: true, moved: 0 };
  const B = { m: herpMind(id, rnd), p: { x: 12, z: 3 }, yaw: 0, male: false, moved: 0 };
  A.m.courtDrive = 1; A.m.shedIn = 99; B.m.shedIn = 99;
  const out = { mated: [false, false], modes: [new Set(), new Set()], birth: 0, t: 0 };
  const step = (me, other, t, r) => {
    const d = Math.hypot(other.p.x - me.p.x, other.p.z - me.p.z);
    const s = { t, dt: 0.1, dtMin: 0.1, x: me.p.x, z: me.p.z, yaw: me.yaw, moved: me.moved, depth, kind, light: 0, rh: 90, temp: 15, hunger: 0.3, male: me.male, adult: true,
      mate: { x: other.p.x, z: other.p.z, d, ok: true, courting: other.m.mode === 'court', phase: other.m.cp, recv: other.m.recv } };
    const it = herpThink(me.m, s, r);
    me.moved = 0;
    if (it.goal && it.speed > 0 && !it.calm) {
      const dx = it.goal.x - me.p.x, dz = it.goal.z - me.p.z, dd = Math.hypot(dx, dz), stop = it.stopAt ?? 0;
      if (dd > Math.max(0.2, stop)) { const st = Math.min(dd - stop, it.speed * 0.1); me.p.x += dx / dd * st; me.p.z += dz / dd * st; me.yaw = Math.atan2(dx, dz); me.moved = st; }
    }
    return it;
  };
  const rA = seeded(rndSeed + 1), rB = femaleRnd ?? seeded(rndSeed + 2);
  for (let t = 0; t < sec; t += 0.1) {
    const a = step(A, B, t, rA), b = step(B, A, t, rB);
    if (a.mated) out.mated[0] = true;
    if (b.mated) out.mated[1] = true;
    out.modes[0].add(A.m.mode); out.modes[1].add(B.m.mode);
  }
  return { ...out, A, B };
}

for (const id of ['newt', 'axolotl', 'firesal']) {
  test(`courtship (${id}): the male approaches, displays, leads off; the female watches and follows; the pair is made`, () => {
    let done = null;
    for (const seed of [5, 6, 7, 8, 9]) {            // she accepts with a chance: one of a few tries must work
      const r = pair(id, { rndSeed: seed, depth: id === 'firesal' ? 0 : 10 });
      if (r.mated[0] && r.mated[1]) { done = r; break; }
    }
    assert.ok(done, 'a pair is made');
    assert.ok(done.modes[0].has('court') && done.modes[1].has('receive') && done.modes[1].has('follow'));
    if (id === 'firesal') assert.ok(done.B.m.pregnant > 4 * 1440, 'the female fire salamander carries larvae for days');
    else assert.equal(done.B.m.pregnant, 0);
    assert.ok(done.A.m.courtCool > 0.5 && done.A.m.courtDrive < 1, 'the male is spent and rests from it for a day');
  });
}

test('courtship: a female that does not accept makes the male give up and try again later', () => {
  // she never accepts: recv is false whenever she decides
  const never = () => 0.99;
  const r = pair('newt', { rndSeed: 5, femaleRnd: never, depth: 10 });
  assert.ok(!r.mated[0] && !r.mated[1]);
  assert.ok(r.modes[0].has('court') && !r.modes[1].has('receive'));
  assert.ok(r.A.m.courtCool > 0 || r.A.m.mode !== 'court', 'he backs off');
});

test('a hungry male, a frightened one or one with no female near does not court', () => {
  const run1 = (over) => run('newt', 60, () => ({ depth: 10, light: 0, rh: 90, temp: 15, male: true, adult: true, mate: { x: 5, z: 0, d: 5, ok: true, courting: false }, ...over }), { start: { mind: { courtDrive: 1, shedIn: 99 } } });
  assert.ok(run1({}).log.some((e) => e.mode === 'court'), 'the ready male courts');
  assert.ok(!run1({ hunger: 0.9 }).log.some((e) => e.mode === 'court'), 'not when starving');
  assert.ok(!run1({ mate: null }).log.some((e) => e.mode === 'court'), 'not with nobody there');
  assert.ok(!run1({ adult: false }).log.some((e) => e.mode === 'court'), 'not a juvenile');
});

test('fire salamander with larvae: walks to the shallows, stands in them and gives birth once', () => {
  const shore = { x: 8, z: 0 };
  const r = run('firesal', 60, (t, p) => ({ light: 0, rh: 85, temp: 15, kind: 'firesal', male: false, adult: true, home: HOME, shore: { ...shore, d: Math.hypot(p.x - shore.x, p.z - shore.z) }, depth: Math.hypot(p.x - shore.x, p.z - shore.z) < 1.3 ? 0.8 : 0 }), { start: { x: 0, mind: { gravid: true, shedIn: 99 } } });
  assert.ok(r.log.some((e) => e.mode === 'larviposit'));
  const births = r.log.filter((e) => e.it.birth > 0);
  assert.equal(births.length, 1, 'one birth');
  assert.ok(births[0].it.birth >= 3 && births[0].it.birth <= 6);
  assert.ok(Math.hypot(births[0].pos.x - shore.x, births[0].pos.z - shore.z) < 1.5, 'in the shallows');
  assert.equal(r.m.gravid, false);
});

test('pregnancy runs down in game time and then the female is ready to give birth', () => {
  const m = herpMind('firesal', seeded(1)); m.pregnant = 2 * 1440; m.shedIn = 99;
  for (let i = 0; i < 4 && !m.gravid; i++) herpThink(m, { t: i, dt: 0.1, dtMin: 1000, x: 0, z: 0, kind: 'firesal', light: 0, rh: 85, temp: 15, male: false }, seeded(i));
  assert.ok(m.gravid && m.pregnant <= 0);
});

// N9s: a land salamander (fire salamander) is never carried into deep water by any mover, and is not placed on a bank top above it.
import { depthCap, depthOk, deepWithin, herpSpot as n9sSpot } from '../src/sim/placement.js';
import { HABITAT as N9S_HAB } from '../src/content/habitats.js';
test('N9s: fire salamander depth cap: no step into water deeper than maxDepth, always a way out', () => {
  const cap = depthCap(N9S_HAB.firesal, 'newt');
  assert.equal(cap, 0.6);
  assert.equal(depthCap(N9S_HAB.newt, 'newt'), 99);
  assert.equal(depthCap(N9S_HAB.firesal, 'frog'), 99);
  assert.ok(depthOk(cap, -Infinity, -Infinity));        // dry to dry
  assert.ok(depthOk(cap, -Infinity, 0.5));              // into a puddle
  assert.ok(!depthOk(cap, -Infinity, 3));               // off the bank into the pool: refused
  assert.ok(!depthOk(cap, 0.4, 1.2));
  assert.ok(depthOk(cap, 5, 3) && depthOk(cap, 5, -Infinity));   // already in: it may walk out
  assert.ok(!depthOk(cap, 3, 4));                       // but never deeper
});
test('N9s: fire salamander refused on a bank top with deep water within LAND_EDGE', () => {
  const pool = (x) => (x > 1 ? 4 : -Infinity);         // a pool from x = 1 cm on
  const ctx = (x) => ({ ground: 0, surf: pool(x) > 0 ? 4 : -Infinity, wl: 0, nearWater: () => true, deepNear: (r, m) => deepWithin((px) => pool(px), x, 0, r, m) });
  assert.ok(n9sSpot(N9S_HAB.firesal, ctx(0)).error);
  assert.equal(n9sSpot(N9S_HAB.firesal, ctx(-3)).y, 0);
  assert.equal(n9sSpot(N9S_HAB.newt, ctx(0)).y, 0);    // newts still go to the water's edge
});
