// The gecko's joints, measured on its mesh (art-src/raw/gecko_mesh.glb, the user's model of a mourning gecko: one fused piece,
// normalised to a length of 1 along z, head toward +z, y up, x to the side, soles at y = -0.18; docs/agents/lizards/RIG_gecko.md),
// for the lizard bone list (tools/rig/lizard.mjs). Baked by tools/bake-lizard.mjs.
//   along the body  fractions of the length from the snout (the model's slice profile, RIG_gecko.md, +-0.02): nape 0.11, vent 0.68;
//                   the shoulder and hip lines are where the limbs leave the trunk; each point on the midline at the slice's centre.
//   the tail        a centre line traced from the vent along its curve (it swings 0.26 to one side), split by TAIL_SPLIT.
//   the limbs       a limb is the mesh beyond the trunk's half width on its side; its root where it leaves the trunk, its tip the
//                   vertex farthest from the root (the longest digit), a centre line by distance from the root; the wrist / heel
//                   where that line comes down to the ground, the elbow / knee where it stands farthest off the root-wrist line,
//                   the knuckles (palm / ball, the digit fans' root) 0.45 of the way from the wrist to the tip.
//   left and right  the model is not quite symmetric (x -0.271 … +0.257): each side keeps its own joint directions, and each pair of
//                   bones takes the mean of the two lengths (raw differences in `asym`).
// Real size (the user: "correct size"): snout to vent 4.4 cm, an adult mourning gecko (the lead's literature figure, not project
// data); the tail and everything else in the model's proportions.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { traceLine, pointAt, polyLength, TAIL_SPLIT, dist } from './lizard.mjs';

export const GECKO = {
  id: 'gecko', raw: 'art-src/raw/gecko_mesh.glb', source: '~/Downloads/sample_2026-10-04T213641.596.glb',
  svlCm: 4.4, tris: [29000, 10000], nape: 0.11, vent: 0.68,
  // capsule radii (model units) for the binding: the girth of each part, from the slice profile (RIG_gecko.md) and the limbs' tubes
  radius: { head: 0.06, neck: 0.055, spine: 0.07, pelvis: 0.065, tail1: 0.045, tail2: 0.038, tail3: 0.032, tail4: 0.027, tail5: 0.022,
    arm: 0.02, forearm: 0.016, hand: 0.011, fingers: 0.007, thigh: 0.028, shin: 0.02, foot: 0.012, toes: 0.008 },
};

export async function readRaw(file = GECKO.raw) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  await doc.transform(weld());
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  return { doc, prim, pos: Float32Array.from(prim.getAttribute('POSITION').getArray()), uv: Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray()),
    idx: Uint32Array.from(prim.getIndices().getArray()) };
}

