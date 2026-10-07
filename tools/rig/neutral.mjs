// A scan taken back to its neutral pose through its own skeleton (owner, 6 Oct 2026, the red-eyed tree frog's walking scan: "transition it back to that neutral
// position, that should also tell you if your movement makes pattern, muscle and bones make sense"). The scan's head is rolled about the body axis (the right eye
// bump higher than the left): the head bone is turned back about its own axis by `deg`, each vertex by that angle times its weight on the head bone, the weight
// smoothed over the mesh so the neck twists over a band instead of creasing along one row. The skeleton does not move (a roll about a bone's own axis leaves its
// head and tail where they are), so the joints measured on the scan stay valid; the checks of the neutral pose (skin stretch, the muscles' lengths) are in
// tests/redeye-neutral.test.mjs and tools/rig/neutral-check.mjs.
//
//   fitHeadRoll(pos, w, c, ax)      the roll (deg) that levels the two eye bumps, searched over -45 ... 45
//   headWeight(bones, bind, n, tris, passes)   the head bone's weight at each vertex (bindCapsules' two-bone binding), smoothed
//   rollHead(pos, w, c, ax, deg)    new positions: each vertex turned about the axis through `c` along `ax` by deg * its weight

const rotAbout = (ax, a) => { const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), k = 1 - c; return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k]; };

export function headWeight(bones, bind, n, tris = null, passes = 0, name = 'head') {
  const h = bones.findIndex((b) => b.name === name), w = new Float32Array(n);
  for (let i = 0; i < n; i++) { const b0 = bind.idx[i * 2], b1 = bind.idx[i * 2 + 1], w0 = bind.w[i]; w[i] = (b0 === h ? w0 : 0) + (b1 === h && b1 !== b0 ? 1 - w0 : 0); }
  if (!tris || !passes) return w;
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = tris[t + a], v = tris[t + b]; if (u !== v) { nb[u].add(v); nb[v].add(u); } }
  let A = w, B = new Float32Array(n);
  for (let it = 0; it < passes; it++) { for (let i = 0; i < n; i++) { const L = [...nb[i]]; let v = A[i]; for (const j of L) v += A[j]; B[i] = v / (1 + L.length); } [A, B] = [B, A]; }
  return A;
}

export function rollHead(pos, w, c, ax, deg) {
  const out = Float32Array.from(pos), a = Math.hypot(...ax), u = ax.map((v) => v / a);
  for (let i = 0; i < pos.length / 3; i++) {
    const wi = w[i]; if (wi < 1e-4) continue;
    const R = rotAbout(u, deg * Math.PI / 180 * wi), x = pos[i * 3] - c[0], y = pos[i * 3 + 1] - c[1], z = pos[i * 3 + 2] - c[2];
    out[i * 3] = c[0] + R[0] * x + R[1] * y + R[2] * z; out[i * 3 + 1] = c[1] + R[3] * x + R[4] * y + R[5] * z; out[i * 3 + 2] = c[2] + R[6] * x + R[7] * y + R[8] * z;
  }
  return out;
}

// The roll that levels the eye bumps: the centroids of the head's vertices (weight > 0.5) above y = `ey` on each side of the midline; the line between them is
// tilted by atan2(dy, dx) and the roll is the turn that levels it (a fit on the top 2 % of y looked at 43 deg: a wide head turned far enough has equal tops).
export function fitHeadRoll(pos, w, c, ax, mid = 0, ey = 0.02) {
  const S = { L: [0, 0, 0, 0], R: [0, 0, 0, 0] };
  for (let i = 0; i < w.length; i++) if (w[i] > 0.5 && pos[i * 3 + 1] > ey) { const t = S[pos[i * 3] < mid ? 'L' : 'R']; t[0] += pos[i * 3]; t[1] += pos[i * 3 + 1]; t[2] += pos[i * 3 + 2]; t[3]++; }
  const L = S.L.slice(0, 3).map((v) => v / S.L[3]), R = S.R.slice(0, 3).map((v) => v / S.R[3]);
  return { deg: -Math.atan2(R[1] - L[1], R[0] - L[0]) * 180 / Math.PI, left: L, right: R };
}

