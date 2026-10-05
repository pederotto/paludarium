// The minds of the salamanders, newts, axolotls and geckos. Pure: no three.js, no world, so it runs under Node
// (tests/herp.test.mjs). animals.js senses the world for each animal, calls herpThink once per step and carries out what it
// returns (animals.js herp()).
//
// WHAT THE ANIMALS ARE (the notes behind the numbers; PROFILES below holds them):
//   fire salamander  Salamandra salamandra. Forest floor, nocturnal, out on damp nights and after rain, sits in a hide (wood, a
//                    root, a rock overhang, leaf litter) by day and comes back to the same one. Slow, deliberate: walks in S-curves,
//                    stops to sniff with its snout down, hunts slugs, worms, springtails by sight and smell: creeps, freezes when
//                    the prey looks up, then one tongue strike. Dries out: has to soak in a shallow dish or at the stream's edge.
//                    Warns rather than flees: freezes, turns its flank (the gland side) to the threat and arches, then walks off.
//   paddle-tail newt Pachytriton. A cool-stream newt: lives on the bottom among rocks and wood, wedged in a crevice by day, walks
//                    the bottom at night with its head sweeping, swims in bursts with its tail, rises to gulp air now and then,
//                    and on damp nights may climb out to wander the bank (returns before it dries). Heat makes it sluggish.
//   axolotl          fully aquatic, never leaves the water. Sits on the bottom most of the time (gills fanning), walks slowly
//                    with a diagonal gait, shuns bright light (sits in shade or a hide while the lamp is on), gulps air at the
//                    surface, finds food by smell and sucks it in with a gape. Above 21 °C it floats about listlessly.
//   mourning gecko   Lepidodactylus lugubris. Climbs glass and background, sleeps by day pressed into a crevice, often in a group
//                    (they share retreats), comes out at dusk, patrols the wall in darts and pauses, licks its own eyes clean,
//                    drinks droplets after rain or misting, stalks insects with its tail waving, then pounces.
//
// HOW THEY DECIDE. Every step an animal has drives (0 … 1) that grow or fade with time and what it senses, and ONE MODE at a
// time, chosen by priority (the first that applies wins, and a mode is kept for a minimum time so nothing flickers):
//   warn / flee   fear above a threshold (something large close by, the camera, a splash)
//   air           (water animals) the air need is up: swim to the surface, gulp, go back down
//   soak          skin drying: go to the water's edge and sit in the shallows
//   drink         (gecko) thirsty and water drops about
//   hunt          food it can see or smell and hunger up: creep (move, freeze, move) to striking distance
//   hide          not the hour to be out (lamp on, dry air, too warm): go home and tuck in
//   shore         (newt) a damp night: climb out and wander the bank
//   forage        out and about: a patrol in short walks, each followed by a pause with the head sweeping
//   shed          the skin is due (every few weeks; it dulls for two days first): go home, writhe and rub the head, peel it off, eat it
//   court         (male, adult, a ready female near) approach, display (tail fanned or head nudging), lead off and wait; she follows
//   receive/follow (female) watch the courting male; follow him when he leads off; the pair is made (fire salamanders then carry larvae)
//   larviposit    (fire salamander, with larvae) walk to the shallows, stand in them, give birth to the larvae
//   rest          otherwise
//
// SENSES (the object animals.js hands in, every field optional except where noted):
//   t, dt (animal seconds), dtMin (game minutes; dtAir the same capped lower, for breathing)         x, z (a plane: for a gecko on the wall z = -height, so that up is the
//                                                         same heading as on the ground), yaw (the body's heading)
//   depth     water over the ground here, cm              surface   water over the ground at the surface is `depth`; a number
//   onWall    (gecko) the animal is on the background     light 0 … 1 (the lamp), rain 0 … 1, rh %, temp °C, oxygen mg/l
//   kind      the species' kind; reach (cm: its strike); moved (cm walked since the last step); toSurface (cm to the surface)
//   wetGround 0 … 1   cover 0 … 1 (a hide here)           hunger 0 … 1, health 0 … 1, male
//   prey      { x, z, y, d, moving, mine } the animal it is hunting (ordered) or can see/smell, or null
//   threat    { x, z, d } the nearest looming thing, or null            mate  { x, z, d } another of its kind, or null
//   home      { x, z, y } its shelter, or null (animals.js looks for one when `needHome` is set)
//   shore     { x, z, d } the nearest wet ground / shallows             bank { x, z, d } the nearest dry ground (from water)
//   wetSpot   { x, z, y, d } the nearest place to drink (a gecko)       dew 0 … 1 (condensation on the glass), mist 0 … 1
//   cool      { x, z } a cooler spot nearby, or null
//   male, adult  this animal's sex and whether it is grown   mate { x, z, d, ok, courting, phase, recv } the nearest of its kind of the
//             other sex in the same medium (ok: grown and free to court; courting: it is courting me; phase, recv: its courtship state)
// Every random choice goes through `rnd()` (Math.random by default) so tests can fix it.

import { nightActivity } from './habitat.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (cur, tgt, rate, dt) => cur + (tgt - cur) * Math.min(1, rate * dt);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (to, from) => ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const between = (rnd, [a, b]) => a + rnd() * (b - a);

// Per species. `style` picks the thinker: 'land' (fire salamander), 'water' (newt, axolotl), 'wall' (gecko).
export const PROFILES = {
  firesal: {
    style: 'land', rhIdeal: 75, tIdeal: 14, tHot: 20,
    dryMin: 420,                  // game minutes to dry from full to empty on bare ground in ideal air
    soakAt: 0.3, soakTo: 0.9,
    creep: 0.7, walk: 1.5, dash: 3.2,   // cm/s
    range: 40,                    // cm: the patrol stays within this of the hide
    scareCm: 9, warnS: [2.5, 6],  // a threat closer than this frightens it; seconds it holds the warning posture
    walkCm: [4, 14], pauseS: [2.5, 9], sniffS: [1.5, 4],
    awakeAt: 0.34,
    smell: 12, sight: 9,
    shedDays: [30, 60], court: 'land', pregDays: [5, 8], larvae: [3, 6],
  },
  newt: {
    style: 'water', rhIdeal: 80, tIdeal: 18, tHot: 23,
    air: [40, 110],               // game minutes between breaths at rest
    creep: 0.8, walk: 1.5, swim: 4, dash: 9,
    scareCm: 9, shore: true, shoreRange: 22,
    walkCm: [3, 10], pauseS: [2, 8], sniffS: [1.5, 4],
    awakeAt: 0.34, dryMin: 300, soakAt: 0.4,
    smell: 14, sight: 8,
    shedDays: [8, 16], court: 'water',
  },
  axolotl: {
    style: 'water', rhIdeal: 100, tIdeal: 17, tHot: 21,
    air: [60, 170],
    creep: 0.7, walk: 1.2, swim: 3.2, dash: 8,
    scareCm: 9, shore: false,
    walkCm: [3, 12], pauseS: [4, 16], sniffS: [2, 5],
    awakeAt: 0.3, lightShy: 0.8,
    smell: 15, sight: 6,
    shedDays: [10, 20], court: 'water',
  },
  gecko: {
    style: 'wall', rhIdeal: 70, tIdeal: 25, tHot: 29,
    creep: 1.6, walk: 4.5, dash: 13,
    scareCm: 8, thirstMin: [240, 480],
    dartS: [0.35, 1.3], pauseS: [1.2, 6], groomEvery: [25, 70], walkCm: [4, 14],
    awakeAt: 0.3,
    smell: 6, sight: 16,
    shedDays: [14, 28], tail: true, regrowDays: 25,
  },
};
// The marbled newt is a newt with a land life (`land`: the share of its time ashore, the care sheet's half; `bout`: game
// minutes of one stay, ashore or in the water, before it changes): out of the breeding season Triturus marmoratus lives
// mostly on land, hiding under wood and moss by day and hunting there at night, and goes back to the water to soak.
PROFILES.marbled = { ...PROFILES.newt, tIdeal: 17, tHot: 22, land: 0.5, bout: [120, 360] };
// A species without a row (another animal of the same kind) gets the nearest one.
export const profileFor = (id, kind) => PROFILES[id] ?? PROFILES[kind === 'axolotl' ? 'axolotl' : kind === 'gecko' ? 'gecko' : id === 'firesal' ? 'firesal' : 'newt'];

