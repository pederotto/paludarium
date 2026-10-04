// Bakes untextured creature meshes (art-src/raw/*.glb) into game assets with painted vertex colours.
//
//   node tools/bake-creature.mjs [id ...]        (no ids: every job below)
//
// Steps per job: weld, turn the head to +z, stand it on y = 0, scale to its real length, simplify to a detailed and
// a coarse level of detail, smooth the normals, paint every vertex with tools/paint/<paint>.mjs, and write
// <id>.glb and <id>.lo.glb (meshopt-compressed) plus the manifest entry the game reads.
//
// A job with `rig` (tools/rig/<rig>.mjs) bakes the animation rig into the file instead of leaving the game to guess it from
// the shape (render/creatures/glb.js addRig): a `_RIG` vertex attribute (spine, leg / 8, legT, material id / 8, all 0 … 1 so
// meshopt can quantise it) plus ambient occlusion in the colours. `shellWidthCm` scales by the rig's shell width instead
// of the nose-to-tail length (a crab's length is set by its legs).
// A job with `texture: <size>` is unwrapped (xatlas, tools/rig/texture.mjs) and painted per texel by the paint module's
// `texel` function into a WebP colour texture: the detail is as fine as the texture instead of the mesh. The coarse level
// keeps the same UVs and carries no image of its own (the game draws both levels with the detailed file's material).
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const OUT = 'public/assets/creatures';
// rotY: degrees about y that turn the mesh's head towards +z. lengthCm: nose-to-tail length of the real animal.
const FROG = { src: 'frog_mesh', rotY: -90, pre: 22000, rig: 'frog', legs: true, matId: 0, texture: 1024, aoReach: 0.35 };
const JOBS = {
  // The frogs: one scan (frog_mesh, a sitting Dendrobates) decimated to 30k triangles, rigged (tools/rig/frog.mjs: limbs measured
  // along their length, so a folded hind leg moves at the foot), reshaped per species (tools/rig/warps.mjs) and painted into a
  // 1024 texture (tools/paint/<species>.mjs on tools/paint/frogkit.mjs: granules, toe discs, mouth line, creases darkened by the
  // baked occlusion). The coarse level keeps the texture, so a frog across the tank is as crisp as one up close.
  leucomelas: { ...FROG, lengthCm: 4.5, tris: [22000, 8000], paint: 'leucomelas' },
  strawberry: { ...FROG, lengthCm: 2.3, tris: [22000, 6000], paint: 'strawberry' },
  dartfrog: { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#cobalt_spotted', warp: 'azureus' },
  'dartfrog:cobalt_clean': { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#cobalt_clean', warp: 'azureus' },
  'dartfrog:sky_spotted': { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#sky_spotted', warp: 'azureus' },
  'dartfrog:sky_clean': { ...FROG, lengthCm: 4.2, tris: [22000, 8000], paint: 'azureus#sky_clean', warp: 'azureus' },
  auratus: { ...FROG, lengthCm: 4.0, tris: [22000, 8000], paint: 'auratus', warp: 'auratus' },
  bumblebee: { ...FROG, lengthCm: 2.8, tris: [22000, 6000], paint: 'melano', warp: 'melano' },
  reedfrog: { ...FROG, lengthCm: 3.0, tris: [22000, 7000], paint: 'heterixalus', warp: 'heterixalus' },
  toad: { ...FROG, lengthCm: 4.5, tris: [22000, 8000], paint: 'bombina', warp: 'bombina' },
  firesal: { src: 'salamander_mesh', rotY: 90, lengthCm: 18, headZ: 6.2, tris: [32000, 8000], paint: 'firesal', legs: true },
  // Vampire crab: carapace 2.1 cm wide (the procedural body's size, so the sim's spacing is unchanged), legs about 6 cm across.
  // matId 0 (skin) not 4 (chitin): the chitin id has a fixed clear coat that ignores finish and looked like plastic on the scan.
  crab: { src: 'crab_mesh', rotY: 0, shellWidthCm: 2.1, tris: [10000, 3200], paint: 'crab', rig: 'crab', legs: true, matId: 0, texture: 1024 },
  // `texture: 1024`: a painted UV texture instead of vertex colours (tools/rig/texture.mjs). The old "tan patches" were faces that
  // xatlas squashed to a point because the crab was unwrapped in metres; unwrap now rescales (see unwrap()).
};
const M_CHITIN = 4;   // render/creatures/kit.js M.CHITIN: the default material id of a baked rig (job.matId overrides)
// Eyes (cm, in the baked frame) and finish per job live in tools/paint/eyes.mjs so they can be tuned without touching code.
const { EYES } = await import('./paint/eyes.mjs');

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // area-weighted
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

function simplified(pos, idx, targetTris) {
  const tris = idx.length / 3;
  if (tris <= targetTris) return { pos, idx, from: null };
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(targetTris * 3), 0.02, []);
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3);
  const from = new Uint32Array(count);                         // new vertex -> the original vertex it came from
  for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; from[remap[i]] = i; }
  return { pos: np, idx: out, from };
}

