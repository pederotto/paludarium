// Puts the fire salamander's mouth, modelled in Blender, into the game files, and (with --uv) gives it UVs and its maps (6 Oct). The pipeline:
//   1. node tools/bake-lizard.mjs firesal --no-mouth ; node tools/rig/firesal-plain.mjs      -> .agents/firesal/blender/firesal_hi.glb (the head without a mouth)
//   2. Blender -b -P tools/blender/firesal-mouth.py -- <that glb> <mouth.glb>                -> the mouth, the jaw weights folded into _SKIN/_SKINX
//   3. node tools/bake-lizard.mjs firesal                                                   -> the bake's own file: the skeleton extras WITH the jaw bone
//   4. node tools/rig/firesal-finish.mjs <mouth.glb>                                         -> this script, vertex colours (the old painter's), as before
//      node tools/rig/firesal-finish.mjs <mouth.glb> --uv --plain out/firesal.plain.glb --bones out/firesal.bones.json
//          -> xatlas UVs (tools/rig/texture.mjs, as the toad's), a low level that keeps the seams, a plain GLB with the UVs for Blender's skin bake
//      node tools/rig/firesal-finish.mjs <mouth.glb> --uv --color c.webp --normal n.webp  -> the maps embedded in the near file (the low level draws with its material)
//   5. npm run import-creatures -- --baked=firesal
// Units: metres, the baked frame (x lateral, y up, z forward).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import { unwrap, uvStats, simplifyKeepingSeams } from './texture.mjs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const args = process.argv.slice(2), flag = (k) => args.includes(`--${k}`), opt = (k, d = null) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const src = args.find((a) => !a.startsWith('--') && !fs.existsSync(a) === false) ?? '../firesal/blender/firesal_mouth_hi.glb';
const DIR = 'public/assets/creatures/', hiFile = DIR + 'firesal.glb', loFile = DIR + 'firesal.lo.glb', SIZE = +opt('size', 1024), UV = flag('uv');
const tpl = await io.read(hiFile);                                    // the bake's own file: its extras (skeleton with the jaw bone, measures)
const extras = tpl.getRoot().listMeshes()[0].getExtras();
if (!extras?.skeleton?.bones?.some((b) => b.name === 'jaw')) throw new Error('the template has no jaw bone: bake with the mouth first (step 3)');
const doc = await io.read(src);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const take = (name, comps, must = true) => {
  const acc = prim.getAttribute(name); if (!acc) { if (must) throw new Error(`the Blender file has no ${name}`); return null; }
  const n = acc.getCount(), out = new Float32Array(n * comps), el = [];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let c = 0; c < comps; c++) out[i * comps + c] = el[c]; }
  return out;
};
let a = { pos: take('POSITION', 3), nor: take('NORMAL', 3), col: take('COLOR_0', 3), rig: take('_RIG', 4), skin: take('_SKIN', 4), skinx: take('_SKINX', 4), idx: Uint32Array.from(prim.getIndices().getArray()) };
const bad = (b) => { let k = 0; for (let i = 0; i < b.skin.length / 4; i++) for (const [arr, o] of [[b.skin, 0], [b.skin, 1], [b.skinx, 0], [b.skinx, 1]]) if (arr[i * 4 + 2 + o] > 1e-4 && Math.abs(arr[i * 4 + o] * 32 - Math.round(arr[i * 4 + o] * 32)) > 0.02) k++; return k; };
if (bad(a)) throw new Error(`${bad(a)} bone ids are not whole numbers (a vertex made by averaging breaks the shader's bone lookup)`);
const pick = (arr, w, from) => { const o = new Float32Array(from.length * w); for (let i = 0; i < from.length; i++) for (let c = 0; c < w; c++) o[i * w + c] = arr[from[i] * w + c]; return o; };
const remap = (b, from, idx) => ({ pos: pick(b.pos, 3, from), nor: pick(b.nor, 3, from), col: b.col && pick(b.col, 3, from), rig: pick(b.rig, 4, from), skin: pick(b.skin, 4, from), skinx: pick(b.skinx, 4, from), uv: b.uv && pick(b.uv, 2, from), idx });
const report = { src, verts: a.pos.length / 3, tris: a.idx.length / 3 };

