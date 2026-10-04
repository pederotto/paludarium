// The lizards' rig (gecko, skink): one bone list for both, the anatomy each bone stands for, the skin's binding to the bones and
// its `_RIG` / `_SKIN` vertex attributes (as the frog's: render/creatures/glb.js), and the straightening of a tail that a model
// holds curled to one side. The bake: tools/bake-lizard.mjs; a species' joints come from its own file (tools/rig/lizard-<id>.mjs),
// measured on its mesh. The bone list and its order are a contract (docs/agents/lizards/CONTRACTS.md "Lizard bone list"):
//   0 pelvis  1 spine  2 neck  3 head  4-8 tail1-tail5  9-11 thighL shinL footL  12-14 thighR shinR footR
//   15-17 armL forearmL handL  18-20 armR forearmR handR, and with `fans` (the default bake) 21 fingersL 22 fingersR 23 toesL 24 toesR.
// Without the fans the hand and foot run to the digit tips and the digits are bound to them; with them the hand and foot end at the
// knuckles (a gecko peels its toe pads off the glass from the tips, so the digits fold up against the foot: MOTION_gecko.md).
// limb: 0 the axial skeleton, 1 fore left, 2 fore right, 3 hind left, 4 hind right (left = x < 0).
import { bindCapsules } from './skeleton.mjs';

export const TAIL = 5;
// the tail's bones as shares of its length from the sacrum (the caudal vertebrae shorten toward the tip)
export const TAIL_SPLIT = [0.24, 0.22, 0.2, 0.18, 0.16];
export const LIZARD_BONES = [
  'pelvis', 'spine', 'neck', 'head', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'armL', 'forearmL', 'handL', 'armR', 'forearmR', 'handR',
];
export const FAN_BONES = ['fingersL', 'fingersR', 'toesL', 'toesR'];
// What each bone stands for (RIG_gecko.md "Anatomy the rig must cover"); paired bones are named without their side.
export const ANATOMY = {
  skull: ['head'], neck: ['neck'], trunk: ['spine', 'pelvis'], sacrum: ['pelvis'], tail: ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'],
  'pectoral girdle': ['spine', 'arm'], 'pelvic girdle': ['pelvis', 'thigh'], humerus: ['arm'], 'radius-ulna': ['forearm'], hand: ['hand'],
  femur: ['thigh'], 'tibia-fibula': ['shin'], foot: ['foot'], digits: ['fingers', 'toes'],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The bones from the joints (model units): j = { snout, nape, chest, mid, sacrum, vent, tail: [sacrum, 5 points to the tip],
// per side (L / R): shoulder elbow wrist palm finger, hip knee heel ball toe }.
export function lizardBones(j, { fans = true } = {}) {
  const B = [
    { name: 'pelvis', parent: null, head: j.sacrum, tail: j.mid, limb: 0 },
    { name: 'spine', parent: 'pelvis', head: j.mid, tail: j.chest, limb: 0 },
    { name: 'neck', parent: 'spine', head: j.chest, tail: j.nape, limb: 0 },
    { name: 'head', parent: 'neck', head: j.nape, tail: j.snout, limb: 0 },
  ];
  for (let k = 1; k <= TAIL; k++) B.push({ name: `tail${k}`, parent: k === 1 ? 'pelvis' : `tail${k - 1}`, head: j.tail[k - 1], tail: j.tail[k], limb: 0 });
  for (const [s, limb] of [['L', 3], ['R', 4]]) {
    const J = (k) => j[k + s];
    B.push({ name: 'thigh' + s, parent: 'pelvis', head: J('hip'), tail: J('knee'), limb },
      { name: 'shin' + s, parent: 'thigh' + s, head: J('knee'), tail: J('heel'), limb },
      { name: 'foot' + s, parent: 'shin' + s, head: J('heel'), tail: fans ? J('ball') : J('toe'), limb });
  }
  for (const [s, limb] of [['L', 1], ['R', 2]]) {
    const J = (k) => j[k + s];
    B.push({ name: 'arm' + s, parent: 'spine', head: J('shoulder'), tail: J('elbow'), limb },
      { name: 'forearm' + s, parent: 'arm' + s, head: J('elbow'), tail: J('wrist'), limb },
      { name: 'hand' + s, parent: 'forearm' + s, head: J('wrist'), tail: fans ? J('palm') : J('finger'), limb });
  }
  if (fans) {
    for (const [s, limb] of [['L', 1], ['R', 2]]) B.push({ name: 'fingers' + s, parent: 'hand' + s, head: j['palm' + s], tail: j['finger' + s], limb });
    for (const [s, limb] of [['L', 3], ['R', 4]]) B.push({ name: 'toes' + s, parent: 'foot' + s, head: j['ball' + s], tail: j['toe' + s], limb });
  }
  return B;
}

// the point on segment a-b nearest p: { t (0 … 1), d (distance) }
function segProj(px, py, pz, a, b) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], l2 = ux * ux + uy * uy + uz * uz || 1e-12;
  let t = ((px - a[0]) * ux + (py - a[1]) * uy + (pz - a[2]) * uz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { t, d: Math.hypot(px - a[0] - ux * t, py - a[1] - uy * t, pz - a[2] - uz * t) };
}
const radiusOf = (radius, name) => radius[name] ?? radius[name.replace(/[LR]$/, '')] ?? 0.05;

// Every vertex's nearest bone as a capsule (distance to the bone's axis less its radius): { b, t (where along it) }.
export function nearestBones(pos, bones, radius = {}) {
  const n = pos.length / 3, b = new Uint8Array(n), t = new Float32Array(n), rad = bones.map((x) => radiusOf(radius, x.name));
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let k = 0; k < bones.length; k++) {
      const q = segProj(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], bones[k].head, bones[k].tail), d = q.d - rad[k];
      if (d < best) { best = d; b[i] = k; t[i] = q.t; }
    }
  }
  return { b, t };
}

