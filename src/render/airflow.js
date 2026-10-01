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

export const AMBIENT_AIR = 0.035;    // a hint of movement even in still air (a lid still leaks a little)
export const AMBIENT_FLOW = 0.05;

export const AIR = { air: uniform(AMBIENT_AIR), flow: uniform(AMBIENT_FLOW) };
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
  if (sampleT > 0.4) { sampleT = 0; flowNow = waterFlow(world); }
  const k = 1 - Math.exp(-dt * 2.5);
  flowEase += (flowNow - flowEase) * k;
  AIR.air.value = (AMBIENT_AIR + (1 - AMBIENT_AIR) * airMovement(world)) * run;
  AIR.flow.value = (AMBIENT_FLOW + (1 - AMBIENT_FLOW) * flowEase) * run;
}
