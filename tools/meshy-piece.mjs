// Turns a raw generated (Meshy) landscape model into a hardscape piece GLB for sim/decor.js: simplified with its texture kept,
// and split into one mesh per loose object (decor.js makes every mesh of a GLB a variant of the piece type, footprint centred and
// base at y = 0, scaled so the largest side is the type's `size` in cm). A scanned ground disc under the model is NOT cut (a height
// and normal cut left a ragged apron, worse than the clean disc): the piece's `sink` in sim/decor.js buries it, and a stamp only
// raises ground, never lowers it, so a sunk apron stays under the substrate.
//
//   node --max-old-space-size=3072 tools/meshy-piece.mjs <raw.glb> <id> [--tris=20000] [--split=1] [--min=40]
//        [--keep=2] [--tex=1024] [--ntex=512] [--orm=1] [--sat=0.7] [--bright=0.85] [--out=public/assets/models]
//
//   --tris      triangle budget of the whole file (attribute-aware: tools/lib/meshy-simplify.mjs)
//   --split     one mesh per connected piece (a collection of 30 rocks becomes 30 variants; crimson driftwood, its two roots)
//   --min       drop pieces under this many triangles (loose chips, floaters); with --split they are not variants
//   --keep      with --split: keep only the `keep` biggest pieces (default all)
//   --tex/--ntex  longest side of the colour map and of the normal map (the game's stone/wood material, render/shaders.js hardscapeMaterial,
//               reads the colour map, the normal map and the green channel of the roughness map); --orm=1 keeps the metal/roughness map, which
//               is dropped by default (a third of the texture bytes for a constant 0.9 roughness)
//   --sat/--bright  scale the colour map's saturation and brightness: generated textures are brighter and more saturated than the game's
//               older scans and its dim tank light (a mossy rock came out silver with lime moss next to the dark boulders)
// Writes <out>/<id>.glb (WebP textures, not yet meshopt: run tools/compress-models.mjs on it) and prints one JSON line.
// Heavy: one file at a time (see "Hardware constraint" in CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, flatten, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import { simplifyAttr } from './lib/meshy-simplify.mjs';

const args = process.argv.slice(2);
const [src, id] = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
if (!src || !id) { console.error('usage: node tools/meshy-piece.mjs <raw.glb> <id> [--tris=20000] [--split=1]'); process.exit(2); }
const budget = +opt('tris', 20000), split = opt('split', '0') === '1', minTris = +opt('min', 40);
const keep = +opt('keep', 0), texSize = +opt('tex', 1024), nTexSize = +opt('ntex', 512), keepOrm = opt('orm', '0') === '1', sat = +opt('sat', 1), bright = +opt('bright', 1), out = opt('out', 'public/assets/models');

await MeshoptSimplifier.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
const root = doc.getRoot();
await doc.transform(flatten(), dedup(), weld());
const trisOf = (d) => d.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const before = Math.round(trisOf(doc));
if (before > budget) simplifyAttr(doc, budget);

// One primitive from here on (a Meshy file is one mesh with one material).
const mesh0 = root.listMeshes()[0], prim0 = mesh0.listPrimitives()[0];
const pos = prim0.getAttribute('POSITION').getArray(), idx = prim0.getIndices().getArray();
const nTri = idx.length / 3;
let minY = Infinity, maxY = -Infinity;
for (let i = 1; i < pos.length; i += 3) { if (pos[i] < minY) minY = pos[i]; if (pos[i] > maxY) maxY = pos[i]; }
const H = maxY - minY;

// Connected pieces (vertices joined by position: the texture seams split them in the file).
const keyOf = new Map(), vid = new Int32Array(pos.length / 3);
for (let i = 0; i < vid.length; i++) {
  const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
  if (!keyOf.has(k)) keyOf.set(k, keyOf.size);
  vid[i] = keyOf.get(k);
}
const parent = Int32Array.from({ length: keyOf.size }, (_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
for (let t = 0; t < nTri; t++) {
  const a = find(vid[idx[t * 3]]), b = find(vid[idx[t * 3 + 1]]), c = find(vid[idx[t * 3 + 2]]);
  parent[b] = a; parent[find(c)] = a;
}
const comps = new Map();
for (let t = 0; t < nTri; t++) { const r = find(vid[idx[t * 3]]); (comps.get(r) ?? comps.set(r, []).get(r)).push(t); }
let groups = [...comps.values()].filter((g) => g.length >= minTris).sort((a, b) => b.length - a.length);
const dropped = comps.size - groups.length;
if (split && keep) groups = groups.slice(0, keep);
const meshesOut = split ? groups.map((g) => [g]) : [groups.flat()];

// New meshes on the same material and attribute data; compactPrimitive then keeps only the vertices each one uses.
const scene = root.listScenes()[0], material = prim0.getMaterial(), attrs = prim0.listSemantics().map((s) => [s, prim0.getAttribute(s)]);
for (const n of root.listNodes()) n.dispose();
mesh0.dispose();
const parts = [];
meshesOut.forEach((tris, k) => {
  const list = tris.flat();
  const ind = new Uint32Array(list.length * 3);
  list.forEach((t, i) => { ind[i * 3] = idx[t * 3]; ind[i * 3 + 1] = idx[t * 3 + 1]; ind[i * 3 + 2] = idx[t * 3 + 2]; });
  const prim = doc.createPrimitive().setMaterial(material).setIndices(doc.createAccessor().setType('SCALAR').setArray(ind));
  for (const [s, acc] of attrs) prim.setAttribute(s, acc);
  compactPrimitive(prim);
  const name = `${id}_${String(k).padStart(2, '0')}`;
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  const p = prim.getAttribute('POSITION'), mn = p.getMin([]), mx = p.getMax([]);
  parts.push({ name, tris: list.length, size: mx.map((v, i) => +(v - mn[i]).toFixed(3)) });
});
if (!keepOrm) for (const m of root.listMaterials()) m.setMetallicRoughnessTexture(null);
await doc.transform(
  prune(),
  textureCompress({ encoder: sat === 1 && bright === 1 ? sharp : (b) => sharp(b).modulate({ saturation: sat, brightness: bright }), targetFormat: 'webp', resize: [texSize, texSize], quality: 90, slots: /^(?!.*normal).*$/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [nTexSize, nTexSize], quality: 90, slots: /normal/ }),
);
fs.mkdirSync(out, { recursive: true });
const dest = path.join(out, `${id}.glb`);
await io.write(dest, doc);
console.log(JSON.stringify({ id, srcMB: +(fs.statSync(src).size / 1048576).toFixed(1), trisBefore: before, trisAfter: parts.reduce((n, p) => n + p.tris, 0), droppedPieces: dropped, meshes: parts.length, outMB: +(fs.statSync(dest).size / 1048576).toFixed(2), height: +H.toFixed(3), parts: parts.slice(0, 8) }));
