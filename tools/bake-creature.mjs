// Bakes untextured creature meshes (art-src/raw/*.glb) into game assets with painted vertex colours.
//
//   node tools/bake-creature.mjs [id ...]        (no ids: every job below)
//
// Steps per job: weld, turn the head to +z, stand it on y = 0, scale to its real length, simplify to a detailed and
// a coarse level of detail, smooth the normals, paint every vertex with tools/paint/<paint>.mjs, and write
// <id>.glb and <id>.lo.glb (meshopt-compressed) plus the manifest entry the game reads.
//
// A job with `rig` (tools/rig/<rig>.mjs) bakes the animation rig into the file instead of leaving the game to guess it from
// the shape (render/creatures/glb.js addRig): a `_RIG` vertex attribute (spine, leg / 8, legT, material id / 8, all 0 … 1 so
// meshopt can quantise it) plus ambient occlusion in the colours. `shellWidthCm` scales by the rig's shell width instead
// of the nose-to-tail length (a crab's length is set by its legs).
// A job with `texture: <size>` is unwrapped (xatlas, tools/rig/texture.mjs) and painted per texel by the paint module's
// `texel` function into a WebP colour texture: the detail is as fine as the texture instead of the mesh. The coarse level
// keeps the same UVs and carries no image of its own (the game draws both levels with the detailed file's material).
import { skinFour, SKIN_PASSES } from './rig/skeleton.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const OUT = process.env.T4_OUT || 'public/assets/creatures';
// rotY: degrees about y that turn the mesh's head towards +z. lengthCm: nose-to-tail length of the real animal.
// The frog scan's skeleton (tools/rig/skeleton.mjs frogBones), measured on the scan in the rig's frame (scan units after rotY, head +z,
// about 2 long) with tools/rig/joints-view.mjs: a sitting Dendrobates, the hind leg folded in a Z (thigh forward and out to the knee
// at the front of the lobe, shin back to the heel at its rear tip, the foot forward along the ground), the arm straight down with the
// elbow back. `radius`: each bone's capsule for the runtime binding (bindCapsules: two bones a vertex, written as `_SKIN` into the
// detailed file, which the game skins near the camera: render/creatures/skin.js). Every frog job shares it; the species' warp
// carries the joints with the skin (carryJoints).
const FROG_SKELETON = {
  bones: 'frog', poses: {},
  joints: {
    vent: [0, -0.28, -0.72], mid: [0, -0.15, -0.25], chest: [0, -0.1, 0.25], neck: [0, 0, 0.4], snout: [0, 0.15, 1.0],
    hipL: [-0.2, -0.3, -0.7], kneeL: [-0.62, -0.3, -0.28], heelL: [-0.32, -0.45, -0.92], ankleL: [-0.7, -0.58, -0.4], toeL: [-0.83, -0.59, -0.07],
    hipR: [0.2, -0.3, -0.7], kneeR: [0.62, -0.3, -0.27], heelR: [0.32, -0.45, -0.92], ankleR: [0.7, -0.58, -0.4], toeR: [0.84, -0.59, -0.07],
    shoulderL: [-0.45, -0.08, 0.2], elbowL: [-0.6, -0.28, 0.2], wristL: [-0.57, -0.55, 0.38], fingerL: [-0.4, -0.59, 0.85],
    shoulderR: [0.4, -0.08, 0.22], elbowR: [0.6, -0.28, 0.2], wristR: [0.55, -0.55, 0.4], fingerR: [0.43, -0.59, 0.85],
  },
  radius: { pelvis: 0.22, spine: 0.38, head: 0.33, thigh: 0.14, shin: 0.12, foot: 0.06, toes: 0.04, arm: 0.08, forearm: 0.07, hand: 0.05 },
};
// The fire-bellied toad's own scan (art-src/raw/toad_mesh.glb, the owner's, 6 Oct 2026): a squat warty toad sitting, forelegs straight with the
// hands forward, each hind leg folded in a lobe at the rear (thigh forward and out to the knee at the lobe's front, shin back to the heel at its
// rear tip, the long foot out and forward along the ground, toe tips by the hands). Joints measured on it (tools/rig/joints-view.mjs with SKEL,
// tools/rig/limb-centre.mjs; the right side measured, the left mirrors it), scan units after rotY (head +z, about 2 long).
const mirrorJ = (R, base) => { const j = { ...base }; for (const [k, v] of Object.entries(R)) { j[k + 'R'] = v; j[k + 'L'] = [-v[0], v[1], v[2]]; } return j; };
const TOAD_SKELETON = {
  bones: 'frog', poses: {},
  joints: mirrorJ({ hip: [0.30, -0.18, -0.62], knee: [0.55, -0.25, -0.38], heel: [0.40, -0.42, -0.93], ankle: [0.72, -0.51, -0.50], toe: [0.94, -0.53, -0.25],
    shoulder: [0.40, -0.08, 0.30], elbow: [0.56, -0.33, 0.22], wrist: [0.50, -0.48, 0.46], finger: [0.45, -0.52, 0.70] },
  { vent: [0, -0.30, -0.78], mid: [0, -0.12, -0.25], chest: [0, -0.05, 0.30], neck: [0, 0.05, 0.52], snout: [0, 0.26, 0.97] }),
  radius: { pelvis: 0.30, spine: 0.40, head: 0.33, thigh: 0.19, shin: 0.14, foot: 0.07, toes: 0.04, arm: 0.10, forearm: 0.09, hand: 0.06 },
};
const FROG = { src: 'frog_mesh', rotY: -90, pre: 22000, rig: 'frog', legs: true, matId: 0, texture: 1024, aoReach: 0.35, skeleton: FROG_SKELETON };
const SHRIMP = { src: 'shrimp_mesh', rotY: 90, lengthCm: 1.6, tris: [11000, 3200], rig: 'shrimp', rigLeg: 16, legs: true, matId: 7, texture: 512, aoReach: 0.1 };
const JOBS = {
  // The frogs: one scan (frog_mesh, a sitting Dendrobates) decimated to 30k triangles, rigged (tools/rig/frog.mjs: limbs measured
  // along their length, so a folded hind leg moves at the foot), reshaped per species (tools/rig/warps.mjs) and painted into a
  // 1024 texture (tools/paint/<species>.mjs on tools/paint/frogkit.mjs: granules, toe discs, mouth line, creases darkened by the
  // baked occlusion). The coarse level keeps the texture, so a frog across the tank is as crisp as one up close.
  leucomelas: { ...FROG, lengthCm: 4.5, tris: [22000, 8000], paint: 'leucomelas' },
  strawberry: { ...FROG, lengthCm: 2.3, tris: [22000, 6000], paint: 'strawberry' },
  dartfrog: { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#cobalt_spotted', warp: 'azureus' },
  'dartfrog:cobalt_clean': { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#cobalt_clean', warp: 'azureus' },
  'dartfrog:sky_spotted': { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#sky_spotted', warp: 'azureus' },
  'dartfrog:sky_clean': { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#sky_clean', warp: 'azureus' },
  auratus: { ...FROG, lengthCm: 4.0, tris: [22000, 8000], paint: 'auratus', warp: 'auratus' },
  bumblebee: { ...FROG, lengthCm: 2.8, tris: [22000, 6000], paint: 'melano', warp: 'melano' },
  reedfrog: { ...FROG, lengthCm: 3.0, tris: [22000, 7000], paint: 'heterixalus', warp: 'heterixalus' },
  // (nose to the rear of the lobes 4.9 cm = snout to vent 4.5, the swim body's trunk, tools/bake-frogpose.mjs; `eye`: the bump on the scan, scan units)
  toad: { ...FROG, src: 'toad_mesh', rotY: 90, pre: 0, lengthCm: 4.9, tris: [10000, 5000], paint: 'bombina', skeleton: TOAD_SKELETON, eye: { c: [0.135, 0.48, 0.63], r: 0.07 }, eyeCm: { c: [0.404, 2.473, 1.525], r: 0.27 } },
  firesal: { src: 'salamander_mesh', rotY: 90, lengthCm: 18, headZ: 6.2, tris: [32000, 8000], paint: 'firesal', legs: true },
  // Vampire crab: carapace 2.1 cm wide (the procedural body's size, so the sim's spacing is unchanged), legs about 6 cm across.
  // matId 0 (skin) not 4 (chitin): the chitin id has a fixed clear coat that ignores finish and looked like plastic on the scan.
  crab: { src: 'crab_mesh', rotY: 0, shellWidthCm: 2.1, tris: [10000, 3200], paint: 'crab', rig: 'crab', legs: true, matId: 0, texture: 1024 },
  // Red-eyed tree frog: its own scan (redeye_frog_mesh, standing alert with the limbs clear of the body and the toe discs spread),
  // rigged like the other frogs and painted from the reference pictures (tools/paint/callidryas.mjs). 6.4 cm nose to toe tips
  // as it stands (a female's body is about 6 cm, a male's 5).
  // Its hind legs lie folded flat in a lobe at the rear (thigh inside, shin outside): rigged by a skeleton measured on the scan
  // (`hind`, tools/rig/frog.mjs) so the whole leg moves, not only the foot.
  // `skeleton` (tools/rig/skeleton.mjs): its bones, measured on the scan (scan units after rotY: head +z, about 2 long), and poses
  // made by turning them: `sleep`, the day-time posture on a leaf or the glass (hind legs folded tight along the flanks, feet
  // under the thighs, hands folded back under the chest, chin down): <id>.sleep.glb, the same texture on the posed skin.
  redeye: { src: 'redeye_frog_mesh', rotY: 90, rig: 'frog', legs: true, matId: 0, texture: 1024, aoReach: 0.3, lengthCm: 6.4, tris: [10000, 5000], paint: 'callidryas',
    rigOpt: { hind: {
      trunk: [[0.02, -0.18, -0.8, 0.12], [0.01, -0.17, -0.55, 0.25], [0, -0.13, -0.2, 0.3], [0, -0.02, 0.35, 0.3], [0, 0.05, 0.8, 0.2]],
      3: [[-0.14, -0.2, -0.74, 0.1], [-0.54, -0.25, -0.24, 0.1], [-0.24, -0.33, -0.9, 0.09]],
      4: [[0.16, -0.2, -0.74, 0.1], [0.5, -0.25, -0.22, 0.1], [0.14, -0.33, -0.88, 0.09]],
    } },
    skeleton: {
      bones: 'frog',
      // `muscles`: the sleep pose's folded thighs, calves and shoulders swell (src/util/bodyplan.js anuran muscles). Not skinned at run
      // time yet (no `radius`): its hind legs lie folded flat with thigh and shin fused in one lobe and the long toes beside the hands,
      // and walking on these joints tore the lobe and left toe tips behind (tools/rig/skin-stretch.mjs: 2.7 % of triangles past 2x
      // in a walk, 11 % in a hop); the joints need measuring again with the lobe split before it can be.
      muscles: true,
      joints: {
        vent: [0.02, -0.18, -0.82], mid: [0, -0.12, -0.2], chest: [0, -0.05, 0.3], neck: [0, -0.02, 0.42], snout: [0, 0.1, 0.9],
        hipL: [-0.14, -0.2, -0.74], kneeL: [-0.54, -0.25, -0.24], heelL: [-0.24, -0.33, -0.9], ankleL: [-0.47, -0.38, -0.5], toeL: [-0.88, -0.4, 0.12],
        hipR: [0.16, -0.2, -0.74], kneeR: [0.5, -0.25, -0.22], heelR: [0.14, -0.33, -0.88], ankleR: [0.47, -0.38, -0.52], toeR: [0.84, -0.4, 0],
        shoulderL: [-0.33, -0.04, 0.27], elbowL: [-0.48, -0.2, 0.16], wristL: [-0.48, -0.36, 0.45], fingerL: [-0.45, -0.4, 0.95],
        shoulderR: [0.32, -0.04, 0.27], elbowR: [0.45, -0.2, 0.14], wristR: [0.47, -0.36, 0.36], fingerR: [0.42, -0.4, 0.78],
      },
      poses: {
        // (eyeLid: the lower lid drawn shut over the eye, a pale green-gold membrane netted with gold lines)
        sleep: { mirror: true, eyeLid: { col: [0.36, 0.42, 0.2], vein: [0.75, 0.52, 0.12], amount: 0.88 }, spine: [0, -0.2, 0.3], head: [0, -0.07, 0.88],
          armR: [0.4, -0.27, 0.14], forearmR: [0.18, -0.36, 0.36], handR: [0.22, -0.4, -0.15],
          thighR: [0.4, -0.25, -0.1], shinR: [0.2, -0.33, -0.75], footR: [0.3, -0.4, -0.38], toesR: [0.24, -0.42, 0.02] },
      },
    } },
  // Dwarf shrimp: one scan (shrimp_mesh, a Caridina-shaped shrimp standing on its legs), rigged by tools/rig/shrimp.mjs (pincers,
  // walking legs, antennae and swimmerets; long antenna whips and the swimmerets are added as geometry) and painted per colour form
  // into a 512 texture. Scaled by the body (rostrum to the base of the tail fan 1.6 cm, about 2 cm to the fan's tip: a grown female;
  // the game draws males smaller), not by the whips. Leg ids go up to 16 (rigLeg).
  // One file for every colour line: the texture is a pigment mask (tools/paint/shrimp.mjs maskTexel) that the game colours per line
  // (`palette` in the manifest: the morphs of the species' genetics; blue dream is the same shrimp in blue).
  shrimp: { ...SHRIMP, paint: 'shrimp#mask', palette: true },
  // `texture: 1024`: a painted UV texture instead of vertex colours (tools/rig/texture.mjs). The old "tan patches" were faces that
  // xatlas squashed to a point because the crab was unwrapped in metres; unwrap now rescales (see unwrap()).
};
const M_CHITIN = 4;   // render/creatures/kit.js M.CHITIN: the default material id of a baked rig (job.matId overrides)
// Eyes (cm, in the baked frame) and finish per job live in tools/paint/eyes.mjs so they can be tuned without touching code.
const { EYES } = await import('./paint/eyes.mjs');

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // area-weighted
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

function simplified(pos, idx, targetTris) {
  const tris = idx.length / 3;
  if (tris <= targetTris) return { pos, idx, from: null };
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(targetTris * 3), 0.02, []);
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3);
  const from = new Uint32Array(count);                         // new vertex -> the original vertex it came from
  for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; from[remap[i]] = i; }
  return { pos: np, idx: out, from };
}

async function build(id, job, paint, level, geo, fullNormals, rig = null, spineZ = null) {
  const { pos, idx, from } = geo;
  const src = (i) => (from ? from[i] : i);
  const n = pos.length / 3;
  // Smooth normals come from the full-resolution mesh, so a coarse level of detail still shades like the original.
  let nor;
  if (from) { nor = new Float32Array(n * 3); for (let i = 0; i < n; i++) { nor[i*3] = fullNormals[from[i]*3]; nor[i*3+1] = fullNormals[from[i]*3+1]; nor[i*3+2] = fullNormals[from[i]*3+2]; } } else nor = normals(pos, idx);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, pos[i*3]); x1 = Math.max(x1, pos[i*3]); y0 = Math.min(y0, pos[i*3+1]); y1 = Math.max(y1, pos[i*3+1]); z0 = Math.min(z0, pos[i*3+2]); z1 = Math.max(z1, pos[i*3+2]); }
  const hw = Math.max(x1, -x0), zmid = (z0 + z1) / 2, xFrac = 0.32, yFrac = 0.62;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos[i*3] * 100, y = pos[i*3+1] * 100, z = pos[i*3+2] * 100;
    const h = (pos[i*3+1] - y0) / (y1 - y0);
    const s = Math.abs(pos[i*3]) / hw;
    const isLeg = job.legs && s > xFrac && h < yFrac;
    let leg = isLeg ? (pos[i*3+2] > zmid ? 1 : 3) + (pos[i*3] > 0 ? 1 : 0) : 0;
    let legT = isLeg ? Math.min(1, (s - xFrac) / (1 - xFrac)) : 0;
    const extra = {};
    if (rig) {
      const j = src(i);
      leg = rig.leg[j]; legT = rig.legT[j];
      Object.assign(extra, { part: rig.part[j], ao: rig.ao[j], eyeT: rig.eyeT[j], zf: rig.zf[j] });
    }
    const c = paint({ u: (z1 - pos[i*3+2]) / (z1 - z0), x, y, z, s, h, leg, legT, n: [nor[i*3], nor[i*3+1], nor[i*3+2]], ...extra });
    col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
  }
  const doc = new Document();
  const buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0));
  if (rig) {
    const r = new Float32Array(n * 4);
    const [sz0, sz1] = spineZ ?? [z0, z1];
    for (let i = 0; i < n; i++) { const j = src(i); r[i*4] = Math.max(0, Math.min(1, (sz1 - pos[i*3+2]) / (sz1 - sz0))); r[i*4+1] = rig.leg[j] / (job.rigLeg ?? 8); r[i*4+2] = rig.legT[j]; r[i*4+3] = (job.matId ?? M_CHITIN) / 8; }
    prim.setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(r).setBuffer(buf));
  }
  const mesh = doc.createMesh(id).addPrimitive(prim);
  doc.createScene().addChild(doc.createNode(id).setMesh(mesh));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc);
  return { file, verts: n, tris: idx.length / 3, bytes: fs.statSync(file).size, size: [(x1 - x0) * 100, (y1 - y0) * 100, (z1 - z0) * 100] };
}

