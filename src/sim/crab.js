// The vampire crab's mind (Geosesarma). Pure: no three.js, no world, so it runs under Node (tests/crab.test.mjs).
// animals.js senses the world for each crab, calls crabThink once per step and carries out what it returns.
//
// WHAT THE ANIMAL IS (the keeper's care sheet; CRAB below holds its numbers):
//   a semi-terrestrial crab that lives on land 80% of its time, wets its gills in shallow water, burrows into soil and
//   sits in cork tubes and moss; out at dusk and at night, hidden by day; 24-28 °C air, 80-90% humidity, water 22-26 °C;
//   omnivore (springtails, fruit flies, pellets, bloodworms, leaf litter); one male to two or three females; it drowns in
//   water it cannot climb out of.
//
// HOW IT DECIDES. Every step the crab has drives (0 … 1) that grow or fade with time and what it senses:
//   wet      gill moisture: dries on land (faster when the air is dry or hot), refills in water or on wet ground
//   hunger   from the sim (sim.js), the crab only acts on it
//   fear     jumps when something looms close (a large animal, the camera, a splash), then fades
//   unease   how far the spot is from the crab's comfort (temperature, humidity); makes it seek cover
// and one MODE at a time, chosen by priority (the first that applies wins):
//   exit     in water too deep or for too long: get out by the nearest climbable bank (or drown slowly if there is none)
//   flee     fear above the threshold: freeze for a moment, then sprint sideways to cover or home
//   molt     every few weeks of game time: a long stay deep in the burrow, then soft and shy for a while
//   soak     gills drying: walk to the water's edge and sit in the shallows until wet
//   display  a male with a female or a rival near: face it and wave the claws; a rival that stays gets chased
//   dig      its burrow is shallower than it wants (before hiding, before a molt): scrape loose soil out of the pit with the claws
//            and the first legs, carry the load out sideways, drop it on the spoil heap by the mouth, go back (sim/burrow.js moves
//            the soil); a spot whose walls keep sliding back in is given up and another home is chosen
//   eat      food within reach: stop and pick it up with the claws, claw to mouth, one bite at a time
//   forage   hungry or out at night: wander in short sideways bursts, steering for food it smells
//   hide     by day or uneasy: go home (a burrow or a hide) and sink into it until only the eyes show
//   rest     otherwise: sit, tap the claws, groom the eyes, look about
// Movement is in bursts (util/gait.js scuttleSpeed): the crab accelerates, runs a few shell widths and stops dead.
//
// SENSES (the object animals.js hands in, every field optional except where noted):
//   t                 seconds (real, speed-scaled), dt seconds this step, dtMin game minutes this step
//   x, z              the crab's position (cm)
//   depth             water over the ground here, cm (<= 0: dry)
//   wetGround         0 … 1 how damp the ground is (moss, wet soil)
//   light             0 dark … 1 the lamp is on;  rain 0 … 1
//   rh, temp          local air humidity (%) and temperature (°C);  waterTemp (°C)
//   cover             0 … 1 cover here (wood, cork, moss, dense plants, a burrow)
//   hunger            0 … 1
//   food              { x, z, d, kind } the nearest food it can smell, or null
//   threat            { x, z, d } the nearest looming thing (already filtered for size), or null
//   other             { x, z, d, male, morph } the nearest other vampire crab, or null
//   home              { x, z } its burrow or hide (animals.js keeps it), or null
//   shore             { x, z, d } the nearest shallow water (0.3 … 3 cm deep), or null
//   bank              { x, z, d } the nearest dry ground it can climb up to from here, or null (only asked in water)
//   burrow            at its home: { depth (cm the pit is deep now), want, wantMolt (cm it digs to), room (cm of soil left to
//                     dig into), rate (0 … 1 how easily the ground gives), spoil: { x, z } where the loads go }, or null when
//                     the home cannot be dug (rock, hardscape, water)
//   male, morph       this crab
// Every random choice goes through `rnd()` (Math.random by default) so tests can fix it.