export function herpMind(id = 'newt', rnd = Math.random) {
  return {
    id, mode: 'rest', modeT: 0,
    wet: 1, fear: 0, air: rnd() * 0.6, thirst: rnd() * 0.5, groom: 0,
    goal: null, speed: 0, goalSpeed: 0,
    moveLeft: 0, pauseLeft: rnd() * 2, sniff: 0, step: 0, freeze: 0, lastPrey: 0,
    look: rnd() * 6.28, lookT: 0, lookTo: 0, sideSign: rnd() < 0.5 ? -1 : 1,
    head: 0, headP: 0, bend: 0, tail: 0, throat: 0, eyeShut: 0, gill: 0.3,
    lickT: 0, drinkT: 0, gulpT: 0, groomLeft: 0, groomNext: 0, warnT: 0, say: 0,
    alt: null, wantWall: true, needHome: false, hideT: 0, surfaceT: 0, ashore: 0,
    // skin, tail, mating
    shedIn: 30, dull: 0, shedT: 0, tailF: 1,
    courtDrive: rnd() * 0.5, courtCool: 0, cp: null, cpT: 0, cpDur: 0, recv: null, pregnant: 0, gravid: false, birthT: 0,
  };
}
// (A fresh mind starts part-way through its skin cycle, so a tank's animals do not all shed together.)
export function herpMindFor(id, rnd = Math.random, kind) {
  const m = herpMind(id, rnd), P = profileFor(id, kind);
  m.shedIn = between(rnd, P.shedDays ?? [20, 40]) * rnd();
  return m;
}

// How fast the skin dries on land per game minute: faster in dry or hot air and in the light, slower on wet ground.
export function dryRate(P, rh, temp, light, wetGround = 0) {
  const air = 1 + Math.max(0, P.rhIdeal - rh) / 10 + Math.max(0, temp - 18) / 5 + light * 0.4;
  return (air * (1 - 0.75 * clamp(wetGround, 0, 1))) / P.dryMin;
}

// How much the animal wants to be out, 0 … 1: the hour, the weather, hunger, heat, light shyness.
export function awake(P, s, m) {
  let a = nightActivity(s.light ?? 0.5, s.rain ?? 0, s.rh ?? P.rhIdeal, P.rhIdeal);
  if (P.lightShy) a = lerp(a, 0.05 + 0.5 * (1 - smooth(0.1, 0.8, s.light ?? 0.5)) + 0.2 * (s.rain ?? 0), P.lightShy);
  if (P.style === 'water') a = Math.max(a, 0.18 + 0.3 * (1 - smooth(0.2, 0.9, s.light ?? 0.5)));   // submerged: damp whatever the hour
  const hot = clamp(((s.temp ?? P.tIdeal) - P.tHot) / 4, 0, 1);
  a *= 1 - 0.6 * hot;
  if ((s.hunger ?? 0) > 0.7) a = Math.max(a, 0.2 + (s.hunger - 0.7) * 2);    // hunger drives it out at the wrong hour
  if (m && m.mode === 'hide' && m.modeT < 20) a = Math.min(a, P.awakeAt + 0.1);
  return clamp(a, 0, 1);
}

const away = (s, p, dist) => { const dx = s.x - p.x, dz = s.z - p.z, l = Math.hypot(dx, dz) || 1; return { x: s.x + (dx / l) * dist, z: s.z + (dz / l) * dist }; };
const dist2 = (s, p) => Math.hypot(p.x - s.x, p.z - s.z);

// The shared part of a step: drives and the fear reflex. Returns what the thinkers need.
function drives(m, P, s, rnd) {
  const dt = s.dt ?? 0, dtMin = s.dtMin ?? dt / 60;
  const inWater = (s.depth ?? 0) > 0.3;
  if (P.style === 'land' || (P.style === 'water' && P.shore)) {
    if (inWater) m.wet = Math.min(1, m.wet + dtMin / 15);
    else if (P.style === 'land' || m.ashore > 0) {
      const sheltered = (s.cover ?? 0) > 0.25 && (s.rh ?? 70) > P.rhIdeal - 10 ? 0.2 : 1;
      m.wet = clamp(m.wet - dryRate(P, s.rh ?? 70, s.temp ?? 18, s.light ?? 0.5, s.wetGround) * dtMin * sheltered + (s.rain ?? 0) * dtMin / 60, 0, 1);
    }
  } else m.wet = 1;
  if (P.style === 'water') {
    const surfacing = m.mode === 'air' && m.gulpT > 0;
    const warm = 1 + Math.max(0, (s.temp ?? P.tIdeal) - P.tIdeal) / 8 + (s.oxygen != null && s.oxygen < 5 ? (5 - s.oxygen) * 0.3 : 0);
    const active = m.mode === 'flee' || m.mode === 'forage' || m.mode === 'hunt' ? 1.5 : 1;
    if (!surfacing) m.air += (s.dtAir ?? dtMin) * warm * active / lerp(P.air[0], P.air[1], 0.5 + 0.5 * Math.sin(m.look));
  }
  if (P.style === 'wall') {
    const wet = (s.rain ?? 0) > 0.1 || (s.mist ?? 0) > 0.2 || (s.dew ?? 0) > 0.3;
    m.thirst = clamp(m.thirst + dtMin / lerp(P.thirstMin[0], P.thirstMin[1], 0.5) * (1 + Math.max(0, (s.temp ?? 25) - 27) / 4), 0, 1.5);
    m.dewHere = wet;
  }
  // Fear: jumps when something large looms close (or the camera comes close), fades over a few seconds.
  const sc = P.scareCm * (m.mode === 'hide' || m.mode === 'rest' ? 0.7 : 1);
  if (s.threat && s.threat.d < sc) m.fear = Math.max(m.fear, 1 - s.threat.d / sc);
  m.fear = Math.max(0, m.fear - dt * 0.22);
  return { dt, dtMin, inWater, act: awake(P, s, m), hot: clamp(((s.temp ?? P.tIdeal) - P.tHot) / 3, 0, 1) };
}

