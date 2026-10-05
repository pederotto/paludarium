// The skink's joints, measured on its mesh (art-src/raw/skink_mesh.glb, the user's model of a red-eyed crocodile skink: one fused
// piece, length 1 along z, head toward +z, y up, x to the side, fore soles at y = -0.128; docs/agents/lizards/RIG_skink.md), for the
// lizard bone list (tools/rig/lizard.mjs). Baked by `node tools/bake-lizard.mjs skink`. The method is the gecko's
// (tools/rig/lizard-gecko.mjs) with the skink's own zones; what differs:
//   the tail      the model holds it straight in the top view but sloping down to the ground (y +0.014 at the vent to -0.095 at the
//                 tip). readRaw levels it first (the side view), with the shared straightenTail run in the y-z plane (x and y swapped,
//                 the tip aimed at the vent's height): rigid per segment of its centre line, so its length and girth stay as modelled.
//                 The bake then runs the usual top-view straightening on the levelled tail (a no-op but for noise).
//   the limbs     each limb finds its wrist / heel against its own sole height (the hind soles stand 0.023 above the fore soles).
//   the arc       the tail's length is measured along its centre line in 3D (the source's tail slopes), so the source's proportions
//                 can be compared with the bake's (tests/lizard-rig-skink.test.mjs check 7).
// Real size (the user): snout to vent 9 cm, an adult red-eyed crocodile skink (8-10 cm: the lead's literature figure, not project
// data); the tail and everything else in the model's proportions (the wide trunk is kept: no slimming).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { ANATOMY, traceLine, pointAt, polyLength, TAIL_SPLIT, dist, straightenTail } from './lizard.mjs';

export const SKINK = {
  id: 'skink', raw: 'art-src/raw/skink_mesh.glb', source: '~/Downloads/sample_2026-10-04T213008.005.glb',
  svlCm: 9.0, tris: [29400, 10000], nape: 0.12, vent: 0.56, srcLen: 1.0012,   // (the model's length as modelled: RIG_skink.md bbox)
  // fractions of the length from the snout (RIG_skink.md slice profile, +-0.02): the trunk between the limb pairs, the zones the
  // fore and hind limbs leave the trunk in (their digits may reach beyond)
  trunk: [0.29, 0.37], fore: [0.12, 0.37], hind: [0.37, 0.78],
  // capsule radii (model units) for the binding: the girth of each part (RIG_skink.md: head 0.13-0.19 wide, trunk 0.19 x 0.16, tail
  // 0.086 tapering to 0.018) and the limbs' tubes (shorter, stouter than the gecko's)
  radius: { head: 0.075, neck: 0.075, spine: 0.085, pelvis: 0.08, tail1: 0.042, tail2: 0.034, tail3: 0.027, tail4: 0.02, tail5: 0.013,
    arm: 0.022, forearm: 0.018, hand: 0.012, fingers: 0.007, thigh: 0.03, shin: 0.022, foot: 0.013, toes: 0.008 },
};
// RIG_skink.md lists the ribs on most of the trunk: the trunk's two bones carry them
export const SKINK_ANATOMY = { ...ANATOMY, ribs: ['spine', 'pelvis'] };

const len3 = (P) => { let s = 0; for (let k = 1; k < P.length; k++) s += dist(P[k - 1], P[k]); return s; };
const quant = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function bounds(pos) {
  let zmax = -Infinity, zmin = Infinity, ySole = Infinity, xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    zmax = Math.max(zmax, pos[i + 2]); zmin = Math.min(zmin, pos[i + 2]); ySole = Math.min(ySole, pos[i + 1]);
    xmin = Math.min(xmin, pos[i]); xmax = Math.max(xmax, pos[i]);
  }
  return { zmax, zmin, ySole, cx: (xmin + xmax) / 2 };
}
// a point on the midline at z0: the mean height of the trunk's slice there (not the limbs, not the soles)
function axial(pos, cx, z0, ySole) {
  let sy = 0, c = 0;
  for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - z0) < 0.012 && Math.abs(pos[i] - cx) < 0.06 && pos[i + 1] > ySole + 0.04) { sy += pos[i + 1]; c++; }
  return [cx, c ? sy / c : 0, z0];
}
const tailLine = (pos, vent) => traceLine(pos, vent, [0, 0, -1], { step: 0.01, reach: 0.065 });

