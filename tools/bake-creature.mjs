// Bakes untextured creature meshes (art-src/raw/*.glb) into game assets with painted vertex colours.
//
//   node tools/bake-creature.mjs [id ...]        (no ids: every job below)
//
// Steps per job: weld, turn the head to +z, stand it on y = 0, scale to its real length, simplify to a detailed and
// a coarse level of detail, smooth the normals, paint every vertex with tools/paint/<paint>.mjs, and write
// <id>.glb and <id>.lo.glb (meshopt-compressed) plus the manifest entry the game reads.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const OUT = 'public/assets/creatures';
// rotY: degrees about y that turn the mesh's head towards +z. lengthCm: nose-to-tail length of the real animal.
const JOBS = {
  leucomelas: { src: 'frog_mesh', rotY: -90, lengthCm: 4.5, tris: [30000, 10000], paint: "leucomelas", legs: true },
  strawberry: { src: 'frog_mesh', rotY: -90, lengthCm: 2.3, tris: [30000, 7000], paint: 'strawberry', legs: true },
  firesal: { src: 'salamander_mesh', rotY: 90, lengthCm: 18, headZ: 6.2, tris: [32000, 8000], paint: 'firesal', legs: true },
};
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

async function build(id, job, paint, level, geo, fullNormals) {
  const { pos, idx, from } = geo;
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
    const leg = isLeg ? (pos[i*3+2] > zmid ? 1 : 3) + (pos[i*3] > 0 ? 1 : 0) : 0;
    const legT = isLeg ? Math.min(1, (s - xFrac) / (1 - xFrac)) : 0;
    const c = paint({ u: (z1 - pos[i*3+2]) / (z1 - z0), x, y, z, s, h, leg, legT, n: [nor[i*3], nor[i*3+1], nor[i*3+2]] });
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
  const mesh = doc.createMesh(id).addPrimitive(prim);
  doc.createScene().addChild(doc.createNode(id).setMesh(mesh));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, level === 'hi' ? `${id}.glb` : `${id}.lo.glb`);
  await io.write(file, doc);
  return { file, verts: n, tris: idx.length / 3, bytes: fs.statSync(file).size, size: [(x1 - x0) * 100, (y1 - y0) * 100, (z1 - z0) * 100] };
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cache = {};
for (const [id, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(id)) continue;
  const { paint } = await import(`./paint/${job.paint}.mjs`);
  if (!cache[job.src]) {
    const doc = await io.read(`art-src/raw/${job.src}.glb`);
    await doc.transform(weld());
    const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    cache[job.src] = { pos: Float32Array.from(p.getAttribute('POSITION').getArray()), idx: Uint32Array.from(p.getIndices().getArray()) };
  }
  // Orient, stand on the ground, centre, scale to the real length (metres).
  const src = cache[job.src], pos = Float32Array.from(src.pos);
  const a = job.rotY * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); }
  const k = (job.lengthCm / 100) / (z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < pos.length; i += 3) { pos[i] = (pos[i] - cx) * k; pos[i + 1] = (pos[i + 1] - y0) * k; pos[i + 2] = (pos[i + 2] - cz) * k; }
  const fullN = normals(pos, src.idx);
  const hi = await build(id, job, paint, 'hi', simplified(pos, src.idx, job.tris[0]), fullN);
  const lo = await build(id, job, paint, 'lo', simplified(pos, src.idx, job.tris[1]), fullN);
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
  manifest[id] = { file: `${id}.glb`, lo: `${id}.lo.glb`, legs: job.legs, tris: { hi: hi.tris, lo: lo.tris }, sizeCm: hi.size.map((v) => +v.toFixed(2)), ...(EYES[id] ?? {}) };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${hi.size.map((v) => v.toFixed(2)).join(' x ')} cm (x y z)`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
