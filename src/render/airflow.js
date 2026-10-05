// How much air and water is really moving, for the plant sway shader.
//
// A closed tank has no wind: leaves should stay still unless something moves the air (a fan, a fogger, rain,
// the spray of a waterfall) or, under water, the current. `updateAirflow` is called once a frame by the game
// shell; it eases two uniforms that plantMaterial reads:
//   AIR.air   0 … 1  how hard the air moves (a very small ambient value when nothing runs)
//   AIR.flow  0 … 1  how hard the water moves (underwater plants)
// Both are 0 while the simulation is paused. The hydro velocity arrays (vx, vz in cm/s) are read only here, inside
// `waterFlow`, guarded so that a change in the water code cannot break the render.

import { uniform } from 'three/tsl';
import { poolCurrent } from '../sim/filterflow.js';
import { currentAt, FLOOR_LAYER, FLOOR_EXP } from '../sim/currentat.js';
import { localFlow, plantBend } from '../util/plantbend.js';

export const AMBIENT_AIR = 0.035;    // a hint of movement even in still air (a lid still leaks a little)
export const AMBIENT_FLOW = 0.05;

//   AIR.blend 0 … 1  how far the plants have eased from the last water sample to the new one (the per-plant `flow` attribute, plantFlow)
export const AIR = { air: uniform(AMBIENT_AIR), flow: uniform(AMBIENT_FLOW), blend: uniform(1) };
if (typeof window !== 'undefined') window.__AIR = AIR;   // for tests (a dev-server reload can load this module twice)

let run = 1;          // 0 paused … 1 running, eased
let flowEase = 0;
let sampleT = 1e9;
let flowNow = 0;

// Mean flow speed of the wet cells, scaled so a gentle stream is about 0.4 and a strong pump or cascade is 1.
export function waterFlow(world) {
  try {
    const h = world.water?.hydro;
    if (!h?.vx || !h.d) return 0;
    const N = h.N ?? h.d.length;
    const step = Math.max(1, Math.floor(N / 700));
    let sum = 0, n = 0;
    for (let c = 0; c < N; c += step) {
      if (h.d[c] < 0.3) continue;
      sum += Math.hypot(h.vx[c], h.vz[c]);
      n++;
    }
    if (!n) return 0;
    return Math.min(1, (sum / n) / 9);
  } catch { return 0; }
}

// The water that covers a plant standing at (x, y0, z) and how it moves there (B5b-fix). Returns the depth over its base, cm (0: dry),
// and the push in `out` (cm/s, tank axes). Depth: the animals' rule (Animals.waterTop: water.surfaceAt(x, z, 0.3), which is the main
// pool's level over the ground or a stream's or pond's depth). Push: currentAt, the fishes' sampler (sim/currentat.js), at half the depth
// over the base (at most SAMPLE_UP); in the main pool, whose water is the level and not hydro `d` (currentAt's d gate skips it), the
// same sum written out: the cell's flow plus the filter's jet and intake (poolCurrent), slowed in currentAt's floor layer.
export const SAMPLE_UP = 4;   // cm (a guess: where most of a submerged leaf is)
const _p = { x: 0, y: 0, z: 0 };
export function waterAtPlant(W, x, y0, z, out) {
  out.x = out.y = out.z = 0;
  const H = W.water?.hydro, top = W.water?.surfaceAt?.(x, z, 0.3);
  const depth = Number.isFinite(top) ? Math.max(0, top - y0) : 0;
  if (!(depth > 0) || !H?.vx) return depth;
  const c = H.cellOf(x, z), y = y0 + Math.min(depth * 0.5, SAMPLE_UP);
  if (!H.res?.[c]) { currentAt(W, x, y, z, out); return depth; }
  let vx = H.vx[c], vz = H.vz[c];
  if (H.ports) { poolCurrent(H, x, y, z, _p); vx += _p.x; vz += _p.z; }
  const h = y - W.terrain.heightAt(x, z), k = h >= FLOOR_LAYER ? 1 : h > 0 ? (h / FLOOR_LAYER) ** FLOOR_EXP : 0;
  out.x = vx * k; out.z = vz * k;
  return depth;
}

// Where the water pushes each plant (B5b). For every aquatic or emergent plant: waterAtPlant, turned into the plant's own axes and
// written to its mesh's `flow` attribute (the old target, then the new one; plantMaterial eases between them with AIR.blend) and
// `flowDepth` (the water over its base in its own units). It runs inside the 0.4 s sample, once for all plants, writes plain arrays and
// asks for an upload only when some plant's flow changed (and once more to settle the ease). PF: its cost, read by the probe.
const _w = { x: 0, y: 0, z: 0 }, _l = [0, 0], _touch = [];
let settle = false, lastWorld = null;
export const PF = { calls: 0, frames: 0, ms: 0, max: 0, plants: 0 };
export function plantFlow(world) {
  const t0 = performance.now();
  try {
    const P = world.plants;
    if (!P?.list?.length) return;
    let changed = false, n = 0;
    _touch.length = 0;
    for (const p of P.list) {
      const im = P.meshes[P.key(p)], fa = im?.geometry.attributes.flow;
      if (!fa) continue;
      const da = im.geometry.attributes.flowDepth, depth = waterAtPlant(world, p.pos.x, p.pos.y, p.pos.z, _w);
      if (p._q) localFlow(p._q, _w.x, _w.z, _l); else { _l[0] = _w.x; _l[1] = _w.z; }
      const a = fa.array, o = p.index * 4, dep = depth / Math.max(1e-3, p._s ?? 1);
      if (Math.abs(_l[0] - a[o + 2]) + Math.abs(_l[1] - a[o + 3]) > 0.3 || Math.abs(dep - da.array[p.index]) > 0.1) changed = true;
      a[o] = a[o + 2]; a[o + 1] = a[o + 3]; a[o + 2] = _l[0]; a[o + 3] = _l[1];
      da.array[p.index] = dep;
      if (!_touch.includes(im)) _touch.push(im);
      n++;
    }
    if (changed || settle) for (const im of _touch) im.geometry.attributes.flow.needsUpdate = im.geometry.attributes.flowDepth.needsUpdate = true;
    settle = changed;
    PF.plants = n;
  } catch { /* the water code must not break the render */ } finally {
    const ms = performance.now() - t0;
    PF.calls++; PF.ms += ms; if (ms > PF.max) PF.max = ms;
  }
}