// The textured variant of build(): positions, normals, UVs and the baked rig; the hi level embeds the colour texture.
// `skin` (bindCapsules, per scan vertex): the runtime skin binding as `_SKIN` = (bone 0 / 32, bone 1 / 32, bone 0's weight, 0).
async function buildTextured(id, job, level, g, rig, image, spineZ = null, skin = null) {
  const { pos, nor, uv, idx, from } = g, n = pos.length / 3;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, pos[i*3]); x1 = Math.max(x1, pos[i*3]); y0 = Math.min(y0, pos[i*3+1]); y1 = Math.max(y1, pos[i*3+1]); z0 = Math.min(z0, pos[i*3+2]); z1 = Math.max(z1, pos[i*3+2]); }
  const r = new Float32Array(n * 4);
  const [sz0, sz1] = spineZ ?? [z0, z1];
  for (let i = 0; i < n; i++) { const j = from[i]; r[i*4] = Math.max(0, Math.min(1, (sz1 - pos[i*3+2]) / (sz1 - sz0))); r[i*4+1] = rig.leg[j] / (job.rigLeg ?? 8); r[i*4+2] = rig.legT[j]; r[i*4+3] = (job.matId ?? M_CHITIN) / 8; }
  const doc = new Document();
  const buf = doc.createBuffer();
  const mat = doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  if (image) {
    doc.createExtension(EXTTextureWebP).setRequired(true);
    mat.setBaseColorTexture(doc.createTexture(`${id}_color`).setImage(image).setMimeType('image/webp'));
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf))
    .setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(r).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(mat);
  if (skin) {
    const sk = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const j = from[i]; sk[i*4] = skin.idx[j*2] / 32; sk[i*4+1] = skin.idx[j*2+1] / 32; sk[i*4+2] = skin.w[j]; }
    const f4 = skinFour(pos, idx, sk, SKIN_PASSES[job.skeleton?.plan ?? 'anuran'] ?? SKIN_PASSES.anuran);   // (SK1: four bones a vertex)
    prim.setAttribute('_SKIN', doc.createAccessor().setType('VEC4').setArray(f4.skin).setBuffer(buf));
    prim.setAttribute('_SKINX', doc.createAccessor().setType('VEC4').setArray(f4.skinx).setBuffer(buf));
  }
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 16, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc);
  return { file, verts: n, tris: idx.length / 3, bytes: fs.statSync(file).size, size: [(x1 - x0) * 100, (y1 - y0) * 100, (z1 - z0) * 100] };
}

