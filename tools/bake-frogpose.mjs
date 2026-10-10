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
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { bindCapsules, frogBones, skinFour, SKIN_PASSES, spineRamp, vertexNormals } from './rig/skeleton.mjs';
import { headWeight, rollHead, poseToStroke, scanStroke } from './rig/neutral.mjs';
import { cutSeams } from './rig/seam-cut.mjs';
import { graftMirror, relaxRings, meshCheck } from './rig/leg-graft.mjs';
import { neutralStroke } from '../src/util/climb.js';

const OUT = process.env.T4_OUT || 'public/assets/creatures';
// cmPerUnit: the scan's trunk (snout to vent, 1.33 units) has to be the 4.5 cm of the sitting leucomelas; strawberry is 0.511 of that.
// Every frog with a baked body gets one, painted by the same painter as its sitting model (paint 'module#arg' as in bake-creature).
const SWIM = (cm, paint, eyes, tris = [24000, 7000]) => ({ src: 'frog_swim_mesh', cmPerUnit: 3.3 * cm / 4.5, tris, paint, eyes });
const JOBS = {
  'leucomelas.swim': SWIM(4.5, 'leucomelas', 'leucomelas', [30000, 10000]),
  'strawberry.swim': SWIM(2.3, 'strawberry', 'strawberry'),
  'dartfrog.swim': SWIM(4.2, 'azureus#cobalt_spotted', 'dartfrog'),
  'dartfrog:cobalt_clean.swim': SWIM(4.2, 'azureus#cobalt_clean', 'dartfrog:cobalt_clean'),
  'dartfrog:sky_spotted.swim': SWIM(4.2, 'azureus#sky_spotted', 'dartfrog:sky_spotted'),
  'dartfrog:sky_clean.swim': SWIM(4.2, 'azureus#sky_clean', 'dartfrog:sky_clean'),
  'auratus.swim': SWIM(4.0, 'auratus', 'auratus'),
  'bumblebee.swim': SWIM(2.8, 'melano', 'bumblebee'),
  'reedfrog.swim': SWIM(3.0, 'heterixalus', 'reedfrog'),
  // The fire-bellied toad has its own swimming scan (art-src/raw/toad_swim_mesh.glb, the owner's, 6 Oct 2026): flat warty body, eyes on
  // top of the head, forelegs forward, hind legs trailing in a flat V. `skel`: its joints, measured on the scan as the bake sees it (turned
  // by `rotY` so the head is +z, then levelled: tools/rig/limb-centre.mjs, tools/rig/joints-view.mjs with LEVEL=1); the right side is
  // measured, the left mirrors it (the scan is symmetric to 0.01). `split`: the trunk is two bones (T4, spine and spineB).
  // `conform` (owner, 6 Oct 2026, after a swimming body derived from the sitting one looked terrible: "adapt the swimming body we have to match dimensions"): the scan's
  // girth is taken to the sitting toad's (conformTo below). The same scan will also serve the European edible/common frog, reskinned (the owner), at its own size.
  'toad.swim': { conform: 'toad', src: 'toad_swim_mesh', rotY: -90, cmPerUnit: 3.285, tris: [30000, 9000], texture: 1024, skinPasses: 120, paint: 'bombina', eyes: 'toad', skel: 'TOAD', vent: -0.40, trunkZ: [-0.2, 0.4], sHalf: 0.2, eye: { c: [0.086, 0.0, 0.76], r: 0.065 }, eyeCm: { c: [0.50, 1.63, 1.30], r: 0.27, axis: [0.62, 0.55, 0.56], dome: true }, split: true },
  // The European common frog (Rana temporaria, owner, 7 Oct 2026): ONE body for every pose, from the owner's drop (an image-to-3D model of their reference, limbs apart),
  // corrected against the owner's proportion table (head width, head depth, femur, foot, tympanum: .agents/skin/eu1007/GATE-3.md, correct.py) and scaled x2 to the scans'
  // usual size. SVL 7 cm (1.012 units). `skel`: the joints measured on mm grids and carried through the correction, levelled as the bake levels it
  // (tools/rig/commonfrog-swim-joints.json). paint: a stand-in until the owner's texture (colours from the reference images) is baked onto the atlas (set-texture.mjs).
  'commonfrog.swim': { src: 'commonfrog_swim_mesh', cmPerUnit: 6.917, tris: [30000, 9000], texture: 1024, skinPasses: 120, paint: 'bombina', eyes: 'commonfrog', skel: 'COMMONFROG', vent: -0.19, trunkZ: [-0.15, 0.42], sHalf: 0.2, eye: { c: [0.088, 0.028, 0.658], r: 0.05 }, eyeCm: { c: [0.642, 1.899, 2.003], r: 0.40, axis: [0.90, 0.15, 0.41] }, split: true },   // (eyeCm: the eye sphere fitted to the body's dome, its axis mostly sideways, a little up and forward (the cap's middle, 0.69/0.58/0.43, put the pupil too high against the reference's side view); 7 Oct, the owner: "pupils wrong compared to ref img")
  // The harlequin poison frog (Oophaga histrionica, the owner's Meshy scan of 8 Oct 2026, art-src/raw/harlequin_mesh.glb): ONE body for every pose, as the common frog's. The scan lies sprawled, the limbs apart (the
  // left hind leg stretched out behind, the right one folded in a Z, the left hand reaching ahead, the right one beside the chest); 3.3 cm snout to vent (mean 32.9 mm, the species' size on the Species board)
  // = 1.22 scan units. `center`: the trunk's x taken to 0 first (the scan is off the axis, +0.134). `skel`: the joints in tools/rig/harlequin-swim-joints.json (measured on slices and zoomed
  // views of the levelled, centred scan, the hind legs fitted with tools/rig/fit-chain.mjs). `paint`: a stand-in until the owner's scan colours and the true black-and-orange pattern are baked on.
  'harlequin.swim': { src: 'harlequin_sym_mesh', center: 0.060, cmPerUnit: 2.705, tris: [30000, 9000], texture: 1024, skinPasses: 120, paint: 'bombina', eyes: 'harlequin', skel: 'HARLEQUIN', vent: -0.42, trunkZ: [-0.3, 0.5], sHalf: 0.22, eye: { c: [0.115, 0.117, 0.635], r: 0.07 }, split: true },
  // The red-eyed tree frog does not swim, but it leaps, and its own scan sits with its hind legs folded in one lump: in the air it is
  // drawn in this body (Animals.draw, util/gait.js leapStroke), painted as itself.
  // The red-eyed tree frog does not swim: this is its CLIMBING and WALKING body (the stroke-posed, limbs-apart variant the game loads as `<id>.swim`), made from the
  // owner's walking scan (art-src/raw/redeye_walk_mesh.glb, 6 Oct 2026: a slender red-eye mid-step, limbs unfolded) as it is, no conform. 22 bones: the toad swimmer's 18
  // + a scapula and a fingers bone a side. `skel`: the joints in tools/rig/redeye-walk-joints.json (measured with tools/rig/limb-axes.mjs). `center`: the trunk's x to 0
  // (the scan is off the axis). `headRoll`: the scan's head is rolled about the body axis; the head bone is turned back through its skeleton (tools/rig/neutral.mjs,
  // tools/rig/neutral-check.mjs: the roll fitted from the eye bumps, -10.2 deg). `neutral: [hind, arm]` (not set: tried 6 Oct, see reports/REDEYE-plan.md) poses the whole scan into a point of the
  // crawl cycle through its skeleton first. `eye`: the bump, scan units after the roll (right eye; the shader mirrors it).
  'redeye.swim': { src: 'redeye_walk_mesh', rotY: 128, center: 0.274, headRoll: -10.2, cmPerUnit: 3.55, tris: [30000, 9000], texture: 1024, skinPasses: 120, paint: 'callidryas', eyes: 'redeye', skel: 'REDEYE', neutral: [0.45, 0.12, 'redeye'], vent: -0.45, trunkZ: [-0.2, 0.5], sHalf: 0.22, eye: { c: [0.129, 0.09, 0.725], r: 0.12 }, split: true,   // (c.x was 0.14 on the scan's own head; the symmetrized head's bumps sit 0.011 nearer the midline)
    // (the walking scan's hind legs lie against each other and the left one runs across the midline: no x-sign rule, distances in radii, a bone does not take skin that faces into its axis, and the diffused weights may only join a bone to its parent and children; the joints and per-side radii fitted to the skin, tools/rig/fit-chain.mjs)
    bind: { side: false, norm: false, sigma: 0.03, facing: 0.15, mask: 1 }, cut: true, graft: true, symHead: true },
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
const mirror = (R, base) => { const j = { ...base }; for (const [k, v] of Object.entries(R)) { j[k + 'R'] = v; j[k + 'L'] = [-v[0], v[1], v[2]]; } return j; };
const TOAD_SWIM_SKELETON = {
  joints: mirror({ hip: [0.10, -0.13, -0.27], knee: [0.37, -0.05, -0.28], heel: [0.41, 0.02, -0.71], ankle: [0.64, 0.09, -0.85], toe: [0.79, 0, -0.97],
    shoulder: [0.17, -0.13, 0.50], elbow: [0.31, -0.26, 0.52], wrist: [0.32, -0.33, 0.66], finger: [0.41, -0.37, 0.80] },
  { vent: [0, -0.10, -0.40], mid: [0, -0.12, -0.02], chest: [0, -0.13, 0.40], neck: [0, -0.12, 0.55], snout: [0, -0.04, 0.97] }),
  radius: { pelvis: 0.2, spine: 0.2, head: 0.17, thigh: 0.09, shin: 0.07, foot: 0.05, toes: 0.03, arm: 0.06, forearm: 0.05, hand: 0.035 },
};
// (PASSES=<n>: the red-eye's four-bone diffusion passes, for trying how far the weights may spread over its fused folds)
const REDEYE_JOINTS = JSON.parse(fs.readFileSync(new URL('./rig/redeye-walk-joints.json', import.meta.url), 'utf8'));
const { mid2: _mid2, ...REDEYE_J } = REDEYE_JOINTS.joints;       // (the split's mid2 is the middle of mid and chest, as for the toad)
const CF_JOINTS = JSON.parse(fs.readFileSync(new URL('./rig/commonfrog-swim-joints.json', import.meta.url), 'utf8'));
const { mid2: _cfmid2, ...CF_J } = CF_JOINTS.joints;
const HQ_JOINTS = JSON.parse(fs.readFileSync(new URL('./rig/harlequin-swim-joints.json', import.meta.url), 'utf8'));
const { mid2: _hqmid2, ...HQ_J } = HQ_JOINTS.joints;
const SKELS = { TOAD: TOAD_SWIM_SKELETON, REDEYE: { joints: REDEYE_J, radius: REDEYE_JOINTS.radius }, COMMONFROG: { joints: CF_J, radius: CF_JOINTS.radius }, HARLEQUIN: { joints: HQ_J, radius: HQ_JOINTS.radius } };
if (process.env.PASSES) JOBS['redeye.swim'].skinPasses = +process.env.PASSES;
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
function analyse(src, job = {}) {
  const pos = Float32Array.from(src.pos), n = pos.length / 3;
  // 0. a scan that does not face +z: turned about y (as bake-creature's rotY)
  if (job.rotY) { const a = job.rotY * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); for (let i = 0; i < n; i++) { const x = pos[i * 3], z = pos[i * 3 + 2]; pos[i * 3] = x * ca + z * sa; pos[i * 3 + 2] = -x * sa + z * ca; } }
  // 0b. a scan placed off the axis (the red-eyed tree frog's walking scan): its trunk's x (`job.center`, scan units after rotY) taken to 0 first, so the trunk windows below find the trunk
  if (job.center) for (let i = 0; i < n; i++) pos[i * 3] -= job.center;
  // 1. level: a least-squares line y = a + b z through the trunk, rotated about x until it is flat.
  let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
  for (let i = 0; i < n; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const b = (m * szy - sz * sy) / (m * szz - sz * sz), th = Math.atan(b), c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1], z = pos[i * 3 + 2]; pos[i * 3 + 1] = y * c - z * s; pos[i * 3 + 2] = y * s + z * c; }
  // 2. the trunk's measures: snout, vent, belly, back.
  let zs = -1e9; for (let i = 0; i < n; i++) zs = Math.max(zs, pos[i * 3 + 2]);
  const zv = job.vent ?? -0.35, [tz0, tz1] = job.trunkZ ?? [-0.2, 0.7];
  const ty = [], trunkIdx = []; for (let i = 0; i < n; i++) { const x = pos[i * 3], z = pos[i * 3 + 2]; if (Math.abs(x) < 0.25 && z > tz0 && z < tz1) { ty.push(pos[i * 3 + 1]); trunkIdx.push(i); } }
  const yb = quant(ty, 0.02), yt = quant(ty, 0.98);
  // 3. per vertex: trunk or limb, and where along it.
  const U = new Float32Array(n), H = new Float32Array(n), S = new Float32Array(n), LEG = new Uint8Array(n), LEGT = new Float32Array(n);
  let xmax = 0; for (let i = 0; i < n; i++) xmax = Math.max(xmax, Math.abs(pos[i * 3]));
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], ax = Math.abs(x);
    const arm = !job.skel && z > 0.28 && z < 0.66 && ax > 0.3;
    const hind = !job.skel && ((z < -0.28 && ax > 0.15) || (z < -0.1 && ax > 0.34));      // (a job with its own skeleton: from its binding, legsFromBones)
    if (arm) { LEG[i] = x < 0 ? 1 : 2; LEGT[i] = clamp01((ax - 0.3) / (xmax - 0.3)); }
    else if (hind) { LEG[i] = x < 0 ? 3 : 4; LEGT[i] = clamp01(Math.hypot(ax - 0.22, z + 0.25) / 0.95); }
    U[i] = clamp01((zs - z) / (zs - zv));
    H[i] = clamp01((y - yb) / (yt - yb));
    S[i] = clamp01(ax / (job.sHalf ?? 0.3));
  }
  return { pos, n, U, H, S, LEG, LEGT, zs, zv, yb, yt, trunkIdx, th };
}

