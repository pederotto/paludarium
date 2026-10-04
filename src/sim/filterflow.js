// The filter's own pump circuit as real hardware (content/equipment.js FILTERS): how much water its pump really moves and
// how fast that water runs in each hose. Pure numbers, no world state: sim.js calls it every step (Env.filterFlow, not
// saved), render/plumbing.js sizes the hoses and moves the water in them by it, ui/panels/Flow.jsx shows it.
//
// External filters (sponge box, canister) stand on the floor of the cabinet under the tank, fed by the overflow drain: the
// pool spills over a standpipe at its water line and falls down the drain hose to the filter (gravity: the pump does not
// pull on it); the filter's pump pushes the water through the media and lifts it back up the return hose into the pool. Its
// head is that lift (from the water in the filter to the pool's surface) plus what the media and the return hose cost, both
// growing with the square of the flow, and clogged media cost many times more; the pump gives less the higher it has to lift
// (sim/hydro.js pumpCurve). The corner foam filter stands in the pool: its pump lifts the water only over the top of the foam.

import { FILTERS } from '../content/equipment.js';
import { pumpCurve } from './hydro.js';
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
//   cabinet   sponge box, canister: on the cabinet floor, fed by the overflow drain, the pump lifts the water back up the return
//   pool      corner foam filter: in the pool, lifts the water over the top of the foam
//   rim       hang-on-back: the pump lifts the water up a rigid tube to a box on the rim (the tank's height over the pool's
//             line, and the box's own water standing RIM_BOX over the rim) and it falls back over a lip: no return hose
//   internal  submersible: pump and foam in one body in the pool, the outlet nozzle under the surface, so it lifts next to nothing
//   bed       false bottom: the pump in the slotted tower lifts from the plenum's line (E.plenumLevel, a centimetre under the
//             pool's when unknown) to a spout SPOUT over the pool; no false bottom, or a plenum under its intake, and it does not run
export const RIM_BOX = 4, INTERNAL_LIFT = 1;
export const MOUNTS = {
  cabinet: { run: 'out', pre: 2, lift: (E, k, level, drop) => Math.max(0, level + drop - FILTER_TOP[k]), len: (level, drop) => drop + 15,
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
// mediaBio, prefilter) with the pool's water at `level` cm over the glass floor and the cabinet floor `drop` cm under it.
export function filterFlow(E, level, drop = CABINET_DROP) {
  const kind = FILTERS[E.filterKind] ? E.filterKind : 'sponge', F = FILTERS[kind], M = MOUNTS[F.mount];
  const clog = Math.max(0, Math.min(1, (E.filterDirt ?? 0) / F.hold));
  const stages = stageClogs(F, clog);
  const lift = M.lift(E, kind, level, drop);
  const len = M.len(level, drop);
  // The media's head at the rated flow, each stage by its share, a clogged one many times more; more bio media a little more.
  let media = 0;
  for (const s of stages) media += s.share * (1 + CLOG_K * s.clog * s.clog) * (s.id === 'bio' ? 0.75 + 0.5 * (E.mediaBio ?? 0.5) : 1);
  media *= F.media;
  if (E.prefilter) media += M.pre;                     // the foam sleeve over the overflow's comb, or over the intake
  const head = (q) => lift + media * (q / F.lph) ** 2 + hoseLoss(q, F.hose[M.run][0], len);
  // The working point: the flow at which what the pump gives against the head equals the flow (bisection, it only falls).
  let lo = 0, hi = F.pump.lph;
  for (let k = 0; k < 40; k++) {
    const q = (lo + hi) / 2;
    if (F.pump.lph * pumpCurve(head(q), F.pump.hmax) > q) lo = q; else hi = q;
  }
  const blocked = M.blocked?.(E) ?? null;
  const lph = E.filter && !blocked ? (lo + hi) / 2 : 0;
  const hoses = M.hoses(F, len, level, drop).map(([role, [id, od], l, dir]) => ({ role, id, od, len: l, dir, v: hoseSpeed(lph, id) }));
  return { kind, on: !!E.filter, lph, rated: F.lph, eff: lph / F.lph, head: head(lph), lift, clog, stages, hoses, blocked };
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
