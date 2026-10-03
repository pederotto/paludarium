// The red-eyed crocodile skink's mind (Tribolonotus gracilis, New Guinea). Pure: no three.js, no world, so it runs under
// Node (tests/skink.test.mjs). animals.js senses the world for each skink, calls skinkThink once per step and carries out
// what it returns (the same split as the vampire crab, sim/crab.js).
//
// WHAT THE ANIMAL IS (the keeper's care sheet; SKINK below holds its numbers):
//   a shy, armoured little lizard of humid stream banks: 80% land, 20% shallow water it soaks in (no deeper than 5-7 cm,
//   with textured ways out); 23-27 °C air with a mild warm spot of 28-29 °C, 80-90% humidity and more; low UVB (index about
//   2); out at dusk and in the evening, under cork bark and leaf litter by day; eats insects and worms (isopods, flies,
//   larvae); one animal or a bonded pair, never two males. Startled, it freezes, then may flip over and play dead for a
//   while, and it squeaks.
//
// DRIVES (0 … 1): wet (skin and body water: dries on land in dry air, refills in water or on wet ground), warm (body heat:
// gains under the warm spot, loses in cool air), fear (something looming close), and hunger from the sim.
// MODES, first that applies wins:
//   dead     fear spiked very high: lies still on its side for a while (playing dead), then rights itself and hides
//   freeze   fear above the threshold: stops dead, head low
//   flee     fear stays: runs to its hide
//   soak     drying out or too hot: walks to shallow water and lies in it with the head out
//   bask     cold (morning): goes to the warm spot and lies flat under it for a while
//   hunt     the sim ordered a meal (animals.js `order`), or very hungry with prey near: animals.js drives the walk and strike
//   forage   awake (dusk, night, rain) or hungry: slow walk with pauses, nosing the litter
//   hide     otherwise by day: back into its hide (cover, litter, moss), only the head showing now and then
//   rest     otherwise
//
// SENSES (all optional except t, dt, x, z): t, dt (s), dtMin (game min), x, z, depth (water over the ground here, cm),
// wetGround 0 … 1, light 0 … 1, rain 0 … 1, rh (%), temp (°C here), cover 0 … 1 here, hunger 0 … 1, threat {x, z, d} or null,
// home {x, z} or null, shore {x, z, d} (the nearest water 0.5 … 4 cm deep) or null, warm {x, z, d, temp} (the warmest spot
// near it) or null, hunting (true while animals.js runs a hunt for it).

import { nightActivity } from './habitat.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const SKINK = {
  airT: [23, 27], bask: 28.5, rh: [80, 95], uvb: 2,
  speed: 3.2,                  // cm/s walking; a startled run is 2x
  soakDepth: [0.5, 4],         // cm of water it lies in
  maxDepth: 6,                 // deeper than this it cannot stand and swims badly: it heads for the bank
  dryMin: 300,                 // game minutes for the body to dry from full to empty in ideal air on bare ground
  soakAt: 0.35, soakTo: 0.9,
  coolMin: 240,                // game minutes to cool from warm to cold in 23 °C air
  baskAt: 0.3, baskTo: 0.85,
  fearAt: 0.4, deadAt: 0.85,   // fear thresholds: freeze/flee, play dead
  scareCm: 14,
  freeze: [1, 4],              // seconds frozen before it runs
  deadS: [8, 25],              // seconds playing dead
  pause: [1, 5], walk: [1.5, 4],   // forage rhythm: seconds still, seconds walking
};

