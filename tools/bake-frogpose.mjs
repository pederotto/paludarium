// Bakes the swimming-pose frog scan (art-src/raw/frog_swim_mesh.glb, an untextured model of a frog in mid-stroke: forelegs out,
// hind legs trailing in a V) into swim-pose models for the frogs that have a baked body: <id>.swim.glb and <id>.swim.lo.glb,
// painted with the species' own colours (tools/paint/<paint>.mjs), and a manifest entry `<id>.swim` that the game draws the
// frog with while it swims (Animals.upgradeModels, Animals.draw). The sitting model stays for everything else.
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

const OUT = 'public/assets/creatures';
// cmPerUnit: the scan's trunk (snout to vent, 1.33 units) has to be the 4.5 cm of the sitting leucomelas; strawberry is 0.511 of that.
const JOBS = {
  'leucomelas.swim': { src: 'frog_swim_mesh', cmPerUnit: 3.3, tris: [30000, 10000], paint: 'leucomelas', eyes: 'leucomelas' },
  'strawberry.swim': { src: 'frog_swim_mesh', cmPerUnit: 1.69, tris: [30000, 7000], paint: 'strawberry', eyes: 'strawberry' },
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

async function writeGlb(id, level, pos, nor, col, idx) {
  const doc = new Document(), buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0));
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, level === 'hi' ? `${id}.glb` : `${id}.lo.glb`);
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
  const { paint } = await import(`./paint/${job.paint}.mjs`);
  cache[job.src] ??= analyse(await readScan(job.src));
  const A = cache[job.src], src = await readScan(job.src);
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
    const w = await writeGlb(id, level, g.pos, nor, col, g.idx);
    return { ...w, tris: g.idx.length / 3 };
  };
  const hi = await lod('hi', job.tris[0]), lo = await lod('lo', job.tris[1]);
  // The eyes sit on the upper side of the head, a third of the way back from the snout: found by looking at the model with
  // markers (tools: scratch headview), in cm for the 3.3 cm-a-unit leucomelas and scaled for the smaller frogs.
  const sc = job.cmPerUnit / 3.3, eye = [0.48 * sc, 1.18 * sc, 1.6 * sc].map((v) => +v.toFixed(2));
  const base = EYES[job.eyes].finish, e0 = base.eyes[0];
  const finish = { ...base, eyes: [{ ...e0, c: eye, r: +(0.3 * sc).toFixed(3) }] };
  const size = [0, 0, 0].map((_, a) => { let lo2 = 1e9, hi2 = -1e9; for (let i = 0; i < A.n; i++) { lo2 = Math.min(lo2, pos[i * 3 + a]); hi2 = Math.max(hi2, pos[i * 3 + a]); } return +((hi2 - lo2) * 100).toFixed(2); });
  manifest[id] = { file: `${id}.glb`, lo: `${id}.lo.glb`, legs: false, pose: 'swim', tris: { hi: hi.tris, lo: lo.tris }, sizeCm: size, finish };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${size.join(' x ')} cm (x y z), eye at ${eye.join(', ')} cm`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
