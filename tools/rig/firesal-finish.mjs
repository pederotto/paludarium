// Puts the fire salamander's mouth, modelled in Blender, into the game file (6 Oct). The pipeline:
//   1. node tools/bake-lizard.mjs firesal --no-mouth   -> the head without a mouth (and the skeleton extras: run once WITH the mouth to get the jaw bone in them)
//   2. node tools/rig/firesal-plain.mjs                -> a plain GLB for Blender (.agents/firesal/blender/firesal_hi.glb)
//   3. Blender (live, through its tools): the head bisected along the lip plane, the slit split, three rings of palate and floor, caps, a back wall,
//      the jaw vertex group and a jaw bone, jaw weights folded into _SKIN/_SKINX; exported as .agents/firesal/blender/firesal_mouth_hi.glb
//   4. node tools/bake-lizard.mjs firesal              -> the file with the bake's own (JS) mouth: the skeleton extras with the jaw bone, and the low level
//   5. node tools/rig/firesal-finish.mjs <blender glb> -> this script: the near level's mesh replaced by Blender's, the extras kept, compressed as the bake does
//   6. npm run import-creatures -- --baked=firesal
// Units: the Blender file is in metres in the baked frame (x lateral, y up, z forward), as the bake's.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const src = process.argv[2] ?? '../firesal/blender/firesal_mouth_hi.glb', target = process.argv[3] ?? 'public/assets/creatures/firesal.glb';
const tpl = await io.read(target);                                    // the bake's own file: its extras (skeleton with the jaw bone, measures)
const extras = tpl.getRoot().listMeshes()[0].getExtras();
if (!extras?.skeleton?.bones?.some((b) => b.name === 'jaw')) throw new Error('the template has no jaw bone: bake with the mouth first (step 4)');
const doc = await io.read(src);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const take = (name, comps) => {
  const acc = prim.getAttribute(name); if (!acc) throw new Error(`the Blender file has no ${name}`);
  const n = acc.getCount(), out = new Float32Array(n * comps), el = [];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let c = 0; c < comps; c++) out[i * comps + c] = el[c]; }
  return out;
};
const a = { pos: take('POSITION', 3), nor: take('NORMAL', 3), col: take('COLOR_0', 3), rig: take('_RIG', 4), skin: take('_SKIN', 4), skinx: take('_SKINX', 4), idx: Uint32Array.from(prim.getIndices().getArray()) };
// the bone ids must be whole numbers / 32 (a vertex made by averaging would break the shader's bone lookup)
let bad = 0; for (let i = 0; i < a.skin.length / 4; i++) for (const [arr, o] of [[a.skin, 0], [a.skin, 1], [a.skinx, 0], [a.skinx, 1]]) if (arr[i * 4 + 2 + o] > 1e-4 && Math.abs(arr[i * 4 + o] * 32 - Math.round(arr[i * 4 + o] * 32)) > 0.02) bad++;
if (bad) throw new Error(`${bad} bone ids are not whole numbers`);
const out = new Document(), buf = out.createBuffer(), acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const p = out.createPrimitive()
  .setAttribute('POSITION', acc('VEC3', a.pos)).setAttribute('NORMAL', acc('VEC3', a.nor)).setAttribute('COLOR_0', acc('VEC3', a.col))
  .setAttribute('_RIG', acc('VEC4', a.rig)).setAttribute('_SKIN', acc('VEC4', a.skin)).setAttribute('_SKINX', acc('VEC4', a.skinx)).setIndices(acc('SCALAR', a.idx))
  .setMaterial(out.createMaterial('firesal').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.6));
out.createScene().addChild(out.createNode('firesal').setMesh(out.createMesh('firesal').addPrimitive(p).setExtras(extras)));
await out.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeGeneric: 12, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(target, out);
console.log(JSON.stringify({ target, verts: a.pos.length / 3, tris: a.idx.length / 3, kb: Math.round(fs.statSync(target).size / 1024), bones: extras.skeleton.bones.length }));
