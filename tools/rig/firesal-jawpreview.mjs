// Opens the baked fire salamander's jaw by a given angle (the jaw weights of the baked mesh, a rotation about the hinge) and writes a plain GLB for
// the Blender head views. Not the runtime pose (render/creatures/lizardpose.js): it only shows the mouth the bake built.
//   node tools/rig/firesal-jawpreview.mjs 0 20 38        -> ../firesal/blender/firesal_open<deg>.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8')).firesal;
const jawIdx = man.skeleton.bones.findIndex((b) => b.name === 'jaw'), jaw = man.skeleton.bones[jawIdx];
if (jawIdx < 0) throw new Error('no jaw bone in the manifest');
for (const deg of process.argv.slice(2).map(Number)) {
  const doc = await io.read('public/assets/creatures/firesal.glb');
  await doc.transform(dequantize());
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'KHR_mesh_quantization') e.dispose();
  const node = doc.getRoot().listNodes().find((n) => n.getMesh()), s = node.getScale(), t = node.getTranslation();
  const prim = node.getMesh().listPrimitives()[0], pos = prim.getAttribute('POSITION'), sk = prim.getAttribute('_SKIN'), skx = prim.getAttribute('_SKINX');
  const h = jaw.head, th = (deg * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th), v = [], a = [], b = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v); sk.getElement(i, a); skx.getElement(i, b);
    let w = 0; for (const [arr, o] of [[a, 0], [a, 1], [b, 0], [b, 1]]) if (Math.round(arr[o] * 32) === jawIdx) w += arr[2 + o];
    if (w <= 0) continue;
    const X = (v[0] * s[0] + t[0]) * 100, Y = (v[1] * s[1] + t[1]) * 100, Z = (v[2] * s[2] + t[2]) * 100;
    const dy = Y - h[1], dz = Z - h[2], Y2 = h[1] + dy * c - dz * sn, Z2 = h[2] + dy * sn + dz * c;
    v[0] = (X / 100 - t[0]) / s[0]; v[1] = ((Y + (Y2 - Y) * w) / 100 - t[1]) / s[1]; v[2] = ((Z + (Z2 - Z) * w) / 100 - t[2]) / s[2];
    pos.setElement(i, v);
  }
  await io.write(`../firesal/blender/firesal_open${deg}.glb`, doc);
  console.log('wrote open', deg);
}