import { scuttleSpeed, crabStride, clawRaise, smooth } from '../util/gait.js';
import { nightActivity, hideScore } from './habitat.js';
import { validGoal } from './goals.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Tunables, from the keeper's sheet where there is a number for it.
export const CRAB = {
  airT: [24, 28], waterT: [22, 26], rh: [80, 90],
  shellCm: 2.1,                 // carapace width (the baked model's scale)
  speed: 6,                     // cm/s at the top of a burst (a startled crab: 1.6x)
  burst: [0.5, 1.6],            // seconds per burst
  pause: [0.4, 2.5],            // seconds between bursts while foraging
  smell: 18,                    // cm: food further than this is not noticed (animals.js already limits the search)
  reach: 1.2,                   // cm: food this close is eaten
  biteS: 1.6,                   // seconds per bite (claw to mouth)
  dryMin: 40,                   // game minutes for gills to dry from full to empty in ideal air on bare ground
  soakAt: 0.35, soakTo: 0.95,   // go to water below this, leave above that
  soakDepth: [0.3, 3],          // cm of water it sits in to wet its gills
  safeDepth: 4,                 // cm: deeper than this it wants out at once (shell height is about 1.4 cm)
  maxUnder: 25,                 // game minutes it may stay submerged before it must leave
  drownMin: 90,                 // game minutes of being unable to get out before it drowns
  fearAt: 0.45,                 // fear above this: flee
  scareCm: 9,                   // a threat closer than this frightens it (scaled by its size by animals.js)
  freeze: [0.25, 0.9],          // seconds it freezes before it runs
  rivalCm: 8, mateCm: 10,       // males react to other crabs this close
  moltEvery: [30, 50],          // game days between molts
  moltHours: [18, 36],          // game hours hidden while molting
  softHours: 24,                // game hours shy after a molt
  digStart: 0.7,                // starts digging when the burrow is shallower than this share of what it wants
  scrape: [1.6, 3.2],           // seconds of scraping per load (at dig rate 1; harder ground takes longer)
  digStall: 10,                 // loads in a row that leave the pit no deeper (sand running back in): give the spot up
  digRest: 240,                 // game minutes before it tries a given-up spot again
  displayMax: 25,               // seconds a stand-off with another crab lasts at most
  displayRest: 90,              // seconds before it faces a crab again
  noun: 'vampire crab',
};

// The panther crab (Parathelphusa pantherina, Lake Matano, Sulawesi) on the same mind with other numbers: a big, mostly
// aquatic crab (80% water) that walks the bottom of deep, hard water and hauls out onto roots and rocks now and then. It does not
// dig, it is out by day as well, its gills want water within half an hour on land, and deep water is home, not a danger.
export const PANTHER = {
  ...CRAB,
  noun: 'panther crab', aquatic: true, dig: false,
  airT: [24, 28], waterT: [24, 27], rh: [60, 90],
  shellCm: 5, speed: 7, smell: 26, reach: 2.2, scareCm: 13, rivalCm: 16, mateCm: 18,
  dryMin: 25, soakAt: 0.5, soakTo: 0.97, soakDepth: [2, 60],
  safeDepth: 1e9, maxUnder: 1e9, drownMin: 1e9,
  haulEvery: 240,               // game minutes under water before it wants to climb out for a while
  moltEvery: [40, 70], moltHours: [12, 24],
};

// A fresh memory for a new crab. `rnd` decides the molt clock so crabs do not molt together.
export function crabMind(rnd = Math.random, P = CRAB) {
  return {
    mode: 'rest', modeT: 0,
    wet: 1, fear: 0,
    burst: 0, burstT: 0, pauseT: rnd() * 1.5,   // the current burst: its length and elapsed time; time left to pause
    goal: null, lead: rnd() < 0.5 ? 1 : -1,
    under: 0, stuck: 0,                          // game minutes submerged; game minutes unable to get out
    moltIn: (P.moltEvery[0] + rnd() * (P.moltEvery[1] - P.moltEvery[0])) * 1440, moltLeft: 0, soft: 0,
    waveT: -1, waveDur: 0, bite: 0, freezeT: 0, look: rnd() * 6.28,
    dig: null, digBest: 0, digLoads: 0, digRest: 0,  // the dig cycle; the deepest the pit got and the loads since; game minutes off digging
    abort: crabAbort,
  };
}

// The goal contract (sim/goals.js): it gave up where it was going; a pause, then a new choice.
function crabAbort() { this.goal = null; this.pauseT = 1; this.modeT = 0; }

// Comfort 0 … 1 from the keeper's ranges: 1 inside them, falling off over 4 °C and 20% outside.
export function crabComfort(temp, rh, P = CRAB) {
  const [t0, t1] = P.airT, [h0] = P.rh;
  const ct = temp < t0 ? 1 - (t0 - temp) / 4 : temp > t1 ? 1 - (temp - t1) / 4 : 1;
  const ch = rh < h0 ? 1 - (h0 - rh) / 20 : 1;
  return clamp(Math.min(ct, ch), 0, 1);
}

