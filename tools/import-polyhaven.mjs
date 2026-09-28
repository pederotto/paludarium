// Imports Poly Haven (CC0) models and textures into assets/, optimised for
// the web with gltf-transform: meshes simplified with meshoptimizer,
// textures resized with sharp, everything packed into one .glb per model.
//
// Poly Haven itself isn't reachable from every network, so this reads a
// local folder in Poly Haven's layout (<asset>/<asset>.gltf + textures/, and
// <texture>/<texture>_diff_1k.jpg). One public mirror of that layout is
// https://github.com/JimLiu/taohuayuan (assets-src/polyhaven):
//
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/JimLiu/taohuayuan
//   git -C taohuayuan sparse-checkout set assets-src/polyhaven
//   node tools/import-polyhaven.mjs taohuayuan/assets-src/polyhaven

import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune, textureCompress, resample, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('usage: node tools/import-polyhaven.mjs <folder with Poly Haven assets>');
  process.exit(1);
}
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'assets');

// name → fraction of triangles to keep, texture size
const MODELS = {
  rock_moss_set_01: [0.3, 512],
  rock_moss_set_02: [0.3, 512],
  rock_face_01: [0.3, 512],
  root_cluster_01: [0.2, 512],
  fern_02: [1, 512],
  weed_plant_02: [0.6, 512],
  tree_stump_01: [0.12, 512],
  dead_tree_trunk: [0.06, 512],
};
// Ground textures: diffuse + GL normal at 512 px.
const TEXTURES = ['clean_pebbles', 'forest_ground_04', 'forrest_ground_01', 'mossy_rock', 'lichen_rock', 'cliff_side', 'brown_mud_leaves_01'];

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(path.join(out, 'models'), { recursive: true });
fs.mkdirSync(path.join(out, 'ground'), { recursive: true });

for (const [name, [ratio, size]] of Object.entries(MODELS)) {
  const file = path.join(src, name, `${name}.gltf`);
  if (!fs.existsSync(file)) { console.warn('missing', file); continue; }
  const doc = await io.read(file);
  const before = tris(doc);
  await doc.transform(
    dedup(),
    weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false })] : []),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [size, size], quality: 82 }),
  );
  const dest = path.join(out, 'models', `${name}.glb`);
  await io.write(dest, doc);
  console.log(`${name}: ${before} → ${tris(doc)} triangles, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
}

for (const name of TEXTURES) {
  for (const [suffix, tag] of [['diff', ''], ['nor_gl', '_normal']]) {
    const f = path.join(src, name, `${name}_${suffix}_1k.jpg`);
    if (!fs.existsSync(f)) { console.warn('missing', f); continue; }
    const dest = path.join(out, 'ground', `${name}${tag}.jpg`);
    await sharp(f).resize(512, 512).jpeg({ quality: 82, mozjpeg: true }).toFile(dest);
  }
  console.log('texture', name);
}

function tris(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
}
