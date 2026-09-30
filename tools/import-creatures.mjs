// Turns raw generated/scanned animal models into game assets.
//
//   npm run import-creatures [-- --src=art-src/creatures --out=public/assets/creatures]
//
// For every <id>.glb in the source folder: merges and cleans it (flatten, dedup,
// weld, prune), writes a detailed version <id>.glb (triangle budget by species
// class, textures resized to 1024 px and re-encoded as WebP, meshopt-compressed) and
// a coarse one <id>.lo.glb for the everyday view, then writes manifest.json, which
// the game reads to swap the models in. See docs/ASSET_BRIEF.md for the spec.
// Optional art-src/creatures/overrides.json: { "dartfrog": { "rotY": 90, "scale": 1.1 } }.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, dedup, weld, prune, simplify, textureCompress, meshopt, quantize, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const SRC = arg('src', 'art-src/creatures'), OUT = arg('out', 'public/assets/creatures');

// File name → species id (morph files that have no species yet are skipped with a note).
const ALIAS = { guppy_male: 'guppy', axolotl_leucistic: 'axolotl' };
const SMALL = new Set(['neon', 'cardinal', 'ember', 'guppy', 'springtail', 'fly', 'isopod', 'oto', 'shrimp', 'tadpole', 'eggs']);
const BUDGET = { hero: { hi: 40000, lo: 7000 }, small: { hi: 9000, lo: 2500 } };
// The animal's real longest dimension in cm, to catch models exported at the wrong scale.
const REAL_CM = { dartfrog: 4.5, strawberry: 2.3, toad: 4.5, leucomelas: 4.5, auratus: 4, axolotl: 14, newt: 12, gecko: 9, crab: 2.2, shrimp: 2.5, snail: 2.5, isopod: 0.7, tadpole: 1.8, springtail: 0.25, fly: 0.3, neon: 3.2, cardinal: 4, ember: 2, guppy: 3, cory: 5.5, oto: 3.5, betta: 6 };
const KNOWN = Object.keys(REAL_CM);

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const tris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);

async function prepare(doc, targetTris, texSize) {
  await doc.transform(flatten(), dedup(), weld(), prune());
  const t = tris(doc);
  if (t > targetTris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: targetTris / t, error: 0.005, lockBorder: false }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize] }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return tris(doc);
}

if (!fs.existsSync(SRC)) { console.error(`No source folder: ${SRC}. Put your .glb files there (see docs/ASSET_BRIEF.md).`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const overrides = fs.existsSync(path.join(SRC, 'overrides.json')) ? JSON.parse(fs.readFileSync(path.join(SRC, 'overrides.json'), 'utf8')) : {};
const manifest = fs.existsSync(path.join(OUT, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) : {};
let n = 0;
for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.glb') && !f.startsWith('_'))) {
  const stem = f.replace(/\.glb$/, '');
  const id = ALIAS[stem] ?? stem;
  if (!KNOWN.includes(id)) { console.log(`skip ${f}: no species "${id}" yet (morphs come later)`); continue; }
  const cls = SMALL.has(id) ? 'small' : 'hero';
  const budget = BUDGET[cls];
  const hiDoc = await io.read(path.join(SRC, f));
  const b = getBounds(hiDoc.getRoot().listScenes()[0]);
  const size = b.max.map((v, i) => v - b.min[i]);              // metres
  const longest = Math.max(...size) * 100;
  const expected = REAL_CM[id];
  const warn = [];
  if (longest < expected * 0.6 || longest > expected * 1.6) warn.push(`longest side is ${longest.toFixed(2)} cm, expected about ${expected} cm: check the scale (units must be metres)`);
  if (size[0] > size[2] * 1.6 && !['snail'].includes(id)) warn.push('wider than long: the head should point to +Z (use overrides.json rotY: 90 if it points along X)');
  const loDoc = await io.read(path.join(SRC, f));
  const hiTris = await prepare(hiDoc, budget.hi, 1024);
  const loTris = await prepare(loDoc, budget.lo, 512);
  await io.write(path.join(OUT, `${id}.glb`), hiDoc);
  await io.write(path.join(OUT, `${id}.lo.glb`), loDoc);
  manifest[id] = { file: `${id}.glb`, lo: `${id}.lo.glb`, tris: { hi: Math.round(hiTris), lo: Math.round(loTris) }, sizeCm: size.map((v) => +(v * 100).toFixed(2)), ...(overrides[id] ?? {}) };
  console.log(`${id}: ${Math.round(hiTris)} tris (lo ${Math.round(loTris)}), ${longest.toFixed(2)} cm longest${warn.length ? '\n   ⚠ ' + warn.join('\n   ⚠ ') : ''}`);
  n++;
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${n} model(s) imported → ${OUT}/manifest.json`);