async function bakeTextured(id, job, pos, srcIdx, fullN, rig, eye = null, spineZ = null, poses = {}, skin = null) {
  const { unwrap, paintTexture, simplifyKeepingSeams, uvStats } = await import('./rig/texture.mjs');
  const texel = job.texelFn;
  const U = await unwrap(pos, srcIdx, job.texture);
  const n = U.from.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { P[i*3+k] = pos[U.from[i]*3+k]; N[i*3+k] = fullN[U.from[i]*3+k]; }
  const st = uvStats(U.uv, U.idx, P, job.texture);
  console.log(`  uv: texel density p1 ${st.p1} p5 ${st.p5} p50 ${st.p50} (1 = even), ${st.squashed} faces under 10 %, ${st.used} % of the atlas used`);
  if (st.squashed > U.idx.length / 3 * 0.01) throw new Error(`${id}: ${st.squashed} faces squashed in UV space (they would show as flat-coloured patches)`);
  const t0 = Date.now();
  // The same frame numbers the vertex paint gets (u snout 0 … tail 1, h height 0 … 1, s out from the midline 0 … 1) and the
  // distance to the analytic eye's centre in cm (eyeD), for masks and rings around the eye.
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i*3]); x1 = Math.max(x1, P[i*3]); y0 = Math.min(y0, P[i*3+1]); y1 = Math.max(y1, P[i*3+1]); z0 = Math.min(z0, P[i*3+2]); z1 = Math.max(z1, P[i*3+2]); }
  const hw = Math.max(x1, -x0);
  const img = paintTexture(job.texture, U.uv, U.idx, P, N, ({ p, n: nn, w, v }) => {
    const o = v.map((i) => U.from[i]);
    const lerp = (arr) => w[0] * arr[o[0]] + w[1] * arr[o[1]] + w[2] * arr[o[2]];
    const main = o[w.indexOf(Math.max(...w))];
    const x = p[0] * 100, y = p[1] * 100, z = p[2] * 100;
    const eyeD = eye ? Math.hypot(Math.abs(x) - eye.c[0], y - eye.c[1], z - eye.c[2]) : 99;
    return texel({ x, y, z, n: nn, part: rig.part[main], leg: rig.leg[main], legT: lerp(rig.legT), ao: lerp(rig.ao), eyeT: lerp(rig.eyeT), zf: lerp(rig.zf),
      u: (z1 - p[2]) / (z1 - z0), h: (p[1] - y0) / (y1 - y0), s: Math.abs(p[0]) / hw, eyeD, eyeR: eye?.r ?? 0 });
  });
  const webp = await sharp(Buffer.from(img.buffer), { raw: { width: job.texture, height: job.texture, channels: 4 } }).removeAlpha().webp({ quality: 88, effort: 6 }).toBuffer();
  fs.mkdirSync('test-output/bake', { recursive: true });
  await sharp(Buffer.from(img.buffer), { raw: { width: job.texture, height: job.texture, channels: 4 } }).png().toFile(`test-output/bake/${id.replace(':', '-')}_color.png`);
  console.log(`  texture ${job.texture}px painted in ${Date.now() - t0} ms, ${(webp.length / 1024) | 0} KB webp (preview test-output/bake/${id}_color.png)`);
  const hi = await buildTextured(id, job, 'hi', { pos: P, nor: N, uv: U.uv, idx: U.idx, from: U.from }, rig, webp, spineZ, skin);
  const L = simplifyKeepingSeams(P, U.idx, job.tris[1], U.uv);
  const m = L.from.length, LP = new Float32Array(m * 3), LN = new Float32Array(m * 3), LU = new Float32Array(m * 2), LF = new Uint32Array(m);
  for (let i = 0; i < m; i++) { const j = L.from[i]; for (let k = 0; k < 3; k++) { LP[i*3+k] = P[j*3+k]; LN[i*3+k] = N[j*3+k]; } LU[i*2] = U.uv[j*2]; LU[i*2+1] = U.uv[j*2+1]; LF[i] = U.from[j]; }
  const sl = uvStats(LU, L.idx, LP, job.texture);
  console.log(`  lo uv: texel density p1 ${sl.p1} p5 ${sl.p5}, ${sl.squashed} faces under 10 %`);
  const lo = await buildTextured(id, job, 'lo', { pos: LP, nor: LN, uv: LU, idx: L.idx, from: LF }, rig, null, spineZ);
  // Poses (skeleton): the same vertices, UVs and texture on the posed skin.
  const posed = {};
  for (const [name, q] of Object.entries(poses)) {
    const qN = normals(q, srcIdx);
    const PP = new Float32Array(n * 3), PN = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { PP[i*3+k] = q[U.from[i]*3+k]; PN[i*3+k] = qN[U.from[i]*3+k]; }
    const QP = new Float32Array(m * 3), QN = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) { const j = L.from[i]; for (let k = 0; k < 3; k++) { QP[i*3+k] = PP[j*3+k]; QN[i*3+k] = PN[j*3+k]; } }
    posed[name] = {
      hi: await buildTextured(`${id}.${name}`, job, 'hi', { pos: PP, nor: PN, uv: U.uv, idx: U.idx, from: U.from }, rig, webp, spineZ),
      lo: await buildTextured(`${id}.${name}`, job, 'lo', { pos: QP, nor: QN, uv: LU, idx: L.idx, from: LF }, rig, null, spineZ),
    };
  }
  return { hi, lo, posed };
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cache = {};
for (const [id, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(id)) continue;
  // `paint: 'module#arg'` picks one variant of a paint module (paintFor(arg) / texelFor(arg)): the azureus morphs share a painter.
  const [pmod, parg] = job.paint.split('#');
  const PM = await import(`./paint/${pmod}.mjs`);
  const paint = parg ? PM.paintFor(parg) : PM.paint;
  job.texelFn = parg ? PM.texelFor?.(parg) : PM.texel;
  const ckey = `${job.src}@${job.pre ?? 0}`;
  if (!cache[ckey]) {
    const doc = await io.read(`art-src/raw/${job.src}.glb`);
    await doc.transform(weld());
    const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    cache[ckey] = { pos: Float32Array.from(p.getAttribute('POSITION').getArray()), idx: Uint32Array.from(p.getIndices().getArray()) };
    // `pre`: decimate a dense scan first (the frog scan has 400k triangles: too many to rig, unwrap and texture).
    if (job.pre) { const s = simplified(cache[ckey].pos, cache[ckey].idx, job.pre); cache[ckey] = { pos: s.pos, idx: s.idx }; }
  }
  // Orient, stand on the ground, centre, scale to the real length (metres).
  const src = cache[ckey];
  let pos = Float32Array.from(src.pos), idx0 = src.idx;
  const a = job.rotY * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); }
  let k = (job.lengthCm / 100) / (z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let rig = null, eyesOut = null;
  if (job.rig) {
    // Segment and shade in the scan's own units (the thresholds are tuned to it), then scale by the shell.
    const { [`${job.rig}Rig`]: makeRig } = await import(`./rig/${job.rig}.mjs`);
    const { ambientOcclusion, normals: nrm } = await import('./rig/appendages.mjs');
    rig = makeRig(pos, idx0, job.rigOpt ?? {});
    // A rig may add geometry the scan lacks (a shrimp's antennae whips and swimmerets): appended here, with its rig data.
    if (rig.extra) {
      const X = rig.extra, n0 = pos.length / 3, P2 = new Float32Array(pos.length + X.pos.length), I2 = new Uint32Array(idx0.length + X.idx.length);
      P2.set(pos); P2.set(X.pos, pos.length); I2.set(idx0); I2.set(X.idx, idx0.length);
      const cat = (a, b, T) => { const o = new T(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
      rig.leg = cat(rig.leg, X.leg, Uint8Array); rig.legT = cat(rig.legT, X.legT, Float32Array); rig.part = [...rig.part, ...X.part];
      pos = P2; idx0 = I2;
      console.log(`  rig added ${X.pos.length / 3} vertices, ${X.idx.length / 3} triangles (from ${n0} vertices)`);
    }
    if (rig.counts) console.log('  rig', JSON.stringify(rig.counts));
    rig.ao = ambientOcclusion(pos, idx0, nrm(pos, idx0), { rays: 48, reach: job.aoReach ?? 0.3 });
    const n = pos.length / 3;
    rig.eyeT ??= new Float32Array(n);
    const sh = rig.shell;
    if (sh) { k = (job.shellWidthCm / 100) / (sh.x1 - sh.x0); cx = (sh.x0 + sh.x1) / 2; cz = (sh.z0 + sh.z1) / 2; }
    // `length`: the animal is measured by its body along z (a shrimp without its antennae), not by its bounding box.
    if (rig.length) { const R = rig.length; k = (job.lengthCm / 100) / (R.z1 - R.z0); cx = (R.x0 + R.x1) / 2; cz = (R.z0 + R.z1) / 2; }
    if (sh || rig.length) rig.zf = new Float32Array(n);
    const zr = sh ?? rig.length;
    for (let i = 0; zr && i < n; i++) {
      rig.zf[i] = Math.max(0, Math.min(1, (pos[i*3+2] - zr.z0) / (zr.z1 - zr.z0)));
      if (rig.part[i] !== 'eye' || !rig.eyes?.length) continue;
      const e = rig.eyes.reduce((b, e) => (Math.abs(e.c[0] - pos[i*3]) < Math.abs(b.c[0] - pos[i*3]) ? e : b));
      rig.eyeT[i] = Math.max(0, 1 - Math.hypot(pos[i*3] - e.c[0], pos[i*3+1] - e.c[1], pos[i*3+2] - e.c[2]) / (2.4 * e.r));
    }
    // The +x eye in centimetres of the baked frame, looking along its stalk tipped forward (the shader mirrors it).
    if (rig.eyes) {
      const e = rig.eyes.reduce((a, b) => (b.c[0] > a.c[0] ? b : a));
      const cm = (p) => [(p[0] - cx) * k * 100, (p[1] - y0) * k * 100, (p[2] - cz) * k * 100];
      const stalk = e.c.map((v, i) => v - e.base[i]), sl = Math.hypot(...stalk);
      eyesOut = { c: cm(e.c).map((v) => +v.toFixed(3)), r: +(e.r * k * 100).toFixed(3), axis: [stalk[0] / sl * 0.6 + 0.25, stalk[1] / sl * 0.6, stalk[2] / sl * 0.6 + 0.75] };
    }
  }
  // (the rig's own extent along z, in cm of the baked frame: the spine runs over the body, not over the whips ahead of it)
  const spineZ = rig?.length ? [(rig.length.z0 - cz) * k, (rig.length.z1 - cz) * k] : null;
  const curlCm = rig?.curl ? { z0: +((rig.curl.z0 - cz) * k * 100).toFixed(3), y0: +((rig.curl.y0 - y0) * k * 100).toFixed(3), len: +(rig.curl.len * k * 100).toFixed(3) } : null;
  if (curlCm) console.log('  tail flick pivot (cm)', JSON.stringify(curlCm));
  if (rig?.eggs) console.log('  egg fold point (cm)', JSON.stringify({ y: +((rig.eggs.y - y0) * k * 100).toFixed(3), z: +((rig.eggs.z - cz) * k * 100).toFixed(3) }));
  // Skeleton poses (tools/rig/skeleton.mjs), skinned in the scan's units like the rig, then carried into the baked frame below.
  const poseSrc = {}, poseHead = {};
  let skinBind = null, skelBones = null, scanPos = null;
  if (job.skeleton) {
    const S = await import('./rig/skeleton.mjs');
    const bones = S[`${job.skeleton.bones}Bones`](job.skeleton.joints);
    const bind = S.bindSkin(pos, bones, rig);
    // the runtime binding (two bones a vertex) and the scan positions, to carry the joints into the baked frame below
    if (job.skeleton.radius) { skinBind = S.bindCapsules(pos, bones, { radius: job.skeleton.radius, rig, tris: idx0, smooth: job.skeleton.smooth ?? 6 }); skelBones = bones; scanPos = Float32Array.from(pos); }
    const nScan = normals(pos, idx0);
    // (every joint kept inside its body plan's range, src/util/bodyplan.js; `muscles: true` swells the posed skin as its joints bend:
    // docs/SKELETON.md. Off until a pose has been checked with them in the bench.)
    const plan = job.skeleton.plan ?? (job.skeleton.bones === 'frog' ? 'anuran' : null);
    for (const [name, def] of Object.entries(job.skeleton.poses)) {
      const mats = S.poseMatrices(bones, def, { plan });
      if (mats.clamped.length) console.log(`  pose ${name}: kept inside the ${plan} joint ranges: ${mats.clamped.join(', ')}`);
      const sk = S.skin(pos, nScan, bind, mats);
      if (job.skeleton.muscles && plan) S.applyMuscles(sk.pos, sk.nor, pos, bind, bones, mats, plan);
      poseSrc[name] = sk.pos;
      poseHead[name] = { m: mats.world[mats.byName.head], r: mats.rot[mats.byName.head] };
    }
  }
  const toFrame = (q) => { for (let i = 0; i < q.length; i += 3) { q[i] = (q[i] - cx) * k; q[i + 1] = (q[i + 1] - y0) * k; q[i + 2] = (q[i + 2] - cz) * k; } };
  for (const q of Object.values(poseSrc)) {
    toFrame(q);
    let ymin = Infinity; for (let i = 1; i < q.length; i += 3) ymin = Math.min(ymin, q[i]);
    for (let i = 1; i < q.length; i += 3) q[i] -= ymin;                 // resting on the ground (or the leaf, the glass) as posed
    q.ymin = ymin;
  }
  for (let i = 0; i < pos.length; i += 3) { pos[i] = (pos[i] - cx) * k; pos[i + 1] = (pos[i + 1] - y0) * k; pos[i + 2] = (pos[i + 2] - cz) * k; }
  // `warp`: reshape one scan into a related species (a flatter toad, a slimmer, longer-legged reed frog), in metres of the baked
  // frame, per vertex with the rig: warp([x, y, z] in cm, { leg, legT, part }) -> [x, y, z] in cm. The eyes move with it.
  let warpEye = null;
  if (job.warp) {
    const { [job.warp]: warpFn } = await import('./rig/warps.mjs');
    const W = warpFn(pos, rig);
    for (let i = 0; i < pos.length / 3; i++) {
      const q = W([pos[i*3] * 100, pos[i*3+1] * 100, pos[i*3+2] * 100], { leg: rig?.leg[i] ?? 0, legT: rig?.legT[i] ?? 0, part: rig?.part[i] });
      pos[i*3] = q[0] / 100; pos[i*3+1] = q[1] / 100; pos[i*3+2] = q[2] / 100;
    }
    let ymin = Infinity; for (let i = 1; i < pos.length; i += 3) ymin = Math.min(ymin, pos[i]);
    for (let i = 1; i < pos.length; i += 3) pos[i] -= ymin;
    warpEye = (c) => { const q = W(c, { leg: 0, legT: 0, part: 'body' }); return [q[0], q[1] - ymin * 100, q[2]]; };
  }
  // The skeleton in the baked frame (cm), for the game's runtime skinning: bones with their capsule radius and the body plan.
  let skeletonOut = null;
  if (skinBind) {
    const { carryJoints, frogBones } = await import('./rig/skeleton.mjs');
    const J = carryJoints(job.skeleton.joints, scanPos, pos);
    const cmB = frogBones(Object.fromEntries(Object.entries(J).map(([kk, v]) => [kk, v.map((x) => +(x * 100).toFixed(3))])));
    const rOf = (b) => job.skeleton.radius[b.name] ?? job.skeleton.radius[b.name.replace(/[LR]$/, '')] ?? 0.05;
    skeletonOut = { plan: job.skeleton.plan ?? 'anuran', bones: cmB.map((b, i) => ({ ...b, r: +(rOf(skelBones[i]) * k * 100).toFixed(3) })) };
  }
  const extra = { ...(EYES[id] ?? {}) };
  if (extra.finish) extra.finish = { ...extra.finish, eyes: Array.isArray(extra.finish.eyes) ? extra.finish.eyes.map((e) => ({ ...e })) : extra.finish.eyes };
  if (job.eye && Array.isArray(extra.finish?.eyes)) { const e0 = extra.finish.eyes[0]; e0.c = [(job.eye.c[0] - cx) * k * 100, (job.eye.c[1] - y0) * k * 100, (job.eye.c[2] - cz) * k * 100].map((v) => +v.toFixed(3)); e0.r = +(job.eye.r * k * 100).toFixed(3); }
  if (job.eyeCm && Array.isArray(extra.finish?.eyes)) { const e0 = extra.finish.eyes[0]; e0.c = job.eyeCm.c.map((v) => +v.toFixed(3)); e0.r = job.eyeCm.r; }      // (the skin session's fit on the mesh and the owner's photos, cm of the baked frame: overrides `eye`)
  if (eyesOut && typeof extra.finish?.eyes === 'function') extra.finish = { ...extra.finish, eyes: extra.finish.eyes(eyesOut) };
  if (warpEye && Array.isArray(extra.finish?.eyes)) for (const e of extra.finish.eyes) e.c = warpEye(e.c).map((v) => +v.toFixed(3));
  const fullN = normals(pos, idx0);
  const { hi, lo, posed = {} } = job.texture && rig
    ? await bakeTextured(id, job, pos, idx0, fullN, rig, extra.finish?.eyes?.[0] ?? null, spineZ, poseSrc, skinBind)
    : { hi: await build(id, job, paint, 'hi', simplified(pos, idx0, job.tris[0]), fullN, rig, spineZ), lo: await build(id, job, paint, 'lo', simplified(pos, idx0, job.tris[1]), fullN, rig, spineZ) };
  if (process.argv.includes('--eyes')) {
    // Candidate eye bulges: clusters of the highest vertices on each side of the midline (cm).
    let ymax = -1e9; for (let i = 0; i < pos.length / 3; i++) ymax = Math.max(ymax, pos[i*3+1]);
    const out = {};
    for (const side of ['L', 'R']) {
      const pts = [];
      for (let i = 0; i < pos.length / 3; i++) { const x = pos[i*3]; if ((side === 'R') !== (x > 0) || Math.abs(x) < 0.04 * ymax * 5) continue; if (job.headZ && pos[i*3+2] * 100 < job.headZ) continue; pts.push([pos[i*3] * 100, pos[i*3+1] * 100, pos[i*3+2] * 100]); }
      pts.sort((p, q) => q[1] - p[1]);
      out[side] = pts.slice(0, 40).reduce((m, p) => m.map((v, j) => v + p[j] / 40), [0, 0, 0]).map((v) => +v.toFixed(2));
    }
    console.log('  eye candidates (mean of the 40 highest vertices per side, cm)', JSON.stringify(out));
  }
  manifest[id] = { file: `${id.replace(':', '-')}.glb`, lo: `${id.replace(':', '-')}.lo.glb`, legs: job.legs, ...(job.rig ? { rig: 'baked' } : {}), ...(job.rigLeg ? { rigLeg: job.rigLeg } : {}),
    ...(job.palette ? { palette: true } : {}), ...(spineZ ? { bodyZ: spineZ.map((v) => +(v * 100).toFixed(3)) } : {}), tris: { hi: hi.tris, lo: lo.tris }, sizeCm: hi.size.map((v) => +v.toFixed(2)), ...extra, ...(skeletonOut ? { skeleton: skeletonOut } : {}) };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${hi.size.map((v) => v.toFixed(2)).join(' x ')} cm (x y z)`);
  // Pose models: drawn by the game instead of the standing one while the animal holds that pose (Animals.draw); the analytic eye
  // goes where the head bone took it.
  for (const [name, P] of Object.entries(posed)) {
    const { moveBy, turnBy } = await import('./rig/skeleton.mjs');
    const H = poseHead[name], ymin = poseSrc[name].ymin;
    // eye centre: cm of the baked frame -> scan units -> moved by the head bone -> back, onto the posed ground
    const toScan = (c) => [c[0] / 100 / k + cx, c[1] / 100 / k + y0, c[2] / 100 / k + cz];
    const fromScan = (q) => [(q[0] - cx) * k * 100, ((q[1] - y0) * k - ymin) * 100, (q[2] - cz) * k * 100];
    const fin = extra.finish ? { ...extra.finish, eyes: (extra.finish.eyes ?? []).map((e) => {
      const out = { ...e, c: fromScan(moveBy(H.m, toScan(e.c))).map((v) => +v.toFixed(3)), ...(job.skeleton.poses[name].eyeLid ? { lid: job.skeleton.poses[name].eyeLid } : {}) };
      for (const key of ['axis', 'h', 'w']) if (e[key]) out[key] = turnBy(H.r, e[key]);
      return out;
    }) } : undefined;
    manifest[`${id}.${name}`] = { file: `${id.replace(':', '-')}.${name}.glb`, lo: `${id.replace(':', '-')}.${name}.lo.glb`, legs: job.legs, pose: name, rig: 'baked',
      tris: { hi: P.hi.tris, lo: P.lo.tris }, sizeCm: P.hi.size.map((v) => +v.toFixed(2)), ...(fin ? { finish: fin } : {}) };
    console.log(`${id}.${name}: hi ${P.hi.tris} tris ${(P.hi.bytes / 1024) | 0} KB, ${P.hi.size.map((v) => v.toFixed(2)).join(' x ')} cm`);
  }
}
// Aliases: a morph whose look is the species' default draws the same files (no second copy; the game loads a file once).
const ALIAS = { 'dartfrog:cobalt_spotted': 'dartfrog' };
// The same model in a fixed colour line (a palette model drawn as one line: blue dream is a blue Neocaridina).
const LINE = { blueshrimp: ['shrimp', 'blue'] };
for (const [k, [v, line]] of Object.entries(LINE)) if (manifest[v]) manifest[k] = { ...manifest[v], paletteMorph: line };
for (const k of ['shrimp:red', 'shrimp:wild', 'shrimp:yellow', 'shrimp:orange']) delete manifest[k];     // (per-line files before the palette)
for (const [k, v] of Object.entries(ALIAS)) if (manifest[v]) manifest[k] = { ...manifest[v] };
// (a skeleton is written on one line: the manifest's one-number-a-line layout would add hundreds of lines a species)
const SK = [];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SK.push(v) - 1}@@` : v), 1)
  .replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SK[+i])));
