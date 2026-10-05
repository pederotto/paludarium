// Summary of a GLB without printing binary: node glb-dump.mjs <file.glb> [--extract-image=<dir>]
import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2];
const exArg = process.argv.find((a) => a.startsWith('--extract-image='));
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942 && !bin) bin = data;
  off += 8 + len;
}
const g = json;
console.log('file', path.basename(file), 'bytes', buf.length, 'generator', g.asset?.generator, 'ver', g.asset?.version);
console.log('extensions', g.extensionsUsed || [], 'required', g.extensionsRequired || []);
console.log('scenes', (g.scenes || []).map((s) => s.nodes), 'nodes', (g.nodes || []).length, 'meshes', (g.meshes || []).length, 'skins', (g.skins || []).length, 'animations', (g.animations || []).length, 'materials', (g.materials || []).length, 'textures', (g.textures || []).length, 'images', (g.images || []).length);
const nodes = g.nodes || [];
const parent = new Array(nodes.length).fill(-1);
nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
function pr(i, d) {
  const n = nodes[i];
  const bits = [];
  if (n.mesh != null) bits.push('mesh' + n.mesh);
  if (n.skin != null) bits.push('skin' + n.skin);
  if (n.translation) bits.push('t=' + n.translation.map((v) => +v.toFixed(4)));
  if (n.rotation) bits.push('r=' + n.rotation.map((v) => +v.toFixed(3)));
  if (n.scale) bits.push('s=' + n.scale.map((v) => +v.toFixed(3)));
  if (n.matrix) bits.push('matrix');
  console.log('  '.repeat(d) + `[${i}] ${n.name ?? ''} ${bits.join(' ')}`);
  (n.children || []).forEach((c) => pr(c, d + 1));
}
if (nodes.length > 80) console.log('(node tree truncated: >80 nodes; printing roots and first 60 lines)');
let lines = 0;
const orig = console.log;
const roots = nodes.map((_, i) => i).filter((i) => parent[i] < 0);
if (nodes.length <= 80) roots.forEach((r) => pr(r, 0));
else { console.log('roots', roots.length); roots.slice(0, 5).forEach((r) => pr(r, 0)); }
console.log('extras on nodes/asset:', JSON.stringify(g.asset?.extras ?? null).slice(0, 300), '| scene extras', JSON.stringify(g.scenes?.[0]?.extras ?? null).slice(0, 300));
for (const [si, s] of (g.skins || []).entries()) {
  console.log(`skin${si} joints ${s.joints.length} skeleton ${s.skeleton} ibm ${s.inverseBindMatrices}`);
  console.log('  joint names:', s.joints.map((j) => nodes[j].name).slice(0, 80).join(','));
}
for (const [ai, a] of (g.animations || []).entries()) {
  console.log(`anim${ai} "${a.name}" channels ${a.channels.length} samplers ${a.samplers.length}`);
}
const acc = (i) => g.accessors[i];
let tot = { v: 0, t: 0 };
for (const [mi, m] of (g.meshes || []).entries()) {
  for (const [pi, p] of m.primitives.entries()) {
    const pos = acc(p.attributes.POSITION);
    const tri = p.indices != null ? acc(p.indices).count / 3 : pos.count / 3;
    tot.v += pos.count; tot.t += tri;
    console.log(`mesh${mi} "${m.name}" prim${pi} mode ${p.mode ?? 4} verts ${pos.count} tris ${tri} attrs ${Object.keys(p.attributes).join(',')} mat ${p.material} targets ${p.targets ? p.targets.length : 0}`);
    console.log('  mesh extras', JSON.stringify(m.extras ?? null).slice(0, 400), '| prim extras', JSON.stringify(p.extras ?? null).slice(0, 200));
    for (const [k, ai] of Object.entries(p.attributes)) { const q = acc(ai); console.log(`  attr ${k}: type ${q.type} comp ${q.componentType} norm ${!!q.normalized} count ${q.count}`); }
    if (pos.min && pos.max) {
      const ext = pos.max.map((v, i) => v - pos.min[i]);
      console.log('  min', pos.min.map((v) => +v.toFixed(4)), 'max', pos.max.map((v) => +v.toFixed(4)), 'extent', ext.map((v) => +v.toFixed(4)));
      const ax = ['X', 'Y', 'Z'];
      const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
      console.log('  longest axis', ax[order[0]], 'then', ax[order[1]], 'then', ax[order[2]], 'ratios', ext.map((v) => +(v / ext[order[0]]).toFixed(3)));
    }
  }
}
console.log('total verts', tot.v, 'tris', tot.t);
for (const [mi, m] of (g.materials || []).entries()) console.log(`material${mi} "${m.name}" baseTex ${m.pbrMetallicRoughness?.baseColorTexture?.index} baseColor ${JSON.stringify(m.pbrMetallicRoughness?.baseColorFactor)} metal ${m.pbrMetallicRoughness?.metallicFactor} rough ${m.pbrMetallicRoughness?.roughnessFactor}`);
const tsrc = (t) => (t == null ? undefined : g.textures[t].source ?? g.textures[t].extensions?.EXT_texture_webp?.source);
function imgInfo(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) { let o = 2; while (o < b.length) { if (b[o] !== 0xff) { o++; continue; } const mk = b[o + 1]; if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { type: 'jpeg', h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) }; o += 2 + b.readUInt16BE(o + 2); } return { type: 'jpeg' }; }
  if (b.subarray(0, 4).toString() === 'RIFF') {
    const f = b.subarray(12, 16).toString();
    if (f === 'VP8X') return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (f === 'VP8 ') return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return { type: 'webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    return { type: 'webp' };
  }
  return { type: 'unknown' };
}
for (const [ii, im] of (g.images || []).entries()) {
  const bv = g.bufferViews[im.bufferView];
  const b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const info = imgInfo(b);
  console.log(`image${ii} ${im.mimeType} bytes ${bv.byteLength}`, JSON.stringify(info), 'used as', (g.materials || []).flatMap((m, mi) => { const p = m.pbrMetallicRoughness || {}; const u = []; if (tsrc(p.baseColorTexture?.index) === ii) u.push(`m${mi}.baseColor`); if (tsrc(p.metallicRoughnessTexture?.index) === ii) u.push(`m${mi}.metalRough`); if (tsrc(m.normalTexture?.index) === ii) u.push(`m${mi}.normal`); return u; }).join(','));
  if (exArg) { const d = exArg.split('=')[1]; fs.mkdirSync(d, { recursive: true }); const f = path.join(d, `${path.basename(file, '.glb')}.img${ii}.${info.type === 'jpeg' ? 'jpg' : info.type}`); fs.writeFileSync(f, b); console.log('  wrote', f); }
}
// Silhouette: top view (X-Z) ASCII of vertices, 3 projections, tiny
if (process.argv.includes('--sil')) {
  const p = g.meshes[0].primitives[0]; const a = acc(p.attributes.POSITION); const bv = g.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 12;
  const pts = []; for (let i = 0; i < a.count; i++) pts.push([0, 4, 8].map((o) => bin.readFloatLE(base + i * stride + o)));
  const ext = a.max.map((v, i) => v - a.min[i]); const L = Math.max(...ext);
  const proj = (u, v, W, H, name) => { const grid = Array.from({ length: H }, () => Array(W).fill(' ')); const su = (W - 1) / L, sv = (H - 1) / L; for (const q of pts) { const x = Math.round((q[u] - a.min[u]) * su), y = Math.round((q[v] - a.min[v]) * sv); if (x >= 0 && x < W && y >= 0 && y < H) grid[H - 1 - y][x] = '#'; } console.log(name, 'horizontal axis', 'XYZ'[u], 'vertical', 'XYZ'[v]); console.log(grid.map((r) => r.join('')).join('\n')); };
  const W = 70; proj(0, 2, W, Math.max(4, Math.round((W * ext[2]) / L / 2)), 'top');
  proj(0, 1, W, Math.max(4, Math.round((W * ext[1]) / L / 2)), 'side');
}
// Slice profile along the longest axis: node glb-dump.mjs <glb> --profile=<bins>  (per bin: z range, x width, x min/max, y min/max)
const pa = process.argv.find((a) => a.startsWith('--profile='));
if (pa) {
  const nb = +pa.split('=')[1]; const p = g.meshes[0].primitives[0]; const a = acc(p.attributes.POSITION); const bv = g.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 12;
  const bins = Array.from({ length: nb }, () => ({ n: 0, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }));
  const z0 = a.min[2], zs = a.max[2] - a.min[2];
  for (let i = 0; i < a.count; i++) { const x = bin.readFloatLE(base + i * stride), y = bin.readFloatLE(base + i * stride + 4), z = bin.readFloatLE(base + i * stride + 8); const b = bins[Math.min(nb - 1, Math.floor(((z - z0) / zs) * nb))]; b.n++; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
  console.log('profile: bin  zFromHead(0=snout end +z)  xmin xmax width  ymin ymax height');
  for (let k = nb - 1; k >= 0; k--) { const b = bins[k]; console.log(String(nb - 1 - k).padStart(2), ((nb - 1 - k) / nb).toFixed(3), b.x0.toFixed(3), b.x1.toFixed(3), (b.x1 - b.x0).toFixed(3), b.y0.toFixed(3), b.y1.toFixed(3), (b.y1 - b.y0).toFixed(3)); }
}
