// Prepares a generated animal model (Meshy, Tripo ...: a GLB with no real scale and any facing) for tools/import-creatures.mjs:
// turns the head to +Z (the game's frame, back up), scales the longest side to the animal's real length, centres it on the origin and
// bakes all of that into the vertices (node transforms are dropped). Writes <out>/<id>.glb, in metres, textures untouched.
//
//   node tools/meshy-prep.mjs <in.glb> <id> --cm=10.8 --head=-x [--fold=1.0:0.3] [--out=art-src/creatures-sets]
//
// --head: where the head points in the file as glTF has it (+x, -x, +z, -z). Look at the model first (Blender MCP `look`, or the
// eyes in the texture). --fold=<cm>:<share>: generated fins often stand out sideways like spikes; everything farther than <cm> from the
// midline is pulled toward the body to <share> of its excess (the texture stays). --cm: the real total length in cm (tail fin included); the importer warns when it is far from REAL_CM.
// Then: add the id to REAL_CM in tools/import-creatures.mjs, `npm run import-creatures -- --src=art-src/creatures-sets`
// (the importer rewrites manifest.json: never merge it by hand), and keep the original in art-src/raw/.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const [src, id] = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const cm = +opt('cm', 0), head = opt('head', '-x'), out = opt('out', 'art-src/creatures-sets');
const fold = opt('fold', '').split(':').map(Number), [foldAt, foldK] = fold.length === 2 && fold.every(Number.isFinite) ? fold : [0, 1];
if (!src || !id || !cm) { console.error('usage: node tools/meshy-prep.mjs <in.glb> <id> --cm=<real length> --head=<+x|-x|+z|-z> [--out=dir]'); process.exit(2); }
// (x, y, z) -> where the head ends up on +Z: a proper rotation about Y in each case.
const TURN = { '+z': ([x, y, z]) => [x, y, z], '-z': ([x, y, z]) => [-x, y, -z], '-x': ([x, y, z]) => [z, y, -x], '+x': ([x, y, z]) => [-z, y, x] }[head];
if (!TURN) { console.error(`--head must be +x, -x, +z or -z, not ${head}`); process.exit(2); }

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
await doc.transform(flatten(), prune());
// the node transforms are applied to the vertices first (Meshy files carry a scale or a rotation on the node)
const root = doc.getRoot();
const prims = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) prims.push({ p, m });
  node.setTranslation([0, 0, 0]); node.setRotation([0, 0, 0, 1]); node.setScale([1, 1, 1]);
}
const apply = (v, m) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const applyN = (v, m) => { const r = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]; const l = Math.hypot(...r) || 1; return r.map((c) => c / l); };
const done = new Set();
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const { p, m } of prims) {                                   // pass 1: node matrix and the turn, bounds
  const pos = p.getAttribute('POSITION'); if (done.has(pos)) continue; done.add(pos);
  const a = pos.getArray(), n = p.getAttribute('NORMAL');
  for (let i = 0; i < pos.getCount(); i++) {
    const v = TURN(apply([a[i * 3], a[i * 3 + 1], a[i * 3 + 2]], m));
    a[i * 3] = v[0]; a[i * 3 + 1] = v[1]; a[i * 3 + 2] = v[2];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  }
  pos.setArray(a);
  if (n) { const b = n.getArray(); for (let i = 0; i < n.getCount(); i++) { const v = TURN(applyN([b[i * 3], b[i * 3 + 1], b[i * 3 + 2]], m)); b[i * 3] = v[0]; b[i * 3 + 1] = v[1]; b[i * 3 + 2] = v[2]; } n.setArray(b); }
}
const size = hi.map((h, k) => h - lo[k]);
const k = (cm / 100) / size[2];                                   // metres per file unit: the length (z) is the real length
const c = lo.map((l, i) => (l + hi[i]) / 2);
for (const pos of done) {                                         // pass 2: scale and centre
  const a = pos.getArray();
  for (let i = 0; i < pos.getCount(); i++) {
    for (let j = 0; j < 3; j++) a[i * 3 + j] = (a[i * 3 + j] - c[j]) * k;
    if (foldK < 1) { const ax = Math.abs(a[i * 3]) * 100; if (ax > foldAt) a[i * 3] = Math.sign(a[i * 3]) * (foldAt + (ax - foldAt) * foldK) / 100; }
  }
  pos.setArray(a);
}
fs.mkdirSync(out, { recursive: true });
await io.write(path.join(out, `${id}.glb`), doc);
console.log(`${id}: ${path.basename(src)} -> ${path.join(out, id + '.glb')}  head ${head} -> +z, ${cm} cm long; file box before ${size.map((v) => v.toFixed(3)).join(' x ')}; after ${size.map((v) => (v * k * 100).toFixed(2)).join(' x ')} cm (x, y, z)`);
