// The filter's own pump circuit as real hardware (content/equipment.js FILTERS): how much water its pump really moves and
// how fast that water runs in each hose. Pure numbers, no world state: sim.js calls it every step (Env.filterFlow, not
// saved), render/plumbing.js sizes the hoses and moves the water in them by it, ui/panels/Flow.jsx shows it.
//
// External filters (sponge box, canister) stand on the floor of the cabinet under the tank, fed by the overflow drain: the
// pool spills over a standpipe at its water line and falls down the drain hose to the filter (gravity: the pump does not
// pull on it). The sponge box is open: its pump lifts the water from the box's own level back up the return hose to the outlet
// over the pool. The canister is sealed, a closed loop: what falls down the drain balances what rises in the return, so its pump
// lifts only to the outlet over the water, and its hoses and media are what cost it flow. Media and hoses grow with the square
// of the flow, clogged media cost many times more; the pump gives less the higher its head (filterPumpCurve). In-tank pumps
// (corner foam, internal, bed tower) lift only from the water they stand in to their outlet; a hang-on-back up to its box.

import { FILTERS, PUMPS, PUMP_LADDER } from '../content/equipment.js';
import { PLENUM } from './plenum.js';
import { TANK } from './tank.js';

const TW = () => TANK.w / 2, TD = () => TANK.d / 2;

export const CABINET_DROP = 70.8;                      // cm from the glass floor down to the cabinet floor (engine/stage.js)
export const FILTER_TOP = { sponge: 15, canister: 30 };    // cm: the water in the filter over the cabinet floor (render/plumbing.js)
export const SPOUT = 1.5;                               // cm: the corner foam filter's spout over the water
const G = 981, NU = 0.01;                               // cm/s²; water's kinematic viscosity, cm²/s (20 °C)
const CLOG_K = 40;                                      // a stage clogged solid costs 41 times its clean head

// Standard aquarium hose, inner/outer diameter in mm. The main pump's hose by its rating (L/h).
export const HOSES = [[9, 12], [12, 16], [16, 22], [19, 27], [25, 34]];
export const pumpHose = (rate) => (rate <= 300 ? HOSES[0] : HOSES[1]);

// Speed of the water (cm/s) when lph runs through a full hose of inner diameter id (mm): v = Q / A.
export const hoseSpeed = (lph, id) => (Math.max(0, lph) * 1000 / 3600) / (Math.PI * (id / 20) ** 2);

// Head (cm) a full hose of length len (cm) costs at lph: Darcy-Weisbach friction (laminar or Blasius) plus k velocity heads
// for its bends and fittings.
export function hoseLoss(lph, id, len, k = 1.5) {
  const v = hoseSpeed(lph, id), D = id / 10;
  if (!(v > 0)) return 0;
  const re = (v * D) / NU;
  const f = re < 2300 ? 64 / re : 0.316 * re ** -0.25;
  return ((f * len) / D + k) * (v * v) / (2 * G);
}

// How full each stage is when the filter as a whole is `clog` (0 … 1): the coarse stage catches the dirt first and fills
// first; what it lets through fills the next ones later.
const STARTS = [0, 0.35, 0.55];
export function stageClogs(F, clog) {
  return F.stages.map(([id, name, share], i) => {
    const s = STARTS[i] ?? 0.6;
    const c = i === 0 ? clog * 1.6 : (clog - s) / (1 - s);
    return { id, name, share, clog: Math.max(0, Math.min(1, c)) };
  });
}

