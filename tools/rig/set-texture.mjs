// Swaps the base-colour image of a baked creature GLB, and sets or adds its normal map (the coarse level draws with the detailed file's material,
// so only the hi file has them). The GLB's binary is rebuilt around the new images: every other buffer view (vertex data, meshopt-compressed or
// not) is copied byte for byte. The skin session's painted maps go in here after the bake and the muscle binding.
//   node tools/rig/set-texture.mjs <id> <color.webp> [normal.webp]      (id: a manifest key, e.g. toad, toad.swim; run from the repository root)
import fs from 'node:fs';
const DIR = 'public/assets/creatures/', [id, color, normal] = process.argv.slice(2);
if (!id || !color) throw new Error('usage: node tools/rig/set-texture.mjs <id> <color.webp> [normal.webp]');
const webp = (f) => { const d = fs.readFileSync(f); if (d.slice(8, 12).toString() !== 'WEBP') throw new Error(`${f} is not a WebP file`); return d; };
const man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8')), file = DIR + man[id].file, imgC = webp(color), imgN = normal ? webp(normal) : null;
const b = fs.readFileSync(file), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString()), bl = b.readUInt32LE(20 + jl), bin = b.slice(28 + jl, 28 + jl + bl);
const mat = j.materials?.find((m) => m.pbrMetallicRoughness?.baseColorTexture);
if (!mat) throw new Error(`${file} has no base-colour texture (its UVs and image come from the bake: a job with \`texture\`)`);
const srcOf = (t) => t.extensions?.EXT_texture_webp?.source ?? t.source;
const setSrc = (t, s) => { if (t.extensions?.EXT_texture_webp) t.extensions.EXT_texture_webp.source = s; else t.source = s; };
const viewOf = (ti) => j.images[srcOf(j.textures[ti])].bufferView;
// every segment of buffer 0 a buffer view (or its meshopt extension) points at
const segs = new Map();
const note = (o, l, set) => { const k = `${o}:${l}`; if (!segs.has(k)) segs.set(k, { o, l, set: [] }); segs.get(k).set.push(set); };
j.bufferViews.forEach((v) => {
  if ((v.buffer ?? 0) === 0) note(v.byteOffset ?? 0, v.byteLength, (no, nl) => { v.byteOffset = no; v.byteLength = nl; });
  const e = v.extensions?.EXT_meshopt_compression;
  if (e && (e.buffer ?? 0) === 0) note(e.byteOffset ?? 0, e.byteLength, (no, nl) => { e.byteOffset = no; e.byteLength = nl; });
});
const segOf = (iv) => { const v = j.bufferViews[iv], s = [...segs.values()].find((q) => (v.byteOffset ?? 0) === q.o && v.byteLength === q.l && (v.buffer ?? 0) === 0); if (!s) throw new Error('an image is not in buffer 0'); return s; };
const replace = new Map([[segOf(viewOf(mat.pbrMetallicRoughness.baseColorTexture.index)), imgC]]);
const added = [];                                           // a normal map the GLB does not have yet: a new buffer view, image and texture at the end
if (imgN) {
  if (mat.normalTexture) replace.set(segOf(viewOf(mat.normalTexture.index)), imgN);
  else {
    const ct = j.textures[mat.pbrMetallicRoughness.baseColorTexture.index], nt = JSON.parse(JSON.stringify(ct)), view = { buffer: 0, byteOffset: 0, byteLength: imgN.length };
    j.bufferViews.push(view); j.images.push({ bufferView: j.bufferViews.length - 1, mimeType: 'image/webp' }); setSrc(nt, j.images.length - 1);
    j.textures.push(nt); mat.normalTexture = { index: j.textures.length - 1 }; added.push([view, imgN]);
  }
}
const parts = [];
let at = 0;
const put = (data, set) => { const pad = (4 - (at % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); at += pad; } set(at, data.length); parts.push(data); at += data.length; };
for (const s of [...segs.values()].sort((p, q) => p.o - q.o)) { const data = replace.get(s) ?? bin.slice(s.o, s.o + s.l); put(data, (no, nl) => s.set.forEach((f) => f(no, nl))); }
for (const [view, data] of added) put(data, (no, nl) => { view.byteOffset = no; view.byteLength = nl; });
const padEnd = (4 - (at % 4)) % 4; if (padEnd) parts.push(Buffer.alloc(padEnd));
const nbin = Buffer.concat(parts); j.buffers[0].byteLength = nbin.length;
let js = Buffer.from(JSON.stringify(j)); const jp = (4 - (js.length % 4)) % 4; if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + nbin.length, 8);
const ch = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32LE(d.length, 0); h.write(t, 4); return Buffer.concat([h, d]); };
fs.writeFileSync(file, Buffer.concat([head, ch('JSON', js), ch('BIN\0', nbin)]));
console.log(`set ${id} base colour${imgN ? ' and normal map' : ''}: ${file} now ${fs.statSync(file).size} bytes, every other buffer view copied unchanged`);