// The tail levelled in the side view (see the header). Returns the new positions and the change: the tip's height above the vent
// before and after, the tail's 3D arc before and after, and the edge stretch over the whole mesh (p99.9 and worst, new / old length).
export function levelTail(pos, idx, cfg = SKINK) {
  const b = bounds(pos), vent = axial(pos, b.cx, b.zmax - cfg.vent * (b.zmax - b.zmin), b.ySole), line = tailLine(pos, vent);
  const sw = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) { o[i] = a[i + 1]; o[i + 1] = a[i]; o[i + 2] = a[i + 2]; } return o; };
  const st = straightenTail(sw(pos), null, { pts: line.pts.map((p) => [p[1], p[0], p[2]]), r: line.r }, { blend: 0.2, aim: vent[1], ramp: 0.1, soft: 0.02 });
  // (ramp 0.1 and soft 0.02, not the gecko defaults 0.02 / 0.01: the lift pivots at the vent, and a short ease tore the belly crease behind it, 278 edges past
  // 2x and the worst 4.5x, now 12 and 2.1x; blend 0.2 spreads the turn over the first 0.4 of the tail)
  const out = sw(st.pos), after = tailLine(out, vent), tip = (L) => L.pts[L.pts.length - 1][1] - vent[1];
  const R = [];
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e] * 3, c = idx[t + (e + 1) % 3] * 3;
    const l0 = Math.hypot(pos[a] - pos[c], pos[a + 1] - pos[c + 1], pos[a + 2] - pos[c + 2]);
    if (l0 > 1e-7) R.push(Math.hypot(out[a] - out[c], out[a + 1] - out[c + 1], out[a + 2] - out[c + 2]) / l0);
  }
  const Rs = Float64Array.from(R).sort();
  const stats = { tipDropBefore: +tip(line).toFixed(3), tipDropAfter: +tip(after).toFixed(3), arcBefore: +len3(line.pts).toFixed(3), arcAfter: +len3(after.pts).toFixed(3),
    stretchP999: +Rs[Math.floor(Rs.length * 0.999)].toFixed(2), stretchMax: +Rs[Rs.length - 1].toFixed(2), over2x: R.filter((r) => r > 2).length };
  return { pos: out, stats };
}

// `level` (default): the tail levelled in the side view, as baked; false: the source as modelled (the proportions check)
export async function readRaw(file = SKINK.raw, { level = true } = {}) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  await doc.transform(weld());
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const raw = { doc, prim, pos: Float32Array.from(prim.getAttribute('POSITION').getArray()), uv: Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray()),
    idx: Uint32Array.from(prim.getIndices().getArray()) };
  if (level) { const L = levelTail(raw.pos, raw.idx); raw.pos = L.pos; raw.level = L.stats; console.log(JSON.stringify({ skinkTailLevel: L.stats })); }
  return raw;
}