export function skinkMind(rnd = Math.random) {
  return { mode: 'hide', modeT: 0, wet: 0.9, warm: 0.6, fear: 0, goal: null, walkT: 0, pauseT: rnd() * 2, freezeT: 0, deadT: 0, squeak: false, look: rnd() * 6.28 };
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

// One step: updates `m`, returns { mode, goal, speed, calm (legs still), flat (belly down, 0 … 1), roll (on its back, 0 … 1),
// headUp 0 … 1, sink (into the litter, 0 … 1), say }.
export function skinkThink(m, s, rnd = Math.random) {
  const dt = s.dt ?? 0, dtMin = s.dtMin ?? dt / 60;
  const depth = s.depth ?? 0, inWater = depth > 0.3;
  const out = { mode: m.mode, goal: null, speed: 0, calm: 1, flat: 0, roll: 0, headUp: 0, sink: 0, say: null };

  // Drives.
  if (inWater) m.wet = Math.min(1, m.wet + dtMin / 20);
  else {
    const air = 1 + Math.max(0, 85 - (s.rh ?? 85)) / 10 + Math.max(0, (s.temp ?? 25) - 27) / 4;
    const shelter = m.mode === 'hide' ? 0.35 : 1;
    m.wet = clamp(m.wet - (air * (1 - 0.6 * clamp(s.wetGround ?? 0, 0, 1)) * shelter * dtMin) / SKINK.dryMin, 0, 1);
  }
  const t = s.temp ?? 25;
  m.warm = clamp(m.warm + ((t - 24) / 5) * (dtMin / SKINK.coolMin) * (t > 24 ? 2 : 1), 0, 1);
  if (s.threat && s.threat.d < SKINK.scareCm) m.fear = Math.max(m.fear, 1 - s.threat.d / SKINK.scareCm);
  m.fear = Math.max(0, m.fear - dt * (m.mode === 'dead' ? 0.02 : 0.12));
  const awake = nightActivity(s.light ?? 0.5, s.rain ?? 0, s.rh ?? 85, 85);
  const comfort = skinkComfort(t, s.rh ?? 85);

  // Mode.
  const prev = m.mode;
  let mode;
  if (prev === 'dead' && m.deadT > 0) mode = 'dead';
  else if (m.fear > SKINK.deadAt && prev === 'freeze' && rnd() < dt * 0.8) mode = 'dead';
  else if (m.fear > SKINK.fearAt) mode = prev === 'flee' || (prev === 'freeze' && m.freezeT <= 0) ? 'flee' : 'freeze';
  else if (depth > SKINK.maxDepth) mode = 'flee';                                    // out of its depth: back to the bank
  else if (m.wet < SKINK.soakAt || (prev === 'soak' && m.wet < SKINK.soakTo) || (t > SKINK.airT[1] + 3 && s.shore)) mode = 'soak';
  else if ((m.warm < SKINK.baskAt || (prev === 'bask' && m.warm < SKINK.baskTo)) && s.warm && s.warm.temp > t + 1) mode = 'bask';
  else if (s.hunting) mode = 'hunt';
  else if (awake > 0.45 || (s.hunger ?? 0) > 0.55) mode = 'forage';
  else if (awake * comfort < 0.45) mode = 'hide';
  else mode = 'rest';
  if (mode !== prev) {
    m.mode = mode; m.modeT = 0;
    if (mode === 'freeze') m.freezeT = SKINK.freeze[0] + rnd() * (SKINK.freeze[1] - SKINK.freeze[0]);
    if (mode === 'dead') { m.deadT = SKINK.deadS[0] + rnd() * (SKINK.deadS[1] - SKINK.deadS[0]); out.say = 'A crocodile skink squeaked and is playing dead. Give it a moment.'; }
  }
  m.modeT += dt;
  out.mode = mode;

  // A slow walk in bouts: walk, stop, look, walk on.
  const stroll = (goal, speed) => {
    if (!goal) return;
    if (m.walkT > 0) { m.walkT -= dt; out.goal = goal; out.speed = speed; out.calm = 0; if (m.walkT <= 0) m.pauseT = SKINK.pause[0] + rnd() * (SKINK.pause[1] - SKINK.pause[0]); }
    else if ((m.pauseT -= dt) <= 0) m.walkT = SKINK.walk[0] + rnd() * (SKINK.walk[1] - SKINK.walk[0]);
    else out.headUp = 0.4 + 0.3 * Math.sin((s.t ?? 0) * 1.3 + m.look);
  };

  switch (mode) {
    case 'dead':
      m.deadT -= dt; out.roll = 1; out.calm = 1;
      if (m.deadT <= 0) { m.fear = SKINK.fearAt * 0.9; m.mode = 'hide'; }
      break;
    case 'freeze':
      m.freezeT -= dt; out.flat = 0.8; out.calm = 1;
      break;
    case 'flee': {
      const safe = s.home && (!s.threat || Math.hypot(s.home.x - s.threat.x, s.home.z - s.threat.z) > s.threat.d) ? s.home : null;
      out.goal = depth > SKINK.maxDepth && s.shore ? toward(s.shore) : safe ? toward(safe) : s.threat ? away(s, s.threat, 15) : null;
      out.speed = SKINK.speed * 2; out.calm = 0;
      if (safe && near(s, safe, 1.2)) { out.goal = null; out.speed = 0; out.calm = 1; out.sink = 0.6; }
      break;
    }
    case 'soak':
      if (inWater && depth <= SKINK.soakDepth[1]) { out.calm = 1; out.flat = 1; out.headUp = 0.6; break; }   // lies in the shallows, head out
      out.goal = toward(s.shore); out.speed = SKINK.speed; out.calm = out.goal ? 0 : 1;
      break;
    case 'bask':
      if (near(s, s.warm, 1.5)) { out.flat = 1; out.calm = 1; break; }
      out.goal = toward(s.warm); out.speed = SKINK.speed; out.calm = 0;
      break;
    case 'hunt': out.calm = 0; break;                      // animals.js walks it to the prey
    case 'forage': {
      if (!m.goal || near(s, m.goal, 1) || m.modeT > 25) {
        const h = s.home, hx = h ? h.x - s.x : 0, hz = h ? h.z - s.z : 0, hd = Math.hypot(hx, hz);
        const a = rnd() * Math.PI * 2, r = 3 + rnd() * 9, pull = h ? clamp((hd - 18) / 20, 0, 0.8) : 0;
        m.goal = { x: s.x + Math.sin(a) * r * (1 - pull) + (hd ? (hx / hd) * r * pull : 0), z: s.z + Math.cos(a) * r * (1 - pull) + (hd ? (hz / hd) * r * pull : 0) };
        m.modeT = 0;
      }
      stroll(m.goal, SKINK.speed * (0.6 + 0.4 * awake));
      break;
    }
    case 'hide': {
      const home = s.home ?? null;
      if (home && !near(s, home, 1.2)) { out.goal = toward(home); out.speed = SKINK.speed * 0.8; out.calm = 0; break; }
      out.sink = 0.55 - 0.35 * Math.max(0, Math.sin((s.t ?? 0) * 0.11 + m.look));   // peeks out now and then
      out.flat = 0.6;
      break;
    }
    default:
      out.headUp = 0.3 + 0.3 * Math.sin((s.t ?? 0) * 0.7 + m.look);
  }
  return out;
}