// Switch to a mode (keeps the memory tidy).
function go(m, mode, rnd) {
  if (m.mode === mode) return;
  m.mode = mode; m.modeT = 0; m.moveLeft = 0; m.pauseLeft = 0; m.goal = null; m.goalOk = false; m.aimed = false; m.freeze = 0; m.groomLeft = 0; m.gulpT = 0; m.drinkT = 0; m.hideT = 0;
  m.warnT = 0; m.sniff = 0;
  m.pauseLeft = rnd() * 0.8;
}

const emptyIntent = (m) => ({
  mode: m.mode, goal: null, speed: 0, face: null, calm: 1,
  head: 0, headP: 0, bend: 0, tail: 0, throat: 0, eye: 0, gill: 0,
  swim: false, rise: false, bottom: true, wantWall: m.wantWall, needHome: false, tuck: 0, stopAt: 0, say: null,
  gulp: false, strike: false, sniff: false, drink: false,
  dull: 0, tailF: 1, dropTail: false, mated: false, birth: 0, shed: false,
});

// Smooth the posture channels toward their targets.
function posture(m, it, tg, dt) {
  m.head = ease(m.head, tg.head ?? 0, tg.hr ?? 5, dt);
  m.headP = ease(m.headP, tg.headP ?? 0, tg.hr ?? 5, dt);
  m.bend = ease(m.bend, tg.bend ?? 0, 3, dt);
  m.tail = ease(m.tail, tg.tail ?? 0, tg.tr ?? 5, dt);
  m.throat = ease(m.throat, tg.throat ?? 0, 6, dt);
  m.eyeShut = ease(m.eyeShut, tg.eye ?? 0, 7, dt);
  m.gill = ease(m.gill, tg.gill ?? 0.3, 2, dt);
  it.head = m.head; it.headP = m.headP; it.bend = m.bend; it.tail = m.tail; it.throat = m.throat; it.eye = m.eyeShut; it.gill = m.gill;
}

// Head targets: sweep from side to side with the snout down (sniffing the ground), or hold on a point of interest.
const sniffHead = (m, t, amp = 0.5) => ({ head: amp * Math.sin(t * 2.2 + m.look) + 0.12 * Math.sin(t * 5.3), headP: -0.32 + 0.08 * Math.sin(t * 6.1), hr: 7 });
const lookAt = (s, p, lim = 0.75) => clamp(angDiff(Math.atan2(p.x - s.x, p.z - s.z), s.yaw ?? 0), -lim, lim);

