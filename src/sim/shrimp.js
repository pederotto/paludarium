// The dwarf shrimp's mind (Neocaridina davidi: cherry, its colour lines, blue dream). Pure: no three.js, no world, so it runs under
// Node (tests/shrimp.test.mjs). Animals.shrimp() in animals.js senses the world for each shrimp, calls shrimpThink once per step and
// carries out what it returns (walks, swims, the tail flick), and hands the pincers, swimmerets and antennae to the rig.
//
// WHAT THE ANIMAL DOES (from the keeper's experience; SHRIMP below holds the numbers):
//   graze   most of its life: it stands on a surface and picks at the film of algae and bacteria on it with its two front pairs of
//           legs, several times a second, the antennae sweeping; now and then it shuffles a few millimetres or turns about
//   roam    every minute or so it walks a few centimetres to another patch, preferring the rich ones (moss, wood, leaves and
//           stems, stone; bare sand least)
//   swim    or it lifts off and paddles with its swimmerets to a patch farther off, legs trailing
//   food    food that sinks into the tank is smelt within a minute: it comes from across the tank, walking or swimming, and a
//           group crowds round it, picking fast, until it is gone
//   flick   danger close by (a fish that eats shrimp, a hand): it shoots backwards with one snap of the tail
//   hide    soft after a moult, or frightened: it goes into cover (moss, plants, under wood) and stays there, picking slowly
//   moult   every few weeks (every week or so while young): a quiet spell in cover, a snap, and it walks out of its old shell,
//           which lies on the bottom for a day or two (Animals keeps it as a cast shell, and others pick at it); then it is soft
//   swarm   a female that moults when ready gives off a scent and the males of the tank swim about looking for her for a while
//           (the "mating dance"); afterwards she is berried: she carries her eggs under her tail for about a month and fans them
//           with her swimmerets whenever she stands still
//
// SENSES (every field optional unless noted): t, dt (animal seconds), dtMin (game minutes), x, z, yaw, adult, female, hunger 0 … 1,
//   food { x, z, d, age } (the nearest food it can smell, age in seconds since it landed) | null,  threat { x, z, d } | null,
//   cover 0 … 1 here,  hide { x, z, d } | null (the nearest good cover),  rich 0 … 1 (grazing here),
//   spots: () => [{ x, z, d, rich }] patches it could move to (called only when it wants to move),
//   call { x, z, d } | null (a female near has just moulted: males go searching),  mates (a grown male of its kind is in the tank),
//   inWater (false: stranded, it does little)
// INTENT: mode, goal { x, z } | null, speed (cm/s), swim (get there by swimming), feed (0 … 1 the pincers' picking), fan (0 … 1 the
//   swimmerets fanning on the spot), ant (0 … 1 the antennae), face { x, z } | null, flick { x, z } | null (shoot away from it),
//   moult (true on the step it casts its shell), call (true: it has just moulted ready to breed), eating (picking at the food),
//   soft (0 … 1), berried (0 … 1), say (a log key) | null
// Every random choice goes through `rnd()` so tests can fix it.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const between = (rnd, [a, b]) => a + rnd() * (b - a);
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

export const SHRIMP = {
  walk: 0.9,                    // cm/s on its legs (a grazing shuffle is slower)
  shuffle: 0.35,
  swim: 3.2,                    // cm/s paddling
  grazeS: [25, 100],            // seconds on one patch
  shuffleS: [1.5, 6],           // between shuffles
  shuffleCm: [0.2, 0.9],
  roamCm: [3, 10],              // a walk to a new patch
  swimCm: [9, 26],              // a swim to a far one
  swimP: 0.35,                  // the chance that a move to a new patch is swum
  smell: 38,                    // cm: food is smelt from this far …
  smellS: 1.2,                  // … this many seconds per cm after it lands (the scent spreads)
  eatR: 0.7,                    // cm: close enough to pick at it
  scare: 4,                     // cm: a threat this close makes it flick
  moultDays: [21, 35], moultYoungDays: [7, 12],
  softHours: [3, 8],            // soft and hiding after a moult (game hours)
  swarmMin: [20, 60],           // the males' search (game minutes)
  berriedDays: [26, 32],        // carrying eggs
  readyDays: 20,                // a female breeds once this old
};

export function shrimpMind(rnd = Math.random) {
  return {
    mode: 'graze', modeT: 0, goal: null, pause: rnd() * 3, left: between(rnd, SHRIMP.grazeS),
    moultIn: between(rnd, SHRIMP.moultDays) * rnd(), soft: 0, prep: 0, berried: 0, swarm: 0, fear: 0, flickT: 0,
    foodSeen: null, ring: rnd() * Math.PI * 2, face: null, pickRate: 0.6 + rnd() * 0.4, ant: 0.5,
  };
}

