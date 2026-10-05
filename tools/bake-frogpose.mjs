// Bakes the swimming-pose frog scan (art-src/raw/frog_swim_mesh.glb, an untextured model of a frog in mid-stroke: forelegs out,
// hind legs trailing in a V) into swim-pose models for the frogs that have a baked body: <id>.swim.glb and <id>.swim.lo.glb,
// painted with the species' own colours (tools/paint/<paint>.mjs), and a manifest entry `<id>.swim` that the game draws the
// frog with while it swims (Animals.upgradeModels, Animals.draw). The sitting model stays for everything else.
// The scan's limbs are apart and half bent (the hind legs mid-stroke, the forelegs out), which is the pose a skeleton binds best in:
// its bones are measured on it (SWIM_SKELETON), the skin bound to them (`_SKIN`, tools/rig/skeleton.mjs bindCapsules) and the
// skeleton written to the manifest, so the game drives this body through the whole stroke (render/creatures/skeleton.js poseStroke).
//
//   node tools/bake-frogpose.mjs [id.swim ...]       (no ids: every job below)
//
// The scan is about 2 units across and 2 long, head towards +z. The steps: weld, level the trunk, tell trunk from limbs and
// work out where along the body every vertex is (the painters want u, h, s, leg and legT, see tools/paint/common.mjs),
// scale so the body is as long as the sitting model's, put the origin at the middle of the trunk with the belly on y = 0 (a
// swimmer floats: the game puts the origin a little under the water), simplify to two levels of detail, paint, write.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { bindCapsules, frogBones } from './rig/skeleton.mjs';