// How fast the gills dry, per game minute, on land: faster in dry or hot air, slower on wet ground.
export function dryRate(rh, temp, wetGround = 0, P = CRAB) {
  const air = 1 + Math.max(0, 85 - rh) / 12 + Math.max(0, temp - 26) / 6;
  return (air * (1 - 0.7 * clamp(wetGround, 0, 1))) / P.dryMin;
}

const toward = (s, p) => (p ? { x: p.x, z: p.z } : null);
const away = (s, p, dist) => { const dx = s.x - p.x, dz = s.z - p.z, l = Math.hypot(dx, dz) || 1; return { x: s.x + (dx / l) * dist, z: s.z + (dz / l) * dist }; };

// One step. Updates the memory `m` and returns the intent:
//   { mode, goal: {x, z} | null, speed (cm/s), face: {x, z} | null (turn the front toward it, standing),
//     claw 0 … 1 (claw raise for the rig's pose), feed 0 … 1 (the feeding cycle: claws pick up and carry to the mouth in turn),
//     pinch 0 … 1 (how wide the pincers are held open and snapped), calm 0 … 1 (legs still), sink 0 … 1 (into the burrow: 1 eyes only),
//     eat: true when a bite lands this step, drown: true when it has been unable to get out for too long, say: a log line or null,
//     dig: true when a load of soil is dropped on the spoil heap this step (animals.js moves it), nose: head down (scraping),
//     badHome: true when it gives up digging here (animals.js picks another home) }
export function crabThink(m, s, rnd = Math.random, P = CRAB) {
  const dt = s.dt ?? 0, dtMin = s.dtMin ?? dt / 60;
  const inWater = (s.depth ?? 0) > 0.2;
  const out = { mode: m.mode, goal: null, speed: 0, face: null, claw: 0, feed: 0, pinch: 0, calm: 1, sink: 0, eat: false, drown: false, say: null, dig: false, nose: false, badHome: false };

  // --- Drives ---------------------------------------------------------------------------------------------------------
  if (inWater) m.wet = Math.min(1, m.wet + dtMin / 3);
  else {
    const burrow = m.mode === 'molt' ? 0 : m.mode === 'hide' ? 0.3 : 1;   // a burrow holds damp air: the gills barely dry there (not at all while molting, sealed in)
    m.wet = clamp(m.wet - dryRate(s.rh ?? 85, s.temp ?? 25, s.wetGround, P) * dtMin * burrow, 0, 1);
  }
  m.under = (s.depth ?? 0) > 1.4 ? m.under + dtMin : Math.max(0, m.under - dtMin * 2);
  // Aquatic crabs (P.aquatic) build up an urge to haul out while under water; it is spent on land.
  if (P.aquatic) m.haul = inWater ? (m.haul ?? rnd()) + dtMin / P.haulEvery : Math.max(0, (m.haul ?? 0) - dtMin / 20);
  const comfort = crabComfort(s.temp ?? 25, s.rh ?? 85, P);
  const awake = P.aquatic ? 0.55 + 0.35 * (s.light ?? 0.5) : nightActivity(s.light ?? 0.5, s.rain ?? 0, s.rh ?? 85, 85);   // 0.06 by day in dry air … 1 on a damp night
  if (s.threat && s.threat.d < P.scareCm) m.fear = Math.max(m.fear, (1 - s.threat.d / P.scareCm) * (m.soft > 0 ? 1.5 : 1));
  m.fear = Math.max(0, m.fear - dt * 0.25);
  m.moltIn -= dtMin;
  m.soft = Math.max(0, m.soft - dtMin);
  m.digRest = Math.max(0, m.digRest - dtMin);

  // --- Mode ------------------------------------------------------------------------------------------------------------
  const prev = m.mode;
  let mode;
  if (inWater && ((s.depth ?? 0) > P.safeDepth || m.under > P.maxUnder)) mode = 'exit';
  else if (m.moltLeft > 0 || (m.moltIn <= 0 && (!inWater || P.aquatic))) mode = 'molt';
  else if (m.fear > P.fearAt) mode = 'flee';
  else if ((m.wet < P.soakAt || (prev === 'soak' && m.wet < P.soakTo)) && (inWater || s.shore)) mode = 'soak';   // (no water in reach: it keeps searching, it does not stand still)
  else if (s.food && s.food.d < P.reach && (s.hunger ?? 0) > 0.1) mode = 'eat';
  else if (s.male && s.other && s.other.d < (s.other.male ? P.rivalCm : P.mateCm) && awake > 0.3 && (m.noDisplay ?? 0) <= 0) mode = 'display';
  else if (P.aquatic && inWater && m.haul > 1 && s.bank && awake > 0.4) mode = 'haul';
  else if (wantsDig(m, s, prev, awake * comfort < 0.25 || comfort < 0.5, P)) mode = 'dig';
  else if (awake * comfort < 0.25 || (comfort < 0.5 && (s.cover ?? 0) < 0.3) || m.soft > 0) mode = 'hide';
  else if ((s.hunger ?? 0) > 0.25 || awake > 0.5) mode = 'forage';
  else mode = 'rest';
  // A stand-off ends: two crabs that have faced each other for P.displayMax seconds turn away for P.displayRest (they did not stare for ever).
  m.noDisplay = Math.max(0, (m.noDisplay ?? 0) - dt);
  m.dispT = mode === 'display' ? (m.dispT ?? 0) + dt : 0;
  if (m.dispT > P.displayMax) { m.noDisplay = P.displayRest; m.dispT = 0; mode = 'forage'; }
  if (mode !== prev) { m.mode = mode; m.modeT = 0; m.burst = 0; m.burstT = 0; if (mode !== 'dig') m.dig = null; }
  m.modeT += dt;
  out.mode = mode;

  // A burst: speed follows scuttleSpeed over its length; between bursts the crab stands (calm legs).
  const run = (goal, top, pause = P.pause) => {
    out.goal = goal;
    if (m.burst > 0) {
      m.burstT += dt;
      const u = m.burstT / m.burst;
      out.speed = top * scuttleSpeed(u);
      out.calm = 0;
      if (u >= 1) { m.burst = 0; m.pauseT = pause[0] + rnd() * (pause[1] - pause[0]); }
    } else if ((m.pauseT -= dt) <= 0) {
      m.burst = P.burst[0] + rnd() * (P.burst[1] - P.burst[0]); m.burstT = 0;
    }
  };

  switch (mode) {
    case 'exit': {
      if (s.bank) { out.goal = toward(s, s.bank); out.speed = P.speed * 0.8; out.calm = 0; m.stuck = Math.max(0, m.stuck - dtMin); }
      else {
        m.stuck += dtMin;
        out.goal = null; out.calm = 0.3;                           // paddles in place: nowhere to climb out
        if (m.stuck > P.drownMin) out.drown = true;
        if (m.stuck > 5 && m.stuck - dtMin <= 5) out.say = `A ${P.noun} cannot climb out of the water: it needs a ramp of rock or wood.`;
      }
      break;
    }
    case 'flee': {
      if (m.modeT < dt + 1e-9) m.freezeT = P.freeze[0] + rnd() * (P.freeze[1] - P.freeze[0]);
      if ((m.freezeT -= dt) > 0) { out.calm = 1; out.claw = 0.35; out.pinch = 0.6; break; }   // frozen, claws half up and open
      const safe = s.home && (!s.threat || Math.hypot(s.home.x - s.threat.x, s.home.z - s.threat.z) > (s.threat.d ?? 0)) ? s.home : null;
      out.goal = safe ? toward(s, safe) : s.threat ? away(s, s.threat, 12) : null;
      out.speed = P.speed * 1.6; out.calm = 0;
      if (safe && Math.hypot(s.x - safe.x, s.z - safe.z) < 1.5) { out.goal = null; out.speed = 0; out.calm = 1; out.sink = 0.7; }
      break;
    }
    case 'molt': {
      if (m.moltLeft <= 0) { m.moltLeft = (P.moltHours[0] + rnd() * (P.moltHours[1] - P.moltHours[0])) * 60; out.say = `A ${P.noun} has gone into hiding to molt.`; }
      const home = s.home ?? null;
      if (home && Math.hypot(s.x - home.x, s.z - home.z) > 1.5) { out.goal = toward(s, home); out.speed = P.speed * 0.6; out.calm = 0; break; }
      m.moltLeft -= dtMin;
      out.sink = 1;
      if (m.moltLeft <= 0) {
        m.moltIn = (P.moltEvery[0] + rnd() * (P.moltEvery[1] - P.moltEvery[0])) * 1440;
        m.soft = P.softHours * 60; m.mode = 'hide';
        out.say = `A ${P.noun} has molted; it stays hidden while its new shell hardens.`;
      }
      break;
    }
    case 'soak': {
      if (inWater && (s.depth ?? 0) >= P.soakDepth[0] && (s.depth ?? 0) <= P.soakDepth[1]) { out.calm = 1; out.claw = 0.15 + 0.1 * Math.sin((s.t ?? 0) * 3); out.feed = 0.35; break; }   // sitting in the shallows, bailing water over its mouthparts
      run(toward(s, s.shore), P.speed * 0.8, [0.2, 0.8]);
      break;
    }
    case 'eat': {
      out.face = { x: s.food.x, z: s.food.z };
      m.bite += dt;
      out.feed = 1;                                                    // each claw in turn: down, open, snap shut on it, to the mouth, nibble (instanced.js)
      if (m.bite >= P.biteS) { m.bite = 0; out.eat = true; }
      break;
    }
    case 'display': {
      const o = s.other;
      out.face = { x: o.x, z: o.z };
      if (m.waveT < 0 || m.waveT > m.waveDur + 2) { m.waveT = 0; m.waveDur = 1.2 + rnd() * 1.8; }
      m.waveT += dt;
      out.claw = clawRaise(m.waveT, m.waveDur); out.pinch = 0.85;               // raised and held open: the threat
      // A rival male that does not back off gets a short charge; morph strangers are always rivals.
      const rival = o.male || (s.morph != null && o.morph != null && o.morph !== s.morph);
      if (rival && m.modeT > 3 && o.d < P.rivalCm * 0.7) { out.goal = toward(s, o); out.speed = P.speed * 1.2; out.calm = 0; out.claw = 1; }
      break;
    }
    case 'dig': digStep(m, s, out, dt, rnd, P); break;
    case 'haul': {
      // An aquatic crab hauls out now and then: up a root or a rock, where it sits until its gills want water again (soak).
      run(toward(s, s.bank), P.speed * 0.7, [0.2, 0.8]);
      break;
    }
    case 'hide': {
      const home = s.home ?? null;
      if (home && Math.hypot(s.x - home.x, s.z - home.z) > 1.5) run(toward(s, home), P.speed * 0.7, [0.2, 0.6]);
      else { out.sink = 1 - 0.4 * smooth(Math.sin((s.t ?? 0) * 0.13 + m.look) * 0.5 + 0.5) * (1 - (m.soft > 0 ? 1 : 0)); out.calm = 1; }   // peeks now and then
      break;
    }
    case 'forage': {
      // Smell first; otherwise a wander that keeps a heading and drifts back toward home (a home range, not the whole tank).
      if (s.food && s.food.d < P.smell) { run(toward(s, s.food), P.speed * 0.8, [0.15, 0.6]); break; }
      if (!m.goal || Math.hypot(s.x - m.goal.x, s.z - m.goal.z) < 1 || m.modeT > 20) {
        const h = s.home, hx = h ? h.x - s.x : 0, hz = h ? h.z - s.z : 0, hd = Math.hypot(hx, hz);
        const a = rnd() * Math.PI * 2, r = 4 + rnd() * 8, pull = h ? clamp((hd - 15) / 20, 0, 0.8) : 0;
        const gx = s.x + Math.sin(a) * r * (1 - pull) + (hd ? (hx / hd) * r * pull : 0), gz = s.z + Math.cos(a) * r * (1 - pull) + (hd ? (hz / hd) * r * pull : 0);
        m.goal = validGoal(s, gx, gz) ? { x: gx, z: gz } : null;
        m.modeT = 0;
      }
      run(m.goal, P.speed * (0.55 + 0.45 * awake));
      // Between bursts it picks at the ground with both claws, a bit at a time to the mouth; walking, it holds them half open, ready.
      if (out.calm >= 1) out.feed = 0.55 + 0.45 * clamp(s.hunger ?? 0.5, 0, 1);
      else out.pinch = 0.3;
      break;
    }
    default: {   // rest: still, with small claw taps and eye grooming
      m.look += dt * 0.7;
      out.claw = 0.08 * Math.max(0, Math.sin(m.look * 2.3)) ** 6;
      out.pinch = out.claw * 6;
    }
  }
  return out;
}

