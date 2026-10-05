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
//
// Without a false bottom the same step runs on the ground's own water table (stepGround): in a drainage layer of LECA clay balls
// (E.drainage between 0 and 1) or in a plain substrate (0). The land is open to the pool through the soil where it slopes into
// the water (no sealed divider), so the table settles toward the pool's line at the soil's seep rate: a layer under the pool's
// line is flooded, as in a real tank. Writes E.groundLevel (cm over the glass floor), E.groundL (litres in the pores) and
// E.groundSoak. belowGround(E) is what the soil profile and the X-ray body (render/soilside.js) draw, in every build.

import { TANK } from './tank.js';
import { clamp } from '../util/math.js';
import { plenumState, filterOf } from '../content/equipment.js';

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

// GUESSES (not from a sheet, B5d): the water room between expanded-clay balls, and the L/min the soil front passes to or from
// the pool per cm of difference in level, over the whole land (much slower than the false bottom's screened gap).
export const LECA_POROSITY = 0.45;
export const SEEP = 0.3;
// The ground's profiles: a 3 cm layer of LECA under the soil (the height render/soilside.js draws), or soil from the glass up.
export const LECA = { kind: 'leca', h: 3, porosity: LECA_POROSITY, soilPorosity: PLENUM.soilPorosity, gap: SEEP };
export const SOIL = { kind: 'soil', h: 0, porosity: PLENUM.soilPorosity, soilPorosity: PLENUM.soilPorosity, gap: SEEP };

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
// Optional: profile (PLENUM, LECA or SOIL: porosities, gap; a drain only with PLENUM) and shape ({ litres(level), level(L),
// perCm(level), max }: the ground's own when its water lies under ground of every height; else the plenum's flat box).
export function plenumStep(s, i, d) {
  const H = i.plenumH, cm2 = i.cm2, land = clamp(cm2 / i.floor, 0, 1), p = i.profile ?? PLENUM, G = p.gap;
  const sh = i.shape ?? { litres: (v) => litresAt(v, H, cm2), level: (L) => levelOf(L, H, cm2), perCm: (v) => (v < H ? PLENUM.porosity : PLENUM.soilPorosity) * cm2 / 1000, max: H + PLENUM.over };
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
    if (i.pool == null) return { level: sh.level(Math.max(0, sh.litres(L0) + n * d)), gap: 0 };
    // Open to the pool: the difference of the two levels relaxes (exactly, whatever the step) toward where the screen passes
    // the net flow, both levels moving (a small pool falls as much as the plenum rises, so the two cannot overshoot each other).
    const perCm = sh.perCm(L0), Cw = i.poolPerCm > 0 ? i.poolPerCm : Infinity;
    const lam = G * (1 / perCm + 1 / Cw), e0 = i.pool - L0;
    const eq = (Number.isFinite(Cw) ? pump / Cw : 0) / (G * (1 / perCm + 1 / Cw)) - n / (G * perCm * (1 / perCm + 1 / Cw));
    const gap = G * (eq * d + (e0 - eq) * (1 - Math.exp(-lam * d)) / lam) / d;
    return { level: sh.level(Math.max(0, sh.litres(L0) + (gap + n) * d)), gap };
  };
  // The drain ("False bottom with drain"): what rises over its lip leaves the tank, so rain and misting that run through the
  // land cannot fill the pool and the plenum up to mud. Running full the whole step it may still not keep up (a pool standing
  // well over the mesh, a downpour): then the level settles where the screen's inflow matches it. Else it holds the lip.
  const lip = p.drain != null ? H - p.drain : Infinity;   // (a LECA layer or plain soil has no drain)
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
      drain = clamp(gap + net + (sh.litres(L0) - sh.litres(lip)) / d, 0, PLENUM.drainLpm);
      r = { level: lip, gap: drain - net - (sh.litres(L0) - sh.litres(lip)) / d };
    }
  }
  s.level = clamp(r.level, 0, sh.max);
  return { drip, pump, wick, gap: r.gap, drain, land: onLand };
}

