// The red-eyed crocodile skink's mind (Tribolonotus gracilis, New Guinea). Pure: no three.js, no world, so it runs under
// Node (tests/caresheet.test.mjs, tests/skink-ethogram.test.mjs). animals.js senses the world for each skink, calls
// skinkThink once per step and carries out what it returns (the same split as the vampire crab, sim/crab.js).
//
// WHAT THE ANIMAL IS (the keeper's care sheet; SKINK below holds its numbers):
//   a shy, armoured little lizard of humid stream banks: 80% land, 20% shallow water it soaks in (no deeper than 5-7 cm,
//   with textured ways out); 23-27 °C air with a mild warm spot of 28-29 °C, 80-90% humidity and more; low UVB (index about
//   2); out at dusk and in the evening, under cork bark and leaf litter by day; eats insects and worms (isopods, flies,
//   larvae); one animal or a bonded pair, never two males. Startled, it freezes, then may flip over and play dead for a
//   while, and it squeaks.
//
// WHAT IT DOES (the ethogram, task S3). Each number in SKINK says where it comes from: footage (one clip of a real skink,
// docs/agents/lizards/MOTION_skink.md), species data (species-info.js, habitats.js, the SPECIES row in animals.js) or guess.
//   - Startled (a threat within scareCm) it freezes at once: feet planted, forebody propped, the head scanning left and
//     right. The freeze holds its full time even when the threat goes (footage: 5 s and more).
//   - If the threat is still there when the freeze ends, it dashes head first to the nearest cover (`refuge`, else `home`),
//     in bursts: a burst ends in cover or in a short stop (a freeze), then the next burst.
//   - Cornered (no cover within cornerCm) by a very close threat, it may flop over and play dead instead (species data).
//   - By day it hides; at dusk and at night (or hungry) it forages, within reach of water and of cover (habitats.js).
//   - Dry, it soaks in the shallows; cold, it basks; another male close by is walked away from (territorial, SPECIES row).
//   - It lives on the ground: a point the world marks as a wall or glass is never a goal (`surface` is always 'ground').
//
// DRIVES (0 … 1): wet (skin and body water: dries on land in dry air, refills in water or on wet ground), warm (body heat:
// gains under the warm spot, loses in cool air), fear (something looming close), and hunger from the sim.
// Two clocks: seconds (dt) for the freeze, the dash, play-dead and the forage rhythm; game minutes (dtMin) for the drives.
// MODES, first that applies wins:
//   dead     playing dead: lies on its back for a while, then rights itself and hides
//   flee     out of its depth: walks back to the bank
//   freeze   startled (or stopped between two dash bursts): still, propped, head scanning, for its drawn time
//   flee     a dash burst under way, or the freeze ended with the threat still there: dash to the nearest cover; under it,
//            it stays sunk while afraid
//   avoid    another male within rivalCm: walks away from it
//   soak     drying out or too hot: walks to shallow water and lies in it with the head out
//   bask     cold (morning): goes to the warm spot and lies flat under it for a while
//   hunt     the sim ordered a meal (animals.js `order`), or very hungry with prey near: animals.js drives the walk and strike
//   forage   awake (dusk, night, rain) or hungry: slow walk with pauses, nosing the litter, near water and cover
//   hide     otherwise by day: into its hide (home, else the nearest cover), only the head showing now and then
//   rest     otherwise
//
// SENSES (all optional except t, dt, x, z): t, dt (s), dtMin (game min), x, z, depth (water over the ground here, cm),
// wetGround 0 … 1, light 0 … 1, rain 0 … 1, rh (%), temp (°C here), cover 0 … 1 here, hunger 0 … 1, threat {x, z, d} or null,
// home {x, z} or null, refuge {x, z, d} (the nearest cover; until animals.js gives it, `home` stands in), shore {x, z, d}
// (the nearest water 0.5 … 4 cm deep; the mind remembers the last one it saw) or null, warm {x, z, d, temp} (the warmest
// spot near it) or null, rival {x, z, d} (the nearest other male skink, for a male) or null, hunting (true while animals.js
// runs a hunt for it). A point with `wall`, `glass` or a `surface` other than 'ground' is ignored.