const OUT = 'public/assets/creatures';
// cmPerUnit: the scan's trunk (snout to vent, 1.33 units) has to be the 4.5 cm of the sitting leucomelas; strawberry is 0.511 of that.
// Every frog with a baked body gets one, painted by the same painter as its sitting model (paint 'module#arg' as in bake-creature).
const SWIM = (cm, paint, eyes, tris = [24000, 7000], web = null) => ({ src: 'frog_swim_mesh', cmPerUnit: 3.3 * cm / 4.5, tris, paint, eyes, web });
// Webbing between the hind toes: a thin, see-through membrane that fills the space between each two toes from where they part out
// to near their tips, its free edge only a shallow curve between them (`ext`: how far along the toes it reaches, `dep`: how far its
// edge dips between two toes, as a share of that). The fire-bellied toad's hind feet are webbed nearly to the tips (Bombina
// orientalis), the red-eyed tree frog's (Agalychnis callidryas) and the reed frog's (Heterixalus) most of the way. The poison frogs
// have free toes with discs, and the bumblebee toad's web is only a trace at the base (Melanophryniscus stelzneri): none drawn.
// (A first try with webs reaching half to three quarters out and a deep notch between toes, opaque and toe-coloured, read as
// deformed toes, not as webbing: the owner, 2026-10-04.)
const WEB = { toad: { ext: 0.95, dep: 0.12 }, redeye: { ext: 0.9, dep: 0.15 }, reedfrog: { ext: 0.86, dep: 0.18 } };
const JOBS = {
  'leucomelas.swim': SWIM(4.5, 'leucomelas', 'leucomelas', [30000, 10000]),
  'strawberry.swim': SWIM(2.3, 'strawberry', 'strawberry'),
  'dartfrog.swim': SWIM(4.2, 'azureus#cobalt_spotted', 'dartfrog'),
  'dartfrog:cobalt_clean.swim': SWIM(4.2, 'azureus#cobalt_clean', 'dartfrog:cobalt_clean'),
  'dartfrog:sky_spotted.swim': SWIM(4.2, 'azureus#sky_spotted', 'dartfrog:sky_spotted'),
  'dartfrog:sky_clean.swim': SWIM(4.2, 'azureus#sky_clean', 'dartfrog:sky_clean'),
  'auratus.swim': SWIM(4.0, 'auratus', 'auratus'),
  'bumblebee.swim': SWIM(2.8, 'melano', 'bumblebee'),
  'reedfrog.swim': SWIM(3.0, 'heterixalus', 'reedfrog', undefined, WEB.reedfrog),
  'toad.swim': SWIM(4.5, 'bombina', 'toad', undefined, WEB.toad),
  // The red-eyed tree frog does not swim, but it leaps, and its own scan sits with its hind legs folded in one lump: in the air it is
  // drawn in this body (Animals.draw, util/gait.js leapStroke), painted as itself.
  'redeye.swim': SWIM(6.4, 'callidryas', 'redeye', undefined, WEB.redeye),
};
// The swimming scan's skeleton (tools/rig/skeleton.mjs frogBones): joints measured on the leveled scan (scan units, head +z, about 2
// long: analyse() below) from its top, side and front views, each at the middle of the limb where the mesh bends. The hind leg is
// mid-stroke (thigh out to the knee, shin back and up to the heel, the foot turned out and hanging); the foreleg is held out.
// `radius`: each bone's capsule for the binding.
const SWIM_SKELETON = {
  joints: {
    vent: [0, 0.023, -0.36], mid: [0, 0.045, -0.02], chest: [0, 0.064, 0.36], neck: [0, 0.064, 0.48], snout: [0, 0.089, 0.985],
    hipR: [0.07, 0, -0.32], kneeR: [0.41, -0.035, -0.41], heelR: [0.21, 0.169, -0.86], ankleR: [0.55, -0.048, -0.91], toeR: [0.78, -0.157, -0.89],
    hipL: [-0.07, 0, -0.32], kneeL: [-0.425, -0.022, -0.395], heelL: [-0.215, 0.158, -0.875], ankleL: [-0.58, -0.074, -0.935], toeL: [-0.86, -0.147, -0.925],
    shoulderR: [0.21, 0.03, 0.44], elbowR: [0.5, 0.064, 0.385], wristR: [0.84, 0.01, 0.5], fingerR: [0.975, 0.005, 0.575],
    shoulderL: [-0.21, 0.035, 0.44], elbowL: [-0.5, 0.064, 0.375], wristL: [-0.86, 0.015, 0.5], fingerL: [-0.985, 0.016, 0.575],
  },
  radius: { pelvis: 0.2, spine: 0.28, head: 0.2, thigh: 0.085, shin: 0.06, foot: 0.045, toes: 0.03, arm: 0.055, forearm: 0.045, hand: 0.03 },
};
const { EYES } = await import('./paint/eyes.mjs');
await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const quant = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

function simplified(pos, idx, targetTris) {
  if (idx.length / 3 <= targetTris) return { pos, idx, from: null };
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(targetTris * 3), 0.02, []);
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3), from = new Uint32Array(count);
  for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; from[remap[i]] = i; }
  return { pos: np, idx: out, from };
}

// Reads the scan: positions in scan units (about -1 … 1), triangle indices.
async function readScan(name) {
  const doc = await io.read(`art-src/raw/${name}.glb`);
  await doc.transform(weld());
  const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  return { pos: Float32Array.from(p.getAttribute('POSITION').getArray()), idx: Uint32Array.from(p.getIndices().getArray()) };
}