async function build(id, job, paint, level, geo, fullNormals, rig = null) {
  const { pos, idx, from } = geo;
  const src = (i) => (from ? from[i] : i);
  const n = pos.length / 3;
  // Smooth normals come from the full-resolution mesh, so a coarse level of detail still shades like the original.
  let nor;
  if (from) { nor = new Float32Array(n * 3); for (let i = 0; i < n; i++) { nor[i*3] = fullNormals[from[i]*3]; nor[i*3+1] = fullNormals[from[i]*3+1]; nor[i*3+2] = fullNormals[from[i]*3+2]; } } else nor = normals(pos, idx);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, pos[i*3]); x1 = Math.max(x1, pos[i*3]); y0 = Math.min(y0, pos[i*3+1]); y1 = Math.max(y1, pos[i*3+1]); z0 = Math.min(z0, pos[i*3+2]); z1 = Math.max(z1, pos[i*3+2]); }
  const hw = Math.max(x1, -x0), zmid = (z0 + z1) / 2, xFrac = 0.32, yFrac = 0.62;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos[i*3] * 100, y = pos[i*3+1] * 100, z = pos[i*3+2] * 100;
    const h = (pos[i*3+1] - y0) / (y1 - y0);
    const s = Math.abs(pos[i*3]) / hw;
    const isLeg = job.legs && s > xFrac && h < yFrac;
    let leg = isLeg ? (pos[i*3+2] > zmid ? 1 : 3) + (pos[i*3] > 0 ? 1 : 0) : 0;
    let legT = isLeg ? Math.min(1, (s - xFrac) / (1 - xFrac)) : 0;
    const extra = {};
    if (rig) {
      const j = src(i);
      leg = rig.leg[j]; legT = rig.legT[j];
      Object.assign(extra, { part: rig.part[j], ao: rig.ao[j], eyeT: rig.eyeT[j], zf: rig.zf[j] });
    }
    const c = paint({ u: (z1 - pos[i*3+2]) / (z1 - z0), x, y, z, s, h, leg, legT, n: [nor[i*3], nor[i*3+1], nor[i*3+2]], ...extra });
    col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
  }
  const doc = new Document();
  const buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0));
  if (rig) {
    const r = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const j = src(i); r[i*4] = Math.max(0, Math.min(1, (z1 - pos[i*3+2]) / (z1 - z0))); r[i*4+1] = rig.leg[j] / 8; r[i*4+2] = rig.legT[j]; r[i*4+3] = (job.matId ?? M_CHITIN) / 8; }
    prim.setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(r).setBuffer(buf));
  }
  const mesh = doc.createMesh(id).addPrimitive(prim);
  doc.createScene().addChild(doc.createNode(id).setMesh(mesh));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc);
  return { file, verts: n, tris: idx.length / 3, bytes: fs.statSync(file).size, size: [(x1 - x0) * 100, (y1 - y0) * 100, (z1 - z0) * 100] };
}

// The textured variant of build(): positions, normals, UVs and the baked rig; the hi level embeds the colour texture.
async function buildTextured(id, job, level, g, rig, image) {
  const { pos, nor, uv, idx, from } = g, n = pos.length / 3;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, pos[i*3]); x1 = Math.max(x1, pos[i*3]); y0 = Math.min(y0, pos[i*3+1]); y1 = Math.max(y1, pos[i*3+1]); z0 = Math.min(z0, pos[i*3+2]); z1 = Math.max(z1, pos[i*3+2]); }
  const r = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const j = from[i]; r[i*4] = Math.max(0, Math.min(1, (z1 - pos[i*3+2]) / (z1 - z0))); r[i*4+1] = rig.leg[j] / 8; r[i*4+2] = rig.legT[j]; r[i*4+3] = (job.matId ?? M_CHITIN) / 8; }
  const doc = new Document();
  const buf = doc.createBuffer();
  const mat = doc.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  if (image) {
    doc.createExtension(EXTTextureWebP).setRequired(true);
    mat.setBaseColorTexture(doc.createTexture(`${id}_color`).setImage(image).setMimeType('image/webp'));
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf))
    .setAttribute('_RIG', doc.createAccessor().setType('VEC4').setArray(r).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
    .setMaterial(mat);
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 16, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc);
  return { file, verts: n, tris: idx.length / 3, bytes: fs.statSync(file).size, size: [(x1 - x0) * 100, (y1 - y0) * 100, (z1 - z0) * 100] };
}