import { nightActivity } from './habitat.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const SKINK = {
  airT: [23, 27], bask: 28.5, rh: [80, 95], uvb: 2,
  speed: 3.2,                  // cm/s walking (guess: the footage shows no slow walk)
  svl: 9,                      // cm snout to vent (footage, estimated; about 17 cm with the tail)
  dash: 13.5,                  // cm/s = 1.5 x svl, 1.5 body lengths a second (footage, estimated 1-2: MOTION_skink.md:26)
  burst: [0.9, 1.6],           // s one dash burst lasts (footage: at least 0.9 s; the upper end a guess)
  stop: [0.4, 1.2],            // s frozen between two bursts (guess)
  fleeCm: 15,                  // cm it runs straight away when it knows no cover (guess, as before)
  soakDepth: [0.5, 4],         // cm of water it lies in
  maxDepth: 6,                 // deeper than this it cannot stand and swims badly: it heads for the bank
  dryMin: 300,                 // game minutes for the body to dry from full to empty in ideal air on bare ground
  soakAt: 0.35, soakTo: 0.9,
  coolMin: 240,                // game minutes to cool from warm to cold in 23 °C air
  baskAt: 0.3, baskTo: 0.85,
  fearAt: 0.4, deadAt: 0.85,   // fear thresholds: freeze/flee, play dead
  scareCm: 14,
  freeze: [5, 8],              // s frozen after a startle (footage: at least 5.0 s, measured; the upper end a guess)
  scanS: 2.25,                 // s per head-scan cycle while frozen (footage, estimated 2-2.5 s)
  scanYaw: 0.65,               // rad of head yaw at each end of a scan (footage, estimated +-30-45 deg)
  inCover: 1.2,                // cm from a cover point that counts as under it (guess)
  cornerCm: 20,                // no cover nearer than this: cornered (guess)
  deadP: 0.35,                 // chance a cornered, very close fright ends in playing dead (guess; species data: "may")
  deadS: [8, 25],              // s playing dead (guess)
  waterReach: 40,              // cm: forages within this of water (species data: habitats.js skink `water`)
  coverReach: 10,              // cm: forages within this of cover (species data: habitats.js skink `cover`)
  rivalCm: 10,                 // cm: another male this close is walked away from (guess; species data: never two males)
  roam: [3, 12],               // cm to the next forage spot (guess, as before)
  pause: [1, 5], walk: [1.5, 4],   // forage rhythm: seconds still, seconds walking (guess)
};

// The refuge (the cover it hides under) is on land (N11c): cover 0.6 or more and no water over the ground there (the same
// test as animals.js okFor('land'): `depth` = water surface minus ground, cm, -Infinity when dry). A covered spot in the stream
// is not one: taken as the refuge, it kept the skink hiding and foraging in the water all day (streambank, 99 % in water).
export const REFUGE_COVER = 0.6;   // (0.6 a guess, as before: the 0.5 edge of a patch is reached short by the stop distance)
export function skinkRefugeOk(cover, depth) { return cover >= REFUGE_COVER && !(depth > -0.2); }

export function skinkMind(rnd = Math.random) {
  return { mode: 'hide', modeT: 0, wet: 0.9, warm: 0.6, fear: 0, goal: null, walkT: 0, pauseT: rnd() * 2, freezeT: 0, burstT: 0, deadT: 0, squeak: false, look: rnd() * 6.28, water: null };
}

// Comfort 0 … 1 for the air here, from the keeper's ranges.
export function skinkComfort(temp, rh) {
  const [t0, t1] = SKINK.airT;
  const ct = temp < t0 ? 1 - (t0 - temp) / 4 : temp > t1 + 2 ? 1 - (temp - t1 - 2) / 3 : 1;
  const ch = rh < SKINK.rh[0] ? 1 - (SKINK.rh[0] - rh) / 20 : 1;
  return clamp(Math.min(ct, ch), 0, 1);
}

const toward = (p) => (p ? { x: p.x, z: p.z } : null);
const away = (s, p, dist) => { const dx = s.x - p.x, dz = s.z - p.z, l = Math.hypot(dx, dz) || 1; return { x: s.x + (dx / l) * dist, z: s.z + (dz / l) * dist }; };
const near = (s, p, r) => p && Math.hypot(s.x - p.x, s.z - p.z) < r;
// The surface rule: the skink lives on the ground, so a wall or glass point is never a place to go.
const ground = (p) => (p && !p.wall && !p.glass && (p.surface == null || p.surface === 'ground') ? p : null);
// Pulls a point to within r of an anchor (no anchor: unchanged).
const within = (g, a, r) => {
  if (!a) return g;
  const dx = g.x - a.x, dz = g.z - a.z, d = Math.hypot(dx, dz);
  return d <= r ? g : { x: a.x + (dx / d) * r, z: a.z + (dz / d) * r };
};

