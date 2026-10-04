// The false bottom's own water (a plenum): the room under the egg-crate, under the land, that the substrate drains into.
//
// A real build: a white egg-crate (louvre) grid on short PVC legs, fibreglass mesh over it, the substrate on top. Rain and
// misting soak through the soil and drip into the plenum some time later; the pump stands in a slotted access tower down in
// it and lifts its water to the waterfall; where the land meets the pool the plenum is open to the pool through a screened
// gap, so the two settle toward one level, held a little apart by whatever is flowing through the screen. A bulkhead drain
// half a centimetre under the mesh lets out what rises over it (PLENUM.drain); only a pool standing well over the mesh or a
// downpour outruns it. When its water climbs over the mesh the soil above soaks it up from below and turns to mud (content/equipment.js plenumState; sim/climate.js, sim/plants.js read the state).
//
// The level is simulated here, not taken from the pool. Writes E.plenumLevel (cm of water over the glass floor, undefined
// without a false bottom), E.plenumL (litres in it), E.plenumSoak (litres on their way down through the soil) and returns
// the state object sim.js stores as E.plenum. The pump's draw is the hydraulics' pump flow (sim/hydro.js pump.lph, read
// only). Open to the pool, the water is conserved: what runs through the screen into the plenum comes out of the hydraulics'
// pool, and what the pump lifts out of the plenum goes back to it (the falls return it; sim/hydro.js draws the pump's flow from
// its pool, so the pool is paid back the plenum's share: Hydro.exchange). Rain and misting that drain through the land reach
// the pool this way too (without a pool they stay in the plenum until it is siphoned).

import { TANK } from './tank.js';
import { clamp } from '../util/math.js';
import { plenumState } from '../content/equipment.js';

export const PLENUM = {
  porosity: 0.85,     // share of the plenum that is water room (the egg-crate, the legs and the bio-rings take the rest)
  soilPorosity: 0.35, // water room in the substrate, once the water climbs over the mesh
  gap: 2,             // L/min through the screened gap to the pool, per cm of difference in level (mesh and fines hold it back)
  rain: 0.15,         // L/min a rain system's nozzles deliver at full rain (four misting nozzles)
  mist: 0.2,          // litres a hand misting puts on the tank, spread over the 90 minutes E.mist takes to fade
  tau: 120,           // minutes: the substrate lets half of a shower through in about this long (times ln 2)
  wick: 0.004,        // L/min per m² the soil draws back up when it is dry and the water is near the mesh
  intake: 0.8,        // cm: the pump in the tower sucks air below this
  over: 4,            // cm over the mesh: the soil is saturated to its surface; more runs off
  drain: 0.5,         // cm under the mesh: the lip of the build's bulkhead drain; water over it runs out of the tank
  drainLpm: 3,        // L/min the drain carries at most (a 1/2" bulkhead to a bucket or the house drain)
};

// The land's footprint over the false bottom (cm²): where the ground stands at least a centimetre over the mesh. Cached on
// the terrain, the ground's version and the mesh height (a new tank has a new terrain).
let area = { T: null, key: '', cm2: 0 };
export function plenumArea(W, plenumH) {
  const key = `${W.water?.hydro?.groundVer ?? 0}|${plenumH}|${TANK.w}|${TANK.d}`;
  const T = W.terrain, S = 3;
  if (area.T === T && area.key === key) return area.cm2;
  let n = 0, k = 0;
  for (let x = -TANK.w / 2 + S / 2; x < TANK.w / 2; x += S) for (let z = -TANK.d / 2 + S / 2; z < TANK.d / 2; z += S) {
    k++;
    if (T.baseAt(x, z) >= plenumH + 1) n++;
  }
  area = { T, key, cm2: Math.max(0.1, n / Math.max(1, k)) * TANK.w * TANK.d };
  return area.cm2;
}