// Dig when the home's pit is shallower than it wants: before hiding for the day (`hiding`), and deeper before a molt. Not
// while soft after a molt, not on a spot given up a little while ago; once started it keeps on until the pit is deep enough.
function wantsDig(m, s, prev, hiding, P = CRAB) {
  if (P.dig === false) return false;
  const b = s.burrow;
  if (!b || m.soft > 0 || m.digRest > 0 || (s.depth ?? 0) > 0.2 || b.room < 0.25 || b.rate <= 0.05) return false;
  const moltSoon = m.moltIn < 2 * 1440;
  const want = Math.min(moltSoon ? b.wantMolt ?? b.want : b.want, b.room);
  if (prev === 'dig') return b.depth < want;
  return (hiding || moltSoon) && b.depth < want * P.digStart;
}

// The dig cycle: scrape in the pit (claws pumping, legs shuffling it sideways, head down), carry the load out to the spoil
// heap, drop it (out.dig), walk back. Harder ground means longer scraping for the same load.
function digStep(m, s, out, dt, rnd, P = CRAB) {
  const home = s.home, b = s.burrow;
  const d = (m.dig ??= { ph: 'back', t: 0, dur: 0 });
  d.t += dt;
  const at = (p, r) => Math.hypot(s.x - p.x, s.z - p.z) < r;
  switch (d.ph) {
    case 'back':
      if (at(home, 0.7)) { d.ph = 'scrape'; d.t = 0; d.dur = (P.scrape[0] + rnd() * (P.scrape[1] - P.scrape[0])) / Math.max(0.25, b.rate); break; }
      out.goal = { x: home.x, z: home.z }; out.speed = P.speed * 0.4; out.calm = 0;
      break;
    case 'scrape': {
      // Shuffles a few millimetres to and fro across the pit as it scrapes: the legs work, the body stays put.
      const sx = b.spoil.x - home.x, sz = b.spoil.z - home.z, l = Math.hypot(sx, sz) || 1, w = Math.sin(d.t * 2.4) * 0.45;
      out.goal = { x: home.x - (sz / l) * w, z: home.z + (sx / l) * w }; out.speed = 0.9; out.calm = 0.35;
      out.claw = 0.12 + 0.3 * Math.abs(Math.sin(d.t * 5.5));
      out.nose = true; out.sink = 0.15;
      if (d.t >= d.dur) { d.ph = 'carry'; d.t = 0; }
      break;
    }
    case 'carry':
      if (at(b.spoil, 0.8) || d.t > 6) { d.ph = 'dump'; d.t = 0; break; }
      out.goal = { x: b.spoil.x, z: b.spoil.z }; out.speed = P.speed * 0.3; out.calm = 0; out.claw = 0.45;   // the load held under the body
      break;
    case 'dump':
      out.face = { x: b.spoil.x, z: b.spoil.z }; out.claw = 0.45 + 0.4 * Math.sin(Math.min(1, d.t / 0.5) * Math.PI);
      if (d.t >= 0.5) {
        out.dig = true; d.ph = 'back'; d.t = 0;
        // Progress: a pit that does not get deeper over many loads is sand running back in.
        if (b.depth > m.digBest + 0.08) { m.digBest = b.depth; m.digLoads = 0; } else m.digLoads++;
        if (m.digLoads >= P.digStall) { m.digRest = P.digRest; m.digLoads = 0; m.digBest = 0; out.badHome = true; m.mode = 'hide'; }
      }
      break;
  }
}