// One step: updates `m`, returns { mode, goal, speed, calm (legs still), flat (belly down, 0 … 1), roll (on its back, 0 … 1),
// headUp 0 … 1, sink (into the litter, 0 … 1), say } and for the animation: pose ('propped' | 'dash' | 'dead' | 'flat' |
// 'hidden' | 'walk' | 'stand'), propped 0 … 1 (forebody up on straight forelimbs), scan (head yaw, rad), dash (running:
// trunk low, tail in S-waves), dead (on its back), surface (always 'ground').
export function skinkThink(m, s, rnd = Math.random) {
  const dt = s.dt ?? 0, dtMin = s.dtMin ?? dt / 60;
  const depth = s.depth ?? 0, inWater = depth > 0.3;
  const out = { mode: m.mode, goal: null, speed: 0, calm: 1, flat: 0, roll: 0, headUp: 0, sink: 0, say: null, pose: 'stand', propped: 0, scan: 0, dash: false, dead: false, surface: 'ground' };
  const draw = (r) => r[0] + rnd() * (r[1] - r[0]);
  const home = ground(s.home), refuge = ground(s.refuge), warm = ground(s.warm), seen = ground(s.shore);
  if (seen) m.water = { x: seen.x, z: seen.z };
  const shore = seen ?? m.water ?? null, threat = s.threat ?? null;

  // Drives (game minutes).
  if (inWater) m.wet = Math.min(1, m.wet + dtMin / 20);
  else {
    const air = 1 + Math.max(0, 85 - (s.rh ?? 85)) / 10 + Math.max(0, (s.temp ?? 25) - 27) / 4;
    const shelter = m.mode === 'hide' ? 0.35 : 1;
    m.wet = clamp(m.wet - (air * (1 - 0.6 * clamp(s.wetGround ?? 0, 0, 1)) * shelter * dtMin) / SKINK.dryMin, 0, 1);
  }
  const t = s.temp ?? 25;
  m.warm = clamp(m.warm + ((t - 24) / 5) * (dtMin / SKINK.coolMin) * (t > 24 ? 2 : 1), 0, 1);
  // Fear (seconds).
  if (threat && threat.d < SKINK.scareCm) m.fear = Math.max(m.fear, 1 - threat.d / SKINK.scareCm);
  m.fear = Math.max(0, m.fear - dt * (m.mode === 'dead' ? 0.02 : 0.12));
  const awake = nightActivity(s.light ?? 0.5, s.rain ?? 0, s.rh ?? 85, 85);
  const comfort = skinkComfort(t, s.rh ?? 85);

  // The cover to run to: the nearest (refuge), else home; not one the threat is nearer to than the skink is.
  const clear = (p) => p && (!threat || Math.hypot(p.x - threat.x, p.z - threat.z) > Math.hypot(p.x - s.x, p.z - s.z));
  const cover = clear(refuge) ? refuge : clear(home) ? home : null;
  const coverD = cover ? Math.hypot(cover.x - s.x, cover.z - s.z) : Infinity, inCover = coverD <= SKINK.inCover;
  const rival = s.rival && s.rival.d < SKINK.rivalCm ? s.rival : null;

  // Mode.
  const prev = m.mode;
  let mode;
  if (prev === 'dead' && m.deadT > 0) mode = 'dead';
  else if (depth > SKINK.maxDepth) mode = 'flee';                                    // out of its depth: back to the bank
  else if (prev === 'freeze' && m.freezeT > 0) mode = 'freeze';                      // a freeze holds its time
  else if (prev === 'flee' && m.burstT > 0 && !inCover) mode = 'flee';               // a burst runs its time
  else if (m.fear > SKINK.fearAt) {
    if (prev === 'freeze') mode = coverD > SKINK.cornerCm && m.fear > SKINK.deadAt && rnd() < SKINK.deadP ? 'dead' : 'flee';
    else if (prev === 'flee') mode = inCover ? 'flee' : 'freeze';                    // a burst over: under cover, or a stop
    else mode = 'freeze';
  }
  else if (rival) mode = 'avoid';
  else if (m.wet < SKINK.soakAt || (prev === 'soak' && m.wet < SKINK.soakTo) || (t > SKINK.airT[1] + 3 && shore)) mode = 'soak';
  else if ((m.warm < SKINK.baskAt || (prev === 'bask' && m.warm < SKINK.baskTo)) && warm && warm.temp > t + 1) mode = 'bask';
  else if (s.hunting) mode = 'hunt';
  else if (awake > 0.45 || (s.hunger ?? 0) > 0.55) mode = 'forage';
  else if (awake * comfort < 0.45) mode = 'hide';
  else mode = 'rest';
  if (mode !== prev) {
    m.mode = mode; m.modeT = 0;
    if (mode === 'freeze') m.freezeT = draw(prev === 'flee' ? SKINK.stop : SKINK.freeze);
    if (mode === 'flee') m.burstT = depth > SKINK.maxDepth ? 0 : draw(SKINK.burst);
    if (mode === 'dead') { m.deadT = draw(SKINK.deadS); out.say = 'A crocodile skink squeaked and is playing dead. Give it a moment.'; }
  }
  m.modeT += dt;
  out.mode = mode;

  // A slow walk in bouts: walk, stop, look, walk on.
  const stroll = (goal, speed) => {
    if (!goal) return;
    if (m.walkT > 0) { m.walkT -= dt; out.goal = goal; out.speed = speed; out.calm = 0; if (m.walkT <= 0) m.pauseT = draw(SKINK.pause); }
    else if ((m.pauseT -= dt) <= 0) m.walkT = draw(SKINK.walk);
    else out.headUp = 0.4 + 0.3 * Math.sin((s.t ?? 0) * 1.3 + m.look);
  };

  switch (mode) {
    case 'dead':
      m.deadT -= dt; out.roll = 1; out.calm = 1; out.dead = true; out.pose = 'dead';
      if (m.deadT <= 0) { m.fear = SKINK.fearAt * 0.9; m.mode = 'hide'; }
      break;
    case 'freeze':
      m.freezeT -= dt; out.calm = 1; out.propped = 1; out.headUp = 0.3; out.pose = 'propped';
      out.scan = SKINK.scanYaw * Math.sin((m.modeT / SKINK.scanS) * Math.PI * 2 + m.look);
      break;
    case 'flee': {
      if (depth > SKINK.maxDepth) { out.goal = toward(shore); out.speed = SKINK.speed; out.calm = out.goal ? 0 : 1; break; }
      if (inCover) { out.sink = 0.6; out.pose = 'hidden'; break; }                    // under it (went in head first)
      m.burstT -= dt;
      out.goal = cover ? toward(cover) : threat ? away(s, threat, SKINK.fleeCm) : null;
      if (out.goal) { out.speed = SKINK.dash; out.calm = 0; out.dash = true; out.pose = 'dash'; }
      break;
    }
    case 'avoid':
      out.goal = away(s, rival, SKINK.rivalCm); out.speed = SKINK.speed; out.calm = 0;
      break;
    case 'soak':
      if (inWater && depth <= SKINK.soakDepth[1]) { out.calm = 1; out.flat = 1; out.headUp = 0.6; break; }   // lies in the shallows, head out
      out.goal = toward(shore); out.speed = SKINK.speed; out.calm = out.goal ? 0 : 1;
      break;
    case 'bask':
      if (near(s, warm, 1.5)) { out.flat = 1; out.calm = 1; break; }
      out.goal = toward(warm); out.speed = SKINK.speed; out.calm = 0;
      break;
    case 'hunt': out.calm = 0; break;                      // animals.js walks it to the prey
    case 'forage': {
      if (!m.goal || near(s, m.goal, 1) || m.modeT > 25) {
        const a = rnd() * Math.PI * 2, r = draw(SKINK.roam);
        const g = within({ x: s.x + Math.sin(a) * r, z: s.z + Math.cos(a) * r }, shore, SKINK.waterReach);
        m.goal = within(g, refuge ?? home, SKINK.coverReach);                       // cover wins over water
        m.modeT = 0;
      }
      const anchor = refuge ?? home;
      if (anchor && !near(s, anchor, SKINK.coverReach)) { out.goal = toward(m.goal); out.speed = SKINK.speed; out.calm = 0; break; }   // in the open: back within reach of cover first, no pauses
      stroll(m.goal, SKINK.speed * (0.6 + 0.4 * awake));
      break;
    }
    case 'hide': {
      const den = home ?? refuge;
      if (den && !near(s, den, SKINK.inCover)) { out.goal = toward(den); out.speed = SKINK.speed * 0.8; out.calm = 0; break; }
      out.sink = 0.55 - 0.35 * Math.max(0, Math.sin((s.t ?? 0) * 0.11 + m.look));   // peeks out now and then
      out.flat = 0.6; out.pose = 'hidden';
      break;
    }
    default:
      out.headUp = 0.3 + 0.3 * Math.sin((s.t ?? 0) * 0.7 + m.look);
  }
  if (out.pose === 'stand') out.pose = out.speed > 0 ? 'walk' : out.flat >= 1 ? 'flat' : 'stand';
  return out;
}
