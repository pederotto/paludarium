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

// The flow (L/h) and the head (cm) it meets, the stages and the hoses, for the settings in E (filter, filterKind, filterDirt,
// mediaBio, prefilter) with the pool's water at `level` cm over the glass floor and the cabinet floor `drop` cm under it.
export function filterFlow(E, level, drop = CABINET_DROP) {
  const kind = FILTERS[E.filterKind] ? E.filterKind : 'sponge', F = FILTERS[kind];
  const clog = Math.max(0, Math.min(1, (E.filterDirt ?? 0) / F.hold));
  const stages = stageClogs(F, clog);
  const ext = kind !== 'matten';
  const lift = ext ? Math.max(0, level + drop - FILTER_TOP[kind]) : SPOUT;
  const retLen = ext ? drop + 15 : Math.max(4, level + SPOUT + 2);
  // The media's head at the rated flow, each stage by its share, a clogged one many times more; more bio media a little more.
  let media = 0;
  for (const s of stages) media += s.share * (1 + CLOG_K * s.clog * s.clog) * (s.id === 'bio' ? 0.75 + 0.5 * (E.mediaBio ?? 0.5) : 1);
  media *= F.media;
  if (ext && E.prefilter) media += 2;                  // the foam sleeve over the overflow's comb
  const head = (q) => lift + media * (q / F.lph) ** 2 + hoseLoss(q, F.hose.out[0], retLen);
  // The working point: the flow at which what the pump gives against the head equals the flow (bisection, it only falls).
  let lo = 0, hi = F.pump.lph;
  for (let k = 0; k < 40; k++) {
    const q = (lo + hi) / 2;
    if (F.pump.lph * pumpCurve(head(q), F.pump.hmax) > q) lo = q; else hi = q;
  }
  const lph = E.filter ? (lo + hi) / 2 : 0;
  const hose = (role, [id, od], len, dir) => ({ role, id, od, len, dir, v: hoseSpeed(lph, id) });
  const hoses = ext
    ? [hose('intake', F.hose.in, drop + 15, 'down'), hose('return', F.hose.out, retLen, 'up')]
    : [hose('riser', F.hose.out, retLen, 'up')];
  return { kind, on: !!E.filter, lph, rated: F.lph, eff: lph / F.lph, head: head(lph), lift, clog, stages, hoses };
}
