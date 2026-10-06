// Writes a meshopt-compressed creature GLB as a plain one (positions and colours decoded), for Blender: node tools/rig/glb-plain.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { dequantize } from '@gltf-transform/functions'; import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]); await doc.transform(dequantize());
for (const e of doc.getRoot().listExtensionsUsed()) e.dispose();
await io.write(process.argv[3], doc); console.log('wrote', process.argv[3]);
