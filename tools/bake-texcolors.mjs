// Turns a textured, multi-material creature model into one the game can draw: every part's base colour texture is sampled
// at its vertices into vertex colours (linear), so parts with different textures (body, fins, eyes) can share the game's one
// creature material (render/creatures/glb.js reads one texture per model, or vertex colours). Untextured see-through parts
// (a cornea dome) are dropped. Parts are renamed body / fin / eye so glb.js gives them their material ids (fins: the
// see-through pass). The head is turned to +z, the model centred and scaled to its real length in metres, ready for
// `npm run import-creatures`.
//
//   node tools/bake-texcolors.mjs <in.glb> <out.glb> --lengthCm=3 [--rotY=-90] [--finBlend=1]
//     rotY: degrees about y that turn the head to +z (a model whose head points to +x needs -90)
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [inp, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const lengthCm = arg('lengthCm', 3), rotY = arg('rotY', -90);
if (!inp || !out) { console.error('usage: node tools/bake-texcolors.mjs <in.glb> <out.glb> --lengthCm=3 [--rotY=-90]'); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(inp);
const lin = (v) => Math.pow(v / 255, 2.2);

// Decoded textures, once each.
const images = new Map();
async function pixels(tex) {
  if (!images.has(tex)) {
    const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    images.set(tex, { data, w: info.width, h: info.height });
  }
  return images.get(tex);
}
function sample(img, u, v) {                                   // bilinear, repeat; glTF uv origin is the top left
  const x = (((u % 1) + 1) % 1) * img.w - 0.5, y = (((v % 1) + 1) % 1) * img.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx, yy) => { const i = ((((yy % img.h) + img.h) % img.h) * img.w + (((xx % img.w) + img.w) % img.w)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
  return [0, 1, 2].map((k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy);
}

// Collect parts in world space.
const parts = [];
const mat = (m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]];
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const W = mat(node.getWorldMatrix());
  for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial(), tex = m?.getBaseColorTexture(), blend = m?.getAlphaMode() === 'BLEND';
    if (!tex && blend) continue;                               // a clear cornea or lens: drop
    const P = p.getAttribute('POSITION'), UV = p.getAttribute('TEXCOORD_0'), I = p.getIndices();
    const n = P.getCount(), f = m?.getBaseColorFactor() ?? [1, 1, 1, 1];
    const idx = I ? Array.from(I.getArray()) : [...Array(n).keys()];
    // Only the vertices this primitive uses (two primitives of one mesh may share an accessor but not a texture).
    const used = [...new Set(idx)].sort((a, b) => a - b), remap = new Map(used.map((v, i) => [v, i]));
    const pos = new Float32Array(used.length * 3), col = new Float32Array(used.length * 3), tc = UV ? new Float32Array(used.length * 2) : null;
    const img = tex ? await pixels(tex) : null, e = [0, 0, 0], uv = [0, 0];
    used.forEach((v, i) => {
      P.getElement(v, e);
      pos[i * 3] = W[0] * e[0] + W[3] * e[1] + W[6] * e[2] + W[9];
      pos[i * 3 + 1] = W[1] * e[0] + W[4] * e[1] + W[7] * e[2] + W[10];
      pos[i * 3 + 2] = W[2] * e[0] + W[5] * e[1] + W[8] * e[2] + W[11];
      if (tc) { UV.getElement(v, uv); tc[i * 2] = uv[0]; tc[i * 2 + 1] = uv[1]; }
      const c = img && UV ? sample(img, uv[0], uv[1]) : [f[0] * 255, f[1] * 255, f[2] * 255];
      for (let k = 0; k < 3; k++) col[i * 3 + k] = lin(c[k]) * (img ? f[k] : 1);
    });
    // Mirrored nodes (negative scale) flip the winding.
    const det = W[0] * (W[4] * W[8] - W[7] * W[5]) - W[3] * (W[1] * W[8] - W[7] * W[2]) + W[6] * (W[1] * W[5] - W[4] * W[2]);
    const tri = idx.map((v) => remap.get(v));
    if (det < 0) for (let t = 0; t < tri.length; t += 3) [tri[t + 1], tri[t + 2]] = [tri[t + 2], tri[t + 1]];
    const name = blend ? 'fin' : n < 200 ? 'eye' : 'body';
    parts.push({ name, pos, col, tc, idx: tri });
  }
}

// Turn the head to +z, centre, scale to the real length (metres).
const r = (rotY * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) {
  const x = p.pos[i], z = p.pos[i + 2];
  p.pos[i] = x * cs + z * sn; p.pos[i + 2] = -x * sn + z * cs;
  for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
}
const s = lengthCm / 100 / (mx[2] - mn[2]), c = mn.map((v, k) => (v + mx[k]) / 2);
for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i + k] = (p.pos[i + k] - c[k]) * s;

const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene();
const mats = {};
for (const p of parts) {
  mats[p.name] ??= doc.createMaterial(p.name).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.4).setMetallicFactor(0);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.pos).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(p.col).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(p.idx)).setBuffer(buf))
    .setMaterial(mats[p.name]);
  if (p.tc) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.tc).setBuffer(buf));   // kept for tools that re-texture the model (bake-sunfish.mjs)
  scene.addChild(doc.createNode(p.name).setMesh(doc.createMesh(p.name).addPrimitive(prim)));
}
await io.write(out, doc);
const tris = parts.reduce((n, p) => n + p.idx.length / 3, 0);
console.log(`${out}: ${parts.length} parts (${parts.map((p) => p.name).join(', ')}), ${tris} tris, ${(((mx[0] - mn[0]) * s) * 100).toFixed(2)} x ${(((mx[1] - mn[1]) * s) * 100).toFixed(2)} x ${lengthCm} cm`);