// Vertices that share a position (a UV seam splits them): one id each, so seams bind and shade as one surface.
export function byPosition(pos) {
  const n = pos.length / 3, rep = new Uint32Array(n), map = new Map(), first = [];
  for (let i = 0; i < n; i++) {
    const k = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
    let u = map.get(k);
    if (u === undefined) { u = first.length; map.set(k, u); first.push(i); }
    rep[i] = u;
  }
  const upos = new Float32Array(first.length * 3);
  first.forEach((i, u) => { upos[u * 3] = pos[i * 3]; upos[u * 3 + 1] = pos[i * 3 + 1]; upos[u * 3 + 2] = pos[i * 3 + 2]; });
  return { rep, upos, count: first.length };
}

// The skin's binding: each vertex's limb and its place along it (legT, 0 at the root … 1 at the tip) from its nearest capsule,
// then tools/rig/skeleton.mjs bindCapsules (two bones a vertex, smoothed over the mesh), on the mesh welded by position.
// Returns { idx (n x 2), w (the first bone's weight; the second has 1 - w), leg, legT } per vertex of `pos`.
export function bindLizard(pos, bones, tris, { radius = {}, sigma = 0.012, smooth = 4 } = {}) {
  const W = byPosition(pos), U = W.upos, m = W.count;
  const ut = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) ut[i] = W.rep[tris[i]];
  const near = nearestBones(U, bones, radius), L = bones.map((b) => dist(b.head, b.tail)), chain = {};
  bones.forEach((b, i) => { if (b.limb) (chain[b.limb] ??= []).push(i); });
  const uleg = new Uint8Array(m), ulegT = new Float32Array(m);
  for (let u = 0; u < m; u++) {
    const b = near.b[u], l = bones[b].limb;
    if (!l) continue;
    let a = 0, tot = 0;
    for (const k of chain[l]) tot += L[k];
    for (const k of chain[l]) { if (k === b) break; a += L[k]; }
    uleg[u] = l; ulegT[u] = (a + near.t[u] * L[b]) / tot;
  }
  const ub = bindCapsules(U, bones, { radius, rig: { leg: uleg, legT: ulegT }, sigma, tris: ut, smooth });
  const n = pos.length / 3, idx = new Uint8Array(n * 2), w = new Float32Array(n), leg = new Uint8Array(n), legT = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = W.rep[i];
    idx[i * 2] = ub.idx[u * 2]; idx[i * 2 + 1] = ub.idx[u * 2 + 1]; w[i] = ub.w[u]; leg[i] = uleg[u]; legT[i] = ulegT[u];
  }
  return { idx, w, leg, legT };
}

// `_RIG` = (spine 0 at the snout … 1 at the tail tip, leg / 8, legT, material 0) and `_SKIN` = (bone 0 / 32, bone 1 / 32, bone 0's
// weight, bone 1's weight = 1 - it), per vertex of `pos` (the frog bakes leave the fourth at 0; render/creatures/glb.js ignores it).
export function rigAttributes(pos, bind, zSnout, zTip) {
  const n = pos.length / 3, rig = new Float32Array(n * 4), skin = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = (zSnout - pos[i * 3 + 2]) / (zSnout - zTip);
    rig[i * 4] = u < 0 ? 0 : u > 1 ? 1 : u; rig[i * 4 + 1] = bind.leg[i] / 8; rig[i * 4 + 2] = bind.legT[i];
    skin[i * 4] = bind.idx[i * 2] / 32; skin[i * 4 + 1] = bind.idx[i * 2 + 1] / 32; skin[i * 4 + 2] = bind.w[i]; skin[i * 4 + 3] = 1 - bind.w[i];
  }
  return { rig, skin };
}

