// A crab's feet on the ground (util/turn.js crabFoot, drawn by render/creatures/instanced.js): a foot that is down must stay where it was put
// while the body walks sideways, turns on the spot, or does both along an arc, and when the crab stops it stands on the feet where the cycle
// left them (nothing snaps back to a neutral stance). Measured as the distance a down foot travels over the ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crabFoot, turnSteps } from '../src/util/turn.js';
import { crabStride, smooth } from '../src/util/gait.js';

const TAU = Math.PI * 2;
const SHELL = 5, SIZE = 2.4, STRIDE = 0.47, R_MODEL = 3.2, PZ = 0;        // the panther crab: shell 5 cm at size 2.4, rig stride 0.47, farthest foot 3.2 model units out
const RATE = TAU / crabStride(SHELL);                                      // leg phase per cm of foot travel (sim/crab.js crabGaitRate)
// feet at rest (model units): front, side and rear legs on the left and the right
const FEET = [[-3.0, 1.4, 0], [-3.2, 0.2, 1], [-2.6, -1.2, 0], [3.0, 1.4, 1], [3.2, 0.2, 0], [2.6, -1.2, 1]];

// Walks a crab through `path(t) -> { x, z, yaw }` (world cm, radians) for `T` seconds and returns the total slip of the down feet and the
// path length + turn arc they should have followed.
function run(path, T, { dir = 1, dt = 1 / 60, calm = () => 0, foot = crabFoot } = {}) {
  let phi = 0.3, prev = path(0), slip = 0, travel = 0, feetPrev = null;
  const world = (st, f, ph, tau, go) => {
    const r = foot(f[0], f[1], ph + (f[2] ? Math.PI : 0), go, STRIDE, tau, PZ, R_MODEL, dir);
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);                      // body -> world: local x -> (cos, -sin), local z -> (sin, cos)
    const X = r.x * SIZE, Z = r.z * SIZE;
    return { x: st.x + X * c + Z * s, z: st.z - X * s + Z * c, down: r.down };
  };
  for (let t = dt; t <= T + 1e-9; t += dt) {
    const cur = path(t), moved = Math.hypot(cur.x - prev.x, cur.z - prev.z), dyaw = Math.atan2(Math.sin(cur.yaw - prev.yaw), Math.cos(cur.yaw - prev.yaw));
    const ts = turnSteps(moved, dyaw, R_MODEL * SIZE);
    phi += ts.steps * RATE;
    const go = 1 - calm(t), tau = ts.tau;
    const now = FEET.map((f) => world(cur, f, phi, tau, go)), before = feetPrev ?? FEET.map((f) => world(prev, f, phi - ts.steps * RATE, tau, go));
    now.forEach((p, i) => { if (p.down && before[i].down) slip += Math.hypot(p.x - before[i].x, p.z - before[i].z); });
    travel += ts.steps * 6;                                                // 6 feet; the cycle drives `steps` of foot travel each
    feetPrev = now; prev = cur;
  }
  return { slip, travel };
}

test('walking sideways at any speed: the feet that are down do not slide', () => {
  for (const dir of [1, -1]) for (const v of [2, 7]) {
    const r = run((t) => ({ x: dir * v * t, z: 0, yaw: 0 }), 4, { dir });          // (the rig reads dir -1 when the crab walks toward local -x)
    assert.ok(r.slip < 0.04 * r.travel, `dir ${dir} v ${v}: slipped ${r.slip.toFixed(2)} of ${r.travel.toFixed(1)} cm`);
  }
});

test('turning on the spot: the feet swing round the pivot instead of sliding sideways', () => {
  for (const w of [0.6, 1.5, -1.2]) {
    const r = run((t) => ({ x: 0, z: 0, yaw: w * t }), 3, {});
    assert.ok(r.slip < 0.06 * r.travel, `turn ${w} rad/s: slipped ${r.slip.toFixed(2)} of ${r.travel.toFixed(1)} cm`);
  }
});

test('an arc (walking while turning): the feet still do not slide', () => {
  const v = 5, w = 0.5, y0 = 0.4;                                        // walking toward local -x along a circle: the velocity is v x (-cos yaw, sin yaw)
  const r = run((t) => ({ x: -(v / w) * (Math.sin(y0 + w * t) - Math.sin(y0)), z: -(v / w) * (Math.cos(y0 + w * t) - Math.cos(y0)), yaw: y0 + w * t }), 4, { dir: -1 });
  assert.ok(r.slip < 0.12 * r.travel, `arc: slipped ${r.slip.toFixed(2)} of ${r.travel.toFixed(1)} cm`);
});

test('the rig before this one (swing along x only, gated by calm) slid its feet badly in a turn on the spot', () => {
  const old = (x, z, phi, go, stride, tau, pz, R, dir) => { const u = phi / TAU - Math.floor(phi / TAU), sn = u < 0.5 ? -Math.cos(u * TAU) : 3 - 4 * u; return { x: x + dir * sn * stride * go, z, down: go < 0.05 || Math.sin(phi) <= 0 }; };
  const r = run((t) => ({ x: 0, z: 0, yaw: 1.0 * t }), 3, { foot: old });
  const now = run((t) => ({ x: 0, z: 0, yaw: 1.0 * t }), 3, {});
  assert.ok(r.slip > 8 * now.slip, `before ${r.slip.toFixed(1)} cm, now ${now.slip.toFixed(1)} cm`);
});

test('a crab that stops stands on its feet where the cycle left them: nothing snaps', () => {
  // it walks, then stops dead (smooth in speed, as scuttleSpeed): the feet that are down stay put through the stop and after it
  const r = run((t) => { const d = t < 2 ? 3.5 * t * t / 2 : 3.5 * 2; return { x: -d, z: 0, yaw: 0 }; }, 4, { dir: -1, calm: (t) => (t > 2 ? 1 : 0) });
  assert.ok(r.slip < 0.04 * r.travel, `slipped ${r.slip.toFixed(2)} of ${r.travel.toFixed(1)} cm over a stop`);
  void smooth;
});