async function bakeTextured(id, job, pos, srcIdx, fullN, rig, eye = null) {
  const { unwrap, paintTexture, simplifyKeepingSeams, uvStats } = await import('./rig/texture.mjs');
  const texel = job.texelFn;
  const U = await unwrap(pos, srcIdx, job.texture);
  const n = U.from.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { P[i*3+k] = pos[U.from[i]*3+k]; N[i*3+k] = fullN[U.from[i]*3+k]; }
  const st = uvStats(U.uv, U.idx, P, job.texture);
  console.log(`  uv: texel density p1 ${st.p1} p5 ${st.p5} p50 ${st.p50} (1 = even), ${st.squashed} faces under 10 %, ${st.used} % of the atlas used`);
  if (st.squashed > U.idx.length / 3 * 0.01) throw new Error(`${id}: ${st.squashed} faces squashed in UV space (they would show as flat-coloured patches)`);
  const t0 = Date.now();
  // The same frame numbers the vertex paint gets (u snout 0 … tail 1, h height 0 … 1, s out from the midline 0 … 1) and the
  // distance to the analytic eye's centre in cm (eyeD), for masks and rings around the eye.
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i*3]); x1 = Math.max(x1, P[i*3]); y0 = Math.min(y0, P[i*3+1]); y1 = Math.max(y1, P[i*3+1]); z0 = Math.min(z0, P[i*3+2]); z1 = Math.max(z1, P[i*3+2]); }
  const hw = Math.max(x1, -x0);
  const img = paintTexture(job.texture, U.uv, U.idx, P, N, ({ p, n: nn, w, v }) => {
    const o = v.map((i) => U.from[i]);
    const lerp = (arr) => w[0] * arr[o[0]] + w[1] * arr[o[1]] + w[2] * arr[o[2]];
    const main = o[w.indexOf(Math.max(...w))];
    const x = p[0] * 100, y = p[1] * 100, z = p[2] * 100;
    const eyeD = eye ? Math.hypot(Math.abs(x) - eye.c[0], y - eye.c[1], z - eye.c[2]) : 99;
    return texel({ x, y, z, n: nn, part: rig.part[main], leg: rig.leg[main], legT: lerp(rig.legT), ao: lerp(rig.ao), eyeT: lerp(rig.eyeT), zf: lerp(rig.zf),
      u: (z1 - p[2]) / (z1 - z0), h: (p[1] - y0) / (y1 - y0), s: Math.abs(p[0]) / hw, eyeD, eyeR: eye?.r ?? 0 });
  });
  const webp = await sharp(Buffer.from(img.buffer), { raw: { width: job.texture, height: job.texture, channels: 4 } }).removeAlpha().webp({ quality: 88, effort: 6 }).toBuffer();
  fs.mkdirSync('test-output/bake', { recursive: true });
  await sharp(Buffer.from(img.buffer), { raw: { width: job.texture, height: job.texture, channels: 4 } }).png().toFile(`test-output/bake/${id.replace(':', '-')}_color.png`);
  console.log(`  texture ${job.texture}px painted in ${Date.now() - t0} ms, ${(webp.length / 1024) | 0} KB webp (preview test-output/bake/${id}_color.png)`);
  const hi = await buildTextured(id, job, 'hi', { pos: P, nor: N, uv: U.uv, idx: U.idx, from: U.from }, rig, webp);
  const L = simplifyKeepingSeams(P, U.idx, job.tris[1], U.uv);
  const m = L.from.length, LP = new Float32Array(m * 3), LN = new Float32Array(m * 3), LU = new Float32Array(m * 2), LF = new Uint32Array(m);
  for (let i = 0; i < m; i++) { const j = L.from[i]; for (let k = 0; k < 3; k++) { LP[i*3+k] = P[j*3+k]; LN[i*3+k] = N[j*3+k]; } LU[i*2] = U.uv[j*2]; LU[i*2+1] = U.uv[j*2+1]; LF[i] = U.from[j]; }
  const sl = uvStats(LU, L.idx, LP, job.texture);
  console.log(`  lo uv: texel density p1 ${sl.p1} p5 ${sl.p5}, ${sl.squashed} faces under 10 %`);
  const lo = await buildTextured(id, job, 'lo', { pos: LP, nor: LN, uv: LU, idx: L.idx, from: LF }, rig, null);
  return { hi, lo };
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cache = {};
for (const [id, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(id)) continue;
  // `paint: 'module#arg'` picks one variant of a paint module (paintFor(arg) / texelFor(arg)): the azureus morphs share a painter.
  const [pmod, parg] = job.paint.split('#');
  const PM = await import(`./paint/${pmod}.mjs`);
  const paint = parg ? PM.paintFor(parg) : PM.paint;
  job.texelFn = parg ? PM.texelFor?.(parg) : PM.texel;
  const ckey = `${job.src}@${job.pre ?? 0}`;
  if (!cache[ckey]) {
    const doc = await io.read(`art-src/raw/${job.src}.glb`);
    await doc.transform(weld());
    const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    cache[ckey] = { pos: Float32Array.from(p.getAttribute('POSITION').getArray()), idx: Uint32Array.from(p.getIndices().getArray()) };
    // `pre`: decimate a dense scan first (the frog scan has 400k triangles: too many to rig, unwrap and texture).
    if (job.pre) { const s = simplified(cache[ckey].pos, cache[ckey].idx, job.pre); cache[ckey] = { pos: s.pos, idx: s.idx }; }
  }
  // Orient, stand on the ground, centre, scale to the real length (metres).
  const src = cache[ckey], pos = Float32Array.from(src.pos);
  const a = job.rotY * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); }
  let k = (job.lengthCm / 100) / (z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let rig = null, eyesOut = null;
  if (job.rig) {
    // Segment and shade in the scan's own units (the thresholds are tuned to it), then scale by the shell.
    const { [`${job.rig}Rig`]: makeRig } = await import(`./rig/${job.rig}.mjs`);
    const { ambientOcclusion, normals: nrm } = await import('./rig/appendages.mjs');
    rig = makeRig(pos, src.idx);
    rig.ao = ambientOcclusion(pos, src.idx, nrm(pos, src.idx), { rays: 48, reach: job.aoReach ?? 0.3 });
    const n = pos.length / 3;
    rig.eyeT ??= new Float32Array(n);
    const sh = rig.shell;
    if (sh) { k = (job.shellWidthCm / 100) / (sh.x1 - sh.x0); cx = (sh.x0 + sh.x1) / 2; cz = (sh.z0 + sh.z1) / 2; }
    if (sh) rig.zf = new Float32Array(n);
    for (let i = 0; sh && i < n; i++) {
      rig.zf[i] = Math.max(0, Math.min(1, (pos[i*3+2] - sh.z0) / (sh.z1 - sh.z0)));
      if (rig.part[i] !== 'eye') continue;
      const e = rig.eyes.reduce((b, e) => (Math.abs(e.c[0] - pos[i*3]) < Math.abs(b.c[0] - pos[i*3]) ? e : b));
      rig.eyeT[i] = Math.max(0, 1 - Math.hypot(pos[i*3] - e.c[0], pos[i*3+1] - e.c[1], pos[i*3+2] - e.c[2]) / (2.4 * e.r));
    }
    // The +x eye in centimetres of the baked frame, looking along its stalk tipped forward (the shader mirrors it).
    if (rig.eyes) {
      const e = rig.eyes.reduce((a, b) => (b.c[0] > a.c[0] ? b : a));
      const cm = (p) => [(p[0] - cx) * k * 100, (p[1] - y0) * k * 100, (p[2] - cz) * k * 100];
      const stalk = e.c.map((v, i) => v - e.base[i]), sl = Math.hypot(...stalk);
      eyesOut = { c: cm(e.c).map((v) => +v.toFixed(3)), r: +(e.r * k * 100).toFixed(3), axis: [stalk[0] / sl * 0.6 + 0.25, stalk[1] / sl * 0.6, stalk[2] / sl * 0.6 + 0.75] };
    }
  }
  for (let i = 0; i < pos.length; i += 3) { pos[i] = (pos[i] - cx) * k; pos[i + 1] = (pos[i + 1] - y0) * k; pos[i + 2] = (pos[i + 2] - cz) * k; }
  // `warp`: reshape one scan into a related species (a flatter toad, a slimmer, longer-legged reed frog), in metres of the baked
  // frame, per vertex with the rig: warp([x, y, z] in cm, { leg, legT, part }) -> [x, y, z] in cm. The eyes move with it.
  let warpEye = null;
  if (job.warp) {
    const { [job.warp]: warpFn } = await import('./rig/warps.mjs');
    const W = warpFn(pos, rig);
    for (let i = 0; i < pos.length / 3; i++) {
      const q = W([pos[i*3] * 100, pos[i*3+1] * 100, pos[i*3+2] * 100], { leg: rig?.leg[i] ?? 0, legT: rig?.legT[i] ?? 0, part: rig?.part[i] });
      pos[i*3] = q[0] / 100; pos[i*3+1] = q[1] / 100; pos[i*3+2] = q[2] / 100;
    }
    let ymin = Infinity; for (let i = 1; i < pos.length; i += 3) ymin = Math.min(ymin, pos[i]);
    for (let i = 1; i < pos.length; i += 3) pos[i] -= ymin;
    warpEye = (c) => { const q = W(c, { leg: 0, legT: 0, part: 'body' }); return [q[0], q[1] - ymin * 100, q[2]]; };
  }
  const extra = { ...(EYES[id] ?? {}) };
  if (extra.finish) extra.finish = { ...extra.finish, eyes: Array.isArray(extra.finish.eyes) ? extra.finish.eyes.map((e) => ({ ...e })) : extra.finish.eyes };
  if (eyesOut && typeof extra.finish?.eyes === 'function') extra.finish = { ...extra.finish, eyes: extra.finish.eyes(eyesOut) };
  if (warpEye && Array.isArray(extra.finish?.eyes)) for (const e of extra.finish.eyes) e.c = warpEye(e.c).map((v) => +v.toFixed(3));
  const fullN = normals(pos, src.idx);
  const { hi, lo } = job.texture && rig
    ? await bakeTextured(id, job, pos, src.idx, fullN, rig, extra.finish?.eyes?.[0] ?? null)
    : { hi: await build(id, job, paint, 'hi', simplified(pos, src.idx, job.tris[0]), fullN, rig), lo: await build(id, job, paint, 'lo', simplified(pos, src.idx, job.tris[1]), fullN, rig) };
  if (process.argv.includes('--eyes')) {
    // Candidate eye bulges: clusters of the highest vertices on each side of the midline (cm).
    let ymax = -1e9; for (let i = 0; i < pos.length / 3; i++) ymax = Math.max(ymax, pos[i*3+1]);
    const out = {};
    for (const side of ['L', 'R']) {
      const pts = [];
      for (let i = 0; i < pos.length / 3; i++) { const x = pos[i*3]; if ((side === 'R') !== (x > 0) || Math.abs(x) < 0.04 * ymax * 5) continue; if (job.headZ && pos[i*3+2] * 100 < job.headZ) continue; pts.push([pos[i*3] * 100, pos[i*3+1] * 100, pos[i*3+2] * 100]); }
      pts.sort((p, q) => q[1] - p[1]);
      out[side] = pts.slice(0, 40).reduce((m, p) => m.map((v, j) => v + p[j] / 40), [0, 0, 0]).map((v) => +v.toFixed(2));
    }
    console.log('  eye candidates (mean of the 40 highest vertices per side, cm)', JSON.stringify(out));
  }
  manifest[id] = { file: `${id.replace(':', '-')}.glb`, lo: `${id.replace(':', '-')}.lo.glb`, legs: job.legs, ...(job.rig ? { rig: 'baked' } : {}), tris: { hi: hi.tris, lo: lo.tris }, sizeCm: hi.size.map((v) => +v.toFixed(2)), ...extra };
  console.log(`${id}: hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${hi.size.map((v) => v.toFixed(2)).join(' x ')} cm (x y z)`);
}
// Aliases: a morph whose look is the species' default draws the same files (no second copy; the game loads a file once).
const ALIAS = { 'dartfrog:cobalt_spotted': 'dartfrog' };
for (const [k, v] of Object.entries(ALIAS)) if (manifest[v]) manifest[k] = { ...manifest[v] };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