// Where each kind stands decides what its pump lifts, which hose costs head and what is drawn. lift(E, kind, level, drop) is the
// head (cm) the pump works against before the media; len(level, drop) the length (cm) of the hose that costs head, of the `run`
// ('out' the return, 'in' the intake) bore; pre the head a sponge on the intake adds; hoses the hoses to draw: role, bore, length,
// direction of the water; blocked why it cannot run (or null).
//   cabinet   sponge box, canister: on the cabinet floor, fed by the overflow drain; the open box's pump lifts from its water to the
//             outlet SPOUT over the pool, the closed canister's only SPOUT (both its hoses cost friction)
//   pool      corner foam filter: in the pool, lifts the water over the top of the foam
//   rim       hang-on-back: the pump lifts the water up a rigid tube to a box on the rim (the tank's height over the pool's
//             line, and the box's own water standing RIM_BOX over the rim) and it falls back over a lip: no return hose
//   internal  submersible: pump and foam in one body in the pool, the outlet nozzle under the surface, so it lifts next to nothing
//   bed       false bottom: the pump in the slotted tower lifts from the plenum's line (E.plenumLevel, a centimetre under the
//             pool's when unknown) to a spout SPOUT over the pool; no false bottom, or a plenum under its intake, and it does not run
// A filter pump's curve (B5e): a centrifugal pump's head falls with the square of its flow, H = Hmax (1 - (Q / Qmax)^2), so against
// `head` it gives sqrt(1 - head / Hmax) of its free flow. (sim/hydro.js pumpCurve is the main pump's, the one that feeds the streams and
// falls, not a filter pump: Q = Qmax (1 - (H / Hmax)^2) bends the other way; left as it is.)
export const filterPumpCurve = (head, hmax) => Math.sqrt(Math.max(0, 1 - head / hmax));
export const LIFT_MARGIN = 0.8;      // a pump is sized so the static lift is at most this share of its maximum head
export const TURNOVER = 4;           // the pool's water should pass the filter this many times an hour (a keeper's rule)
export const RIM_BOX = 4, INTERNAL_LIFT = 1;
export const MOUNTS = {
  cabinet: { run: 'out', pre: 2, lift: (E, k, level, drop) => (FILTERS[k].closed ? SPOUT : Math.max(0, level + drop - FILTER_TOP[k]) + SPOUT), len: (level, drop) => drop + 15,
    hoses: (F, len, level, drop) => [['intake', F.hose.in, drop + 15, 'down'], ['return', F.hose.out, len, 'up']] },
  pool: { run: 'out', pre: 0, lift: () => SPOUT, len: (level) => Math.max(4, level + SPOUT + 2),
    hoses: (F, len) => [['riser', F.hose.out, len, 'up']] },
  rim: { run: 'in', pre: 1.5, lift: (E, k, level) => Math.max(0, TANK.h - level) + RIM_BOX, len: () => TANK.h,
    hoses: (F, len) => [['uptake', F.hose.in, len, 'up']] },
  internal: { run: 'out', pre: 0, lift: () => INTERNAL_LIFT, len: () => 12,
    hoses: (F, len) => [['outlet', F.hose.out, len, 'up']] },
  bed: { run: 'out', pre: 0, lift: (E, k, level) => Math.max(0, level + SPOUT - (E.plenumLevel ?? level - 1)), len: (level) => Math.max(8, level + SPOUT + 6),
    blocked: (E) => (E.drainage < 1 ? 'no false bottom' : E.plenumLevel < PLENUM.intake ? 'dry' : null),
    hoses: (F, len) => [['riser', F.hose.out, len, 'up']] },
};

// The flow (L/h) and the head (cm) it meets, the stages and the hoses, for the settings in E (filter, filterKind, filterDirt,
// mediaBio, prefilter) with the pool's water at `level` cm over the glass floor and the cabinet floor `drop` cm under it; `litres`
// (the pool's water, from the Care panel) sizes a bought filter by TURNOVER. pump the pump in use, fitted true when it was fitted from
// PUMPS, valve the head its flow knob adds, target the flow it is sized for, need the smallest size that does it (null: none),
// undersized, low (the lift is more than the pump's head: it moves nothing), small (a fitted filter turns the pool over too slowly).
export function filterFlow(E, level, drop = CABINET_DROP, litres = 0) {
  const kind = FILTERS[E.filterKind] ? E.filterKind : 'sponge', F = FILTERS[kind], M = MOUNTS[F.mount];
  const clog = Math.max(0, Math.min(1, (E.filterDirt ?? 0) / F.hold));
  const stages = stageClogs(F, clog);
  const lift = M.lift(E, kind, level, drop);
  const len = M.len(level, drop);
  const fit = pumpFit(kind, E, level, drop, litres), P = fit.pump;
  const head = system(F, M, stages, lift, len, drop, E.mediaBio ?? 0.5, E.prefilter);
  const blocked = M.blocked?.(E) ?? null, low = lift >= P.hmax;
  const lph = E.filter && !blocked && !low ? workPoint(P, head, fit.kv) : 0;
  const hoses = M.hoses(F, len, level, drop).map(([role, [id, od], l, dir]) => ({ role, id, od, len: l, dir, v: hoseSpeed(lph, id) }));
  const valve = fit.kv * lph * lph;
  return { kind, on: !!E.filter, lph, rated: F.lph, eff: lph / F.lph, head: head(lph) + valve, valve, lift, clog, stages, hoses, blocked,
    pump: P, fitted: fit.fitted, target: fit.target, need: fit.need, undersized: fit.undersized || low, low, small: fit.small };
}