// The air movement the equipment and weather ask for right now (0 … 1).
export function airMovement(world) {
  const E = world.env;
  if (!E) return 0;
  let falls = 0;
  try { falls = world.water?.falls?.length ?? 0; } catch { falls = 0; }
  const fan = (E.fan ?? 0) * 0.85;
  const fog = (E.fogger ?? 0) * 0.3;
  const rain = (E.rain ?? 0) * 0.4;
  const spray = Math.min(1, falls * 0.5) * 0.22;
  // Sources add up but never beyond 1.
  return Math.min(1, fan + fog + rain + spray);
}

export function updateAirflow(world, rate, dt) {
  if (!world) return;
  run += ((rate > 0 ? 1 : 0) - run) * (1 - Math.exp(-dt * 5));
  sampleT += dt;
  lastWorld = world; PF.frames++;
  if (sampleT > 0.4) { sampleT = 0; flowNow = waterFlow(world); plantFlow(world); }
  AIR.blend.value = Math.min(1, sampleT / 0.4);
  const k = 1 - Math.exp(-dt * 2.5);
  flowEase += (flowNow - flowEase) * k;
  AIR.air.value = (AMBIENT_AIR + (1 - AMBIENT_AIR) * airMovement(world)) * run;
  AIR.flow.value = (AMBIENT_FLOW + (1 - AMBIENT_FLOW) * flowEase) * run;
}

// Dev only (the Vite dev server, or the `?metrics` switch that starts src/diag): a probe for the browser check of B5b.
// `__AIR.probe(id, stiffness = 1)` plants one `id` on the floor of the main pool, at the first spot 4-30 cm down the filter return's axis
// that the pool covers by over 1 cm, reads back what the shader gets for it with the pump as it is (on) and with its flow set to 0 for this
// call (off), and removes it. errDeg: the flow it gets vs waterAtPlant there (frame round trip); axisDeg: vs the return's axis (down-flow);
// leanDeg: root-to-tip angle from vertical, from plantBend, taking reach = 0.4 x the plant's height (flowOptions). Plus plantFlow's cost.
if (typeof window !== 'undefined' && (import.meta.env?.DEV || new URLSearchParams(window.location.search).has('metrics'))) {
  const ang = (ax, az, bx, bz) => { const a = Math.hypot(ax, az), b = Math.hypot(bx, bz); return a > 1e-6 && b > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (a * b)))) * 180 / Math.PI : null; };
  window.__AIR.probe = (id, stiffness = 1) => {
    const W = lastWorld, P = W?.plants, H = W?.water?.hydro, out = { plants: PF.plants, calls: PF.calls, frames: PF.frames, msPerCall: PF.ms / Math.max(1, PF.calls), msPerFrame: PF.ms / Math.max(1, PF.frames), maxMs: PF.max };
    const ref = P?.list?.[0]?.pos, r = H?.ports?.ret;
    if (!ref || !H?.vx || !r) return { ...out, error: 'no plants, hydro or filter return' };
    let x, z, along = -1;
    for (let d = 4; d <= 30 && along < 0; d += 2) {
      const px = r.x + r.dx * d, pz = r.z + r.dz * d;
      if (H.res?.[H.cellOf(px, pz)] && W.water.surfaceAt(px, pz, 0.3) > W.terrain.heightAt(px, pz) + 1) { x = px; z = pz; along = d; }
    }
    if (along < 0) return { ...out, error: 'no pool spot down the return\'s axis' };
    const p = P.add(id, ref.clone().set(x, W.terrain.heightAt(x, z), z), { grown: 1, rot: 0.9 });
    if (!p) return { ...out, error: 'could not plant ' + id };
    const lph = H.ports.lph, im = P.meshes[P.key(p)], e = { x: 0, y: 0, z: 0 };
    const read = () => {
      plantFlow(W); plantFlow(W);                          // twice: the second pass makes the first one's target the "old" value
      const f = im.geometry.attributes.flow, o = p.index * 4, wv = ref.clone().set(f.array[o + 2], 0, f.array[o + 3]).applyQuaternion(p._q);
      const depthCm = waterAtPlant(W, p.pos.x, p.pos.y, p.pos.z, e), sp = Math.hypot(wv.x, wv.z), b = plantBend(wv.x, wv.z, sp, 1, stiffness), l = Math.hypot(b.x, b.z);
      return { flowWorld: [wv.x, wv.z], speed: sp, expected: [e.x, e.z], depthCm, flowDepth: im.geometry.attributes.flowDepth.array[p.index], errDeg: ang(wv.x, wv.z, e.x, e.z), axisDeg: ang(wv.x, wv.z, r.dx, r.dz), tipLean: l, leanDeg: Math.atan2(0.4 * l, 1 - 0.4 * b.sag) * 180 / Math.PI };
    };
    try {
      const on = read(); H.ports.lph = 0; const off = read();
      return { ...out, id, stiffness, lph, along, at: [x, z], on, off, dLeanDeg: on.leanDeg - off.leanDeg };
    } finally { H.ports.lph = lph; P.remove(p); plantFlow(W); }
  };
}