// Litres in the plenum at a water level (cm over the glass), and back. Over the mesh the water fills the soil's pores.
export function litresAt(level, H, cm2) {
  const below = Math.min(level, H), over = Math.max(0, level - H);
  return (below * PLENUM.porosity + over * PLENUM.soilPorosity) * cm2 / 1000;
}
export function levelOf(L, H, cm2) {
  const full = H * PLENUM.porosity * cm2 / 1000;
  return L <= full ? L / (PLENUM.porosity * cm2 / 1000) : H + (L - full) / (PLENUM.soilPorosity * cm2 / 1000);
}

// One step of `d` game minutes. s: { level, soak } (cm, litres), changed in place. i: plenumH (cm), cm2 (footprint),
// floor (cm², the tank's floor), pool (the pool's level, cm, or null when there is no pool to be open to), poolPerCm (litres
// a centimetre of the pool's level holds: the pool rises and falls with what it swaps, and the pump's water comes back to it;
// left out, the pool stands still), pumpLph (the pump in the tower), rain 0 … 1, mist 0 … 1, soil (mean moisture 0 … 1).
// Returns the flows, L/min.
export function plenumStep(s, i, d) {
  const H = i.plenumH, cm2 = i.cm2, land = clamp(cm2 / i.floor, 0, 1);
  // Water reaching the land soaks down through the substrate (dry soil keeps more of it) and drips out of its underside.
  const onLand = (PLENUM.rain * (i.rain ?? 0) + (i.mist > 0 ? PLENUM.mist / 90 : 0)) * land * (0.3 + 0.7 * clamp(i.soil ?? 0.5, 0, 1));
  s.soak = Math.max(0, (s.soak ?? 0) + onLand * d);
  const drip = s.soak * (1 - Math.exp(-d / PLENUM.tau)) / d;
  s.soak -= drip * d;
  // The pump in the tower draws what its intake reaches; a drying substrate wicks water up when it is close to the mesh.
  const pump = (i.pumpLph ?? 0) / 60 * clamp((s.level - PLENUM.intake) / 1, 0, 1);
  const wick = PLENUM.wick * cm2 / 10000 * Math.max(0, 0.65 - (i.soil ?? 0.5)) / 0.65 * clamp(1 - (H - s.level) / 2, 0, 1);
  const net = drip - pump - wick, L0 = s.level;
  // One step with `out` more L/min leaving the plenum (the drain), from where it started.
  const advance = (out) => {
    const n = net - out;
    if (i.pool == null) return { level: levelOf(Math.max(0, litresAt(L0, H, cm2) + n * d), H, cm2), gap: 0 };
    // Open to the pool: the difference of the two levels relaxes (exactly, whatever the step) toward where the screen passes
    // the net flow, both levels moving (a small pool falls as much as the plenum rises, so the two cannot overshoot each other).
    const perCm = (L0 < H ? PLENUM.porosity : PLENUM.soilPorosity) * cm2 / 1000, Cw = i.poolPerCm > 0 ? i.poolPerCm : Infinity;
    const lam = PLENUM.gap * (1 / perCm + 1 / Cw), e0 = i.pool - L0;
    const eq = (Number.isFinite(Cw) ? pump / Cw : 0) / (PLENUM.gap * (1 / perCm + 1 / Cw)) - n / (PLENUM.gap * perCm * (1 / perCm + 1 / Cw));
    const gap = PLENUM.gap * (eq * d + (e0 - eq) * (1 - Math.exp(-lam * d)) / lam) / d;
    return { level: levelOf(Math.max(0, litresAt(L0, H, cm2) + (gap + n) * d), H, cm2), gap };
  };
  // The drain ("False bottom with drain"): what rises over its lip leaves the tank, so rain and misting that run through the
  // land cannot fill the pool and the plenum up to mud. Running full the whole step it may still not keep up (a pool standing
  // well over the mesh, a downpour): then the level settles where the screen's inflow matches it. Else it holds the lip.
  const lip = H - PLENUM.drain;
  let r = advance(0), drain = 0;
  if (r.level > lip) {
    const full = advance(PLENUM.drainLpm);
    if (full.level >= lip) { r = full; drain = PLENUM.drainLpm; }
    else {
      // It keeps up: the plenum stands at the lip and the drain takes what comes in. Through the screen that is the pool's
      // height over the lip, which falls as the pool pays it (and rises with the pump's return), worked out exactly over the
      // step so the time-lapse speed does not change how fast an overfilled pool drains.
      let gap = 0;
      if (i.pool != null) {
        const G = PLENUM.gap, Cw = i.poolPerCm > 0 ? i.poolPerCm : Infinity, e0 = i.pool - lip;
        if (Number.isFinite(Cw)) { const k = G / Cw, eq = pump / G; gap = G * (eq + (e0 - eq) * (1 - Math.exp(-k * d)) / (k * d)); }
        else gap = G * e0;
      }
      drain = clamp(gap + net + (litresAt(L0, H, cm2) - litresAt(lip, H, cm2)) / d, 0, PLENUM.drainLpm);
      r = { level: lip, gap: drain - net - (litresAt(L0, H, cm2) - litresAt(lip, H, cm2)) / d };
    }
  }
  s.level = clamp(r.level, 0, H + PLENUM.over);
  return { drip, pump, wick, gap: r.gap, drain };
}