// The system's head (cm) at q L/h: the lift, the media at the rated flow (each stage by its share, a clogged one many times more, more
// bio media a little more), the foam sleeve over the overflow's comb or the intake, and the hose (both of a closed canister's: one loop).
function system(F, M, stages, lift, len, drop, bio, pre) {
  let media = 0;
  for (const s of stages) media += s.share * (1 + CLOG_K * s.clog * s.clog) * (s.id === 'bio' ? 0.75 + 0.5 * bio : 1);
  media = media * F.media + (pre ? M.pre : 0);
  return (q) => lift + media * (q / F.lph) ** 2 + hoseLoss(q, F.hose[M.run][0], len) + (F.closed ? hoseLoss(q, F.hose.in[0], drop + 15) : 0);
}

// The working point: the flow at which what pump P gives against the head (and the knob's kv q²) equals the flow (bisection, it only falls).
function workPoint(P, head, kv = 0) {
  let lo = 0, hi = P.lph;
  for (let k = 0; k < 40; k++) {
    const q = (lo + hi) / 2;
    if (P.lph * filterPumpCurve(head(q) + kv * q * q, P.hmax) > q) lo = q; else hi = q;
  }
  return (lo + hi) / 2;
}

// The pump an installation gets (B5e), worked out when the set-up or the water level changes (memoised per half centimetre), not per
// step. A fit: 'ladder' row gets the smallest PUMPS size whose lift is at most LIFT_MARGIN of its head and that gives the row's flow
// (F.lph) through clean media; its flow knob is set there to that flow (kv, the valve's head over q²). None does: the largest, flagged.
// A row whose pump is the product (bed, hang-on-back, internal) keeps the size bought; need is the smallest size of its family that gives
// the target (its own flow, or TURNOVER x the pool's litres) within the margin. A head is never raised.
const FITS = new Map();
export function pumpFit(kind, E, level, drop = CABINET_DROP, litres = 0) {
  const F = FILTERS[kind], M = MOUNTS[F.mount], lv = Math.round(level * 2) / 2, L = Math.round(litres);
  const pl = F.mount === 'bed' ? Math.round((E.plenumLevel ?? lv - 1) * 2) / 2 : 0;
  const key = `${kind}|${lv}|${drop}|${TANK.h}|${pl}|${L}`;
  let r = FITS.get(key);
  if (r) return r;
  const lift = M.lift(F.mount === 'bed' ? { ...E, plenumLevel: pl } : E, kind, lv, drop), len = M.len(lv, drop);
  const clean = (G) => system(G, M, stageClogs(G, 0), lift, len, drop, 0.5, false);
  if (F.fit === 'ladder') {
    const h = clean(F), t = F.lph;
    const P = PUMP_LADDER.map((id) => PUMPS[id]).find((p) => lift <= LIFT_MARGIN * p.hmax && workPoint(p, h) >= t);
    const kv = P ? Math.max(0, (P.hmax * (1 - (t / P.lph) ** 2) - h(t)) / (t * t)) : 0;
    r = { pump: P ?? PUMPS[PUMP_LADDER.at(-1)], kv, fitted: true, target: t, undersized: !P, need: P?.name ?? null, small: L > 0 && t < TURNOVER * L };
  } else {
    const fam = Object.keys(FILTERS).filter((k) => FILTERS[k].mount === F.mount), t = L > 0 ? TURNOVER * L : F.lph;
    const need = fam.find((k) => lift <= LIFT_MARGIN * FILTERS[k].pump.hmax && workPoint(FILTERS[k].pump, clean(FILTERS[k])) >= t * 0.97) ?? null;
    r = { pump: F.pump, kv: 0, fitted: false, target: t, undersized: !need || fam.indexOf(kind) < fam.indexOf(need), need: need && FILTERS[need].name, small: false };
  }
  if (FITS.size > 500) FITS.clear();
  FITS.set(key, r);
  return r;
}

