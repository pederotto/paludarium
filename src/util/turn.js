// Turning like an animal, not a turntable. Pure arithmetic (no scene, no world), shared by the sim (sim/animals.js turnTo and
// the gait in move()), the rig (render/creatures/instanced.js: the legs' turning sweep) and the probe (tools/steps/turn.mjs).
//
// What a real walker does when it turns on the spot: it pivots about its support (a frog, salamander or lizard about the pelvis
// and the planted hind feet; a crab or an insect about its middle), the feet step round, each planted foot staying where it was
// put while the others swing, and the spine bends into the turn: the head leads, the tail follows late. A swimmer turns along
// its path by bending its body, never by spinning in place. tests/turn.test.mjs pins these promises.
//
// Units: mesh units for frames (the model's own centimetres, facing +z, before the instance scale), radians, seconds. `plan` is a
// body plan of util/bodyplan.js (PLANS[name]: its `turn` and `rig` numbers), handed in by the caller (util files import nothing).

const TAU = Math.PI * 2;
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The limbs of a mesh, measured on it: where the hips and shoulders are along the body (the mean z of the leg vertices at the
// root of the hind and front legs) and where the four feet rest (legT > 0.9). `P` positions (x, y, z …), `R` the rig attribute
// (spine, leg id, legT, material: 4 a vertex). Null when the mesh has no four walking legs.
export function limbFrame(P, R) {
  if (!P || !R) return null;
  const n = P.length / 3, feet = {}, root = { 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0] };
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = P[i * 3 + 2], l = Math.round(R[i * 4 + 1]), t = R[i * 4 + 2];
    if (z < z0) z0 = z; if (z > z1) z1 = z;
    if (l < 1 || l > 4) continue;
    if (t > 0.9) { const f = (feet[l] ??= [0, 0, 0]); f[0] += P[i * 3]; f[1] += z; f[2]++; }
    if (t < 0.15) { root[l][0] += z; root[l][1]++; }
  }
  for (const k of [1, 2, 3, 4]) if (!feet[k]?.[2] || !root[k][1]) return null;
  const foot = (k) => [feet[k][0] / feet[k][2], feet[k][1] / feet[k][2]];
  const rz = (a, b) => (root[a][0] + root[b][0]) / (root[a][1] + root[b][1]);
  return { hipZ: rz(3, 4), shoulderZ: rz(1, 2), feet: { 1: foot(1), 2: foot(2), 3: foot(3), 4: foot(4) }, z0, z1, len: z1 - z0 };
}

// The turning numbers of a species: the pivot `pz` (mesh z the body turns about), `reach` (how far its farthest foot is from the
// pivot), `R` (the feet's travel per radian of yaw that drives the leg cycle: reach / the plan's turn sweep, since a turning step
// swings the foot `sweep` walking strides round) and the fastest yaw it can make (rad/s): `theta`, the yaw per leg cycle (one
// cycle carries that foot one stride round its circle: 4 x the rig's sweep `stride` x the turn sweep), times the plan's
// fastest stepping. `frame` from limbFrame (or null: a body without four legs), `foot` the trunk's centre (bodyFootprint tc) as
// the fallback pivot.
export function turnFrame(plan, frame, stride, centre = 0) {
  const T = plan.turn;
  if (!frame || !stride || T.pivot === 'none') {
    const rate = T.swimRate ?? 2;
    return { plan, pz: centre, R: 0, theta: 0, maxRate: rate, legs: false };
  }
  const pz = T.pivot === 'hips' ? frame.hipZ : centre;
  let R = 0;
  for (const k of [1, 2, 3, 4]) R = Math.max(R, Math.hypot(frame.feet[k][0], frame.feet[k][1] - pz));
  const reach = Math.max(R, 1e-3);
  R = reach / (T.sweep ?? 1);
  const theta = (4 * stride) / R;
  return { plan, pz, R, reach, theta, maxRate: theta * T.stepHz, legs: true };
}

// One step of a turn toward heading `want`: the yaw rate eases toward `gain` x the angle still to go, never above `maxRate`, and
// speeds up at most `accel` rad/s² (a turn starts with a step, not a jerk); it may slow down at once (no overshoot). `state` keeps
// the yaw rate between steps ({ w }). Returns the new yaw.
export function turnStep(yaw, want, dt, maxRate, state, gain = 8, accel = maxRate * 8) {
  const d = angDiff(want, yaw);
  const target = clamp(d * gain, -maxRate, maxRate);
  let w = state.w ?? 0;
  if (w !== 0 && Math.sign(target) !== Math.sign(w)) w = 0;            // turning back: stop first
  if (Math.abs(target) < Math.abs(w)) w = target;
  else w += clamp(target - w, -accel * dt, accel * dt);
  let step = w * dt;
  if (Math.abs(step) > Math.abs(d)) { step = d; w = 0; }
  state.w = w;
  return yaw + step;
}