// --- The scan taken to a pose through its own skeleton (the whole body, not only the head) ----------------------------------------------------------------------
// The red-eye's scan is a walking frog: its limbs are far (60-100 deg) from the poses the runtime asks of them, which stretched 10 % of its skin in every pose. Posed
// ONCE at bake time into the gait's own hold pose (the poser's: render/creatures/skeleton.js poseStroke, the same arithmetic the game runs), the baked body rests in
// that pose and every later pose is a small turn from it; and the transition itself says whether the bones, the weights and the pose keys make sense together
// (its stretch is printed by the bake).
//   poseToStroke(pos, f4, bones, stroke)   `f4`: skinFour's { skin, skinx } with bone indices into `bones` (22: spineB in); bones: [{ name, parent, head, tail, limb, r }]
//   returns { pos: the posed vertices, bones: the posed bones (head and tail where the pose puts them), stretch: { edges, over13, over2, worst } }
import { skeletonRig, poseStroke, applyBone, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';

export function poseToStroke(pos, f4, bones, stroke, tris = null) {
  const rig = skeletonRig({ plan: 'anuran', bind: 'swim', bones }), row = new Float32Array(ROW_FLOATS);
  if (!rig) throw new Error('the skeleton cannot be posed by the stroke runtime');
  poseStroke(rig, stroke, row);
  const n = pos.length / 3, out = new Float32Array(pos.length);
  for (let i = 0; i < n; i++) {
    const w0 = f4.skin[i * 4 + 2], w1 = f4.skin[i * 4 + 3], w2 = f4.skinx[i * 4 + 2], w3 = f4.skinx[i * 4 + 3];
    const bs = [f4.skin[i * 4], f4.skin[i * 4 + 1], f4.skinx[i * 4], f4.skinx[i * 4 + 1]].map((x) => Math.round(x * 32)), ws = [w0, w1, w2, w3], p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    let X = 0, Y = 0, Z = 0, W = 0;
    for (let k = 0; k < 4; k++) { if (!(ws[k] > 0)) continue; const q = applyBone(row, 0, bs[k], p); X += ws[k] * q[0]; Y += ws[k] * q[1]; Z += ws[k] * q[2]; W += ws[k]; }
    if (W > 1e-6) { out[i * 3] = X / W; out[i * 3 + 1] = Y / W; out[i * 3 + 2] = Z / W; } else { out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2]; }
  }
  const nb = bones.map((b, i) => ({ ...b, head: applyBone(row, 0, i, b.head), tail: applyBone(row, 0, i, b.tail) }));
  let stretch = null;
  if (tris) {
    let o13 = 0, o2 = 0, worst = 1, edges = 0; const seen = new Set();
    for (let t = 0; t < tris.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = tris[t + a], v = tris[t + b], k = u < v ? u * n + v : v * n + u; if (seen.has(k)) continue; seen.add(k); edges++;
      const d0 = Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]), d1 = Math.hypot(out[u * 3] - out[v * 3], out[u * 3 + 1] - out[v * 3 + 1], out[u * 3 + 2] - out[v * 3 + 2]), r = d1 / Math.max(d0, 1e-9); if (d0 < 0.004) continue; edges--; edges++; if (r > 1.3) o13++; if (r > 2) o2++; worst = Math.max(worst, r); }
    stretch = { edges, over13: o13, over2: o2, worst };
  }
  return { pos: out, bones: nb, stretch };
}

// --- The scan's own pose as a stroke -----------------------------------------------------------------------------------------------------------------------------
// The poser (render/creatures/skeleton.js poseStroke) points every limb bone along segDir(th, ph, side) = [side sin th cos ph, sin ph, -cos th cos ph], its frame the one
// across(dir, up) defines (the bone's rest frame is the same formula): so the angles of a bone's own direction pose it exactly where it is. `scanStroke` reads them from the joints
// (the hind legs' four bones: thigh hip-knee, shin knee-heel, foot heel-ankle, toes ankle-toe; the arms' three: arm, forearm, hand shoulder-elbow-wrist-finger, and the fingers
// finger-fingertip as the hand's own angles less `fcurl`): { legA (18: left 9 then right 9: th x4, ph x4, foot roll), armA (12: left 6 then right 6: th x3, ph x3), fcurl [L, R] }.
// A key set for this body is the scan's angles plus deviations; posing the scan with its own angles must leave every vertex where it is (tests/redeye-bones.test.mjs).
export const dirAngles = (d, side) => { const l = Math.hypot(...d), y = d[1] / l, ph = Math.asin(Math.max(-1, Math.min(1, y))), c = Math.cos(ph); return c < 1e-6 ? [0, ph * 180 / Math.PI] : [Math.atan2(side * d[0], -d[2]) * 180 / Math.PI, ph * 180 / Math.PI]; };
export function scanStroke(j) {
  const legA = new Float32Array(18), armA = new Float32Array(12), fcurl = [0, 0], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  for (const [s, side, lo, alo] of [['L', -1, 0, 0], ['R', 1, 9, 6]]) {
    const H = [j['hip' + s], j['knee' + s], j['heel' + s], j['ankle' + s], j['toe' + s]];
    for (let i = 0; i < 4; i++) { const [th, ph] = dirAngles(sub(H[i + 1], H[i]), side); legA[lo + i] = th; legA[lo + 4 + i] = ph; }
    const F = [j['shoulder' + s], j['elbow' + s], j['wrist' + s], j['finger' + s]];
    for (let i = 0; i < 3; i++) { const [th, ph] = dirAngles(sub(F[i + 1], F[i]), side); armA[alo + i] = th; armA[alo + 3 + i] = ph; }
    if (j['fingertip' + s]) { const [, ph] = dirAngles(sub(j['fingertip' + s], j['finger' + s]), side); fcurl[s === 'L' ? 0 : 1] = armA[alo + 5] - ph; }
  }
  return { legA, armA, fcurl };
}