// The filter's pull and push in the pool. render/plumbing.js puts the overflow and the return where the keeper sees them and
// records them in hydro.ports ({ lph, intake: { x, y, z, r }, ret: { x, y, z, dx, dz, D } }). The overflow's slotted crown is
// a sink at the surface: the water converges on it through a hemisphere, v = Q / 2πr², capped at the speed through its slots
// (half open, a centimetre tall). The return's nozzle is a round turbulent jet: u0 = Q / (πD²/4) along its core (6.2 bores),
// then 6.2 u0 D / x on the axis, Gaussian across with a half-width of 0.1 x (Pope, Turbulent Flows, ch. 5). cm/s into `out`.
export function poolCurrent(H, x, y, z, out = { x: 0, y: 0, z: 0 }) {
  out.x = out.y = out.z = 0;
  const P = H?.ports, q = (P?.lph ?? 0) / 3.6;
  if (!(q > 0)) return out;
  const i = P.intake;
  if (i) {
    const dx = i.x - x, dy = i.y - y, dz = i.z - z, d = Math.hypot(dx, dy, dz), r = Math.max(i.r, d);
    const v = Math.min(q / (2 * Math.PI * r * r), q / (Math.PI * i.r)) / Math.max(d, 1e-3);
    out.x += dx * v; out.y += dy * v; out.z += dz * v;
  }
  const j = P.ret;
  if (j) {
    const rx = x - j.x, ry = y - j.y, rz = z - j.z, ax = rx * j.dx + rz * j.dz;
    if (ax > 0) {
      const u0 = q / (Math.PI * j.D * j.D / 4), core = 6.2 * j.D, b = 0.1 * Math.max(ax, core);
      const u = (ax < core ? u0 : u0 * core / ax) * Math.exp(-0.693 * Math.max(0, rx * rx + ry * ry + rz * rz - ax * ax) / (b * b));
      out.x += j.dx * u; out.z += j.dz * u;
    }
  }
  return out;
}

// Flakes and pellets still in the water drift on the filter's current; the ones that reach the overflow's crown are sucked in.
const C = { x: 0, y: 0, z: 0 };
export function filterDrift(W, food, dt) {
  const H = W.water?.hydro, i = H?.ports?.intake;
  if (!(H?.ports?.lph > 0) || !(dt > 0)) return;
  for (let k = food.length - 1; k >= 0; k--) {
    const f = food[k];
    if (f.settled || !W.water.inMainPool(f.pos.x, f.pos.z)) continue;
    poolCurrent(H, f.pos.x, f.pos.y, f.pos.z, C);
    f.pos.x = Math.max(-TW() + 0.5, Math.min(TW() - 0.5, f.pos.x + C.x * dt));
    f.pos.z = Math.max(-TD() + 0.5, Math.min(TD() - 0.5, f.pos.z + C.z * dt));
    f.pos.y = Math.min(H.level, f.pos.y + C.y * dt);
    if (i && Math.hypot(f.pos.x - i.x, f.pos.y - i.y, f.pos.z - i.z) < i.r + 0.4) food.splice(k, 1);
  }
}

// Shrimp and small fish keep out of the water near the overflow that pulls harder than a fifth of their cruising speed.
export function filterAvoid(W, list, SPECIES, dt) {
  const H = W.water?.hydro, i = H?.ports?.intake, q = (H?.ports?.lph ?? 0) / 3.6;
  if (!i || !(q > 0) || !(dt > 0)) return;
  for (const a of list) {
    const sp = SPECIES[a.sp];
    if (!sp || !(sp.size < 5) || !(sp.kind === 'swim' || /shrimp/.test(a.sp))) continue;
    const s = sp.speed ?? 3, R = Math.sqrt(q / (2 * Math.PI * 0.2 * s));
    const dx = a.pos.x - i.x, dz = a.pos.z - i.z, d = Math.hypot(dx, dz);
    if (d >= R || d < 1e-3 || Math.abs(a.pos.y - i.y) > R) continue;
    const push = Math.min(R - d, s * 0.5 * dt);
    a.pos.x += (dx / d) * push; a.pos.z += (dz / d) * push;
  }
}
