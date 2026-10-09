// The water's velocity where a swimmer is (B5a), cm/s: the hydro cell's depth-averaged flow plus the filter's jet and intake
// (poolCurrent, analytic, in the main pool only), slowed in the floor's boundary layer and in the lee of a solid. The same sum
// B5b's plantFlow (render/airflow.js) gives the plants, here in the sim layer. No allocation per call.
// flowSenses() wraps it with the other callbacks a fish mind (sim/fishmind.js) asks for, once per Animals.
import { poolCurrent } from './filterflow.js';
import { TANK } from './tank.js';
import { COST } from './fishmind.js';

// GUESSES, to be tuned:
export const FLOOR_LAYER = 2;     // cm over the floor in which the water slows to the floor's no-slip
export const FLOOR_EXP = 0.5;     // its profile (h / FLOOR_LAYER)^FLOOR_EXP: slow tank flows are laminar, nearer linear than turbulent 1/7
export const LEE = 0.4, LEE_D = 2; // share of the flow left LEE_D cm downstream of a solid

const P = { x: 0, y: 0, z: 0 };
const now = () => globalThis.performance?.now() ?? 0;

export function currentAt(W, x, y, z, out = { x: 0, y: 0, z: 0 }, occ = null) {
  const t0 = now();
  out.x = out.y = out.z = 0;
  const H = W?.water?.hydro;
  if (H?.vx && H.d) {
    const c = H.cellOf(x, z);
    if (H.d[c] >= 0.3 || H.res?.[c]) { // the main pool keeps its water as hydro.level (res), its d is a film
      let vx = H.vx[c], vy = 0, vz = H.vz[c];
      if (H.ports && (W.water.inMainPool?.(x, z) ?? true)) { poolCurrent(H, x, y, z, P); vx += P.x; vy += P.y; vz += P.z; }
      const h = y - W.terrain.heightAt(x, z), l = Math.hypot(vx, vz);
      let k = h >= FLOOR_LAYER ? 1 : h > 0 ? (h / FLOOR_LAYER) ** FLOOR_EXP : 0;
      if (occ && l > 0.05 && occ.solidAt(x - vx / l * LEE_D, y, z - vz / l * LEE_D)) k *= LEE;
      out.x = vx * k; out.y = vy * k; out.z = vz * k;
    }
  }
  COST.ms += now() - t0;
  return out;
}

// Within m cm of the glass (the swimmers' 1.5 cm margin) or of the overflow's intake.
export function nearEdge(W, x, y, z, m) {
  if (Math.abs(x) > TANK.w / 2 - 1.5 - m || Math.abs(z) > TANK.d / 2 - 1.5 - m) return true;
  const i = W?.water?.hydro?.ports?.intake;
  return !!i && Math.hypot(x - i.x, y - i.y, z - i.z) < i.r + m;
}

// The callbacks for fishThink, bound to the current world (S.W), occupancy (S.occ) and water top (top(x, z), Animals.waterTop).
export function flowSenses(top) {
  const S = { W: null, occ: null };
  S.probe = (x, y, z, out) => currentAt(S.W, x, y, z, out, S.occ);
  S.ok = (x, y, z) => {
    if (Math.abs(x) > TANK.w / 2 - 2 || Math.abs(z) > TANK.d / 2 - 2) return false;
    const f = S.W.terrain.heightAt(x, z), L = top(x, z);
    return L - f >= 1.5 && y > f + 0.4 && y < L - 0.4 && !S.occ?.solidAt(x, y, z) && (!S.a?.validGoal || S.a.validGoal(x, z, y));   // (the goal contract: Animals.isValidGoal)
  };
  S.edge = (x, y, z, m) => nearEdge(S.W, x, y, z, m);
  S.s = { dt: 0, x: 0, y: 0, z: 0, w: null, want: { x: 0, z: 0 }, probe: S.probe, ok: S.ok, edge: S.edge };
  S.sense = (a, w, want, dt) => {
    const s = S.s;
    S.a = a;
    s.dt = dt; s.x = a.pos.x; s.y = a.pos.y; s.z = a.pos.z; s.w = w; s.want.x = want.x; s.want.z = want.z;
    return s;
  };
  return S;
}