const quant = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function measureGecko(pos, cfg = GECKO) {
  const n = pos.length / 3;
  let zmax = -Infinity, zmin = Infinity, ySole = Infinity;
  for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2]; zmax = Math.max(zmax, z); zmin = Math.min(zmin, z); ySole = Math.min(ySole, pos[i * 3 + 1]); }
  const L0 = zmax - zmin, zAt = (f) => zmax - f * L0;
  // the midline and the trunk's half width, between the limb pairs (0.30 … 0.46 of the length)
  const xs = [];
  for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2]; if (z < zAt(0.3) && z > zAt(0.46) && pos[i * 3 + 1] > ySole + 0.05) xs.push(pos[i * 3]); }
  const cx = (quant(xs, 0.02) + quant(xs, 0.98)) / 2, hw = (quant(xs, 0.98) - quant(xs, 0.02)) / 2;
  const axial = (z0) => {
    let sy = 0, c = 0;
    for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3 + 2] - z0) < 0.012 && Math.abs(pos[i * 3] - cx) < 0.06 && pos[i * 3 + 1] > ySole + 0.04) { sy += pos[i * 3 + 1]; c++; }
    return [cx, c ? sy / c : 0, z0];
  };
  // the tail's centre line, from the vent
  const vent = axial(zAt(cfg.vent));
  const line = traceLine(pos, vent, [0, 0, -1], { step: 0.01, reach: 0.08, yMin: ySole + 0.05 });
  const nearTail = (x, y, z) => {
    for (let k = 1; k < line.pts.length; k++) {
      const a = line.pts[k - 1], b = line.pts[k], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2] || 1e-12;
      let t = ((x - a[0]) * u[0] + (y - a[1]) * u[1] + (z - a[2]) * u[2]) / l2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - a[0] - u[0] * t, y - a[1] - u[1] * t, z - a[2] - u[2] * t) < 0.07) return true;
    }
    return false;
  };
  // the limbs
  const raw = {}, info = {};
  for (const [s, side] of [['L', -1], ['R', 1]]) {
    for (const fore of [true, false]) {
      const zone = fore ? (z) => z < zAt(0.02) && z > zAt(0.4) : (z) => z <= zAt(0.4) && z > zAt(0.92);
      const I = [];
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (side * (x - cx) > hw + 0.01 && zone(z) && !(!fore && nearTail(x, y, z))) I.push(i);
      }
      let ry = 0, rz = 0, rc = 0;
      for (const i of I) if (side * (pos[i * 3] - cx) < hw + 0.03) { ry += pos[i * 3 + 1]; rz += pos[i * 3 + 2]; rc++; }
      // (the shoulder and hip joints sit inside the body wall, about half way in: the glenoid and the acetabulum)
      const root = [cx + side * hw * 0.55, ry / rc, rz / rc];
      let tip = root, dmax = 0;
      for (const i of I) { const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], d = dist(p, root); if (d > dmax) { dmax = d; tip = p; } }
      const NB = 24, acc = Array.from({ length: NB }, () => [0, 0, 0, 0]);
      for (const i of I) {
        const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], k = Math.min(NB - 1, Math.floor((dist(p, root) / dmax) * NB));
        acc[k][0] += p[0]; acc[k][1] += p[1]; acc[k][2] += p[2]; acc[k][3]++;
      }
      const poly = [root, ...acc.filter((a) => a[3] > 3).map((a) => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]), tip];
      let w = poly.findIndex((p, k) => k >= 2 && p[1] < ySole + 0.03);
      if (w < 2) w = Math.round(poly.length * 0.6);
      let e = 1, best = -1;
      for (let k = 1; k < w; k++) {
        const a = root, b = poly[w], p = poly[k], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = u[0] ** 2 + u[1] ** 2 + u[2] ** 2;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1] + (p[2] - a[2]) * u[2]) / l2));
        const d = Math.hypot(p[0] - a[0] - u[0] * t, p[1] - a[1] - u[1] * t, p[2] - a[2] - u[2] * t);
        if (d > best) { best = d; e = k; }
      }
      const distal = poly.slice(w), knuckle = arcPoint(distal, 0.45);
      const names = fore ? ['shoulder', 'elbow', 'wrist', 'palm', 'finger'] : ['hip', 'knee', 'heel', 'ball', 'toe'];
      raw[s + (fore ? 'F' : 'H')] = { names, P: [root, poly[e], poly[w], knuckle, tip] };
      info[s + (fore ? 'F' : 'H')] = { verts: I.length, bins: poly.length, wrist: w, elbow: e, bend: +best.toFixed(3) };
    }
  }
  // each pair of bones at the mean of its two lengths, along each side's own directions
  const j = {}, asym = {};
  for (const limb of ['F', 'H']) {
    const A = raw['L' + limb], B = raw['R' + limb], PA = [A.P[0]], PB = [B.P[0]];
    for (let k = 1; k < 5; k++) {
      const la = dist(A.P[k], A.P[k - 1]), lb = dist(B.P[k], B.P[k - 1]), l = (la + lb) / 2;
      asym[A.names[k - 1]] = +((Math.abs(la - lb) / Math.max(la, lb)) * 100).toFixed(1);
      for (const [S, P] of [[A, PA], [B, PB]]) {
        const d = [S.P[k][0] - S.P[k - 1][0], S.P[k][1] - S.P[k - 1][1], S.P[k][2] - S.P[k - 1][2]], dl = Math.hypot(...d) || 1;
        P.push([P[k - 1][0] + (d[0] / dl) * l, P[k - 1][1] + (d[1] / dl) * l, P[k - 1][2] + (d[2] / dl) * l]);
      }
    }
    A.names.forEach((nm, k) => { j[nm + 'L'] = PA[k]; j[nm + 'R'] = PB[k]; });
  }
  // the axial skeleton: snout, nape, the shoulder line (chest), the middle of the trunk, the hip line (sacrum), the vent
  const chest = axial((j.shoulderL[2] + j.shoulderR[2]) / 2), sacrum = axial((j.hipL[2] + j.hipR[2]) / 2);
  Object.assign(j, { snout: [cx, axial(zAt(0.03))[1], zmax], nape: axial(zAt(cfg.nape)), chest, mid: axial((chest[2] + sacrum[2]) / 2), sacrum, vent });
  // the tail's bones along [sacrum, vent, the traced line]
  const T = [sacrum, ...line.pts], tl = polyLength(T);
  j.tail = [sacrum];
  let acc = 0;
  for (const f of TAIL_SPLIT) { acc += f; j.tail.push(pointAt(T, acc * tl)); }
  const svl = zmax - vent[2], tailArc = polyLength(line.pts);
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