export function measureSkink(pos, cfg = SKINK) {
  // (fractions of the SOURCE length from the snout: the levelled tail reaches farther back, which must not move the vent or the zones)
  const n = pos.length / 3, B = bounds(pos), { zmax, zmin, ySole } = B, L0 = zmax - zmin, zAt = (f) => zmax - f * (cfg.srcLen ?? L0);
  // the midline and the trunk's half width, between the limb pairs, above the limbs' reach
  const xs = [];
  for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2]; if (z < zAt(cfg.trunk[0]) && z > zAt(cfg.trunk[1]) && pos[i * 3 + 1] > ySole + 0.07) xs.push(pos[i * 3]); }
  const cx = (quant(xs, 0.02) + quant(xs, 0.98)) / 2, hw = (quant(xs, 0.98) - quant(xs, 0.02)) / 2;
  const vent = axial(pos, cx, zAt(cfg.vent), ySole), line = tailLine(pos, vent);
  const nearTail = (x, y, z) => {
    for (let k = 1; k < line.pts.length; k++) {
      const a = line.pts[k - 1], b = line.pts[k], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2] || 1e-12;
      let t = ((x - a[0]) * u[0] + (y - a[1]) * u[1] + (z - a[2]) * u[2]) / l2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - a[0] - u[0] * t, y - a[1] - u[1] * t, z - a[2] - u[2] * t) < 0.07) return true;
    }
    return false;
  };
  // the limbs (the gecko's method; the wrist / heel against the limb's own sole)
  const raw = {}, info = {};
  for (const [s, side] of [['L', -1], ['R', 1]]) {
    for (const fore of [true, false]) {
      const [f0, f1] = fore ? cfg.fore : cfg.hind, I = [];
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (side * (x - cx) > hw + 0.01 && z <= zAt(f0) && z > zAt(f1) && !(!fore && nearTail(x, y, z))) I.push(i);
      }
      let ry = 0, rz = 0, rc = 0, yS = Infinity;
      for (const i of I) { yS = Math.min(yS, pos[i * 3 + 1]); if (side * (pos[i * 3] - cx) < hw + 0.03) { ry += pos[i * 3 + 1]; rz += pos[i * 3 + 2]; rc++; } }
      const root = [cx + side * hw * 0.55, ry / rc, rz / rc];
      let tip = root, dmax = 0;
      for (const i of I) { const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], d = dist(p, root); if (d > dmax) { dmax = d; tip = p; } }
      const NB = 24, acc = Array.from({ length: NB }, () => [0, 0, 0, 0]);
      for (const i of I) {
        const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], k = Math.min(NB - 1, Math.floor((dist(p, root) / dmax) * NB));
        acc[k][0] += p[0]; acc[k][1] += p[1]; acc[k][2] += p[2]; acc[k][3]++;
      }
      const poly = [root, ...acc.filter((a) => a[3] > 3).map((a) => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]), tip];
      let w = poly.findIndex((p, k) => k >= 2 && p[1] < yS + 0.025), found = w >= 2;
      if (!found) w = Math.round(poly.length * 0.6);
      let e = 1, best = -1;
      for (let k = 1; k < w; k++) {
        const a = root, b = poly[w], p = poly[k], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = u[0] ** 2 + u[1] ** 2 + u[2] ** 2;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1] + (p[2] - a[2]) * u[2]) / l2));
        const d = Math.hypot(p[0] - a[0] - u[0] * t, p[1] - a[1] - u[1] * t, p[2] - a[2] - u[2] * t);
        if (d > best) { best = d; e = k; }
      }
      const knuckle = arcPoint(poly.slice(w), 0.45);
      const names = fore ? ['shoulder', 'elbow', 'wrist', 'palm', 'finger'] : ['hip', 'knee', 'heel', 'ball', 'toe'];
      raw[s + (fore ? 'F' : 'H')] = { names, P: [root, poly[e], poly[w], knuckle, tip] };
      info[s + (fore ? 'F' : 'H')] = { verts: I.length, bins: poly.length, wrist: w, wristFound: found, elbow: e, bend: +best.toFixed(3), sole: +yS.toFixed(3), reach: +dmax.toFixed(3) };
    }
  }
  // each pair of bones at the mean of its two lengths, along each side's own directions
  const j = {}, asym = {};
  for (const limb of ['F', 'H']) {
    const A = raw['L' + limb], Bn = raw['R' + limb], PA = [A.P[0]], PB = [Bn.P[0]];
    for (let k = 1; k < 5; k++) {
      const la = dist(A.P[k], A.P[k - 1]), lb = dist(Bn.P[k], Bn.P[k - 1]), l = (la + lb) / 2;
      asym[A.names[k - 1]] = +((Math.abs(la - lb) / Math.max(la, lb)) * 100).toFixed(1);
      for (const [S, P] of [[A, PA], [Bn, PB]]) {
        const d = [S.P[k][0] - S.P[k - 1][0], S.P[k][1] - S.P[k - 1][1], S.P[k][2] - S.P[k - 1][2]], dl = Math.hypot(...d) || 1;
        P.push([P[k - 1][0] + (d[0] / dl) * l, P[k - 1][1] + (d[1] / dl) * l, P[k - 1][2] + (d[2] / dl) * l]);
      }
    }
    A.names.forEach((nm, k) => { j[nm + 'L'] = PA[k]; j[nm + 'R'] = PB[k]; });
  }
  const ax = (z) => axial(pos, cx, z, ySole);
  const chest = ax((j.shoulderL[2] + j.shoulderR[2]) / 2), sacrum = ax((j.hipL[2] + j.hipR[2]) / 2);
  Object.assign(j, { snout: [cx, ax(zAt(0.03))[1], zmax], nape: ax(zAt(cfg.nape)), chest, mid: ax((chest[2] + sacrum[2]) / 2), sacrum, vent });
  const T = [sacrum, ...line.pts], tl = polyLength(T);
  j.tail = [sacrum];
  let acc = 0;
  for (const f of TAIL_SPLIT) { acc += f; j.tail.push(pointAt(T, acc * tl)); }
  const svl = zmax - vent[2], tailArc = len3(line.pts);
  if (process.env.SKINK_LOG) console.log(JSON.stringify({ skinkMeasure: { cx: +cx.toFixed(4), hw: +hw.toFixed(3), ySole: +ySole.toFixed(3), vent: vent.map((v) => +v.toFixed(3)), tailPts: line.pts.length, info } }));
  return { cx, ySole, zmax, zmin, L0, hw, j, line, svl, tailArc, total: svl + tailArc, asym, info };
}

function arcPoint(P, f) {
  let L = 0; for (let k = 1; k < P.length; k++) L += dist(P[k - 1], P[k]);
  let s = f * L;
  for (let k = 1; k < P.length; k++) {
    const l = dist(P[k - 1], P[k]);
    if (s <= l) { const t = l > 0 ? s / l : 0; return P[k - 1].map((v, c) => v + (P[k][c] - v) * t); }
    s -= l;
  }
  return P[P.length - 1].slice();
}
