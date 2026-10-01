import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  console.log('\n==', f.split('/').pop(), (fs.statSync(f).size / 1e6).toFixed(2) + ' MB');
  console.log('extensions', doc.getRoot().listExtensionsUsed().map(e => e.extensionName));
  console.log('scenes', root.listScenes().length, 'nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'materials', root.listMaterials().length, 'textures', root.listTextures().length, 'anims', root.listAnimations().length, 'skins', root.listSkins().length);
  let tv = 0, ti = 0; const bb = { min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] };
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); tv += pos.getCount(); ti += (p.getIndices()?.getCount() ?? pos.getCount()) / 3;
    const mn = pos.getMin([]), mx = pos.getMax([]);
    for (let i = 0; i < 3; i++) { bb.min[i] = Math.min(bb.min[i], mn[i]); bb.max[i] = Math.max(bb.max[i], mx[i]); }
    console.log(' prim', m.getName(), 'verts', pos.getCount(), 'tris', Math.round((p.getIndices()?.getCount() ?? pos.getCount()) / 3), 'attrs', p.listSemantics().join(','), 'mat', p.getMaterial()?.getName());
  }
  console.log('total verts', tv, 'tris', Math.round(ti), 'bbox', bb.min.map(v=>+v.toFixed(3)), bb.max.map(v=>+v.toFixed(3)), 'size', bb.max.map((v,i)=>+(v-bb.min[i]).toFixed(3)));
  for (const m of root.listMaterials()) console.log(' material', m.getName(), 'base', m.getBaseColorFactor().map(v=>+v.toFixed(2)), 'tex', !!m.getBaseColorTexture(), 'normal', !!m.getNormalTexture(), 'orm', !!m.getMetallicRoughnessTexture(), 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), 'alpha', m.getAlphaMode());
  for (const t of root.listTextures()) console.log(' texture', t.getName(), t.getMimeType(), t.getSize(), (t.getImage()?.byteLength/1e3|0)+' KB');
  for (const n of root.listNodes().slice(0, 12)) console.log(' node', n.getName(), 'mesh', !!n.getMesh(), 'scale', n.getScale().map(v=>+v.toFixed(3)), 'trans', n.getTranslation().map(v=>+v.toFixed(2)));
}