// Which side leads: a crab walks toward local -x when `lead` is +1 (render/creatures/instanced.js legAxis 'x'); to head
// along the world direction (dx, dz) it may lead with either side. Returns { yaw, lead } with the smaller turn from `yaw0`.
// yaw is the model's rotation about y (the model faces +z), as everywhere in animals.js.
export function crabHeading(dx, dz, yaw0) {
  const dir = Math.atan2(dx, dz);
  const a = dir + Math.PI / 2, b = dir - Math.PI / 2;                // left side leading, right side leading
  const wrap = (v) => ((v + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Math.abs(wrap(a - yaw0)) <= Math.abs(wrap(b - yaw0)) ? { yaw: a, lead: 1 } : { yaw: b, lead: -1 };
}

// Leg phase advance (radians) for `cm` walked, for a crab of shell width `shellCm`: one leg cycle per crabStride.
export const crabGaitRate = (shellCm = CRAB.shellCm) => (Math.PI * 2) / crabStride(shellCm);

// Keeper's capacity: 3 to 4 crabs per 10 US gallons (38 L) of a horizontal tank, i.e. about one per 300 cm² of land;
// returns the largest healthy group for `landCm2` square centimetres of land.
export const crabCapacity = (landCm2) => Math.max(1, Math.floor(landCm2 / 300));

// The keeper's sex ratio: one male to two or three females. Returns null when fine, else what is wrong.
export function crabGroupIssue(males, females) {
  if (males > 1 && females < males * 2) return 'Too many male vampire crabs: keep one male to two or three females, or they fight.';
  return null;
}
