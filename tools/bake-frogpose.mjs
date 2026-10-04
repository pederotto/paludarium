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
  'toad.swim': SWIM(4.5, 'bombina', 'toad'),
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
  const k = job.cmPerUnit / 100, zc = (A.zs + A.zv) / 2;
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
    const w = await writeGlb(id, level, g.pos, nor, col, g.idx, rig, sk);
    return { ...w, tris: g.idx.length / 3 };
  };
  const hi = await lod('hi', job.tris[0]), lo = await lod('lo', job.tris[1]);
  // The eyes sit on the upper side of the head, a third of the way back from the snout: found by looking at the model with
  // markers (tools: scratch headview), in cm for the 3.3 cm-a-unit leucomelas and scaled for the smaller frogs.
  const sc = job.cmPerUnit / 3.3, eye = [0.48 * sc, 1.18 * sc, 1.6 * sc].map((v) => +v.toFixed(2));
  const base = EYES[job.eyes].finish, e0 = base.eyes[0];
  const finish = { ...base, eyes: [{ ...e0, c: eye, r: +(0.3 * sc).toFixed(3) }] };
  const size = [0, 0, 0].map((_, a) => { let lo2 = 1e9, hi2 = -1e9; for (let i = 0; i < A.n; i++) { lo2 = Math.min(lo2, pos[i * 3 + a]); hi2 = Math.max(hi2, pos[i * 3 + a]); } return +((hi2 - lo2) * 100).toFixed(2); });
  // The skeleton in the baked frame (cm), for the game's runtime skinning (`bind: 'swim'`: posed by the stroke, skeleton.js poseStroke).
  const cm = (j) => [+(j[0] * k * 100).toFixed(3), +((j[1] - A.yb) * k * 100).toFixed(3), +((j[2] - zc) * k * 100).toFixed(3)];
  const rOf = (b) => SWIM_SKELETON.radius[b.name.replace(/[LR]$/, '')] ?? 0.05;
  const skeleton = { plan: 'anuran', bind: 'swim', bones: frogBones(Object.fromEntries(Object.entries(SWIM_SKELETON.joints).map(([kk, v]) => [kk, cm(v)]))).map((b) => ({ ...b, r: +(rOf(b) * k * 100).toFixed(3) })) };
  manifest[id] = { file: `${id.replace(':', '-')}.glb`, lo: `${id.replace(':', '-')}.lo.glb`, legs: false, pose: 'swim', tris: { hi: hi.tris, lo: lo.tris }, sizeCm: size, finish, skeleton };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${size.join(' x ')} cm (x y z), eye at ${eye.join(', ')} cm`);
}
// (a skeleton is written on one line, as tools/bake-creature.mjs does: the manifest's one-number-a-line layout would add hundreds of lines a species)
const SK = [];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SK.push(v) - 1}@@` : v), 1)
  .replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SK[+i])));