// The world's step (sim.js): fits the plenum when a false bottom is chosen, steps it, writes E and returns E.plenum.
export function stepPlenum(W, E, d) {
  if (!(E.drainage >= 1)) { E.plenumLevel = undefined; E.plenumL = undefined; E.plenumSoak = 0; stepGround(W, E, d); return null; }
  E.groundLevel = undefined; E.groundL = undefined; E.groundSoak = 0;
  const pool = W.water.level, P = W.water.hydro.pump;
  const hasPool = W.water.volumeLitres() > 1;
  if (!(E.plenumH > 0)) E.plenumH = Math.round((pool + 1) * 2) / 2;   // fitted just over the water
  const cm2 = plenumArea(W, E.plenumH), H = W.water.hydro;
  // The pump in the tower: the main pump's (it feeds the falls) and a bed filter's own (content/equipment.js FILTERS.bed; it returns to
  // the pool by its riser, so the loop pool > screen > plenum > pump > pool is closed and the exchange below, which pays the pool for the
  // plenum's change only, stays right). E.filterLph is 0 when that filter is off or cannot run.
  const pumpLph = (P.on && P.running ? P.lph : 0) + (E.filter && filterOf(E).mount === 'bed' ? E.filterLph ?? 0 : 0);
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

// --- The ground's water table (no false bottom) -----------------------------------------------------------------------------

// The floor on a 3 cm grid with the ground's height at each cell's centre (cm, sorted with running sums for the litres below):
// pure terrain, cached on the terrain, its version and the tank (a new tank has a new terrain). Also the X-ray body's grid.
let grid = { T: null, key: '' };
export function groundGrid(W) {
  const T = W.terrain, key = `${W.water?.hydro?.groundVer ?? 0}|${TANK.w}|${TANK.d}`;
  if (grid.T === T && grid.key === key) return grid;
  const nx = Math.max(1, Math.round(TANK.w / 3)), nz = Math.max(1, Math.round(TANK.d / 3)), sx = TANK.w / nx, sz = TANK.d / nz;
  const g = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = Math.max(0, T.baseAt(-TANK.w / 2 + (i + 0.5) * sx, -TANK.d / 2 + (j + 0.5) * sz));
  const sorted = Float64Array.from(g).sort(), pre = new Float64Array(sorted.length + 1);
  for (let k = 0; k < sorted.length; k++) pre[k + 1] = pre[k] + sorted[k];
  grid = { T, key, nx, nz, sx, sz, g, sorted, pre, cell: sx * sz, max: sorted[sorted.length - 1] };
  return grid;
}
// Over all cells: the sum of min(level, ground) (cm) and how many cells stand over `level`.
function below(G, v) {
  let lo = 0, hi = G.sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (G.sorted[m] < v) lo = m + 1; else hi = m; }
  return [G.pre[lo] + v * (G.sorted.length - lo), G.sorted.length - lo];
}
// The water a table holds in the pores of the ground under it (LECA in its bottom `h` cm, soil over that), cell by cell up to
// each cell's ground: under the pool's bed it is the bed's pores only (the pool's own water is the hydraulics').
export function groundShape(G, p) {
  const A = G.cell / 1000;
  const litres = (v) => { v = Math.max(0, v); const a = below(G, Math.min(v, p.h))[0]; return (p.porosity * a + p.soilPorosity * (below(G, v)[0] - a)) * A; };
  const full = litres(G.max);
  return {
    max: G.max, litres,
    perCm: (v) => (v < p.h ? p.porosity : p.soilPorosity) * Math.max(1, below(G, v)[1]) * A,
    level: (L) => {
      if (!(L > 0)) return 0;
      if (L >= full) return G.max;
      let lo = 0, hi = G.max;
      for (let k = 0; k < 48; k++) { const m = (lo + hi) / 2; if (litres(m) < L) lo = m; else hi = m; }
      return (lo + hi) / 2;
    },
  };
}

// The world's step for a drainage layer or a plain substrate (from stepPlenum). Open to the pool through the soil: what seeps
// in or out is paid by the pool (Hydro.exchange, as the plenum's screen). A new build is filled with it to the pool's line (not
// out of the pool); without a pool a LECA layer holds the little left in its bottom and plain soil none. Returns the flows, L/min.
export function stepGround(W, E, d) {
  const p = E.drainage > 0 ? LECA : SOIL, G = groundGrid(W), sh = groundShape(G, p), H = W.water.hydro;
  const pool = W.water.level, hasPool = W.water.volumeLitres() > 1;
  if (!(E.groundLevel >= 0)) {
    E.groundLevel = hasPool ? clamp(pool, 0, sh.max) : p === LECA ? 1.2 : 0;
    E.groundSoak = 0;
    if (H) H.held = 0;
  }
  const L0 = E.groundLevel, s = { level: L0, soak: E.groundSoak ?? 0 };
  // The land: the ground standing over the pool's line (or the table); rain on it soaks down to the table.
  const land = Math.max(1, below(G, Math.max(L0, hasPool ? pool : 0))[1]) * G.cell;
  const poolPerCm = hasPool && H?.volumeAt ? (H.volumeAt(pool + 0.25) - H.volumeAt(pool - 0.25)) / 500 : 0;
  const f = plenumStep(s, {
    profile: p, shape: sh, plenumH: p.h, cm2: land, floor: TANK.w * TANK.d, pool: hasPool ? Math.max(0, pool) : null, poolPerCm,
    pumpLph: 0, rain: E.rain, mist: E.mist, soil: E.soil,
  }, d);
  if (hasPool && H?.exchange) {
    const want = ((f.drip - f.wick - f.drain) * d - (sh.litres(s.level) - sh.litres(L0))) * 1000;
    const short = H.exchange(want) - want;
    if (short > 1e-9) s.level = sh.level(Math.max(0, sh.litres(s.level) - short / 1000));
    H.solveLevel?.();
  }
  E.groundLevel = s.level; E.groundSoak = s.soak; E.groundL = sh.litres(s.level);
  return f;
}

// What the renderer draws below the ground, in every build: mode (0 plain substrate, 1 LECA layer, 2 false bottom), the
// drainage's height (cm), the water's level (cm over the glass floor) and its litres. `pool`: the pool's level, for a false
// bottom not yet fitted.
export function belowGround(E, pool = 0) {
  if (E.drainage >= 1) return { mode: 2, layerH: E.plenumH || pool + 1, level: E.plenumLevel ?? pool, L: E.plenumL ?? 0 };
  const leca = E.drainage > 0;
  return { mode: leca ? 1 : 0, layerH: leca ? LECA.h : 0, level: E.groundLevel ?? (leca ? 1.2 : 0), L: E.groundL ?? 0 };
}

// The X-ray body's top over a cell with ground `g` (cm): the level, kept a millimetre under the ground where the ground is lower
// (under the pool its bed's pores only). render/soilside.js draws the same in its vertex stage.
export const BODY_SINK = 0.1;
export const bodyTop = (g, level) => Math.max(0, Math.min(level, g - BODY_SINK));