// Level the trunk (the scan swims a little head-up), then describe every vertex for the painters. Returns the leveled
// positions (scan units) and per-vertex arrays.
function analyse(src) {
  const pos = Float32Array.from(src.pos), n = pos.length / 3;
  // 1. level: a least-squares line y = a + b z through the trunk, rotated about x until it is flat.
  let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
  for (let i = 0; i < n; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const b = (m * szy - sz * sy) / (m * szz - sz * sz), th = Math.atan(b), c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1], z = pos[i * 3 + 2]; pos[i * 3 + 1] = y * c - z * s; pos[i * 3 + 2] = y * s + z * c; }
  // 2. the trunk's measures: snout, vent, belly, back.
  let zs = -1e9; for (let i = 0; i < n; i++) zs = Math.max(zs, pos[i * 3 + 2]);
  const zv = -0.35;
  const ty = []; for (let i = 0; i < n; i++) { const x = pos[i * 3], z = pos[i * 3 + 2]; if (Math.abs(x) < 0.25 && z > -0.2 && z < 0.7) ty.push(pos[i * 3 + 1]); }
  const yb = quant(ty, 0.02), yt = quant(ty, 0.98);
  // 3. per vertex: trunk or limb, and where along it.
  const U = new Float32Array(n), H = new Float32Array(n), S = new Float32Array(n), LEG = new Uint8Array(n), LEGT = new Float32Array(n);
  let xmax = 0; for (let i = 0; i < n; i++) xmax = Math.max(xmax, Math.abs(pos[i * 3]));
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], ax = Math.abs(x);
    const arm = z > 0.28 && z < 0.66 && ax > 0.3;
    const hind = (z < -0.28 && ax > 0.15) || (z < -0.1 && ax > 0.34);
    if (arm) { LEG[i] = x < 0 ? 1 : 2; LEGT[i] = clamp01((ax - 0.3) / (xmax - 0.3)); }
    else if (hind) { LEG[i] = x < 0 ? 3 : 4; LEGT[i] = clamp01(Math.hypot(ax - 0.22, z + 0.25) / 0.95); }
    U[i] = clamp01((zs - z) / (zs - zv));
    H[i] = clamp01((y - yb) / (yt - yb));
    S[i] = clamp01(ax / 0.3);
  }
  return { pos, n, U, H, S, LEG, LEGT, zs, zv, yb, yt };
}