// The world's step (sim.js): fits the plenum when a false bottom is chosen, steps it, writes E and returns E.plenum.
export function stepPlenum(W, E, d) {
  if (!(E.drainage >= 1)) { E.plenumLevel = undefined; E.plenumL = undefined; E.plenumSoak = 0; if (W.water.hydro) W.water.hydro.held = 0; return null; }
  const pool = W.water.level, P = W.water.hydro.pump;
  const hasPool = W.water.volumeLitres() > 1;
  if (!(E.plenumH > 0)) E.plenumH = Math.round((pool + 1) * 2) / 2;   // fitted just over the water
  const cm2 = plenumArea(W, E.plenumH), H = W.water.hydro;
  const pumpLph = P.on && P.running ? P.lph : 0;
  // A new plenum is filled with the build (the keeper fills it with the tank: not out of the pool) to where it settles open
  // to the pool, the pump in its tower holding it under the pool's line; without a pool it holds the little water poured in.
  if (!(E.plenumLevel >= 0)) E.plenumLevel = hasPool ? clamp(pool - pumpLph / 60 / PLENUM.gap, 0, E.plenumH + PLENUM.over) : Math.min(1.5, E.plenumH * 0.3);
  const s = { level: E.plenumLevel, soak: E.plenumSoak ?? 0 };
  const poolPerCm = hasPool && H.volumeAt ? (H.volumeAt(pool + 0.25) - H.volumeAt(pool - 0.25)) / 500 : 0;
  const f = plenumStep(s, {
    plenumH: E.plenumH, cm2, floor: TANK.w * TANK.d, pool: hasPool ? Math.max(0, pool) : null, poolPerCm,
    pumpLph, rain: E.rain, mist: E.mist, soil: E.soil,
  }, d);
  // The pool pays for the plenum's change that rain, misting and the soil's wicking did not: the screen's flow out of the pool
  // less the pump's back into it, and any water over the soil's surface, which runs off back to the pool. What the drain took
  // left the tank: not the pool's.
  if (hasPool && H.exchange) {
    const want = ((f.drip - f.wick - f.drain) * d - (litresAt(s.level, E.plenumH, cm2) - litresAt(E.plenumLevel, E.plenumH, cm2))) * 1000;
    const short = H.exchange(want) - want;      // > 0 when the pool ran dry: the plenum got that much less
    if (short > 1e-9) s.level = levelOf(Math.max(0, litresAt(s.level, E.plenumH, cm2) - short / 1000), E.plenumH, cm2);
    H.solveLevel?.();                           // (the pool's line moved: the next step and the picture see it now)
  }
  E.plenumLevel = s.level; E.plenumSoak = s.soak;
  E.plenumL = litresAt(s.level, E.plenumH, cm2);
  const st = plenumState(E, s.level);
  return st && { ...st, level: s.level, L: E.plenumL, full: litresAt(E.plenumH, E.plenumH, cm2), flows: f, open: hasPool };
}
