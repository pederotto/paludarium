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
import { localFlow } from '../util/plantbend.js';

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

// Where the water pushes each plant (B5b). For every aquatic or emergent plant: the flow of its hydro cell plus the filter's jet and
// intake (poolCurrent, which is analytic and not in vx/vz), turned into the plant's own axes and written to its mesh's `flow`
// attribute (the old target, then the new one; plantMaterial eases between them with AIR.blend) and `flowDepth`. It runs inside the
// 0.4 s sample, once for all plants, writes plain arrays and asks for an upload only when some plant's flow changed (and once more
// to settle the ease), so a still tank costs a pass over the plants every 0.4 s and nothing else. PF: its cost, read by the probe.
const _w = { x: 0, y: 0, z: 0 }, _l = [0, 0], _touch = [];
let settle = false, lastWorld = null;
export const PF = { calls: 0, frames: 0, ms: 0, max: 0, plants: 0 };
export function plantFlow(world) {
  const t0 = performance.now();
  try {
    const P = world.plants, H = world.water?.hydro;
    if (!P?.list?.length) return;
    let changed = false, n = 0;
    _touch.length = 0;
    for (const p of P.list) {
      const im = P.meshes[P.key(p)], fa = im?.geometry.attributes.flow;
      if (!fa) continue;
      const da = im.geometry.attributes.flowDepth, x = p.pos.x, z = p.pos.z;
      let wx = 0, wz = 0, depth = 0;
      if (H?.vx && H.d) {
        const c = H.cellOf(x, z);
        depth = H.d[c];
        if (depth >= 0.3) {
          wx = H.vx[c]; wz = H.vz[c];
          poolCurrent(H, x, p.pos.y + 1, z, _w);
          wx += _w.x; wz += _w.z;
        } else depth = 0;
      }
      if (p._q) localFlow(p._q, wx, wz, _l); else { _l[0] = wx; _l[1] = wz; }
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
// `__AIR.probe(id)` plants one `id` 5 cm downstream of the filter's return, reads back what the shader will receive for it, and removes it;
// it also reports what plantFlow costs (ms per call, per frame, and the worst call) at the tank's plant count.
if (typeof window !== 'undefined' && (import.meta.env?.DEV || new URLSearchParams(window.location.search).has('metrics'))) {
  window.__AIR.probe = (id) => {
    const W = lastWorld, P = W?.plants, H = W?.water?.hydro, out = { plants: PF.plants, calls: PF.calls, frames: PF.frames, msPerCall: PF.ms / Math.max(1, PF.calls), msPerFrame: PF.ms / Math.max(1, PF.frames), maxMs: PF.max };
    const ref = P?.list?.[0]?.pos;
    if (!ref || !H?.vx || !H.d) return { ...out, error: 'no plants or no hydro' };
    // Where to plant: 5 cm downstream of a running filter's return, at the nozzle's height, if that is in water; else in the fastest wet cell.
    const r = H.ports?.ret, wet = (x, z) => H.d[H.cellOf(x, z)] >= 0.3;
    let x, z, y, src;
    if (r && (H.ports.lph ?? 0) > 0 && wet(r.x + r.dx * 5, r.z + r.dz * 5)) { x = r.x + r.dx * 5; z = r.z + r.dz * 5; y = r.y; src = 'return nozzle, 5 cm downstream'; }
    else {
      let best = 0, bn = -1;
      for (let n = 0; n < H.N; n++) { if (H.d[n] < 0.3) continue; const v = Math.hypot(H.vx[n], H.vz[n]); if (v > best) { best = v; bn = n; } }
      if (bn < 0) return { ...out, ports: !!H.ports, lph: H.ports?.lph, error: 'no wet cell moves' };
      const w = H.cellXZ(bn); x = w.x ?? w[0]; z = w.z ?? w[1]; y = W.terrain.heightAt(x, z); src = 'fastest cell ' + best.toFixed(2) + ' cm/s';
    }
    const p = P.add(id, ref.clone().set(x, y, z), { grown: 1, rot: 0.9 });
    if (!p) return { ...out, error: 'could not plant ' + id };
    try {
      plantFlow(W); plantFlow(W);                          // twice: the second pass makes the first one's target the "old" value
      const im = P.meshes[P.key(p)], f = im.geometry.attributes.flow, o = p.index * 4;
      const c = H.cellOf(p.pos.x, p.pos.z), pc = poolCurrent(H, p.pos.x, p.pos.y + 1, p.pos.z, { x: 0, y: 0, z: 0 });
      const ex = H.vx[c] + pc.x, ez = H.vz[c] + pc.z;       // what the field says at the plant, in the tank's axes
      const wv = ref.clone().set(f.array[o + 2], 0, f.array[o + 3]).applyQuaternion(p._q);   // what the shader gets, turned back to the tank's axes
      const sp = Math.hypot(wv.x, wv.z), se = Math.hypot(ex, ez), cos = (wv.x * ex + wv.z * ez) / (sp * se || 1);
      return { ...out, id, src, at: [p.pos.x, p.pos.z], expected: [ex, ez], flowWorld: [wv.x, wv.z], local: [f.array[o + 2], f.array[o + 3]], speed: sp, errDeg: sp > 0 && se > 0 ? Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI : null, version: f.version, depth: im.geometry.attributes.flowDepth.array[p.index] };
    } finally { P.remove(p); }
  };
}