// Which limb a vertex belongs to (rig ids 1 … 4: arms L and R, hind legs L and R, 0 the trunk) and how far along it (0 at the root, 1 at the
// tip), read off the bone it is bound to: for a scan whose limbs the old fixed boxes do not describe.
function legsFromBones(A, bones, bind) {
  const chains = new Map();
  for (let b = 0; b < bones.length; b++) if (bones[b].limb) { const c = chains.get(bones[b].limb) ?? []; c.push(b); chains.set(bones[b].limb, c); }
  const len = bones.map((b) => Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]));
  const cum = new Map(), tot = new Map();
  for (const [l, c] of chains) { let a = 0; for (const b of c) { cum.set(b, a); a += len[b]; } tot.set(l, a); }
  for (let i = 0; i < A.n; i++) {
    const b = bind.idx[i * 2], l = bones[b].limb;
    if (!l) continue;
    const h = bones[b].head, d = [bones[b].tail[0] - h[0], bones[b].tail[1] - h[1], bones[b].tail[2] - h[2]];
    const t = clamp01(((A.pos[i * 3] - h[0]) * d[0] + (A.pos[i * 3 + 1] - h[1]) * d[1] + (A.pos[i * 3 + 2] - h[2]) * d[2]) / (len[b] * len[b]));
    A.LEG[i] = l; A.LEGT[i] = clamp01((cum.get(b) + t * len[b]) / tot.get(l));
  }
}

