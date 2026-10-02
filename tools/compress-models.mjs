// Shrinks the hardscape and plant models in public/assets/models/ for download: textures become WebP (alpha kept) no
// larger than 1024 px, and the geometry is meshopt-compressed (EXT_meshopt_compression, decoded by render/assets.js).
// The vertex data stays float32 (no quantization): sim/decor.js reads the raw position, normal and uv arrays.
// The page used to download 6.3 MB of models before the title screen was usable; run this after importing a model.
//   node tools/compress-models.mjs [files…]    (default: every public/assets/models/*.glb; rewrites in place)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { textureCompress, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync('public/assets/models').filter((f) => f.endsWith('.glb')).map((f) => 'public/assets/models/' + f);
let before = 0, after = 0;
for (const f of files) {
  const n0 = fs.statSync(f).size;
  const doc = await io.read(f);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82, slots: /^(?!.*normal).*$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 90, slots: /normal/ }),
    reorder({ encoder: MeshoptEncoder }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(f, doc);
  const n1 = fs.statSync(f).size;
  before += n0; after += n1;
  console.log(`${f.split('/').pop().padEnd(26)} ${Math.round(n0 / 1024)} kB -> ${Math.round(n1 / 1024)} kB`);
}
console.log(`total ${Math.round(before / 1024)} kB -> ${Math.round(after / 1024)} kB`);