let hi = a, lo = null;
if (UV) {
  const u = await unwrap(a.pos, a.idx, SIZE);
  hi = remap(a, u.from, u.idx); hi.uv = u.uv;
  report.uv = { ...uvStats(hi.uv, hi.idx, hi.pos, SIZE), atlas: [u.width, u.height], verts: hi.pos.length / 3 };
  const s = simplifyKeepingSeams(hi.pos, hi.idx, 8000, hi.uv);
  const sub = remap(hi, s.from, null); sub.uv = pick(hi.uv, 2, s.from);
  lo = { ...sub, idx: Uint32Array.from(s.idx) };                    // (simplifyKeepingSeams returns the index list already compacted to the kept vertices, in `from` order)
  report.lo = { verts: lo.pos.length / 3, tris: lo.idx.length / 3 };
}

async function write(file, b, { texture = null, normal = null, colours = false } = {}) {
  const out = new Document(), buf = out.createBuffer(), acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const p = out.createPrimitive().setAttribute('POSITION', acc('VEC3', b.pos)).setAttribute('NORMAL', acc('VEC3', b.nor));
  if (b.uv) p.setAttribute('TEXCOORD_0', acc('VEC2', b.uv));
  if (colours && b.col) p.setAttribute('COLOR_0', acc('VEC3', b.col));
  p.setAttribute('_RIG', acc('VEC4', b.rig)).setAttribute('_SKIN', acc('VEC4', b.skin)).setAttribute('_SKINX', acc('VEC4', b.skinx)).setIndices(acc('SCALAR', b.idx));
  const mat = out.createMaterial('firesal').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.6);
  if (texture) {
    out.createExtension(EXTTextureWebP).setRequired(true);
    mat.setBaseColorTexture(out.createTexture('firesal').setImage(fs.readFileSync(texture)).setMimeType('image/webp'));
    if (normal) mat.setNormalTexture(out.createTexture('firesal.n').setImage(fs.readFileSync(normal)).setMimeType('image/webp'));
  }
  p.setMaterial(mat);
  out.createScene().addChild(out.createNode('firesal').setMesh(out.createMesh('firesal').addPrimitive(p).setExtras(extras)));
  await out.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeGeneric: 12, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, out);
  return Math.round(fs.statSync(file).size / 1024);
}
// the near file: textured when maps are given, else the painter's vertex colours; the low level (with --uv) carries the same UVs and no image
report.hiKb = await write(hiFile, hi, { texture: opt('color'), normal: opt('normal'), colours: !opt('color') });
if (lo) report.loKb = await write(loFile, lo, { colours: !opt('color') });
// for Blender's skin bake: a plain GLB with the UVs (and the Blender vertex colour: the inside of the mouth is painted red there), and the bones
if (opt('plain')) {
  const d = new Document(), b = d.createBuffer(), ac = (t, r) => d.createAccessor().setType(t).setArray(r).setBuffer(b);
  const pp = d.createPrimitive().setAttribute('POSITION', ac('VEC3', hi.pos)).setAttribute('NORMAL', ac('VEC3', hi.nor)).setAttribute('TEXCOORD_0', ac('VEC2', hi.uv)).setAttribute('COLOR_0', ac('VEC3', hi.col)).setIndices(ac('SCALAR', hi.idx));
  d.createScene().addChild(d.createNode('firesal').setMesh(d.createMesh('firesal').addPrimitive(pp)));
  await io.write(opt('plain'), d); report.plain = opt('plain');
}
if (opt('bones')) { fs.writeFileSync(opt('bones'), JSON.stringify(extras.skeleton, null, 1)); report.bones = opt('bones'); }
console.log(JSON.stringify(report));