// The hind toes of the leveled scan, for the webbing: walked over the foot's surface from the ankle (geodesic distance along the
// mesh's edges), the toes are the parts of the foot that stay apart as the distance falls. Each toe: its tip (the middle of the
// disc, a disc's radius in from the farthest point), the point where it parts from the foot, and the straight line between (the
// toes of this scan are straight). Sorted round the foot, so neighbours in the list are neighbours on the foot.
function hindToes(A, idx, side, ankle) {
  const P = A.pos, n = A.n;
  const inFoot = (i) => P[i * 3] * side > 0.4 && P[i * 3 + 2] < -0.6;
  const adj = new Map();
  const edge = (a, b) => { let e = adj.get(a); if (!e) adj.set(a, (e = new Set())); e.add(b); };
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (v.every(inFoot)) for (let k = 0; k < 3; k++) { edge(v[k], v[(k + 1) % 3]); edge(v[(k + 1) % 3], v[k]); }
  }
  const verts = [...adj.keys()], d3 = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const dist = new Map(verts.map((v) => [v, Infinity])), heap = [];
  const push = (v, d) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const v of verts) if (Math.hypot(P[v * 3] - ankle[0], P[v * 3 + 1] - ankle[1], P[v * 3 + 2] - ankle[2]) < 0.05) { dist.set(v, 0); push(v, 0); }
  while (heap.length) { const [d, v] = pop(); if (d > dist.get(v)) continue; for (const w of adj.get(v)) { const nd = d + d3(v, w); if (nd < dist.get(w)) { dist.set(w, nd); push(w, nd); } } }
  const finite = verts.filter((v) => Number.isFinite(dist.get(v))), dmax = Math.max(...finite.map((v) => dist.get(v)));
  const parts = (t) => {
    const seen = new Set(), out = [];
    for (const v of finite) {
      if (seen.has(v) || dist.get(v) < t) continue;
      const q = [v], cv = []; seen.add(v);
      while (q.length) { const u = q.pop(); cv.push(u); for (const w of adj.get(u)) if (!seen.has(w) && dist.get(w) >= t) { seen.add(w); q.push(w); } }
      out.push(cv);
    }
    return out;
  };
  // the tips: the farthest vertex of each part that stays apart at some distance (not the stump where the foot region was cut)
  const tips = [];
  for (const f of [0.6, 0.5, 0.45, 0.4]) for (const cv of parts(dmax * f)) {
    if (cv.length < 20) continue;
    let tv = cv[0]; for (const v of cv) if (dist.get(v) > dist.get(tv)) tv = v;
    if (P[tv * 3] * side > 0.415 && !tips.some((u) => d3(u, tv) < 0.05)) tips.push(tv);
  }
  const toes = [];
  for (const tv of tips) {
    // down from the tip until the part holding it takes in another toe: there it parts from the foot. On the way, the middle of
    // each band of distance is a point of the toe's centre line.
    const band = [];
    for (let t = dist.get(tv) - 0.006; t > 0.01; t -= 0.006) {
      const mine = parts(t).find((cv) => cv.includes(tv));
      if (!mine || tips.some((u) => u !== tv && mine.includes(u))) break;
      let cx = 0, cy = 0, cz = 0, k = 0;
      for (const v of mine) { const d = dist.get(v); if (d >= t && d < t + 0.012) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; k++; } }
      if (k) band.push([cx / k, cy / k, cz / k]);
    }
    if (band.length < 3) continue;
    band.reverse();                                        // (from where it parts from the foot out to the tip)
    // smoothed (the bands are ragged), the tip a disc's radius in from the farthest point, and the line in from the end of the foot
    const sm = band.map((_, i) => [0, 1, 2].map((a) => { let s2 = 0, m = 0; for (let j = Math.max(0, i - 3); j <= Math.min(band.length - 1, i + 3); j++) { s2 += band[j][a]; m++; } return s2 / m; }));
    const far = [P[tv * 3], P[tv * 3 + 1], P[tv * 3 + 2]], end = sm[sm.length - 1], dir = norm3(sub3(far, end));
    const tip = far.map((v, a) => v - dir[a] * 0.03);
    const line = [ankle, ...sm.filter((q) => Math.hypot(...sub3(q, tip)) > 0.02), tip];
    const cum = [0]; for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(...sub3(line[i], line[i - 1])));
    toes.push({ line, cum, len: cum[cum.length - 1], crotch: cum[1] / cum[cum.length - 1], tip });
  }
  // round the foot: by angle about the toes' mean, in the plane the toes spread in
  const c = [0, 1, 2].map((a) => toes.reduce((s2, t) => s2 + t.tip[a], 0) / toes.length), ank = ankle;
  const u = norm3(sub3(c, ank)), w0 = norm3(cross3(sub3(toes[0].tip, ank), sub3(toes[toes.length - 1].tip, ank))), v = cross3(w0, u);
  for (const t of toes) { const d = sub3(t.tip, ank); t.ang = Math.atan2(dot3(d, v), dot3(d, u)); }
  return toes.sort((a, b) => a.ang - b.ang);
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The web between each two neighbouring toes (leveled scan units): a sheet whose sides run along the two toes' centre lines (inside
// the toes) from within the foot (hidden by it) out past the crotch, where the toes part, to `ext` of each toe's free length, its
// free edge dipping between them by `dep` of that (the concave margin of a frog's web). `R` rows out and `C` columns across; both
// faces (a thin membrane seen from either side). Returns positions, the sheet's normal per vertex (flipped for the back face),
// and triangles.
function along(t, f) {                                    // the point a share f of the way along a toe's line, from the foot's end
  const L = f * t.len;
  let i = 1; while (i < t.line.length - 1 && t.cum[i] < L) i++;
  const q = (L - t.cum[i - 1]) / Math.max(1e-9, t.cum[i] - t.cum[i - 1]);
  return [0, 1, 2].map((a) => t.line[i - 1][a] + (t.line[i][a] - t.line[i - 1][a]) * Math.min(1, Math.max(0, q)));
}
function webSheet(toes, { ext, dep }, R, C) {
  const pos = [], nrm = [], tri = [];
  for (let k = 0; k + 1 < toes.length; k++) {
    const a = toes[k], b = toes[k + 1];
    const ma = a.crotch + ext * (1 - a.crotch), mb = b.crotch + ext * (1 - b.crotch);
    // (the free edge, as a share of the way along the toes: from the margin on one toe to the margin on the other, dipping toward
    // the crotch line between them)
    const edge = (sx) => { const m = ma + (mb - ma) * sx, c = a.crotch + (b.crotch - a.crotch) * sx; return m - dep * (m - c) * Math.sin(Math.PI * sx); };
    const start = 0.4 * Math.min(a.crotch, b.crotch);        // (inside the foot, so it fills the fork between the toes down to its apex)
    // each point: across from a point on one toe to the one on the other at the same share of the way out, which runs from inside
    // the foot to the free edge, so the web's sides lie along the toes however they bend
    const grid = [];
    for (let r = 0; r <= R; r++) for (let cI = 0; cI <= C; cI++) {
      const sx = cI / C, f = start + (r / R) * (edge(sx) - start), pa = along(a, f), pb = along(b, f);
      grid.push([0, 1, 2].map((i) => pa[i] + (pb[i] - pa[i]) * sx));
    }
    // normals: across the sheet (rows and columns), per vertex
    const P2 = (r, c) => grid[r * (C + 1) + c];
    const nn = [];
    for (let r = 0; r <= R; r++) for (let cI = 0; cI <= C; cI++) {
      const du = sub3(P2(r, Math.min(C, cI + 1)), P2(r, Math.max(0, cI - 1))), dv = sub3(P2(Math.min(R, r + 1), cI), P2(Math.max(0, r - 1), cI));
      nn.push(norm3(cross3(du, dv)));
    }
    for (const flip of [1, -1]) {
      const o = pos.length / 3;
      grid.forEach((q, i) => { pos.push(...q); nrm.push(nn[i][0] * flip, nn[i][1] * flip, nn[i][2] * flip); });
      for (let r = 0; r < R; r++) for (let cI = 0; cI < C; cI++) {
        const i0 = o + r * (C + 1) + cI, i1 = i0 + 1, i2 = i0 + C + 1, i3 = i2 + 1;
        if (flip > 0) tri.push(i0, i1, i2, i1, i3, i2); else tri.push(i0, i2, i1, i1, i2, i3);     // (the front face toward its normal)
      }
    }
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), tri: Uint32Array.from(tri) };
}

