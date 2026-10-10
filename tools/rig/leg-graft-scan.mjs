// A scan's folded or fused limb replaced by the mirror of its clean twin, written as a new scan (the file stays beside the original in art-src/raw, the original untouched):
// the harlequin's right hind leg lies in a Z whose thigh, shin and foot touch (the owner's scan, 8 Oct 2026) while the left one is stretched out behind it, and a skeleton cannot
// unfold a fold whose skin is one lump (docs: "a fused scan cannot be posed into a gait"). The graft is tools/rig/leg-graft.mjs (the red-eyed frog's, bake-frogpose `graft`), here run on
// the scan itself with the limbs picked by place, so the baked body and its binding start from a symmetric pair of legs. //   node tools/rig/leg-graft-scan.mjs <scan> <out> --from="x < -0.2 && z < -0.1" --to="x > 0.2 && z < -0.1" [--rot=0] [--center=0] [--level=1] [--mirror=0] [--shift=dx,dy,dz]
// <scan> and <out> are names in art-src/raw (without .glb). The tests --from/--to are JavaScript on x, y, z in the frame the bake uses (turned by --rot about y, the trunk's x taken to 0 by
// --center, levelled by --level: tools/bake-frogpose.mjs analyse); the output is written back in the scan's own frame. --mirror: the plane's x in that frame (the pelvis' midline).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { graftMirror } from './leg-graft.mjs';

const args = process.argv.slice(2), pos0 = args.filter((a) => !a.startsWith('--')), opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const [scan, out] = pos0;
if (!scan || !out) { console.error('usage: node tools/rig/leg-graft-scan.mjs <scan> <out> --from="…" --to="…" [--rot= --center= --level=1 --mirror= --shift=]'); process.exit(2); }
const ROT = +opt('rot', 0), CENTER = +opt('center', 0), LEVEL = opt('level', '1') !== '0', MIRROR = +opt('mirror', 0);
const isFrom = new Function('x', 'y', 'z', `return ${opt('from', 'false')};`), isTo = new Function('x', 'y', 'z', `return ${opt('to', 'false')};`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(`art-src/raw/${scan}.glb`);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
// a Meshy scan's atlas is a mosaic of patches: every patch edge is a texture seam, so the vertices are split there and the mesh is a heap of islands that touch only in position. The graft
// (and the bake's skin smoothing) need the topology, so the vertices are welded by POSITION and the normals and texture coordinates dropped: the copy is geometry only, its colours come
// from the original scan afterwards (tools/blender/texture-transfer.py, the mirrored left leg standing in as the colour source of the new right one)
prim.setAttribute('NORMAL', null); prim.setAttribute('TEXCOORD_0', null);
await doc.transform(weld({ tolerance: 1e-5 }));
const P = Float32Array.from(prim.getAttribute('POSITION').getArray()), idx = Uint32Array.from(prim.getIndices().getArray()), n = P.length / 3;
console.log(`welded by position: ${n} vertices, ${idx.length / 3} triangles`);

// the bake's frame: rotY, the trunk's x to 0, levelled (a line y = a + b z through the trunk window, rotated about x until flat)
const a = ROT * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), F = new Float32Array(P.length);
for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; F[i * 3] = x * ca + z * sa - CENTER; F[i * 3 + 1] = y; F[i * 3 + 2] = -x * sa + z * ca; }
let th = 0;
if (LEVEL) {
  let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
  for (let i = 0; i < n; i++) { const x = F[i * 3], y = F[i * 3 + 1], z = F[i * 3 + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  th = Math.atan((m * szy - sz * sy) / (m * szz - sz * sz));
  const c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < n; i++) { const y = F[i * 3 + 1], z = F[i * 3 + 2]; F[i * 3 + 1] = y * c - z * s; F[i * 3 + 2] = y * s + z * c; }
}
// --shear "z0,z1,dx": the vertices ahead of z0 moved by -dx in x, blended in smoothly up to z1 (a head set aside from its trunk's midline, brought onto it before the mirror)
if (opt('shear', '')) {
  const [z0, z1, dx] = opt('shear', '').split(',').map(Number);
  for (let i = 0; i < n; i++) { const t = Math.min(1, Math.max(0, (F[i * 3 + 2] - z0) / (z1 - z0))); F[i * 3] -= dx * t * t * (3 - 2 * t); }
  // (the scan's own vertices are written back through the same shear, undone in the output frame: the frame's x for the originals comes from F, not from P)
}
const g = graftMirror({ pos: F, idx, isFrom: (i) => isFrom(F[i * 3], F[i * 3 + 1], F[i * 3 + 2]), isTo: (i) => isTo(F[i * 3], F[i * 3 + 1], F[i * 3 + 2]), mirrorX: MIRROR,
  shift: opt('shift', '') ? opt('shift', '').split(',').map(Number) : null });
console.log('graft', JSON.stringify(g.stats), 'shift', g.shift?.map((v) => +v.toFixed(4)));
// back to the scan's own frame
const m1 = g.pos.length / 3, back = new Float32Array(g.pos.length), c = Math.cos(-th), s = Math.sin(-th);
for (let i = 0; i < m1; i++) {
  const x = g.pos[i * 3], y0 = g.pos[i * 3 + 1], z0 = g.pos[i * 3 + 2], y = y0 * c - z0 * s, z = y0 * s + z0 * c, X = x + CENTER;
  back[i * 3] = X * ca - z * sa; back[i * 3 + 1] = y; back[i * 3 + 2] = X * sa + z * ca;
}
if (!opt('shear', '')) back.set(P);   // (the scan's own vertices exactly as they were; only the copy's are transformed back: with a shear they are all moved, so all are)
prim.getAttribute('POSITION').setArray(back);
prim.getIndices().setArray(g.idx.length > 65535 * 3 || m1 > 65535 ? Uint32Array.from(g.idx) : Uint16Array.from(g.idx));
// geometry only: the scan's material and its three 2048 px maps stay with the original
for (const t of doc.getRoot().listTextures()) t.dispose();
prim.setMaterial(null);
for (const m of doc.getRoot().listMaterials()) m.dispose();
await io.write(`art-src/raw/${out}.glb`, doc);
// what the copy was made in, for the colour source (tools/blender/mirror-source.py rebuilds the textured scan the same way)
fs.writeFileSync(`art-src/raw/${out}.glb.json`, JSON.stringify({ scan, rot: ROT, center: CENTER, level: LEVEL, th, mirror: MIRROR, shear: opt('shear', '') || null, from: opt('from', ''), to: opt('to', '') }, null, 1));
console.log(`wrote art-src/raw/${out}.glb: ${m1} vertices (${m1 - n} new), ${g.idx.length / 3} triangles (was ${idx.length / 3})`);