// Smooth normals, area-weighted, shared across UV seams (vertices at one position get one normal).
export function smoothNormals(pos, tris) {
  const W = byPosition(pos), acc = new Float32Array(W.count * 3), n = pos.length / 3, out = new Float32Array(n * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [tris[t], tris[t + 1], tris[t + 2]]) { const u = W.rep[v] * 3; acc[u] += nx; acc[u + 1] += ny; acc[u + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    const u = W.rep[i] * 3, l = Math.hypot(acc[u], acc[u + 1], acc[u + 2]) || 1;
    out[i * 3] = acc[u] / l; out[i * 3 + 1] = acc[u + 1] / l; out[i * 3 + 2] = acc[u + 2] / l;
  }
  return out;
}

// A centre line through a tube of the mesh (the tail) from `start` along `dir`: slabs `step` thick across the line, the centroid of
// the vertices in each within `reach` of it and above `yMin` (not the feet); it ends where a slab holds fewer than `minPts`, then
// runs on to the farthest vertex ahead (the tip). Returns { pts, r (the 90th-percentile radius of each slab) }.
export function traceLine(pos, start, dir, { step = 0.01, reach = 0.08, yMin = -Infinity, minPts = 12, maxSteps = 300 } = {}) {
  const n = pos.length / 3, pts = [start.slice()], r = [];
  let c = start.slice(), d = dir.slice(), l0 = Math.hypot(...d);
  d = d.map((v) => v / l0);
  for (let k = 0; k < maxSteps; k++) {
    const q = [c[0] + d[0] * step, c[1] + d[1] * step, c[2] + d[2] * step];
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    const I = [];
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (y < yMin) continue;
      const vx = pos[i * 3] - q[0], vy = y - q[1], vz = pos[i * 3 + 2] - q[2];
      if (Math.abs(vx * d[0] + vy * d[1] + vz * d[2]) > step / 2 || vx * vx + vy * vy + vz * vz > reach * reach) continue;
      sx += pos[i * 3]; sy += y; sz += pos[i * 3 + 2]; cnt++; I.push(i);
    }
    if (cnt < minPts) break;
    const m = [sx / cnt, sy / cnt, sz / cnt], ds = I.map((i) => Math.hypot(pos[i * 3] - m[0], pos[i * 3 + 1] - m[1], pos[i * 3 + 2] - m[2])).sort((a, b) => a - b);
    r.push(ds[Math.floor(ds.length * 0.9)]);
    const nd = sub(m, c), nl = Math.hypot(...nd) || 1;
    d = [d[0] * 0.5 + (nd[0] / nl) * 0.5, d[1] * 0.5 + (nd[1] / nl) * 0.5, d[2] * 0.5 + (nd[2] / nl) * 0.5];
    l0 = Math.hypot(...d); d = d.map((v) => v / l0);
    c = m; pts.push(m);
  }
  let far = 0;
  for (let i = 0; i < n; i++) {
    const v = [pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]];
    if (pos[i * 3 + 1] >= yMin && Math.hypot(...v) < reach * 1.5) far = Math.max(far, dot(v, d));
  }
  if (far > 1e-4) pts.push([c[0] + d[0] * far, c[1] + d[1] * far, c[2] + d[2] * far]);
  return { pts, r };
}

// A point `s` along a polyline (by its horizontal length) and the polyline's horizontal length.
const hlen = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);
export function polyLength(P) { let s = 0; for (let k = 1; k < P.length; k++) s += hlen(P[k - 1], P[k]); return s; }
export function pointAt(P, s) {
  for (let k = 1; k < P.length; k++) {
    const l = hlen(P[k - 1], P[k]);
    if (s <= l || k === P.length - 1) return lerp(P[k - 1], P[k], l > 0 ? Math.min(1, s / l) : 0);
    s -= l;
  }
  return P[P.length - 1].slice();
}

