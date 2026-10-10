// First pass over a raw generated static model (Meshy: plants, wood, rock, cacti ...): flattens the node tree, welds, simplifies to a
// triangle budget with meshoptimizer, shrinks the textures to WebP and writes a light GLB plus one line of facts (size, bounding
// box, materials, textures). Raw Meshy meshes run 0.2 to 2.1 million triangles and 4096 px textures; nothing here goes into
// public/assets/ by itself: this is the preview/budget step, tools/compress-models.mjs packs the final file.
//
//   node --max-old-space-size=3072 tools/meshy-decor.mjs <in.glb> --tris=20000 [--tex=1024] [--out=dir] [--err=0.5] [--uvw=2] [--nw=0.5] [--permissive=0] [--name=<output name>]
//
// Writes <out>/<name>.glb (name = the file without "Meshy_AI_" and "_texture") and prints a JSON line. One file at a time: a 2M
// triangle model with four 4K textures needs about 1.5 GB (this Mac has 8 GB and is usually busy: see "Hardware constraint").
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, flatten, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import { simplifyAttr, slug } from './lib/meshy-simplify.mjs';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
if (!src) { console.error('usage: node tools/meshy-decor.mjs <in.glb> --tris=20000 [--tex=1024] [--out=dir]'); process.exit(2); }
const budget = +opt('tris', 20000), texSize = +opt('tex', 1024), out = opt('out', '../.agents/meshy-1008/lod'), err = +opt('err', 0.5);
// name: the words of the Meshy title plus the last six digits of its time stamp (two files can share a title)
const name = opt('name', '') || slug(src);

const tris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);

await MeshoptSimplifier.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
const root = doc.getRoot();
const before = Math.round(tris(doc));
const texBefore = root.listTextures().map((t) => t.getSize().join('x'));
await doc.transform(flatten(), dedup(), weld());
if (before > budget) simplifyAttr(doc, budget, { err, uvw: +opt('uvw', 2), nw: +opt('nw', 0.5), permissive: opt('permissive', '1') === '1' });
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82, slots: /^(?!.*normal).*$/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 90, slots: /normal/ }),
);
fs.mkdirSync(out, { recursive: true });
const dest = path.join(out, `${name}.glb`);
await io.write(dest, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
const dim = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
console.log(JSON.stringify({
  name, srcMB: +(fs.statSync(src).size / 1048576).toFixed(1), trisBefore: before, trisAfter: Math.round(tris(doc)), outMB: +(fs.statSync(dest).size / 1048576).toFixed(2),
  size: dim, min: b.min.map((v) => +v.toFixed(3)),
  meshes: root.listMeshes().length, prims: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
  mats: root.listMaterials().map((m) => `${m.getAlphaMode()}${m.getDoubleSided() ? '/2s' : ''}`),
  tex: texBefore, slots: root.listMaterials().map((m) => [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getEmissiveTexture(), m.getOcclusionTexture()].map((t) => (t ? 1 : 0)).join('')),
}));