// `rig`: (spine, leg / 8, legT, material id / 8) and `skin`: (bone 0 / 32, bone 1 / 32, bone 0's weight, 0), as tools/bake-creature.mjs
// writes them (render/creatures/glb.js bakedRig reads them back).
async function writeGlb(id, level, pos, nor, col, idx, rig, skin) {
  const doc = new Document(), buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf))
    .setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(rig).setBuffer(buf))
    .setAttribute('_SKIN', doc.createAccessor().setType('VEC4').setArray(skin).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0));
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc);
  return { file, bytes: fs.statSync(file).size };
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cache = {};
for (const [id, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(id)) continue;
  // The texel painter at vertex resolution (no granules, no occlusion), with the eye known, so masks round the eye come out.
  const [pmod, parg] = job.paint.split('#');
  const PM = await import(`./paint/${pmod}.mjs`);
  const tex = parg ? PM.texelFor(parg) : PM.texel;
  const sc0 = job.cmPerUnit / 3.3, eyeC = [0.48 * sc0, 1.18 * sc0, 1.6 * sc0], eyeR = 0.3 * sc0;
  const paint = (v) => tex({ ...v, ao: 0, noGran: true, eyeR, eyeD: Math.hypot(Math.abs(v.x) - eyeC[0], v.y - eyeC[1], v.z - eyeC[2]) });
  cache[job.src] ??= analyse(await readScan(job.src));
  const A = cache[job.src], src = await readScan(job.src);
  // the skeleton and the skin's binding, on the full scan (scan units): every level of detail takes its vertices' binding from it
  const bones = frogBones(SWIM_SKELETON.joints);
  A.bind ??= bindCapsules(A.pos, bones, { radius: SWIM_SKELETON.radius, tris: src.idx, smooth: 6 });
  // the webbing's sheets (scan units) and, for each of its vertices, the nearest vertex of the scan (its colour, rig and binding)
  A.toes ??= ['R', 'L'].map((sd) => hindToes(A, src.idx, sd === 'R' ? 1 : -1, SWIM_SKELETON.joints[`ankle${sd}`]));
  if (process.env.WEB_DEBUG) for (const [q, toes] of A.toes.entries()) console.log(q ? 'L' : 'R', toes.map((t) => `tip(${t.tip.map((v) => v.toFixed(2))}) ang ${t.ang.toFixed(2)} crotch ${t.crotch.toFixed(2)} len ${t.len.toFixed(2)}`).join(' | '));
  const webOf = (R, C) => {
    if (!job.web) return null;
    const sheets = A.toes.map((toes) => webSheet(toes, job.web, R, C));
    const wpos = new Float32Array(sheets.reduce((s2, w) => s2 + w.pos.length, 0)), wnrm = new Float32Array(wpos.length), wtri = [];
    let o = 0;
    for (const w of sheets) { wpos.set(w.pos, o * 3); wnrm.set(w.nrm, o * 3); for (const t of w.tri) wtri.push(t + o); o += w.pos.length / 3; }
    const near = new Uint32Array(o);
    for (let i = 0; i < o; i++) {
      let best = 1e9, bi = 0;
      for (let j = 0; j < A.n; j++) { const dx = A.pos[j * 3] - wpos[i * 3], dy = A.pos[j * 3 + 1] - wpos[i * 3 + 1], dz = A.pos[j * 3 + 2] - wpos[i * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < best) { best = d; bi = j; } }
      near[i] = bi;
    }
    return { pos: wpos, nrm: wnrm, tri: Uint32Array.from(wtri), near, n: o };
  };
  const k = job.cmPerUnit / 100, zc = (A.zs + A.zv) / 2;
  // Baked frame, metres: origin at the middle of the trunk, belly on y = 0, head towards +z.
  const pos = new Float32Array(A.n * 3);
  for (let i = 0; i < A.n; i++) { pos[i * 3] = A.pos[i * 3] * k; pos[i * 3 + 1] = (A.pos[i * 3 + 1] - A.yb) * k; pos[i * 3 + 2] = (A.pos[i * 3 + 2] - zc) * k; }
  const fullN = normals(pos, src.idx);
  const lod = async (level, target) => {
    const g0 = simplified(pos, src.idx, target), web = webOf(level === 'hi' ? 8 : 4, level === 'hi' ? 8 : 4);
    // (the web's vertices go after the body's: positions in the baked frame, the scan vertex each takes its looks from)
    const g = !web ? g0 : {
      pos: Float32Array.from([...g0.pos, ...Array.from({ length: web.n * 3 }, (_, q) => (q % 3 === 0 ? web.pos[q] * k : q % 3 === 1 ? (web.pos[q] - A.yb) * k : (web.pos[q] - zc) * k))]),
      idx: Uint32Array.from([...g0.idx, ...Array.from(web.tri, (t) => t + g0.pos.length / 3)]),
      from: Uint32Array.from([...(g0.from ?? Array.from({ length: g0.pos.length / 3 }, (_, q) => q)), ...web.near]),
    };
    const n = g.pos.length / 3, from = g.from, nBody = g0.pos.length / 3;
    const nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = from ? from[i] : i;
      for (let c = 0; c < 3; c++) nor[i * 3 + c] = i >= nBody ? web.nrm[(i - nBody) * 3 + c] : from ? fullN[o * 3 + c] : fullN[i * 3 + c];
      const c = paint({ u: A.U[o], x: g.pos[i * 3] * 100, y: g.pos[i * 3 + 1] * 100, z: g.pos[i * 3 + 2] * 100, s: A.S[o], h: A.H[o], leg: A.LEG[o], legT: A.LEGT[o], n: [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]] });
      // (the web: thin skin, a paler wash of the toes' colour, which the see-through membrane lets the water show through)
      const wk = i >= nBody ? 0.25 : 0, MEM = [0.7, 0.66, 0.6];
      for (let q = 0; q < 3; q++) col[i * 3 + q] = c[q] * (1 - wk) + MEM[q] * wk;
    }
    const rig = new Float32Array(n * 4), sk = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = from ? from[i] : i;
      rig[i * 4] = A.U[o]; rig[i * 4 + 1] = A.LEG[o] / 8; rig[i * 4 + 2] = A.LEGT[o];
      if (i >= nBody) rig[i * 4 + 3] = 2 / 8;    // (the web is a membrane: render/creatures/material.js FIN, drawn see-through)
      sk[i * 4] = A.bind.idx[o * 2] / 32; sk[i * 4 + 1] = A.bind.idx[o * 2 + 1] / 32; sk[i * 4 + 2] = A.bind.w[o];
    }
    const w = await writeGlb(id, level, g.pos, nor, col, g.idx, rig, sk);
    return { ...w, tris: g.idx.length / 3 };
  };
  const hi = await lod('hi', job.tris[0]), lo = await lod('lo', job.tris[1]);
  // The eyes sit on the upper side of the head, a third of the way back from the snout: found by looking at the model with
  // markers (tools: scratch headview), in cm for the 3.3 cm-a-unit leucomelas and scaled for the smaller frogs.
  const sc = job.cmPerUnit / 3.3, eye = [0.48 * sc, 1.18 * sc, 1.6 * sc].map((v) => +v.toFixed(2));
  const base = EYES[job.eyes].finish, e0 = base.eyes[0];
  const finish = { ...base, eyes: [{ ...e0, c: eye, r: +(0.3 * sc).toFixed(3) }], ...(job.web ? { finOpacity: 0.38, webFold: true } : {}) };
  const size = [0, 0, 0].map((_, a) => { let lo2 = 1e9, hi2 = -1e9; for (let i = 0; i < A.n; i++) { lo2 = Math.min(lo2, pos[i * 3 + a]); hi2 = Math.max(hi2, pos[i * 3 + a]); } return +((hi2 - lo2) * 100).toFixed(2); });
  // The skeleton in the baked frame (cm), for the game's runtime skinning (`bind: 'swim'`: posed by the stroke, skeleton.js poseStroke).
  const cm = (j) => [+(j[0] * k * 100).toFixed(3), +((j[1] - A.yb) * k * 100).toFixed(3), +((j[2] - zc) * k * 100).toFixed(3)];
  const rOf = (b) => SWIM_SKELETON.radius[b.name.replace(/[LR]$/, '')] ?? 0.05;
  const skeleton = { plan: 'anuran', bind: 'swim', bones: frogBones(Object.fromEntries(Object.entries(SWIM_SKELETON.joints).map(([kk, v]) => [kk, cm(v)]))).map((b) => ({ ...b, r: +(rOf(b) * k * 100).toFixed(3) })) };
  manifest[id] = { file: `${id.replace(':', '-')}.glb`, lo: `${id.replace(':', '-')}.lo.glb`, legs: false, pose: 'swim', tris: { hi: hi.tris, lo: lo.tris }, sizeCm: size, finish, skeleton, ...(job.web ? { web: job.web } : {}) };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${size.join(' x ')} cm (x y z), eye at ${eye.join(', ')} cm`);
}
// (a skeleton is written on one line, as tools/bake-creature.mjs does: the manifest's one-number-a-line layout would add hundreds of lines a species)
const SK = [];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SK.push(v) - 1}@@` : v), 1)
  .replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SK[+i])));
