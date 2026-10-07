// Decode the game's baked firesal.glb (meshopt + quantised) into a plain GLB for Blender, and write the manifest skeleton as JSON (cm, baked frame).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const root = '/Users/rubykim/Documents/paludarium master/.agents/wt-firesal/';
const out = '/Users/rubykim/Documents/paludarium master/.agents/firesal/blender/';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const [src, dst] of [['firesal.glb', 'firesal_hi.glb'], ['firesal.lo.glb', 'firesal_lo.glb']]) {
  const doc = await io.read(root + 'public/assets/creatures/' + src);
  await doc.transform(dequantize());
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'KHR_mesh_quantization') e.dispose();   // plain buffers out
  await io.write(out + dst, doc);
}
const man = JSON.parse(fs.readFileSync(root + 'public/assets/creatures/manifest.json', 'utf8')).firesal;
fs.writeFileSync(out + 'firesal.bones.json', JSON.stringify(man.skeleton, null, 1));
console.log('bones', man.skeleton.bones.length, 'species', man.skeleton.species, 'size', man.sizeCm);
