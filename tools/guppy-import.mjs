// Puts the owner's prepared guppy models (art-src/guppy/out/, made by art-src/guppy/prep_glb.py) into the game:
//   public/assets/creatures/guppy.glb, guppy.lo.glb              the male (the species' default model, with the owner's own texture)
//   public/assets/creatures/guppy-female.glb, guppy-female.lo.glb the female (and the fry)
//   public/assets/creatures/guppy/<sex>-coords.png, -parts.png, -base.webp   the maps the strain painter reads (guppypaint.js)
// then records them in art-src/creatures/overrides.json under "guppy" and writes the manifest key with
// `npm run import-creatures -- --baked=guppy` (never hand-edit the manifest).
//   node tools/guppy-import.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PropertyType } from '@gltf-transform/core';
import { dedup, prune, textureCompress, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const SRC = 'art-src/guppy/out', OUT = 'public/assets/creatures';
fs.mkdirSync(`${OUT}/guppy`, { recursive: true });
const files = { male: 'guppy', female: 'guppy-female' };
const meta = {};
for (const [sex, name] of Object.entries(files)) {
  for (const lod of ['', '.lo']) {
    const doc = await io.read(`${SRC}/${sex}${lod}.glb`);
    // the prepared file is in cm; the game reads metres (glb.js multiplies by 100)
    for (const n of doc.getRoot().listScenes()[0].listChildren()) n.setScale([0.01, 0.01, 0.01]);
    // (dedup must not merge the body and fin materials: they differ only by name, and the name is how the game tells a fin)
    await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod ? 512 : 1024, lod ? 512 : 1024] }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(`${OUT}/${name}${lod}.glb`, doc);
  }
  // the game paints each look at 512 x 512 (1 MB of texture a look): the maps go at that size (nearest for the coordinates and parts,
  // which must not be blended across a UV seam)
  for (const m of ['coords', 'parts']) await sharp(`${SRC}/${sex}-${m}.png`).resize(512, 512, { kernel: 'nearest' }).png({ compressionLevel: 9 }).toFile(`${OUT}/guppy/${sex}-${m}.png`);
  await sharp(`${SRC}/${sex}-base.png`).resize(512, 512).webp({ quality: 92 }).toFile(`${OUT}/guppy/${sex}-base.webp`);
  const j = JSON.parse(fs.readFileSync(`${SRC}/${sex}.json`, 'utf8'));
  meta[sex] = { file: `${name}.glb`, lo: `${name}.lo.glb`, coords: `guppy/${sex}-coords.png`, parts: `guppy/${sex}-parts.png`, base: `guppy/${sex}-base.webp`, slCm: j.slCm, totalCm: j.totalCm, ...(j.eye ? { eye: j.eye } : {}) };
  console.log(sex, fs.statSync(`${OUT}/${name}.glb`).size, 'bytes', fs.statSync(`${OUT}/${name}.lo.glb`).size, 'bytes (lo)');
}
const ov = 'art-src/creatures/overrides.json', o = JSON.parse(fs.readFileSync(ov, 'utf8'));
o.guppy = { ...(o.guppy ?? {}), finish: { rough: 0.38, coat: 0.3, coatRough: 0.25, grainAmt: 0.15, finOpacity: 0.85, finAlpha: 1, flutter: 0.03 }, guppy: meta };
fs.writeFileSync(ov, JSON.stringify(o, null, 1) + '\n');
execSync('npm run import-creatures -- --baked=guppy', { stdio: 'inherit' });