// The tail straightened behind the body, in the ground plane, along its own length: the centre line's heading turns (smoothly over
// its first `blend`) to straight back (-z), each tail vertex keeping its offset from the line in the line's frame, so the tail's
// length and girth stay as modelled. `sel`: the vertices that may move (null: all). Returns { pos, map (a point carried the same way) }.
export function straightenTail(pos, sel, line, { blend = 0.1, aim = null, soft = 0.01, ramp = 0.02 } = {}) {
  const P = line.pts, K = P.length, s = [0], th = [];
  for (let k = 1; k < K; k++) s.push(s[k - 1] + hlen(P[k - 1], P[k]));
  const seg = [];
  for (let k = 1; k < K; k++) seg.push(Math.atan2(P[k][0] - P[k - 1][0], P[k][2] - P[k - 1][2]));
  for (let k = 1; k < seg.length; k++) while (seg[k] - seg[k - 1] > Math.PI) seg[k] -= 2 * Math.PI; // (unwrapped)
  for (let k = 1; k < seg.length; k++) while (seg[k] - seg[k - 1] < -Math.PI) seg[k] += 2 * Math.PI;
  for (let k = 0; k < K; k++) th.push(k === 0 ? seg[0] : k === K - 1 ? seg[K - 2] : (seg[k - 1] + seg[k]) / 2);
  let target = Math.PI; while (target - th[0] > Math.PI) target -= 2 * Math.PI; while (target - th[0] < -Math.PI) target += 2 * Math.PI;
  const sm = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
  const build = (tg) => {
    const h = th.map((a, k) => a + (tg - a) * sm(s[k] / blend)), c = [P[0].slice()];
    for (let k = 1; k < K; k++) {
      const l = s[k] - s[k - 1], a = (h[k - 1] + h[k]) / 2;
      c.push([c[k - 1][0] + Math.sin(a) * l, P[k][1], c[k - 1][2] + Math.cos(a) * l]);
    }
    return { h, c };
  };
  // (the base turns over `blend`, which carries the tail a little to the side it curled to: with `aim`, the straight part is turned
  // by that little so the tip comes back onto the midline x = aim)
  let built = build(target);
  if (aim != null) for (let it = 0; it < 4; it++) { target += Math.asin(Math.max(-1, Math.min(1, (built.c[K - 1][0] - aim) / s[K - 1]))); built = build(target); }
  const th2 = built.h, C = built.c;
  // Each segment of the line carries a point rigidly (its turn about y and its shift); a point takes the blend of the segments
  // nearest it (weights falling off over `soft`), so the map has no seam where the nearest segment changes on the inside of a bend.
  // How much a point follows: eased in over the line's first `ramp` (the body ahead of the vent stays put) and out from 1.4 to 2.4
  // of the tail's local radius (the flank and thigh beside the tail's root bend a little with it instead of tearing from it).
  const R = P.map((_, k) => Math.max(0.012, line.r?.[Math.max(0, Math.min((line.r?.length ?? 1) - 1, k - 1))] ?? 0.03));
  const ds = new Float64Array(K - 1), ts = new Float64Array(K - 1);
  const map = (p) => {
    let dmin = Infinity, kb = 0;
    for (let k = 0; k < K - 1; k++) { const q = segProj(p[0], p[1], p[2], P[k], P[k + 1]); ds[k] = q.d; ts[k] = q.t; if (q.d < dmin) { dmin = q.d; kb = k; } }
    const r = R[kb] + (R[kb + 1] - R[kb]) * ts[kb];
    const f = sm((s[kb] + (s[kb + 1] - s[kb]) * ts[kb]) / ramp) * (1 - sm((dmin - 1.4 * r) / r));
    if (f <= 0) return p.slice();
    let sw = 0, ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < K - 1; k++) {
      const w = Math.exp(-(ds[k] - dmin) / soft);
      if (w < 1e-4) continue;
      const tb = ts[k], c = lerp(P[k], P[k + 1], tb), c2 = lerp(C[k], C[k + 1], tb);
      const al = (th2[k] - th[k]) * (1 - tb) + (th2[k + 1] - th[k + 1]) * tb, ca = Math.cos(al), sa = Math.sin(al), dx = p[0] - c[0], dz = p[2] - c[2];
      ox += w * (c2[0] + dx * ca + dz * sa); oy += w * (p[1] - c[1] + c2[1]); oz += w * (c2[2] - dx * sa + dz * ca); sw += w;
    }
    return [p[0] + (ox / sw - p[0]) * f, p[1] + (oy / sw - p[1]) * f, p[2] + (oz / sw - p[2]) * f];
  };
  const out = Float32Array.from(pos), n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    if (sel && !sel[i]) continue;
    const q = map([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2];
  }
  return { pos: out, map, line: C };
}