// `conform: '<id>'` (owner, 6 Oct 2026: "adapt the swimming body we have to match dimensions"): the scan's girth taken to that baked body's, both measured the same
// way (tools/rig/body-dims.mjs). The skin is inflated along its own smoothed normals by a thickness that varies smoothly over the surface: across and up for the
// trunk (the two bodies' widths and heights, station by station) and all round for a limb (the ratio of the limb radii, at most `conformCap`), a vertex taking the
// blend of what the bones that carry it ask for, and the whole field smoothed over the mesh so no join tears. (Scaling the vertices about the axes instead
// tore the limb roots off the flank.) The bones, joints and skin weights stay as measured on the thin scan; `A.conform` carries what the eyes and the bone radii need.
async function conformTo(A, bones, bind, idx, job, k) {
  const { bodyDims, measure } = await import('./rig/body-dims.mjs');
  const ref = await bodyDims(job.conform), cm = k * 100, n = A.n, TR = ['pelvis', 'spine', 'spineB', 'head'];
  const dom = Array.from({ length: n }, (_, i) => (bind.w[i] >= 0.5 ? bind.idx[i * 2] : bind.idx[i * 2 + 1]));
  const P = Array.from({ length: n }, (_, i) => [A.pos[i * 3] * cm, A.pos[i * 3 + 1] * cm, A.pos[i * 3 + 2] * cm]);
  const me = measure(P, dom, bones.map((b) => ({ name: b.name, head: b.head.map((v) => v * cm), tail: b.tail.map((v) => v * cm) })));
  const cap = job.conformCap ?? 1.8, avg = (d, base) => { const v = ['L', 'R'].map((s) => d.bones[base + s]?.r75).filter(Boolean); return v.length ? v.reduce((a, c) => a + c) / v.length : null; };
  const limb = {}, limbD = {};
  for (const base of ['thigh', 'shin', 'foot', 'toes', 'arm', 'forearm', 'hand']) { const r = avg(ref, base), m = avg(me, base); limb[base] = r && m ? Math.max(1, Math.min(cap, r / m)) : 1; limbD[base] = r && m ? (limb[base] - 1) * m / cm : 0; }
  // the trunk's stations: the ratios, outliers (thigh roots in a station) pulled in by a three-tap blend, a null station by its neighbour
  const clampT = (v) => Math.max(1, Math.min(job.conformTrunkCap ?? 2.4, v)), pick = (f) => me.trunk.map((st, i) => (st && ref.trunk[i] ? clampT(f(ref.trunk[i], st)) : null));
  const fill = (a) => a.map((v, i) => v ?? a[i - 1] ?? a.find((x) => x != null)), sm = (a) => a.map((v, i) => (0.25 * (a[i - 1] ?? v) + 0.5 * v + 0.25 * (a[i + 1] ?? v)));
  const fx = sm(fill(pick((r, m) => r.halfWidth / m.halfWidth))), fy = sm(fill(pick((r, m) => r.height / m.height)));
  const dx = fx.map((f, i) => (f - 1) * (me.trunk[i]?.halfWidth ?? 0.6) / cm), dy = fy.map((f, i) => (f - 1) * (me.trunk[i]?.height ?? 0.8) / 2 / cm);      // (scan units: how far the skin moves out across, and up and down)
  const at = (arr, t) => { const x = Math.max(0, Math.min(arr.length - 1, t * arr.length - 0.5)), i = Math.min(arr.length - 2, Math.floor(x)), f = x - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
  const tOf = (z) => Math.max(0, Math.min(1, (me.z1 - z * cm) / (me.z1 - me.z0)));
  // smoothed normals and the mesh's neighbours
  const nbr = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { nbr[idx[t + a]].push(idx[t + b]); nbr[idx[t + b]].push(idx[t + a]); }
  let nor = normals(A.pos, idx);
  for (let it = 0; it < 4; it++) { const m = new Float32Array(n * 3); for (let i = 0; i < n; i++) { let x = nor[i * 3], y = nor[i * 3 + 1], z = nor[i * 3 + 2]; for (const j of nbr[i]) { x += nor[j * 3]; y += nor[j * 3 + 1]; z += nor[j * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; m[i * 3] = x / l; m[i * 3 + 1] = y / l; m[i * 3 + 2] = z / l; } nor = m; }
  // what each vertex's bones ask for
  let D = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = tOf(A.pos[i * 3 + 2]), nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    for (const [b, w] of [[bind.idx[i * 2], bind.w[i]], [bind.idx[i * 2 + 1], 1 - bind.w[i]]]) {
      if (w <= 0) continue;
      const nm = bones[b].name;
      if (TR.includes(nm)) { D[i * 3] += w * nx * at(dx, t); D[i * 3 + 1] += w * ny * at(dy, t); }
      else { const d = limbD[nm.replace(/[LR]$/, '')] ?? 0; D[i * 3] += w * nx * d; D[i * 3 + 1] += w * ny * d; D[i * 3 + 2] += w * nz * d; }
    }
  }
  // smoothed over the surface, so the thickness passes gently from the trunk into a limb and nothing tears at the roots
  for (let it = 0; it < (job.conformSmooth ?? 24); it++) { const m = new Float32Array(n * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { let s = D[i * 3 + c] * 2; for (const j of nbr[i]) s += D[j * 3 + c]; m[i * 3 + c] = s / (2 + nbr[i].length); } D = m; }
  const P0 = Float32Array.from(A.pos);                                       // (the thin scan, to find where a point on it goes)
  for (let i = 0; i < n * 3; i++) A.pos[i] += D[i];
  // the belly is y = 0 again (the quantiles of the same trunk vertices)
  A.yb = quant(A.trunkIdx.map((i) => A.pos[i * 3 + 1]), 0.02); A.yt = quant(A.trunkIdx.map((i) => A.pos[i * 3 + 1]), 0.98);
  const near = (p) => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const dd = (P0[i * 3] - p[0]) ** 2 + (P0[i * 3 + 1] - p[1]) ** 2 + (P0[i * 3 + 2] - p[2]) ** 2; if (dd < bd) { bd = dd; b = i; } } return b; };
  A.conform = {
    limb, fx, fy, D,
    point: (p) => { const i = near(p); return [p[0] + D[i * 3], p[1] + D[i * 3 + 1], p[2] + D[i * 3 + 2]]; },        // (a point on the skin: moved with its nearest vertex; call before A.pos is not needed: it is the moved scan)
    radius: (nm) => (TR.includes(nm) ? (fx.reduce((a, c) => a + c) + fy.reduce((a, c) => a + c)) / (2 * fx.length) : limb[nm.replace(/[LR]$/, '')] ?? 1),
    mean: (p) => { const t = tOf(p[2]); return (at(fx, t) + at(fy, t)) / 2; },
  };
  console.log(`  conform to ${job.conform}: trunk out ${dx.map((v) => (v * cm).toFixed(2)).join(' ')} cm across, ${dy.map((v) => (v * cm).toFixed(2)).join(' ')} up; limbs ${Object.entries(limb).map(([a, v]) => `${a} ${v.toFixed(2)}`).join(', ')}`);
}

// `rig`: (spine, leg / 8, legT, material id / 8) and `skin`: (bone 0 / 32, bone 1 / 32, bone 0's weight, 0), as tools/bake-creature.mjs
// writes them (render/creatures/glb.js bakedRig reads them back).
// T4: the trunk as two bones. Bone indices from 2 up move one place (spineB is bone 2); the old spine's share at a vertex goes to spine
// and spineB by its place along the old spine, a linear ramp (spineRamp). `sp`: { head, ax } the old spine in the baked frame (m).
function splitSpine(f4, pos, sp) {
  const n = pos.length / 3, ns = new Float32Array(n * 4), nx = new Float32Array(n * 4), ax2 = sp.ax[0] ** 2 + sp.ax[1] ** 2 + sp.ax[2] ** 2;
  for (let i = 0; i < n; i++) {
    const t = ((pos[i * 3] - sp.head[0]) * sp.ax[0] + (pos[i * 3 + 1] - sp.head[1]) * sp.ax[1] + (pos[i * 3 + 2] - sp.head[2]) * sp.ax[2]) / ax2, f = spineRamp(t);
    const W = new Map(), a = f4.skin.subarray(i * 4, i * 4 + 4), b = f4.skinx.subarray(i * 4, i * 4 + 4);
    for (const [bi, w] of [[a[0], a[2]], [a[1], a[3]], [b[0], b[2]], [b[1], b[3]]]) { const o = Math.round(bi * 32); if (w > 0) W.set(o, (W.get(o) ?? 0) + w); }
    const nw = new Map();
    for (const [o, w] of W) { if (o === 1) { nw.set(1, w * (1 - f)); nw.set(2, w * f); } else nw.set(o >= 2 ? o + 1 : o, w); }
    const top = [...nw].filter(([, w]) => w > 0).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4); while (top.length < 4) top.push([top[0][0], 0]);
    const sum = top.reduce((q, [, w]) => q + w, 0), w4 = top.map(([, w]) => w / sum);
    ns[i * 4] = top[0][0] / 32; ns[i * 4 + 1] = top[1][0] / 32; ns[i * 4 + 2] = w4[0]; ns[i * 4 + 3] = w4[1];
    nx[i * 4] = top[2][0] / 32; nx[i * 4 + 1] = top[3][0] / 32; nx[i * 4 + 2] = w4[2]; nx[i * 4 + 3] = w4[3];
  }
  return { skin: ns, skinx: nx };
}
async function writeGlb(id, level, pos, nor, col, idx, rig, skin, split = null) {
  const doc = new Document(), buf = doc.createBuffer();
  let f4 = skinFour(pos, idx, skin, SKIN_PASSES.swim);   // (SK1: four bones a vertex)
  if (split) f4 = splitSpine(f4, pos, split);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf))
    .setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(rig).setBuffer(buf))
    .setAttribute('_SKIN', doc.createAccessor().setType('VEC4').setArray(f4.skin).setBuffer(buf))
    .setAttribute('_SKINX', doc.createAccessor().setType('VEC4').setArray(f4.skinx).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0));
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc);
  return { file, bytes: fs.statSync(file).size };
}