// Walks and pauses: a move of `walkCm` is made in one go, then a pause of `pauseS` (the head sweeps). Returns true while moving.
function paced(m, P, dt, rnd, wantMove) {
  if (m.moveLeft > 0) return true;
  m.pauseLeft -= dt;
  if (m.pauseLeft > 0 || !wantMove) return false;
  m.moveLeft = between(rnd, P.walkCm);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fire salamander: a land animal.
// ---------------------------------------------------------------------------------------------------------------------
function landThink(m, P, s, d, it, rnd) {
  const { dt, act } = d;
  const t = s.t ?? 0;
  const here = { x: s.x, z: s.z };
  const home = s.home;
  const atHome = home ? dist2(here, home) < 2.5 : false;
  const cool = d.hot > 0.4;

  // --- Mode ----------------------------------------------------------------------------------------------------------
  const holdWarn = m.mode === 'warn' && s.threat && s.threat.d < P.scareCm * 1.4 && m.warnT < between(() => 0.5, P.warnS);
  if (m.fear > 0.3 && (m.mode !== 'retreat' || m.fear > 0.8)) {
    if (m.mode !== 'warn' && m.mode !== 'retreat') { go(m, 'warn', rnd); m.freeze = 0.5 + rnd() * 0.6; m.sideSign = rnd() < 0.5 ? -1 : 1; }
  }
  if (m.mode === 'warn') {
    m.warnT += dt;
    if (!holdWarn && m.warnT > P.warnS[0] && m.fear < 0.3) go(m, home ? 'retreat' : 'rest', rnd);
    else if (m.warnT > P.warnS[1] && s.threat && s.threat.d < P.scareCm) go(m, 'retreat', rnd);
  } else if (m.mode === 'retreat') {
    if ((atHome || !home) && m.modeT > 3 && m.fear < 0.2) go(m, 'hide', rnd);
  } else {
    const thirsty = m.wet < P.soakAt || (m.mode === 'soak' && m.wet < P.soakTo);
    const prey = s.prey && (s.hunger ?? 0) > 0.3 && s.prey.d < (s.prey.mine ? 60 : P.smell) ? s.prey : null;
    let want;
    if (thirsty && s.shore) want = 'soak';
    else if (prey && act > 0.2 && m.wet > 0.25) want = 'hunt';
    else if (act < P.awakeAt || (cool && m.mode !== 'forage')) want = 'hide';
    else if (act > 0.45 && m.wet > P.soakAt + 0.1) want = 'forage';
    else want = m.mode === 'forage' || m.mode === 'hunt' || m.mode === 'soak' ? 'rest' : m.mode;
    if (want === 'hunt' || want === 'soak' || m.modeT > 4 || m.mode === 'rest' || m.mode === 'retreat') go(m, want, rnd);
  }
  m.modeT += dt;
  it.mode = m.mode;

  // --- Doing it --------------------------------------------------------------------------------------------------------
  const tg = { throat: 0.25 + 0.2 * Math.sin(t * 3.1), gill: 0 };
  switch (m.mode) {
    case 'warn': {
      // Freeze, turn the flank to it and arch the back, head lowered; the yellow shows. Does not run.
      it.calm = 1; it.face = s.threat ? { x: s.threat.x, z: s.threat.z } : null;
      const k = smooth(0, 0.6, m.warnT);
      Object.assign(tg, { bend: 0.5 * k * m.sideSign, head: -0.35 * m.sideSign * k, headP: -0.18 * k, tail: 0.04 * m.sideSign * k, throat: 0.6 });
      it.say = m.warnT < dt * 1.5 && rnd() < 0.5 ? 'warn' : null;
      break;
    }
    case 'retreat': {
      it.goal = home ?? (s.threat ? away(s, s.threat, 12) : null); it.speed = P.dash * 0.7;
      it.calm = 0; it.needHome = !home;
      Object.assign(tg, { bend: 0, headP: -0.05 });
      break;
    }
    case 'soak': {
      const sh = s.shore;
      if (sh && sh.d > 1.2 && (s.depth ?? 0) < 0.3) { it.goal = { x: sh.x, z: sh.z }; it.speed = P.walk; it.calm = 0; Object.assign(tg, sniffHead(m, t, 0.25)); }
      else { it.calm = 1; Object.assign(tg, { headP: 0.05, throat: 0.5 + 0.3 * Math.sin(t * 4) }); m.wet = Math.min(1, m.wet + d.dtMin / 40); }
      break;
    }
    case 'hunt': {
      const pr = s.prey;
      if (!pr) { go(m, 'rest', rnd); break; }
      it.face = { x: pr.x, z: pr.z };
      // Creep: a few steps, then freeze with the eyes on it, more so when it is close or moving. The strike itself is the
      // animal's (animals.js hunter()), at the reach; we stop short of it and hold still so the strike lands.
      const stop = (s.reach ?? 2) * 0.8;
      if (pr.d <= stop + 0.3) { it.calm = 1; it.stopAt = stop; Object.assign(tg, { head: lookAt(s, pr, 0.5), headP: -0.08, hr: 9, throat: 0.15 }); break; }
      m.pauseLeft -= dt;
      if (m.moveLeft <= 0 && m.pauseLeft <= 0) { m.moveLeft = pr.d > 8 ? 4 + rnd() * 5 : 1 + rnd() * 1.5; }
      if (pr.moving && pr.d < 8 && rnd() < dt * 2) { m.moveLeft = 0; m.pauseLeft = 0.6 + rnd() * 1.2; }   // it moved: freeze
      if (m.moveLeft > 0) { it.goal = { x: pr.x, z: pr.z }; it.speed = pr.d > 8 ? P.walk : P.creep; it.calm = 0; it.stopAt = stop; Object.assign(tg, { head: lookAt(s, pr, 0.45), headP: -0.04, hr: 9 }); }
      else { it.calm = 1; if (m.pauseLeft <= 0) m.pauseLeft = 0.8 + rnd() * 1.8; Object.assign(tg, { head: lookAt(s, pr, 0.6), headP: 0.02, hr: 9 }); }
      break;
    }
    case 'hide': {
      if (!home) { it.needHome = true; it.calm = 1; break; }
      if (!atHome) { it.goal = home; it.speed = P.walk; it.calm = 0; Object.assign(tg, sniffHead(m, t, 0.2)); }
      else { it.calm = 1; it.tuck = 1; m.hideT += dt; Object.assign(tg, { headP: -0.02, throat: 0.3 + 0.25 * Math.sin(t * 2.4), eye: 0 }); }
      break;
    }
    case 'forage': {
      const moving = paced(m, P, dt, rnd, true);
      if (moving) {
        if (!m.goal) m.goal = pickLeg(m, P, s, home, rnd);
        it.goal = m.goal; it.speed = P.walk; it.calm = 0;
        m.moveLeft -= (s.moved ?? P.walk * dt);
        Object.assign(tg, sniffHead(m, t, 0.18));
        if (m.moveLeft <= 0 || (s.arrived)) { m.goal = null; m.moveLeft = 0; m.pauseLeft = between(rnd, P.pauseS); m.sniff = between(rnd, P.sniffS); m.look = rnd() * 6.28; }
      } else {
        // A pause: sniff, or sit up and watch.
        it.calm = 1; it.sniff = m.sniff > 0; m.sniff = Math.max(0, m.sniff - dt);
        if (m.sniff > 0) Object.assign(tg, sniffHead(m, t, 0.55));
        else Object.assign(tg, { head: 0.3 * Math.sin(t * 0.7 + m.look), headP: 0.12, hr: 3 });
      }
      break;
    }
    default: {                                         // rest
      it.calm = 1;
      Object.assign(tg, { head: 0.15 * Math.sin(t * 0.5 + m.look), headP: 0.04, hr: 3 });
      if (m.modeT > 8 + rnd() * 20 && act > 0.45) go(m, 'forage', rnd);
    }
  }
  posture(m, it, tg, dt);
}

// The next leg of a patrol: a point 4 … 14 cm away within the range of the hide (animals.js has already filtered the
// candidates it offers in `s.legs` by terrain; the brain chooses among them by what it likes).
function pickLeg(m, P, s, home, rnd) {
  const c = s.legs ?? s.legsFn?.();
  if (!c || !c.length) {
    const a = rnd() * 6.283, r = between(rnd, P.walkCm);
    return { x: s.x + Math.sin(a) * r, z: s.z + Math.cos(a) * r };
  }
  let best = null, bs = -1e9;
  for (const p of c) {
    let sc = rnd() * 0.6 + (p.damp ?? 0) * 0.8 + (p.near ?? 0) * 0.5 + (p.cover ?? 0) * 0.3 + (p.food ?? 0) * 0.9;
    if (home) { const dh = Math.hypot(p.x - home.x, p.z - home.z); if (dh > P.range) sc -= (dh - P.range) * 0.08; }
    if (sc > bs) { bs = sc; best = p; }
  }
  return best ? { x: best.x, z: best.z } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The newt and the axolotl: water animals that breathe air.
// ---------------------------------------------------------------------------------------------------------------------
function waterThink(m, P, s, d, it, rnd) {
  const { dt, act } = d;
  const t = s.t ?? 0;
  const here = { x: s.x, z: s.z };
  const home = s.home;
  const depth = s.depth ?? 0;
  const inWater = depth > 0.3;
  const atHome = home ? dist2(here, home) < 2 : false;
  const warm = d.hot > 0.3;
  const hide = act < P.awakeAt;

  // A land life (P.land): bouts of a few game hours ashore and in the water, P.land of the time ashore on average. Ashore it
  // wanders and hunts on land, hides on land (animals.js finds it a land home while m.onLand), and goes back in only to soak.
  if (P.land) {
    m.boutLeft = (m.boutLeft ?? between(rnd, P.bout) * rnd()) - (d.dtMin ?? 0);
    if (m.boutLeft <= 0) { m.onLand = !m.onLand; m.boutLeft = between(rnd, P.bout) * 2 * (m.onLand ? P.land : 1 - P.land); }
  }
  const landLife = !!(P.land && m.onLand);

  const fleeing = m.fear > 0.35;
  if (m.mode !== 'flee' && fleeing) { go(m, 'flee', rnd); m.freeze = 0; }
  if (m.mode === 'flee') {
    if (m.fear < 0.12 && m.modeT > 1.5) go(m, atHome || !home ? 'rest' : 'hide', rnd);
  } else if (m.mode === 'air') {
    if (m.gulpT <= 0 && m.surfaceT > 0 && m.air <= 0.05) go(m, 'rest', rnd);
    else if (!inWater) go(m, 'rest', rnd);
    else if (m.modeT > 30) { m.air = 0.4; go(m, 'rest', rnd); }          // cannot get up (a ceiling of wood, a shelf): tries again later
  } else {
    let want;
    const airNow = m.air >= 1 && inWater && depth > 1.2;
    const prey = s.prey && (s.hunger ?? 0) > 0.25 && s.prey.d < (s.prey.mine ? 60 : P.smell) ? s.prey : null;
    if (airNow) want = 'air';
    else if (!inWater && m.ashore > 0 && m.wet < P.soakAt + 0.15 && s.bank !== undefined) want = 'return';
    else if (prey && act > 0.2 && !(warm && (s.hunger ?? 0) < 0.6)) want = 'hunt';
    else if (landLife && !inWater && (hide || warm)) want = 'hide';
    else if (landLife && (!inWater || m.wet > 0.9)) want = 'shore';
    else if (m.mode === 'shore' && m.wet > P.soakAt + 0.1 && act > 0.5) want = 'shore';
    else if (hide || warm) want = 'hide';
    else if (P.shore && act > 0.75 && (s.rain ?? 0) + (s.rh ?? 0) / 200 > 0.75 && m.wet > 0.8 && m.mode === 'rest' && rnd() < dt * 0.02) want = 'shore';
    else if (act > 0.42) want = 'forage';
    else want = m.mode === 'forage' || m.mode === 'hunt' || m.mode === 'return' || m.mode === 'shore' ? 'rest' : m.mode;
    if (want === 'air' || want === 'hunt' || want === 'return' || m.modeT > 5 || m.mode === 'rest' || m.mode === 'flee') go(m, want, rnd);
    if (m.mode === 'shore' && m.ashore <= 0 && inWater && m.modeT > 3) { /* still wading out */ }
  }
  m.modeT += dt;
  if (m.mode === 'shore' && !inWater) m.ashore = Math.max(m.ashore, 1);
  else if (inWater) m.ashore = 0;
  it.mode = m.mode;
  const axo = P.shore === false;
  const tg = { gill: 0.35 + (warm ? 0.3 : 0) + (m.mode === 'forage' ? 0.1 : 0), throat: 0.15 };
  it.bottom = true; it.swim = false; it.calm = 1;

  switch (m.mode) {
    case 'flee': {
      // A burst of tail strokes to cover (or away from it), then it freezes. The escape is chosen once, on the way in (animals.js
      // swaps a spot it cannot reach, out of the water or behind a rock, for one it can, or for none: then it freezes where it is).
      if (!m.aimed) { m.aimed = true; m.goal = home ?? (s.threat ? away(s, s.threat, 14) : null); m.goalOk = false; }
      if (m.goal && dist2(here, m.goal) < 1.2) m.goal = null;
      it.goal = m.goal; it.speed = m.goal ? P.dash : 0; it.swim = !!m.goal; it.calm = 1; it.bottom = true;
      if (s.threat) it.face = null;
      Object.assign(tg, { gill: 0.9, bend: m.goal ? 0.05 * m.sideSign : 0, headP: m.goal ? 0 : -0.06 });
      break;
    }
    case 'air': {
      // Swim straight up, break the surface with the snout, gulp, sink. (In shallow water it just lifts its head.)
      it.swim = true; it.bottom = false; it.rise = true; it.calm = 1;
      it.goal = { x: s.x, z: s.z }; it.speed = P.swim * 0.8;
      const top = s.toSurface ?? 99;
      if (top < 0.9 || depth < 2.2 || m.gulpT > 0) {                      // (in shallow water it only has to lift its head)
        if (m.gulpT <= 0 && m.surfaceT <= 0) { m.gulpT = 0.9; m.surfaceT = 1.3; }
        m.gulpT = Math.max(0, m.gulpT - dt); m.surfaceT = Math.max(0, m.surfaceT - dt);
        it.speed = 0; it.gulp = m.gulpT > 0.2 && m.gulpT < 0.8;
        Object.assign(tg, { headP: 0.55, throat: it.gulp ? 0.9 : 0.3, gill: 0.2, hr: 8 });
        if (m.gulpT > 0.45) m.air = Math.max(0, m.air - dt * 3);
        if (m.gulpT <= 0 && m.surfaceT <= 0) { m.air = 0; go(m, 'rest', rnd); }
      } else Object.assign(tg, { headP: 0.35, gill: 0.25 });
      break;
    }
    case 'hunt': {
      const pr = s.prey;
      if (!pr) { go(m, 'rest', rnd); break; }
      it.face = { x: pr.x, z: pr.z };
      const stop = (s.reach ?? 1.6) * 0.8;
      Object.assign(tg, { head: lookAt(s, pr, 0.5), hr: 8, gill: 0.5 });
      if (pr.d <= stop + 0.3) { it.stopAt = stop; it.calm = 1; break; }
      m.pauseLeft -= dt;
      if (m.moveLeft <= 0 && m.pauseLeft <= 0) m.moveLeft = pr.d > 7 ? 5 + rnd() * 4 : 1.2 + rnd();
      if (m.moveLeft > 0) { m.moveLeft -= (s.moved ?? P.creep * dt); it.goal = { x: pr.x, z: pr.z }; it.speed = pr.d > 8 ? P.walk : P.creep; it.calm = 0; it.stopAt = stop; if (m.moveLeft <= 0) m.pauseLeft = 0.6 + rnd() * 1.4; }
      else it.calm = 1;
      break;
    }
    case 'hide': {
      if (!home) { it.needHome = true; break; }
      if (!atHome) { it.goal = home; it.speed = P.walk; it.calm = 0; it.swim = dist2(here, home) > 14; Object.assign(tg, sniffHead(m, t, 0.2)); }
      else { it.tuck = 1; m.hideT += dt; Object.assign(tg, { headP: 0.02, gill: warm ? 0.7 : 0.3, throat: 0.3 + 0.2 * Math.sin(t * 2.2) }); }
      break;
    }
    case 'return': {
      // Back to the water from the bank before it dries.
      const b = s.shore ?? null;
      if (b) { it.goal = { x: b.x, z: b.z }; it.speed = P.walk * 1.2; it.calm = 0; } else { it.needHome = true; }
      Object.assign(tg, { headP: -0.05 });
      break;
    }
    case 'shore': {
      // Climb out and wander the bank, short legs with pauses, near the water.
      const moving = paced(m, P, dt, rnd, true);
      if (moving) {
        if (!m.goal) m.goal = pickLeg(m, P, s, null, rnd);
        it.goal = m.goal; it.speed = P.walk; it.calm = 0; it.bottom = true;
        m.moveLeft -= (s.moved ?? P.walk * dt);
        Object.assign(tg, sniffHead(m, t, 0.2));
        if (m.moveLeft <= 0) { m.goal = null; m.pauseLeft = between(rnd, P.pauseS); m.sniff = between(rnd, P.sniffS); }
      } else { it.calm = 1; m.sniff = Math.max(0, m.sniff - dt); Object.assign(tg, m.sniff > 0 ? sniffHead(m, t, 0.5) : { head: 0.25 * Math.sin(t * 0.8 + m.look), headP: 0.1 }); }
      if ((!landLife && m.modeT > 90) || m.wet < P.soakAt + 0.15) go(m, 'return', rnd);
      break;
    }
    case 'forage': {
      // The bottom patrol: walks of a few cm with the head sweeping, longer hops between spots are swum.
      const moving = paced(m, P, dt, rnd, true);
      if (moving) {
        if (!m.goal) m.goal = pickLeg(m, P, s, home, rnd);
        const far = m.goal ? Math.hypot(m.goal.x - s.x, m.goal.z - s.z) : 0;
        it.goal = m.goal; it.speed = far > 8 ? P.swim * 0.7 : P.walk; it.swim = far > 9; it.calm = it.swim ? 1 : 0;
        m.moveLeft -= (s.moved ?? P.walk * dt);
        Object.assign(tg, sniffHead(m, t, 0.2));
        if (m.moveLeft <= 0) { m.goal = null; m.pauseLeft = between(rnd, P.pauseS); m.sniff = between(rnd, P.sniffS); m.look = rnd() * 6.28; }
      } else {
        m.sniff = Math.max(0, m.sniff - dt);
        if (m.sniff > 0) Object.assign(tg, { ...sniffHead(m, t, 0.5), gill: 0.6 });
        else Object.assign(tg, { head: 0.2 * Math.sin(t * 0.7 + m.look), headP: axo ? 0.1 : 0.04, hr: 3 });
      }
      break;
    }
    default: {                                          // rest on the bottom: the axolotl props itself on its forelegs
      Object.assign(tg, { head: 0.12 * Math.sin(t * 0.5 + m.look), headP: axo ? 0.14 : 0.04, hr: 3, gill: 0.3 + 0.1 * Math.sin(t * 0.7) });
      if (warm && m.modeT > 4) { it.swim = true; it.bottom = false; it.calm = 1; it.goal = null; }   // too warm: drifts about, floating
      if (m.modeT > 10 + rnd() * 30 && act > 0.42) go(m, 'forage', rnd);
    }
  }
  if (m.mode === 'hide' && it.tuck) it.calm = 1;
  posture(m, it, tg, dt);
}

// ---------------------------------------------------------------------------------------------------------------------
// The gecko: a climber of the background.
// ---------------------------------------------------------------------------------------------------------------------
function wallThink(m, P, s, d, it, rnd) {
  const { dt, act } = d;
  const t = s.t ?? 0;
  const home = s.home;
  const here = { x: s.x, z: s.z };
  const atHome = home ? Math.hypot(home.x - s.x, home.z - s.z) < 2.5 && !!(s.onWall ?? true) === !!(home.wall ?? true) : false;

  if (m.fear > 0.35 && m.mode !== 'flee') { go(m, 'flee', rnd); m.sideSign = rnd() < 0.5 ? -1 : 1; }
  if (m.mode === 'flee') {
    if (m.fear < 0.15 && m.modeT > 1.2) go(m, home && !atHome ? 'hide' : 'rest', rnd);
  } else {
    const prey = s.prey && (s.hunger ?? 0) > 0.3 && s.prey.d < (s.prey.mine ? 60 : P.sight) ? s.prey : null;
    const wet = m.dewHere || (s.rain ?? 0) > 0.1;
    let want;
    if (m.mode === 'drink' && m.drinkT < 10 && m.thirst > 0.1) want = 'drink';
    else if (m.thirst > 0.75 && s.wetSpot && (wet || s.wetSpot.d < 30) && act > 0.2) want = 'drink';
    else if (prey && act > 0.2) want = 'hunt';
    else if (act < P.awakeAt) want = 'hide';
    else if (act > 0.42) want = 'patrol';
    else want = m.mode === 'patrol' || m.mode === 'hunt' || m.mode === 'drink' ? 'rest' : m.mode;
    if (want === 'hunt' || want === 'drink' || m.modeT > 3 || m.mode === 'rest' || m.mode === 'flee') go(m, want, rnd);
  }
  m.modeT += dt;
  it.mode = m.mode;
  const tg = { throat: 0.2 + 0.15 * Math.sin(t * 5), hr: 6 };
  it.wantWall = m.wantWall;
  m.groomNext -= dt;

  switch (m.mode) {
    case 'flee': {
      // Caught: the tail comes off and thrashes (the pursuer's eye follows it), and the gecko is gone.
      if (P.tail && m.tailF > 0.8 && s.threat && s.threat.d < 2.8 && m.fear > 0.6 && rnd() < dt * 5) { it.dropTail = true; m.tailF = 0.1; }
      it.goal = home ?? (s.threat ? away(s, s.threat, 14) : null); it.speed = P.dash; it.calm = 0; it.needHome = !home;
      it.wantWall = home ? home.wall !== false : true;
      Object.assign(tg, { tail: 0.05 * Math.sin(t * 14) });
      break;
    }
    case 'hide': {
      // Asleep: pressed flat in a crevice or behind a leaf, eyes shut, tail curled round. Sleeps with others if it can.
      if (!home) { it.needHome = true; it.calm = 1; break; }
      it.wantWall = home.wall !== false;
      if (!atHome) { it.goal = home; it.speed = P.walk; it.calm = 0; Object.assign(tg, { headP: 0.1 }); }
      else { it.calm = 1; it.tuck = 1; Object.assign(tg, { eye: 1, bend: 0.45 * m.sideSign, tail: 0.1 * m.sideSign, headP: -0.05, throat: 0.15 + 0.1 * Math.sin(t * 1.6) }); }
      break;
    }
    case 'drink': {
      // To a wet spot (dew on the glass, drops on a leaf, a splash zone) and lick it: head down, tongue working.
      const w = s.wetSpot;
      if (!w) { go(m, 'rest', rnd); break; }
      it.wantWall = w.wall !== false;
      if (w.d > 1.2) { it.goal = { x: w.x, z: w.z }; it.speed = P.walk; it.calm = 0; Object.assign(tg, { headP: 0.05 }); }
      else {
        it.calm = 1; it.drink = true; m.drinkT += dt;
        const lick = Math.max(0, Math.sin(t * 7.5));
        Object.assign(tg, { headP: -0.4 + 0.12 * lick, head: 0.1 * Math.sin(t * 3), throat: 0.35 + 0.4 * lick, hr: 12 });
        m.thirst = Math.max(0, m.thirst - dt / 14);
        if (m.thirst <= 0.05 || m.drinkT > 14) { m.thirst = 0; go(m, 'rest', rnd); }
      }
      break;
    }
    case 'hunt': {
      const pr = s.prey;
      if (!pr) { go(m, 'rest', rnd); break; }
      it.face = { x: pr.x, z: pr.z }; it.wantWall = pr.wall !== false;
      const stop = (s.reach ?? 1.6) * 0.8;
      // Tail waving while it fixes on the prey, a creep in short steps, a crouch, then the pounce (the animal's strike).
      Object.assign(tg, { head: lookAt(s, pr, 0.5), headP: 0.1, tail: 0.12 * Math.sin(t * 9.5), tr: 12, hr: 9 });
      if (pr.d <= stop + 0.3) { it.stopAt = stop; it.calm = 1; Object.assign(tg, { tail: 0.03 * Math.sin(t * 20) }); break; }
      m.pauseLeft -= dt;
      if (m.moveLeft <= 0 && m.pauseLeft <= 0) m.moveLeft = pr.d > 7 ? 3 + rnd() * 3 : 0.8 + rnd() * 1.2;
      if (m.moveLeft > 0) { m.moveLeft -= (s.moved ?? P.creep * dt); it.goal = { x: pr.x, z: pr.z }; it.speed = pr.d > 8 ? P.walk * 0.8 : P.creep; it.calm = 0; it.stopAt = stop; if (m.moveLeft <= 0) m.pauseLeft = 0.5 + rnd() * 1.5; }
      else it.calm = 1;
      break;
    }
    case 'patrol': {
      // Darts and pauses along the wall. In a pause: a look round, a flick of the tail, now and then a lick of the eye.
      const dart = m.moveLeft > 0 || (m.pauseLeft -= dt) <= 0;
      if (dart && m.moveLeft <= 0) { m.moveLeft = between(rnd, P.dartS); m.goal = pickLeg(m, P, s, home, rnd); it.wantWall = m.goal?.wall ?? m.wantWall; }
      if (m.moveLeft > 0) {
        m.moveLeft -= dt;
        it.goal = m.goal; it.speed = P.walk; it.calm = 0; it.wantWall = m.goal?.wall ?? m.wantWall;
        Object.assign(tg, { headP: 0.08, tail: 0.05 * Math.sin(t * 11) });
        if (m.moveLeft <= 0) { m.goal = null; m.pauseLeft = between(rnd, P.pauseS); m.look = rnd() * 6.28; if (m.groomNext <= 0) { m.groomLeft = 1.6; m.groomNext = between(rnd, P.groomEvery) * 0.6; } }
      } else {
        it.calm = 1;
        if (m.groomLeft > 0) {
          // The tongue sweeps across one eye, then the other: the head turns to the side and dips, the eye closes.
          m.groomLeft -= dt;
          const ph = m.groomLeft > 0.8 ? 1 : -1, k = Math.abs(Math.sin(m.groomLeft * 7));
          Object.assign(tg, { head: 0.8 * ph * m.sideSign, headP: 0.25, eye: 0.8 * k, throat: 0.5 * k, hr: 14 });
        } else Object.assign(tg, { head: 0.55 * Math.sin(t * 1.3 + m.look) * (Math.sin(t * 0.35 + m.look) > 0 ? 1 : 0.2), headP: 0.16 + 0.1 * Math.sin(t * 0.9 + m.look), tail: 0.04 * Math.sin(t * 2.1 + m.look), hr: 7 });
      }
      break;
    }
    default: {
      it.calm = 1;
      Object.assign(tg, { head: 0.2 * Math.sin(t * 0.6 + m.look), headP: 0.1, tail: 0.02 * Math.sin(t * 1.4) });
      if (m.modeT > 2 + rnd() * 6 && act > 0.42) go(m, 'patrol', rnd);
    }
  }
  posture(m, it, tg, dt);
}

// The slow things: the skin cycle, the tail's regrowth, the urge to court, a pregnancy.
function life(m, P, s, d) {
  const dtMin = d.dtMin;
  m.shedIn -= dtMin / 1440;
  if (m.mode !== 'shed') m.dull = clamp(1 - m.shedIn / 2, 0, 1) * 0.85;     // the skin goes dull and milky for the last two days
  if (P.tail && m.tailF < 0.85) m.tailF = Math.min(0.85, m.tailF + dtMin / (P.regrowDays * 1440) * 0.8);   // a regrown tail is shorter and blunt
  m.courtCool = Math.max(0, m.courtCool - dtMin / 1440);
  if (P.court && s.male && s.adult !== false && (s.hunger ?? 0) < 0.6 && d.hot < 0.4) m.courtDrive = Math.min(1, m.courtDrive + dtMin / 360);
  if (m.pregnant > 0) { m.pregnant -= dtMin; if (m.pregnant <= 0) m.gravid = true; }
  if (m.recv != null && !(s.mate && s.mate.courting)) { m.recvT = (m.recvT ?? 0) + d.dt; if (m.recvT > 20) { m.recv = null; m.recvT = 0; } } else m.recvT = 0;
}

const SPECIAL = new Set(['shed', 'court', 'receive', 'follow', 'larviposit']);
const FREE = new Set(['rest', 'forage', 'patrol', 'hide', 'shore']);

// Shedding, courting, being courted, giving birth. These take over from the ordinary modes while they last; fear ends them.
// Returns true when it handled this step.
function special(m, P, s, d, it, rnd) {
  const { dt } = d, t = s.t ?? 0;
  const here = { x: s.x, z: s.z }, depth = s.depth ?? 0;
  let inS = SPECIAL.has(m.mode);
  if (inS && m.fear > 0.3) { go(m, 'rest', rnd); m.cp = null; return false; }
  if (!inS) {
    if (m.fear > 0.15 || !FREE.has(m.mode) || m.modeT < 2) return false;
    if (s.prey && (s.hunger ?? 0) > 0.3) return false;                        // a meal comes first
    const mate = s.mate;
    if (m.shedIn <= 0 && m.wet > 0.4 && (s.hunger ?? 0) < 0.85) { go(m, 'shed', rnd); m.shedT = 0; m.shedDur = 14 + rnd() * 10; }
    else if (m.gravid && s.shore && P.larvae) { go(m, 'larviposit', rnd); m.birthT = 0; }
    else if (P.court && s.male && s.adult !== false && m.courtDrive >= 1 && m.courtCool <= 0 && mate && mate.ok && d.act > 0.45 && (s.hunger ?? 0) < 0.6 && !m.gravid) { go(m, 'court', rnd); m.cp = 'approach'; m.cpT = 0; m.cpDur = 0; }
    else if (P.court && !s.male && m.pregnant <= 0 && !m.gravid && m.courtCool <= 0 && mate && mate.courting && mate.d < 14) {
      if (m.recv == null) m.recv = rnd() < 0.7;
      if (m.recv) go(m, 'receive', rnd);
      return false;
    } else return false;
    inS = true;
  }
  m.modeT += dt;
  it.mode = m.mode;
  const tg = { throat: 0.2 + 0.15 * Math.sin(t * 3), hr: 6 };
  const mate = s.mate;
  const abort = (cool = 0.3) => { m.courtCool = cool; m.courtDrive = Math.min(m.courtDrive, 0.4); m.cp = null; go(m, 'rest', rnd); };
  switch (m.mode) {
    case 'shed': {
      const home = s.home, dh = home ? dist2(here, home) : 0;
      if (home && dh > 3 && dh < 45 && m.shedT < 0.5 && m.modeT < 45) {
        it.goal = home; it.speed = P.walk; it.calm = 0; Object.assign(tg, sniffHead(m, t, 0.2));
        break;
      }
      m.shedT += dt;
      const k = m.shedT / m.shedDur;
      it.calm = 1; it.tuck = home && dh < 3 ? 1 : 0;
      if (k < 0.8) {
        // Peeling: the body writhes, the head rubs against the ground, the throat works, the skin lifts off.
        Object.assign(tg, { bend: 0.4 * Math.sin(t * 2.3), head: 0.75 * Math.sin(t * 3.7), headP: -0.12 + 0.1 * Math.sin(t * 5), tail: 0.1 * Math.sin(t * 2.9), throat: 0.55, eye: P.tail ? 0.5 + 0.4 * Math.sin(t * 2) : 0, hr: 9 });
        m.dull = 0.85 * (1 - smooth(0.25, 0.8, k));
      } else {
        // Eating it: the head lifts and dips, the throat gulps.
        m.dull = 0;
        Object.assign(tg, { headP: 0.3 * Math.sin(t * 5), head: 0.2 * Math.sin(t * 3), throat: 0.9 * Math.abs(Math.sin(t * 5)), hr: 9 });
      }
      if (k >= 1) { m.shedIn = between(rnd, P.shedDays); m.dull = 0; it.shed = true; go(m, 'rest', rnd); }
      break;
    }
    case 'court': {
      if (!mate || mate.d > 40 || (m.cp === 'approach' && m.modeT > 60)) { abort(); return false; }
      m.cpT += dt;
      it.face = { x: mate.x, z: mate.z };
      const water = P.court === 'water';
      if (m.cp === 'approach') {
        it.goal = { x: mate.x, z: mate.z }; it.speed = P.walk; it.calm = 0; it.swim = water && depth > 1.3 && mate.d > 7; it.stopAt = 2.5;
        Object.assign(tg, { head: lookAt(s, mate, 0.4), headP: -0.04, hr: 8 });
        if (mate.d < 3.4) { m.cp = 'display'; m.cpT = 0; m.cpDur = 6 + rnd() * 4; }
      } else if (m.cp === 'display') {
        // A water male fans his tail toward her and quivers; a land male leans against her flank and nudges her.
        it.calm = 1;
        if (water) Object.assign(tg, { tail: 0.2 * Math.sin(t * 8), bend: 0.18 * m.sideSign, head: lookAt(s, mate, 0.4), headP: -0.06 + 0.06 * Math.sin(t * 2), tr: 14, gill: 0.8 });
        else Object.assign(tg, { bend: 0.3 * m.sideSign, head: lookAt(s, mate, 0.5) + 0.2 * Math.sin(t * 5), headP: 0.12 * Math.sin(t * 4.5), tail: 0.05 * Math.sin(t * 6), hr: 10 });
        if (mate.recv === false && m.cpT > 3) { abort(0.5); return false; }
        if (m.cpT > m.cpDur) { m.cp = 'lead'; m.cpT = 0; const a = away(here, mate, 6); m.goal = { x: a.x, z: a.z }; }
      } else if (m.cp === 'lead') {
        // He walks away, tail quivering, and she is to follow.
        it.goal = m.goal; it.speed = P.creep * 1.2; it.calm = 0; it.swim = false;
        Object.assign(tg, { tail: 0.12 * Math.sin(t * 10), tr: 14, headP: -0.02 });
        if (m.cpT > 5 || !m.goal || dist2(here, m.goal) < 0.8) { m.cp = 'wait'; m.cpT = 0; }      // (no goal: animals.js gave up a lead it could not walk)
      } else if (m.cp === 'done') {
        // The pair is made: a moment together (so that she, too, sees it), then they part.
        it.calm = 1; Object.assign(tg, { tail: 0.05 * Math.sin(t * 8), headP: 0.03 });
        if (m.cpT > 1.5) { m.courtDrive = 0; m.courtCool = 1.2; m.cp = null; go(m, 'rest', rnd); }
      } else {
        it.calm = 1;
        Object.assign(tg, { tail: 0.1 * Math.sin(t * 11), tr: 14, headP: 0.05 });
        if (mate.d < 2.8) { it.mated = true; m.cp = 'done'; m.cpT = 0; }
        else if (m.cpT > 7) { abort(0.6); return false; }
      }
      break;
    }
    case 'receive': {
      if (!mate || !mate.courting) { m.recv = null; if (m.modeT > 3) go(m, 'rest', rnd); it.calm = 1; break; }
      it.calm = 1; it.face = { x: mate.x, z: mate.z };
      Object.assign(tg, { head: lookAt(s, mate, 0.5), headP: 0, tail: 0.04 * Math.sin(t * 7), hr: 8 });
      if (mate.phase === 'lead' || mate.phase === 'wait') go(m, 'follow', rnd);
      break;
    }
    case 'follow': {
      if (!mate || !mate.courting) { m.recv = null; go(m, 'rest', rnd); break; }
      it.goal = { x: mate.x, z: mate.z }; it.speed = P.creep * 1.3; it.calm = 0; it.stopAt = 1.4;
      Object.assign(tg, { head: lookAt(s, mate, 0.4), headP: -0.03, hr: 8 });
      if (mate.d < 2.6 && (mate.phase === 'wait' || mate.phase === 'done')) {
        it.mated = true; m.recv = null; m.courtCool = 2;
        if (P.larvae) m.pregnant = between(rnd, P.pregDays) * 1440;
        go(m, 'rest', rnd); posture(m, it, tg, dt); return true;
      }
      break;
    }
    case 'larviposit': {
      const sh = s.shore;
      if (!sh || m.modeT > 90) { go(m, 'rest', rnd); break; }
      if (sh.d > 1.2 && depth < 0.3) { it.goal = { x: sh.x, z: sh.z }; it.speed = P.walk; it.calm = 0; Object.assign(tg, sniffHead(m, t, 0.2)); break; }
      // Standing in the shallows, the hind end trembling, the larvae are born.
      m.birthT += dt;
      it.calm = 1;
      Object.assign(tg, { throat: 0.5 + 0.4 * Math.abs(Math.sin(t * 4)), tail: 0.09 * Math.sin(t * 9), bend: 0.12 * Math.sin(t * 1.7), headP: 0.05, tr: 12 });
      if (m.birthT > 8) { it.birth = Math.floor(between(rnd, P.larvae)); m.gravid = false; m.courtCool = 4; go(m, 'rest', rnd); }
      break;
    }
  }
  posture(m, it, tg, dt);
  return true;
}

// One step. Updates the memory `m` and returns the intent:
//   { mode, goal: {x, z, y?} | null, speed (cm/s), face: {x, z} | null, calm 0 … 1 (legs still), head (yaw, rad: + toward +x),
//     headP (pitch, rad: + nose up), bend, tail (rig2: fractions of the body length), throat 0 … 1, eye 0 … 1 (shut), gill 0 … 1,
//     swim (in the water: swimming rather than walking on the bottom), rise (heading for the surface), bottom, wantWall,
//     needHome (animals.js should look for a shelter), tuck (in its shelter), stopAt (cm from the prey where it holds),
//     gulp (the air gulp is happening now), drink (licking water), say: 'warn' | null }
export function herpThink(m, s, rnd = Math.random) {
  const P = profileFor(m.id, s.kind);
  const it = emptyIntent(m);
  const d = drives(m, P, s, rnd);
  life(m, P, s, d);
  if (!special(m, P, s, d, it, rnd)) {
    if (P.style === 'land') landThink(m, P, s, d, it, rnd);
    else if (P.style === 'water') waterThink(m, P, s, d, it, rnd);
    else wallThink(m, P, s, d, it, rnd);
  }
  it.wet = m.wet; it.air = m.air; it.fear = m.fear; it.act = d.act;
  it.dull = m.dull; it.tailF = m.tailF;
  if (P.tail && m.tailF < 0.5) it.tail *= m.tailF * 2;       // a stump hardly waves
  return it;
}

// What the animal is doing, in a few words for the inspector ("Stalking a fly", "Surfacing for a breath"). `prey` is the name of what it
// is after (or null), `asleep` that it is tucked in its shelter, `hot` that it is too warm.
export function doing(mode, kind, { prey = null, asleep = false, hot = false, wet = 1 } = {}) {
  switch (mode) {
    case 'warn': return 'Frozen, showing its warning colours';
    case 'retreat': return 'Withdrawing to its hide';
    case 'flee': return 'Bolting for cover';
    case 'air': return 'Surfacing for a breath';
    case 'soak': return wet < 0.9 ? 'Soaking to wet its skin' : 'Resting in the shallows';
    case 'drink': return 'Licking up water drops';
    case 'shed': return 'Shedding its skin';
    case 'court': return 'Courting';
    case 'receive': return 'Watching a suitor';
    case 'follow': return 'Following a mate';
    case 'larviposit': return 'Giving birth in the shallows';
    case 'hunt': return prey ? `Stalking ${prey}` : 'Stalking prey';
    case 'hide': return asleep ? (kind === 'gecko' ? 'Asleep in a crevice' : 'Resting in its hide') : hot ? 'Heading for somewhere cooler' : 'Going to its hide';
    case 'shore': return 'Out on the bank, exploring';
    case 'return': return 'Heading back to the water';
    case 'forage': return kind === 'gecko' ? 'Patrolling for insects' : kind === 'axolotl' ? 'Searching the bottom by smell' : 'Foraging';
    case 'patrol': return 'Patrolling for insects';
    default: return 'Resting';
  }
}