function go(m, mode) {
  if (m.mode === mode) return;
  m.mode = mode; m.modeT = 0; m.goal = null; m.pause = 0;
}

// The best of the patches offered: rich and not too far (a shrimp does not cross the tank for a slightly better leaf).
function pickSpot(s, rnd, far) {
  const c = s.spots ? s.spots() : null;
  if (!c || !c.length) return null;
  let best = null, bs = -1e9;
  for (const p of c) {
    const want = far ? clamp((p.d - SHRIMP.swimCm[0]) / 6, -1, 1) : clamp(1 - Math.abs(p.d - 6) / 6, -1, 1);
    const sc = (p.rich ?? 0) * 1.5 + want * 0.6 + rnd() * 0.8;
    if (sc > bs) { bs = sc; best = p; }
  }
  return best && { x: best.x, z: best.z };
}

export function shrimpThink(m, s, rnd = Math.random) {
  const dt = s.dt ?? 0, dtMin = s.dtMin ?? dt / 60, here = { x: s.x ?? 0, z: s.z ?? 0 };
  const it = { mode: m.mode, goal: null, speed: 0, swim: false, feed: 0, fan: 0, ant: 0.5, face: null, flick: null, moult: false, soft: 0, berried: 0, say: null };
  m.modeT += dt;
  // Slow clocks (game time): the moult, softness, eggs, the males' search.
  const days = dtMin / 1440;
  m.moultIn -= days;
  m.soft = Math.max(0, m.soft - dtMin / 60);
  if (m.berried > 0) { m.berried = Math.max(0, m.berried - days); if (m.berried === 0) it.say = 'released'; }
  m.swarm = Math.max(0, m.swarm - dtMin);
  m.flickT = Math.max(0, m.flickT - dt);
  if (s.inWater === false) { it.mode = 'stranded'; it.ant = 1; return it; }

  // --- The tail flick: a reflex, whatever it is doing (not twice in a row) -----------------------------------------------
  if (s.threat && s.threat.d < SHRIMP.scare && m.flickT <= 0) {
    m.flickT = 1.2 + rnd(); m.fear = 1;
    it.flick = { x: s.threat.x, z: s.threat.z };
    if (m.mode !== 'moult') { go(m, 'hide'); m.left = 20 + rnd() * 40; }
    it.mode = m.mode; it.ant = 1;
    return it;
  }
  m.fear = Math.max(0, m.fear - dt * 0.05);

  // --- Mode --------------------------------------------------------------------------------------------------------------
  const food = s.food && s.food.d < SHRIMP.smell && (s.food.age ?? 99) > s.food.d * SHRIMP.smellS ? s.food : null;
  if (m.mode !== 'moult') {
    if (m.moultIn <= 0) { go(m, 'moult'); m.prep = 0; }
    else if (m.soft > 0 || m.fear > 0.5) { if (m.mode !== 'hide') go(m, 'hide'); }
    else if (s.call && !s.female && s.adult && m.swarm <= 0 && m.mode !== 'swarm' && rnd() < 0.6) { go(m, 'swarm'); m.swarm = between(rnd, SHRIMP.swarmMin); m.callAt = { x: s.call.x, z: s.call.z }; }
    else if (m.mode === 'swarm') { if (m.swarm <= 0) go(m, 'graze'); }
    else if (food && (s.hunger ?? 0.5) > 0.05) { if (m.mode !== 'food') go(m, 'food'); }
    else if (m.mode === 'food') go(m, 'graze');
    else if (m.mode === 'hide' && m.modeT > (m.left ?? 30)) go(m, 'graze');
  }
  it.mode = m.mode;
  it.soft = clamp(m.soft / 2, 0, 1);
  it.berried = m.berried > 0 ? 1 : 0;

  switch (m.mode) {
    case 'moult': {
      // To cover; a still spell; the snap; out of the old shell. Then soft for some hours, hiding.
      const h = s.hide;
      if (h && h.d > 1 && m.modeT < 60) { it.goal = { x: h.x, z: h.z }; it.speed = SHRIMP.walk; it.ant = 0.6; break; }
      m.prep += dt;
      it.feed = 0; it.ant = 0.15;
      if (m.prep > 6) {
        it.moult = true; it.say = 'moult';
        m.soft = between(rnd, SHRIMP.softHours);
        m.moultIn = between(rnd, s.adult ? SHRIMP.moultDays : SHRIMP.moultYoungDays);
        // A grown female moults ready to breed: the males go looking, and in the tank's way of it she is berried after.
        if (s.female && s.adult && s.mates) { it.call = true; m.berried = between(rnd, SHRIMP.berriedDays); }
        go(m, 'hide'); m.left = 30;
      }
      break;
    }
    case 'hide': {
      const h = s.hide;
      if (h && h.d > 1 && (s.cover ?? 0) < 0.5) { it.goal = { x: h.x, z: h.z }; it.speed = SHRIMP.walk * (m.fear > 0.5 ? 1.6 : 1); it.ant = 0.8; break; }
      it.feed = 0.35; it.ant = 0.35; it.fan = m.berried > 0 ? 0.5 : 0;
      break;
    }
    case 'food': {
      // To the food; then stand at it (each shrimp at its own place round it) and pick fast.
      const f = food ?? s.food;
      if (!f) { go(m, 'graze'); break; }
      const at = { x: f.x + Math.cos(m.ring) * 0.45, z: f.z + Math.sin(m.ring) * 0.45 };
      const d = dist(here, at);
      it.face = { x: f.x, z: f.z };
      if (f.d > SHRIMP.eatR + 0.3 && d > 0.25) {
        it.goal = at; it.speed = SHRIMP.walk * 1.3; it.swim = d > 9; it.ant = 1;
      } else { it.feed = 1; it.ant = 0.7; it.eating = true; }
      break;
    }
    case 'swarm': {
      // A male searching: swims from place to place round where she was, barely stopping.
      m.pause -= dt;
      if (!m.goal || m.pause <= 0 && dist(here, m.goal) < 1.5) {
        const c = m.callAt ?? here, a = rnd() * Math.PI * 2, r = 4 + rnd() * 16;
        m.goal = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }; m.pause = 0.5 + rnd() * 1.5;
      }
      it.goal = m.goal; it.speed = SHRIMP.swim * 1.3; it.swim = true; it.ant = 1; it.searching = true;
      break;
    }
    default: {                                                    // graze, with shuffles, and now and then a move
      m.left -= dt * (s.rich != null ? 0.6 + (1 - s.rich) * 0.8 : 1);
      if (m.goal) {
        // on the way somewhere (a shuffle, a walk or a swim)
        it.goal = m.goal; it.speed = m.goalSpeed ?? SHRIMP.walk; it.swim = !!m.goalSwim; it.ant = 0.9;
        it.feed = m.goalSpeed === SHRIMP.shuffle ? 0.6 : 0;
        if (dist(here, m.goal) < 0.2) { m.goal = null; m.pause = between(rnd, SHRIMP.shuffleS); }
        break;
      }
      if (m.left <= 0) {
        const far = rnd() < SHRIMP.swimP;
        const p = pickSpot(s, rnd, far);
        m.left = between(rnd, SHRIMP.grazeS);
        if (p) { m.goal = p; m.goalSpeed = far ? SHRIMP.swim : SHRIMP.walk; m.goalSwim = far; it.goal = p; it.speed = m.goalSpeed; it.swim = far; break; }
      }
      // Standing and picking; a shuffle or a turn now and then.
      it.feed = 1; it.fan = m.berried > 0 ? 0.6 : 0.08; it.ant = 0.55;
      m.pause -= dt;
      if (m.pause <= 0) {
        m.pause = between(rnd, SHRIMP.shuffleS);
        const a = (s.yaw ?? 0) + (rnd() - 0.5) * 2.4, r = between(rnd, SHRIMP.shuffleCm);
        if (rnd() < 0.6) { m.goal = { x: here.x + Math.sin(a) * r, z: here.z + Math.cos(a) * r }; m.goalSpeed = SHRIMP.shuffle; m.goalSwim = false; }
        else m.face = { x: here.x + Math.sin(a) * 2, z: here.z + Math.cos(a) * 2 };
      }
      it.face = m.face;
    }
  }
  return it;
}

// What the inspector says it is doing.
export function shrimpDoing(it) {
  switch (it.mode) {
    case 'food': return it.eating ? 'Eating' : 'Heading for food';
    case 'swarm': return 'Searching for a mate';
    case 'moult': return 'Moulting';
    case 'hide': return it.soft > 0 ? 'Hiding (soft after a moult)' : 'Hiding';
    case 'stranded': return 'Stranded';
    default: return it.goal ? (it.swim ? 'Swimming' : 'Walking') : it.berried ? 'Grazing, fanning its eggs' : 'Grazing';
  }
}