// The same body with UVs and a base-colour texture (a job with `texture`): `g` { pos, nor, uv, idx } on the unwrapped vertices, `rig` and `skin` per
// vertex as writeGlb takes them. `image`: the WebP on the detailed level, none on the coarse one (the game draws both with the detailed file's material).
async function writeTextured(id, level, g, rig, skin, image, split = null, passes = SKIN_PASSES.swim, par = null) {
  const doc = new Document(), buf = doc.createBuffer();
  let f4 = skinFour(g.pos, g.idx, skin, passes, par);
  if (split) f4 = splitSpine(f4, g.pos, split);
  const mat = doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0);
  if (image) { doc.createExtension(EXTTextureWebP).setRequired(true); mat.setBaseColorTexture(doc.createTexture(`${id}_color`).setImage(image).setMimeType('image/webp')); }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.nor).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buf))
    .setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(rig).setBuffer(buf))
    .setAttribute('_SKIN', doc.createAccessor().setType('VEC4').setArray(f4.skin).setBuffer(buf))
    .setAttribute('_SKINX', doc.createAccessor().setType('VEC4').setArray(f4.skinx).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.idx).setBuffer(buf))
    .setMaterial(mat);
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 16, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
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
  if (job.parked && !want.includes(id)) continue;
  // The texel painter at vertex resolution (no granules, no occlusion), with the eye known, so masks round the eye come out.
  const [pmod, parg] = job.paint.split('#');
  const PM = await import(`./paint/${pmod}.mjs`);
  const tex = parg ? PM.texelFor(parg) : PM.texel;
  const sc0 = job.cmPerUnit / 3.3;
  let eyeC = [0.48 * sc0, 1.18 * sc0, 1.6 * sc0], eyeR = 0.3 * sc0;
  const paint = (v) => tex({ ...v, ao: 0, noGran: true, eyeR, eyeD: Math.hypot(Math.abs(v.x) - eyeC[0], v.y - eyeC[1], v.z - eyeC[2]) });
  const SKL = job.skel ? SKELS[job.skel] : SWIM_SKELETON;
  cache[job.src] ??= analyse(await readScan(job.src), job);
  const A = cache[job.src], src = await readScan(job.src);
  // the skeleton and the skin's binding, on the full scan (scan units): every level of detail takes its vertices' binding from it
  // (bound as 17 bones; a split trunk shares the old spine's weight after the smoothing, writeGlb)
  const bones = frogBones(SKL.joints);
  const maskPar = (process.env.BIND ? JSON.parse(process.env.BIND) : job.bind ?? {}).mask ? bones.map((b) => bones.findIndex((x) => x.name === b.parent)) : null;
  if (maskPar) maskPar.extra = new Set(bones.flatMap((b, i) => (/^arm/.test(b.name) && maskPar[i] >= 0 && /^scapula/.test(bones[maskPar[i]].name) ? [`${i},${maskPar[maskPar[i]]}`] : [])));
  {
    const bo = process.env.BIND ? JSON.parse(process.env.BIND) : job.bind ?? {};
    A.bind ??= bindCapsules(A.pos, bones, { radius: SKL.radius, tris: src.idx, smooth: 6, ...bo, ...(bo.facing ? { normals: vertexNormals(A.pos, src.idx) } : {}) });
  }
  const k = job.cmPerUnit / 100;
  // The fused contacts of the scan cut and capped (`cut`, tools/rig/seam-cut.mjs): done once on the binding's dominant bones, the rim vertices then follow their own bone alone
  if (job.cut && process.env.CUT !== '0') {
    if (!A.cutIdx) {
      const dom = new Int16Array(A.n); for (let i = 0; i < A.n; i++) dom[i] = A.bind.w[i] >= 0.5 ? A.bind.idx[i * 2] : A.bind.idx[i * 2 + 1];
      const r = cutSeams({ pos: A.pos, idx: src.idx, dom, bones, radius: SKL.radius, pairs: new Set((process.env.CUTPAIRS ?? 'thigh,shin;shin,foot;foot,toes').split(';')) });
      for (const [v, b] of r.pure) { A.bind.idx[v * 2] = b; A.bind.idx[v * 2 + 1] = b; A.bind.w[v] = 1; }
      A.cutIdx = r.idx; console.log(`  seam cut: ${r.stats.facesRemoved} bridging faces removed, ${r.stats.loops} rims, ${r.stats.caps} caps (${r.stats.capTris} triangles), ${r.pure.size} rim vertices pure; `);
      console.log('  pieces before:', r.stats.before.join(' | ')); console.log('  pieces after: ', r.stats.pieces.join(' | '));
    }
    src.idx = A.cutIdx;
  }
  // A scan whose head is rolled (the red-eye's): taken back to neutral through the skeleton, the head bone turned about its own axis by `headRoll` deg, each vertex by its (smoothed) weight on it
  if (job.headRoll && !A.rolled) {
    const hb = bones.find((b) => b.name === 'head'), w = headWeight(bones, A.bind, A.n, src.idx, 40);
    A.pos = rollHead(A.pos, w, hb.head, hb.tail.map((v, i) => v - hb.head[i]), job.headRoll); A.rolled = true;
  }
  // The body posed ONCE into the gait's neutral pose through its skeleton (`neutral: [hind, arm]`, util/climb.js neutralStroke), so it rests in a pose the runtime's poses are
  // small turns from; the transition's own stretch is printed (tools/rig/neutral.mjs: it says whether bones, weights and keys make sense together).
  if ((job.neutral || process.env.NEUTRAL) && !A.neutralised) {
    const J = { ...SKL.joints, mid2: SKL.joints.mid.map((v, i) => (v + SKL.joints.chest[i]) / 2) };
    const b22 = frogBones(J).map((b) => ({ ...b, r: SKL.radius[b.name.replace(/[LR]$/, '').replace('spineB', 'spine')] ?? 0.05 }));
    const sk2 = new Float32Array(A.n * 4); for (let i = 0; i < A.n; i++) { sk2[i * 4] = A.bind.idx[i * 2] / 32; sk2[i * 4 + 1] = A.bind.idx[i * 2 + 1] / 32; sk2[i * 4 + 2] = A.bind.w[i]; }
    let f4 = skinFour(A.pos, src.idx, sk2, job.skinPasses ?? SKIN_PASSES.swim, maskPar);
    const sh = (a) => { const o = Float32Array.from(a); for (let i = 0; i < o.length; i += 4) for (const q of [0, 1]) { const b = Math.round(o[i + q] * 32); o[i + q] = (b >= 2 ? b + 1 : b) / 32; } return o; };
    let scanPos = Float32Array.from(A.pos);
    const res = poseToStroke(A.pos, { skin: sh(f4.skin), skinx: sh(f4.skinx) }, b22, (process.env.NEUTRAL === 'scan' ? scanStroke(SKL.joints) : /^redeye:/.test(process.env.NEUTRAL ?? '') ? neutralStroke(...process.env.NEUTRAL.split(':').slice(1).map(Number), 'redeye') : neutralStroke(...(process.env.NEUTRAL ? process.env.NEUTRAL.split(',').map(Number) : job.neutral))), src.idx);
    { let md = 0, mi = 0; for (let i = 0; i < A.pos.length; i++) { const d = Math.abs(res.pos[i] - A.pos[i]); if (d > md) { md = d; mi = i; } } console.log(`  neutral pose moved a vertex by up to ${md.toFixed(3)} scan units`);
      if (process.env.NEUTRAL === 'scan') { const sh0 = sh(f4.skin), per = {}; for (let i = 0; i < A.n; i++) { const b = Math.round(sh0[i * 4] * 32), d = Math.hypot(res.pos[i * 3] - A.pos[i * 3], res.pos[i * 3 + 1] - A.pos[i * 3 + 1], res.pos[i * 3 + 2] - A.pos[i * 3 + 2]); per[b] = Math.max(per[b] ?? 0, d); } console.log('  by first bone (max move):', b22.map((bb, ix) => `${bb.name} ${(per[ix >= 2 ? ix + 1 : ix] ?? 0).toFixed(3)}`).join(', ')); } }
    // The fused right hind leg replaced by the mirror of the clean left one (`graft`, tools/rig/leg-graft.mjs): the copy's vertices appended, bound to the right bones, the right leg's
    // bones the left's mirrored (the skeleton must be the skin's): the per-vertex arrays follow
    // One graft taken into the bake's arrays: the copy's vertices appended (bound to the mirrored bones: `swap`), the per-vertex arrays grown, the shape relaxed over `rings` round the
    // stitch band, the four-bone weights again on the grown mesh (a vertex without weights does not move)
    const nameOf = (b) => bones[b]?.name ?? '', dom0 = (i) => (A.bind.w[i] >= 0.5 ? A.bind.idx[i * 2] : A.bind.idx[i * 2 + 1]);
    const swapLR = (b) => { const nm = nameOf(b), o = nm.replace(/L$/, '#').replace(/R$/, 'L').replace(/#$/, 'R'); const k = bones.findIndex((x) => x.name === o); return k >= 0 ? k : b; };
    const takeGraft = (g, rings) => {
      const n0 = A.n, n1 = g.pos.length / 3, bi = new Uint8Array(n1 * 2), bw = new Float32Array(n1); bi.set(A.bind.idx.subarray(0, n0 * 2)); bw.set(A.bind.w.subarray(0, n0));
      for (let k = n0; k < n1; k++) { const o = g.src[k]; bi[k * 2] = swapLR(A.bind.idx[o * 2]); bi[k * 2 + 1] = swapLR(A.bind.idx[o * 2 + 1]); bw[k] = A.bind.w[o]; }
      A.bind = { idx: bi, w: bw };
      const grow = (arr, C) => { const o = new C(n1); o.set(arr.subarray(0, n0)); return o; };
      A.U = grow(A.U, Float32Array); A.H = grow(A.H, Float32Array); A.S = grow(A.S, Float32Array); A.LEG = grow(A.LEG, Uint8Array); A.LEGT = grow(A.LEGT, Float32Array);
      const clamp = (v) => Math.max(0, Math.min(1, v));
      if (rings > 0) relaxRings(g.pos, g.idx, g.band, rings, 10, 0.6);
      for (let k = n0; k < n1; k++) { const x = g.pos[k * 3], y = g.pos[k * 3 + 1], z = g.pos[k * 3 + 2]; A.U[k] = clamp((A.zs - z) / (A.zs - A.zv)); A.H[k] = clamp((y - A.yb) / (A.yt - A.yb)); A.S[k] = clamp(Math.abs(x) / (job.sHalf ?? 0.3)); }
      const sc2 = new Float32Array(g.pos.length); sc2.set(scanPos); sc2.set(g.pos.subarray(n0 * 3), n0 * 3); scanPos = sc2;
      res.pos = g.pos; src.idx = g.idx; A.n = n1; A.cutIdx = g.idx;
      const sk3 = new Float32Array(n1 * 4); for (let i = 0; i < n1; i++) { sk3[i * 4] = bi[i * 2] / 32; sk3[i * 4 + 1] = bi[i * 2 + 1] / 32; sk3[i * 4 + 2] = bw[i]; }
      f4 = skinFour(g.pos, g.idx, sk3, job.skinPasses ?? SKIN_PASSES.swim, maskPar);
    };
    // The fused right hind leg replaced by the mirror of the clean left one (`graft`, tools/rig/leg-graft.mjs); the right leg's bones the left's mirrored (the skeleton must be the skin's)
    if (job.graft && process.env.GRAFT !== '0') {
      const reL = /^(thigh|shin|foot|toes)L$/, reR = /^(thigh|shin|foot|toes)R$/;
      // (the copy is anchored at the right hip joint the scan measured: the mirrored left hip moved onto it. The rims' centres differ with how each side's leg set was cut, and the first version
      // followed them: the right hip came out 0.11 forward of where it is, and the hip muscle 3.7 % longer than the left one's)
      const tL = res.bones.find((b) => b.name === 'thighL'), tR = res.bones.find((b) => b.name === 'thighR'), jointShift = [tR.head[0] + tL.head[0], tR.head[1] - tL.head[1], tR.head[2] - tL.head[2]];
      const g = graftMirror({ pos: res.pos, idx: src.idx, isFrom: (i) => reL.test(nameOf(dom0(i))), isTo: (i) => reR.test(nameOf(dom0(i))), mirrorX: 0, shift: process.env.GRAFTALIGN === 'rim' ? null : jointShift.map((v) => v * +(process.env.GRAFTK ?? 1)) });
      takeGraft(g, +(process.env.SEAMRINGS ?? 7)); console.log('  mesh after the leg graft:', JSON.stringify(meshCheck(src.idx)));
      // (the right leg's bones are the left's EXACT mirror, so the skeleton and the muscles on it are symmetric; the skin copy sits `g.shift` from there, 1.4 mm at the hip, because a copy at the exact
      // mirror position pinches the thigh root into a neck: BONES=skin puts the bones where the skin is, which leaves the hip muscle 4-7 % different)
      const bs = process.env.GRAFTBONES === 'skin' ? g.shift : [0, 0, 0];
      for (const nm of ['thigh', 'shin', 'foot', 'toes']) { const L = res.bones.find((b) => b.name === nm + 'L'), R = res.bones.find((b) => b.name === nm + 'R'); R.head = [-L.head[0] + bs[0], L.head[1] + bs[1], L.head[2] + bs[2]]; R.tail = [-L.tail[0] + bs[0], L.tail[1] + bs[1], L.tail[2] + bs[2]]; }
      console.log(`  leg graft: ${g.stats.removedFaces} faces of the right leg removed, ${g.stats.copiedFaces} copied from the left, ${g.stats.bridgeFaces} stitched (rims ${g.stats.holeRim} / ${g.stats.patchRim}), shifted ${g.stats.shift}`);
    }
    // The head made symmetric (`symHead`): the scan's head midline is off the trunk's axis (a line x = a + b z over the head: measured from the head's extents slice by slice) and its two eyes
    // differ (the right bump is the larger, the one the eye fit is of). The head's smoothed weight shears it onto x = 0 (the bisect plane), the left half is removed and the right half
    // mirrored into its place, the seam stitched and relaxed; the bone weights go with the copies.
    if (job.symHead && process.env.SYMHEAD !== '0') {
      const hbI = bones.findIndex((b) => b.name === 'head'), isHead = (i) => dom0(i) === hbI, zS = [], cS = [];
      for (let z0 = 0.62; z0 < 1.0; z0 += 0.04) { let lo = 9, hi = -9; for (let i = 0; i < A.n; i++) if (isHead(i) && res.pos[i * 3 + 2] >= z0 && res.pos[i * 3 + 2] < z0 + 0.04) { lo = Math.min(lo, res.pos[i * 3]); hi = Math.max(hi, res.pos[i * 3]); } if (hi > lo) { zS.push(z0 + 0.02); cS.push((lo + hi) / 2); } }
      const mz = zS.reduce((a, v) => a + v, 0) / zS.length, mc = cS.reduce((a, v) => a + v, 0) / cS.length;
      let sxz = 0, szz = 0; for (let i = 0; i < zS.length; i++) { sxz += (zS[i] - mz) * (cS[i] - mc); szz += (zS[i] - mz) ** 2; }
      const slope = sxz / szz, off = mc - slope * mz, hw = headWeight(bones, A.bind, A.n, src.idx, 30);
      for (let i = 0; i < A.n; i++) res.pos[i * 3] -= hw[i] * (off + slope * res.pos[i * 3 + 2]);
      const g = graftMirror({ pos: res.pos, idx: src.idx, isFrom: (i) => isHead(i) && res.pos[i * 3] >= 0, isTo: (i) => isHead(i) && res.pos[i * 3] < 0, mirrorX: 0 });
      takeGraft(g, +(process.env.HEADRINGS ?? 6)); console.log('  mesh after the head graft:', JSON.stringify(meshCheck(src.idx)));
      console.log(`  head symmetrized: midline x = ${off.toFixed(3)} + ${slope.toFixed(3)} z over z ${zS[0].toFixed(2)}..${zS[zS.length - 1].toFixed(2)}, ${g.stats.removedFaces} faces of the left half removed, ${g.stats.copiedFaces} copied from the right, ${g.stats.bridgeFaces} stitched (rims ${g.stats.holeRim} / ${g.stats.patchRim})`);
    }
    A.pos = res.pos; A.neutralBones = res.bones; A.neutralised = true;
    // The scan's fused folds, pulled apart by the posing, are sheets now: every face whose edge grew more than `TEAR` times (default 3) is cut, the holes capped, the flaps dropped
    // (tools/rig/seam-cut.mjs, `force`); the baked body keeps no torn skin
    if (job.cut && process.env.CUT !== '0' && process.env.TEAR !== '0') {
      const TEAR = +(process.env.TEAR ?? 3), P0 = A.posRest ?? (A.posRest = null), I = src.idx, nF = I.length / 3, force = new Uint8Array(nF), rest = scanPos;
      for (let f = 0; f < nF; f++) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = I[f * 3 + a], v = I[f * 3 + b], d0 = Math.hypot(rest[u * 3] - rest[v * 3], rest[u * 3 + 1] - rest[v * 3 + 1], rest[u * 3 + 2] - rest[v * 3 + 2]); if (d0 < 0.004) continue; if (Math.hypot(res.pos[u * 3] - res.pos[v * 3], res.pos[u * 3 + 1] - res.pos[v * 3 + 1], res.pos[u * 3 + 2] - res.pos[v * 3 + 2]) / d0 > TEAR) { force[f] = 1; break; } }
      const dom2 = new Int16Array(A.n); for (let i = 0; i < A.n; i++) dom2[i] = A.bind.w[i] >= 0.5 ? A.bind.idx[i * 2] : A.bind.idx[i * 2 + 1];
      const r2 = cutSeams({ pos: res.pos, idx: I, dom: dom2, bones, radius: SKL.radius, force, skipRule: true });
      for (const [v, b] of r2.pure) { A.bind.idx[v * 2] = b; A.bind.idx[v * 2 + 1] = b; A.bind.w[v] = 1; }
      src.idx = r2.idx; A.cutIdx = r2.idx; void P0;
      console.log(`  torn skin: ${r2.stats.facesRemoved} faces stretched more than ${TEAR}x cut, ${r2.stats.caps} caps, ${r2.stats.dropped} faces of flaps dropped; pieces: ${r2.stats.pieces.join(' | ')}`);
      console.log('  open rims after the tear cut:', r2.stats.openRims.join(' | '));
    }
    console.log(`  neutral pose ${process.env.NEUTRAL ?? job.neutral.join('/')}: ${res.stretch.edges} edges, > 1.3x ${(100 * res.stretch.over13 / res.stretch.edges).toFixed(2)} %, > 2x ${(100 * res.stretch.over2 / res.stretch.edges).toFixed(2)} %, worst ${res.stretch.worst.toFixed(2)}x; pairs ${res.stretch.pairs.map(([k, c]) => k + ' ' + c).join(', ')}`);
    // SWEEP=<file.json>: [{ name, legA?, armA?, fcurl?, scap?, trunk? }] poses tried from the scan's pose (the fields not given stay the scan's own), each one's stretch printed with the pairs of bones the stretched edges join; nothing is written
    if (process.env.SWEEP) {
      const scan = scanStroke(SKL.joints), list = JSON.parse(fs.readFileSync(process.env.SWEEP, 'utf8'));
      for (const P of list) {
        const st = { legA: Float32Array.from(P.legA ?? scan.legA), armA: Float32Array.from(P.armA ?? scan.armA), fcurl: P.fcurl ?? scan.fcurl, scap: P.scap ?? [0, 0, 0, 0], trunk: Float32Array.from(P.trunk ?? [0, 0, 0, 0, 0, 0]) };
        const r = poseToStroke(res.pos, { skin: sh(f4.skin), skinx: sh(f4.skinx) }, res.bones.map((bb, ix) => ({ ...bb, r: b22[ix].r })), st, src.idx), e = r.stretch;
        if (process.env.DUMPPOSE && process.env.DUMPPOSE.split(',').includes(P.name)) fs.writeFileSync(`/tmp/pose-${P.name.replace(/[^a-z0-9.=]+/gi, '_')}.json`, JSON.stringify({ pos: [...r.pos].map((v) => +v.toFixed(4)), idx: [...src.idx] }));
        if (process.env.DUMPBAD && P.name === process.env.DUMPNAME) { fs.writeFileSync(process.env.DUMPBAD, JSON.stringify(e.bad)); console.log(e.samples.slice(0, 14).join('\n')); }
        console.log(`  ${String(P.name).padEnd(28)} >1.3x ${(100 * e.over13 / e.edges).toFixed(2).padStart(5)} %  >2x ${(100 * e.over2 / e.edges).toFixed(2).padStart(5)} %  worst ${e.worst.toFixed(1).padStart(5)}x   ${e.pairs.map(([k, c]) => `${k} ${c}`).join(', ')}`);
      }
      process.exit(0);
    }

    console.log(`  neutral pose ${process.env.NEUTRAL ?? job.neutral.join('/')}: ${res.stretch.edges} edges, > 1.3x ${(100 * res.stretch.over13 / res.stretch.edges).toFixed(2)} %, > 2x ${(100 * res.stretch.over2 / res.stretch.edges).toFixed(2)} %, worst ${res.stretch.worst.toFixed(2)}x`);
  }
  if (job.conform && !A.conformed) { await conformTo(A, bones, A.bind, src.idx, job, k); A.conformed = true; }
  if (job.skel && !A.legged) { legsFromBones(A, bones, A.bind); A.legged = true; }
  const zc = (A.zs + A.zv) / 2;
  // FRAME_OUT=<file.json>: the frame this body was baked in (scan -> centred, levelled, shifted, scaled), for a colour source in the same frame (tools/blender/mirror-source.py)
  if (process.env.FRAME_OUT) fs.writeFileSync(process.env.FRAME_OUT, JSON.stringify({ id, rotY: job.rotY ?? 0, center: job.center ?? 0, th: A.th, yb: A.yb, zc, k: job.cmPerUnit / 100 }, null, 1));
  const cm0 = (j) => [+(j[0] * k * 100).toFixed(3), +((j[1] - A.yb) * k * 100).toFixed(3), +((j[2] - zc) * k * 100).toFixed(3)];
  if (job.eye) { const ec = A.conform ? A.conform.point(job.eye.c) : job.eye.c; eyeC = cm0(ec); eyeR = (job.eyeCmR ?? job.eye.r * (A.conform ? A.conform.mean(job.eye.c) : 1) * k * 100); }
  // the trunk split in two (T4): joint mid2 half way along the old spine, the old spine's place in the baked frame for the weights' ramp
  // (a posed body's joints are where the pose put them: read back from the posed bones)
  const JN = (() => { if (!A.neutralBones) return SKL.joints; const B = Object.fromEntries(A.neutralBones.map((b) => [b.name, b])), j = { vent: B.pelvis.head, mid: B.pelvis.tail, chest: B.spineB ? B.spineB.tail : B.spine.tail, neck: B.head.head, snout: B.head.tail };
    for (const sd of ['L', 'R']) Object.assign(j, { ['hip' + sd]: B['thigh' + sd].head, ['knee' + sd]: B['thigh' + sd].tail, ['heel' + sd]: B['shin' + sd].tail, ['ankle' + sd]: B['foot' + sd].tail, ['toe' + sd]: B['toes' + sd].tail,
      ['shoulder' + sd]: B['arm' + sd].head, ['elbow' + sd]: B['arm' + sd].tail, ['wrist' + sd]: B['hand' + sd].head, ['finger' + sd]: B['hand' + sd].tail, ...(B['scapula' + sd] ? { ['scap' + sd]: B['scapula' + sd].head } : {}), ...(B['fingers' + sd] ? { ['fingertip' + sd]: B['fingers' + sd].tail } : {}) });
    return j; })();
  const J18 = job.split ? { ...JN, mid2: JN.mid.map((v, i) => (v + JN.chest[i]) / 2) } : JN;
  const split = job.split ? { head: cm0(JN.mid).map((v) => v / 100), ax: JN.chest.map((v, i) => (v - JN.mid[i]) * k) } : null;
  // Baked frame, metres: origin at the middle of the trunk, belly on y = 0, head towards +z.
  const pos = new Float32Array(A.n * 3);
  for (let i = 0; i < A.n; i++) { pos[i * 3] = A.pos[i * 3] * k; pos[i * 3 + 1] = (A.pos[i * 3 + 1] - A.yb) * k; pos[i * 3 + 2] = (A.pos[i * 3 + 2] - zc) * k; }
  const fullN = normals(pos, src.idx);
  const lod = async (level, target) => {
    const g = simplified(pos, src.idx, target), n = g.pos.length / 3, from = g.from;
    const nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = from ? from[i] : i;
      for (let c = 0; c < 3; c++) nor[i * 3 + c] = from ? fullN[o * 3 + c] : fullN[i * 3 + c];
      const c = paint({ u: A.U[o], x: g.pos[i * 3] * 100, y: g.pos[i * 3 + 1] * 100, z: g.pos[i * 3 + 2] * 100, s: A.S[o], h: A.H[o], leg: A.LEG[o], legT: A.LEGT[o], n: [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]] });
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    const rig = new Float32Array(n * 4), sk = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = from ? from[i] : i;
      rig[i * 4] = A.U[o]; rig[i * 4 + 1] = A.LEG[o] / 8; rig[i * 4 + 2] = A.LEGT[o];
      sk[i * 4] = A.bind.idx[o * 2] / 32; sk[i * 4 + 1] = A.bind.idx[o * 2 + 1] / 32; sk[i * 4 + 2] = A.bind.w[o];
    }
    const w = await writeGlb(id, level, g.pos, nor, col, g.idx, rig, sk, split);
    return { ...w, tris: g.idx.length / 3 };
  };
  // A job with `texture`: the hi level is the scan decimated, unwrapped (xatlas, tools/rig/texture.mjs) and painted per texel; the lo level
  // the hi level simplified keeping its seams, so both share the UVs and the texture (as tools/bake-creature.mjs does for the sitting bodies).
  const texLods = async () => {
    const T = await import('./rig/texture.mjs');
    const g = simplified(pos, src.idx, job.tris[0]), scanOf = (i) => (g.from ? g.from[i] : i);
    const U = await T.unwrap(g.pos, g.idx, job.texture), n = U.from.length;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), O = new Uint32Array(n);          // (O: the scan vertex each unwrapped vertex came from)
    for (let i = 0; i < n; i++) { O[i] = scanOf(U.from[i]); for (let c = 0; c < 3; c++) { P[i * 3 + c] = g.pos[U.from[i] * 3 + c]; N[i * 3 + c] = fullN[O[i] * 3 + c]; } }
    // The eyes' domes (the skin session's measurement: the adapt step flattened the scan's eye bumps, so the analytic eye cut a sunken lens): the skin within the eye's
    // radius is pushed out onto its sphere, the normals there turned toward the sphere's. After the unwrap on purpose: the atlas was made on the adapted mesh without them.
    if (job.eyeCm?.dome) {
      const r = job.eyeCm.r / 100, c0 = job.eyeCm.c.map((v) => v / 100);
      for (const sx of [1, -1]) {
        const c = [sx * c0[0], c0[1], c0[2]];
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]);
          if (d >= r || d < 1e-9) continue;
          const t = Math.sqrt(1 - d / r), q = [0, 1, 2].map((a) => c[a] + (P[i * 3 + a] - c[a]) * (r / d));
          const sn = q.map((v, a) => (v - c[a]) / r), m = [0, 1, 2].map((a) => N[i * 3 + a] * (1 - t) + sn[a] * t), l = Math.hypot(...m) || 1;
          for (let a = 0; a < 3; a++) { P[i * 3 + a] = q[a]; N[i * 3 + a] = m[a] / l; }
        }
      }
    }
    const st = T.uvStats(U.uv, U.idx, P, job.texture);
    console.log(`  uv: texel density p1 ${st.p1} p5 ${st.p5} p50 ${st.p50} (1 = even), ${st.squashed} faces under 10 %, ${st.used} % of the atlas used`);
    if (st.squashed > U.idx.length / 3 * 0.01) throw new Error(`${id}: ${st.squashed} faces squashed in UV space`);
    const img = T.paintTexture(job.texture, U.uv, U.idx, P, N, ({ p, n: nn, w, v }) => {
      const o = v.map((i) => O[i]), mix = (arr) => w[0] * arr[o[0]] + w[1] * arr[o[1]] + w[2] * arr[o[2]], main = o[w.indexOf(Math.max(...w))];
      return paint({ u: mix(A.U), x: p[0] * 100, y: p[1] * 100, z: p[2] * 100, s: mix(A.S), h: mix(A.H), leg: A.LEG[main], legT: mix(A.LEGT), n: nn });
    });
    const webp = await sharp(Buffer.from(img.buffer), { raw: { width: job.texture, height: job.texture, channels: 4 } }).removeAlpha().webp({ quality: 88, effort: 6 }).toBuffer();
    const level = async (lv, G, from, image) => {
      const m = G.pos.length / 3, rig = new Float32Array(m * 4), sk = new Float32Array(m * 4);
      for (let i = 0; i < m; i++) { const o = from[i]; rig[i * 4] = A.U[o]; rig[i * 4 + 1] = A.LEG[o] / 8; rig[i * 4 + 2] = A.LEGT[o]; sk[i * 4] = A.bind.idx[o * 2] / 32; sk[i * 4 + 1] = A.bind.idx[o * 2 + 1] / 32; sk[i * 4 + 2] = A.bind.w[o]; }
      const w = await writeTextured(id, lv, G, rig, sk, image, split, job.skinPasses ?? SKIN_PASSES.swim, maskPar);
      return { ...w, tris: G.idx.length / 3 };
    };
    const hi = await level('hi', { pos: P, nor: N, uv: U.uv, idx: U.idx }, O, webp);
    const L = T.simplifyKeepingSeams(P, U.idx, job.tris[1], U.uv), m = L.from.length, LP = new Float32Array(m * 3), LN = new Float32Array(m * 3), LU = new Float32Array(m * 2), LO = new Uint32Array(m);
    for (let i = 0; i < m; i++) { const j = L.from[i]; for (let c = 0; c < 3; c++) { LP[i * 3 + c] = P[j * 3 + c]; LN[i * 3 + c] = N[j * 3 + c]; } LU[i * 2] = U.uv[j * 2]; LU[i * 2 + 1] = U.uv[j * 2 + 1]; LO[i] = O[j]; }
    const lo = await level('lo', { pos: LP, nor: LN, uv: LU, idx: L.idx }, LO, null);
    return { hi, lo };
  };
  const { hi, lo } = job.texture ? await texLods() : { hi: await lod('hi', job.tris[0]), lo: await lod('lo', job.tris[1]) };
  // The eyes sit on the upper side of the head, a third of the way back from the snout: found by looking at the model with
  // markers (tools: scratch headview), in cm for the 3.3 cm-a-unit leucomelas and scaled for the smaller frogs.
  const sc = job.cmPerUnit / 3.3, eye = (job.eye ? eyeC : [0.48 * sc, 1.18 * sc, 1.6 * sc]).map((v) => +v.toFixed(2));
  const base = EYES[job.eyes].finish, e0 = base.eyes[0];
  let finish = { ...base, eyes: [{ ...e0, c: eye, r: +(job.eye ? eyeR : 0.3 * sc).toFixed(3) }] };
  if (job.eyeCm) {        // the skin session's fit, measured on the mesh (cm of the baked frame, +x eye; the shader mirrors it)
    const nz = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }, cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const axis = nz(job.eyeCm.axis), h = nz(cr(axis, [0, 1, 0])), w = nz(cr(axis, h));
    finish = { ...finish, eyes: [{ ...e0, c: job.eyeCm.c, r: job.eyeCm.r, axis, h, w }] };
  }
  const size = [0, 0, 0].map((_, a) => { let lo2 = 1e9, hi2 = -1e9; for (let i = 0; i < A.n; i++) { lo2 = Math.min(lo2, pos[i * 3 + a]); hi2 = Math.max(hi2, pos[i * 3 + a]); } return +((hi2 - lo2) * 100).toFixed(2); });
  // The skeleton in the baked frame (cm), for the game's runtime skinning (`bind: 'swim'`: posed by the stroke, skeleton.js poseStroke).
  const cm = cm0;
  const rOf = (b) => (SKL.radius[b.name.replace(/[LR]$/, '').replace('spineB', 'spine')] ?? 0.05) * (A.conform ? A.conform.radius(b.name) : 1);
  const skeleton = { plan: 'anuran', bind: 'swim', bones: frogBones(Object.fromEntries(Object.entries(J18).map(([kk, v]) => [kk, cm(v)]))).map((b) => ({ ...b, r: +(rOf(b) * k * 100).toFixed(3) })) };
  manifest[id] = { file: `${id.replace(':', '-')}.glb`, lo: `${id.replace(':', '-')}.lo.glb`, legs: false, pose: 'swim', tris: { hi: hi.tris, lo: lo.tris }, sizeCm: size, finish, skeleton };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${size.join(' x ')} cm (x y z), eye at ${eye.join(', ')} cm`);
}
// (a skeleton is written on one line, as tools/bake-creature.mjs does: the manifest's one-number-a-line layout would add hundreds of lines a species)
const SK = [];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SK.push(v) - 1}@@` : v), 1)
  .replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SK[+i])));