// How far the body's origin moves (world dx, dz) when it turns from yaw0 to yaw1 about the point `pz` (mesh z, at instance scale
// `scale`) on its axis: that point stays where it is.
export function pivotShift(yaw0, yaw1, pz, scale = 1) {
  const s = pz * scale;
  return [s * (Math.sin(yaw0) - Math.sin(yaw1)), s * (Math.cos(yaw0) - Math.cos(yaw1))];
}

// The leg cycle a step drives (cm of foot travel): the distance walked plus the turn, |dyaw| x R (world), and how much of it is
// the turn: the turning mix tau (-1 … 1, signed with the turn; 0 a straight walk, ±1 a turn on the spot), which the rig uses to
// sweep the feet round the pivot instead of back along the body.
export function turnSteps(moved, dyaw, Rworld) {
  const turn = Math.abs(dyaw) * Rworld, steps = moved + turn;
  return { steps, tau: steps > 1e-6 ? (Math.sign(dyaw) * turn) / steps : 0 };
}

// The pose a turn puts on the body: the spine bends into the turn (rig2 bend > 0 is a C opening toward +x, the side the heading
// turns to as yaw grows), the head leads into it and the tail follows late. `w` the yaw rate (rad/s, smoothed), `maxRate` the
// species' fastest. `state` keeps the tail's lag ({ tail }). Returns [head, bend, tail] inside the plan's joint limits.
export function turnPose(plan, w, maxRate, dt, state, tailLag = 0.35) {
  const T = plan.turn, R = plan.rig;
  const k = maxRate > 1e-6 ? clamp(w / maxRate, -1, 1) : 0;
  const tailWant = T.tail * R.tail * k;
  state.tail = (state.tail ?? 0) + (tailWant - (state.tail ?? 0)) * Math.min(1, dt / tailLag);
  const c = (v, m) => (v > m ? m : v < -m ? -m : v);
  return [c(T.head * R.head * k, R.head), c(T.bend * R.bend * k, R.bend), c(state.tail, R.tail)];
}

// A swimmer's steering: the horizontal part of a wanted velocity turned toward the current heading so it is at most
// `maxTurn` radians from it (it swings round an arc instead of stopping and spinning). Objects with x, y, z; returns `out`.
export function steerLimit(vel, want, maxTurn, out = { x: 0, y: 0, z: 0 }) {
  out.x = want.x; out.y = want.y; out.z = want.z;
  const hv = Math.hypot(vel.x, vel.z), hw = Math.hypot(want.x, want.z);
  if (hv < 0.2 || hw < 1e-6) return out;
  const a0 = Math.atan2(vel.x, vel.z), d = angDiff(Math.atan2(want.x, want.z), a0);
  if (Math.abs(d) <= maxTurn) return out;
  const a = a0 + Math.sign(d) * maxTurn;
  out.x = Math.sin(a) * hw; out.z = Math.cos(a) * hw;
  return out;
}

// A foot's position in the body (mesh units) as the rig draws it, for a leg at rest at (x, z): the gait phase `phi` (radians,
// diagonal pairs already offset), `go` 0 … 1 (the legs working), the walk sweep `stride`, the turning mix `tau` and the frame's
// pivot `pz` and radius `R`. The walking part slides the foot back along the body while it is down (sn falls from 1 to -1); the
// turning part swings it round the pivot by the same fraction of the yaw per cycle (theta / 4 = stride / R at the ends), so a
// planted foot stays put while the body turns over it. Returns [x, z] and whether the foot is down.
export function footRig(x, z, phi, go, stride, tau = 0, pz = 0, R = 1) {
  const u = phi / TAU - Math.floor(phi / TAU);
  const sn = u < 0.5 ? -Math.cos(u * TAU) : 3 - 4 * u;
  z += sn * stride * go * (1 - Math.abs(tau));
  if (tau && R > 0) {
    const al = (sn * go * tau * stride) / R, c = Math.cos(al), s = Math.sin(al), dz = z - pz;
    const nx = x * c + dz * s;
    z = pz - x * s + dz * c; x = nx;
  }
  return { x, z, down: go < 0.05 || Math.sin(phi) <= 0 };
}
