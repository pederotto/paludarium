// Run "sets", S2 pilot: the hillstream loach as a UV-mapped, textured creature GLB (colour map + tangent-space normal map + ORM), the same kind of
// asset as the toad: art-src/creatures-sets/hillloach.glb (+ overrides.json), imported with
//   npm run import-creatures -- --src=art-src/creatures-sets
// Body: the SDF body (bodies/streamfish.js) meshed by the game's surface nets, then UV-mapped in body space: u along the length (snout 0 ->
// tail base 1), v around the section (0 = belly midline = the seam, 0.5 = the back); fins are flat sheets whose vertices get a planar UV into
// their own rectangle of the atlas. Atlas 1024 x 1024: body rows 0-575, median fins and paired fins below.
// Colour: the owner's reference sheet (top, side and belly views of the maze-patterned loach; AI-generated, supplied by Peder Winterniz)
// RESAMPLED onto the atlas: dorsal view -> back, side view -> flanks, belly view -> underside; fin crops from the same sheet. The atlas holds
// resampled reference data, no other image. Relief (normal map) and ORM are authored here and carry no colour.
//   node tools/bake-hillloach-skin.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { BODIES } from '../src/render/creatures/bodies/index.js';
import { bodyShape } from '../src/render/creatures/shape.js';
import { M } from '../src/render/creatures/kit.js';

const BB = '/Users/rubykim/Documents/paludarium master/.agents/sets';
const SRC = '/Users/rubykim/Documents/paludarium master/.agents/refs/new-species-1007/Gemini_Generated_Image_3it3tr3it3tr3it3.jpg';
const OUTDIR = 'art-src/creatures-sets', TEXDIR = 'art-src/textures/hillloach';
fs.mkdirSync(OUTDIR, { recursive: true }); fs.mkdirSync(TEXDIR, { recursive: true });
const SZ = 1024, BODY_ROWS = 576;
const RECT = { caudal: [0, 576, 256, 224], dorsal: [256, 576, 320, 108], anal: [256, 684, 256, 90], pectoral: [0, 800, 320, 144], pelvic: [320, 800, 256, 120] };
const CROP = { caudal: [705, 532, 838, 650], dorsal: [358, 472, 532, 528], anal: [552, 615, 645, 668], pectoral: [158, 62, 378, 160], pelvic: [378, 108, 528, 190] };

// ---- reference image
const { data: SD, info: SI } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => { x = Math.max(0, Math.min(SI.width - 1.001, x)); y = Math.max(0, Math.min(SI.height - 1.001, y)); const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = [0, 0, 0]; for (let k = 0; k < 3; k++) { const g = (i, j) => SD[((y0 + j) * SI.width + x0 + i) * 3 + k]; o[k] = (g(0, 0) * (1 - fx) + g(1, 0) * fx) * (1 - fy) + (g(0, 1) * (1 - fx) + g(1, 1) * fx) * fy; } return o; };
const lp = (P, x) => { if (x <= P[0][0]) return P[0][1]; for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const t = (x - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[i - 1][1] + t * (P[i][1] - P[i - 1][1]); } return P[P.length - 1][1]; };
const SIDE = { x0: 62, x1: 700, top: [[62, 588], [100, 548], [160, 528], [300, 508], [360, 500], [500, 520], [600, 548], [700, 562]], bot: [[62, 604], [100, 624], [200, 640], [300, 642], [400, 625], [500, 612], [600, 600], [700, 596]] };
const DOR = { a0: 62, a1: 720, cen: [[62, 238], [720, 233]], half: [[62, 6], [80, 46], [120, 76], [200, 84], [300, 70], [400, 55], [500, 45], [600, 32], [720, 14]] };
const BEL = { a0: 78, a1: 600, cen: [[78, 1075], [600, 1075]], half: [[78, 8], [110, 58], [150, 78], [250, 62], [350, 44], [450, 36], [550, 24], [600, 14]] };
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; };

// ---- the body mesh
const def = BODIES.hillloach();
const sh = bodyShape(def, 'hi');
const n0 = sh.n;
const P = sh.P, I = sh.I;
console.log('mesh', n0, 'vertices', I.length / 3, 'triangles');
const fin = new Uint8Array(n0);
for (let i = 0; i < n0; i++) fin[i] = def.mat(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) === M.FIN ? 1 : 0;
const zs = def.hi[2] - 0.2, SL = 5.3;                       // the snout tip z and the body length (cm), as streamfish.js builds them
const zsnout = Math.max(...Array.from({ length: n0 }, (_, i) => P[i * 3 + 2]));
const Zs = zsnout - 0.02;
// Section centre and half sizes per z bin, from the body (non-fin) vertices.
const BIN = 0.06, nb = Math.ceil((zsnout - def.lo[2]) / BIN) + 2, sec = Array.from({ length: nb }, () => ({ y0: 1e9, y1: -1e9, x1: 0, n: 0 }));
for (let i = 0; i < n0; i++) if (!fin[i]) { const b = Math.floor((zsnout - P[i * 3 + 2]) / BIN), s = sec[b]; s.y0 = Math.min(s.y0, P[i * 3 + 1]); s.y1 = Math.max(s.y1, P[i * 3 + 1]); s.x1 = Math.max(s.x1, Math.abs(P[i * 3])); s.n++; }
for (let b = 0; b < nb; b++) if (!sec[b].n) { const o = sec[b - 1] ?? sec[b + 1]; if (o && o.n) Object.assign(sec[b], o); else Object.assign(sec[b], { y0: 0, y1: 0.5, x1: 0.3, n: 1 }); }
const secAt = (z) => sec[Math.max(0, Math.min(nb - 1, Math.floor((zsnout - z) / BIN)))];

// ---- UVs
const U = new Float32Array(n0), V = new Float32Array(n0), cls = new Uint8Array(n0);   // cls: 0 body, 1 caudal, 2 dorsal, 3 anal, 4 pectoral, 5 pelvic
const NAME = ['body', 'caudal', 'dorsal', 'anal', 'pectoral', 'pelvic'];
const bb = Array.from({ length: 6 }, () => ({ x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 }));
for (let i = 0; i < n0; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  const s = (zsnout - z) / SL;
  if (!fin[i]) { cls[i] = 0; continue; }
  if (Math.abs(x) > 0.55) cls[i] = z > 0.6 ? 4 : 5;
  else if (s > 1.02 || z < -1.5) cls[i] = 1;
  else cls[i] = y > secAt(z).y1 - 0.05 ? 2 : 3;
  const b = bb[cls[i]]; b.x1 = Math.max(b.x1, Math.abs(x)); b.x0 = Math.min(b.x0, Math.abs(x)); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
}
for (let i = 0; i < n0; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], c = cls[i];
  if (c === 0) {
    const s = secAt(z), cy = (s.y0 + s.y1) / 2, hy = Math.max(0.05, (s.y1 - s.y0) / 2), ww = Math.max(0.05, s.x1);
    const phi = Math.atan2(x / ww, (y - cy) / hy);                      // 0 at the back, +-pi at the belly
    U[i] = Math.max(0, Math.min(1, (zsnout - z) / SL)); V[i] = (phi + Math.PI) / (2 * Math.PI);   // v = 0 / 1 at the belly midline
    U[i] = U[i] * 0.998 + 0.001; V[i] = V[i] * BODY_ROWS / SZ;
  } else {
    const [rx, ry, rw, rh] = RECT[NAME[c]], b = bb[c];
    let a, bv;                                                           // a: 0..1 across the crop, b: 0..1 down it
    if (c === 1 || c === 2 || c === 3) { a = (b.z1 - z) / Math.max(1e-3, b.z1 - b.z0); bv = (b.y1 - y) / Math.max(1e-3, b.y1 - b.y0); }
    else { a = (b.z1 - z) / Math.max(1e-3, b.z1 - b.z0); bv = (b.x1 - Math.abs(x)) / Math.max(1e-3, b.x1 - b.x0); }
    U[i] = (rx + (0.02 + 0.96 * a) * rw) / SZ; V[i] = (ry + (0.02 + 0.96 * bv) * rh) / SZ;
  }
}
// Seam: triangles whose body vertices straddle the belly midline get their low-v vertices duplicated with v + the body height.
const Pn = Array.from(P), Un = Array.from(U), Vn = Array.from(V), Nn = Array.from(sh.N), cl = Array.from(cls), fn = Array.from(fin), dup = new Map();
const idx = Array.from(I);
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t], b = idx[t + 1], c = idx[t + 2];
  if (cls[a] || cls[b] || cls[c]) continue;
  const vs = [V[a], V[b], V[c]];
  if (Math.max(...vs) - Math.min(...vs) > (BODY_ROWS / SZ) * 0.5) for (let k = 0; k < 3; k++) {
    const vi = idx[t + k];
    if (V[vi] < (BODY_ROWS / SZ) * 0.5) {
      let d = dup.get(vi);
      if (d === undefined) { d = Un.length; dup.set(vi, d); Pn.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]); Nn.push(sh.N[vi * 3], sh.N[vi * 3 + 1], sh.N[vi * 3 + 2]); Un.push(U[vi]); Vn.push(V[vi] + BODY_ROWS / SZ); cl.push(0); fn.push(0); }
      idx[t + k] = d;
    }
  }
}
console.log('seam duplicates', dup.size);

// ---- atlas: colour
const col = Buffer.alloc(SZ * SZ * 3, 128), H = new Float32Array(SZ * SZ), ORM = Buffer.alloc(SZ * SZ * 3);
const setpx = (i, j, c) => { const o = (j * SZ + i) * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; };
for (let j = 0; j < BODY_ROWS; j++) {
  const phi = (j + 0.5) / BODY_ROWS * 2 * Math.PI - Math.PI, sinp = Math.sin(phi), cosp = Math.cos(phi), ap = Math.abs(phi) * 180 / Math.PI;
  const wD = 1 - sm(52, 68, ap), wB = sm(112, 128, ap), wS = Math.max(0, 1 - wD - wB);
  for (let i = 0; i < SZ; i++) {
    const u = (i + 0.5) / SZ, c = [0, 0, 0];
    if (wS > 0) { const x = SIDE.x0 + u * (SIDE.x1 - SIDE.x0), yt = lp(SIDE.top, x), yb = lp(SIDE.bot, x), p = px(x, yt + (1 - cosp) / 2 * (yb - yt)); for (let k = 0; k < 3; k++) c[k] += p[k] * wS; }
    if (wD > 0) { const a = DOR.a0 + u * (DOR.a1 - DOR.a0), p = px(a, lp(DOR.cen, a) + sinp * lp(DOR.half, a) * 0.96); for (let k = 0; k < 3; k++) c[k] += p[k] * wD; }
    if (wB > 0) { const a = BEL.a0 + u * (BEL.a1 - BEL.a0), p = px(lp(BEL.cen, a) + sinp * lp(BEL.half, a) * 0.96, a); for (let k = 0; k < 3; k++) c[k] += p[k] * wB; }
    setpx(i, j, c);
  }
}
// Fins: the crop from the sheet, background filled outward from the fin's own pixels (nearest colour).
const bg = [0, 1, 2].map((k) => [SD[k], SD[(SI.width - 1) * 3 + k], SD[((SI.height - 1) * SI.width) * 3 + k]].sort((a, b) => a - b)[1]);
for (const name of Object.keys(RECT)) {
  const [rx, ry, rw, rh] = RECT[name], [x0, y0, x1, y1] = CROP[name], cw = x1 - x0, ch = y1 - y0;
  const fg = new Uint8Array(rw * rh), buf = new Float32Array(rw * rh * 3);
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) { const p = px(x0 + (i + 0.5) / rw * cw, y0 + (j + 0.5) / rh * ch); buf.set(p, (j * rw + i) * 3); fg[j * rw + i] = Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) > 24 ? 1 : 0; }
  for (let it = 0; it < 60; it++) { const nf = fg.slice(); for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) if (!fg[j * rw + i]) { let s = [0, 0, 0], n = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < rw && b < rh && fg[b * rw + a]) { n++; for (let k = 0; k < 3; k++) s[k] += buf[(b * rw + a) * 3 + k]; } } if (n) { for (let k = 0; k < 3; k++) buf[(j * rw + i) * 3 + k] = s[k] / n; nf[j * rw + i] = 1; } } fg.set(nf); }
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) setpx(rx + i, ry + j, [buf[(j * rw + i) * 3], buf[(j * rw + i) * 3 + 1], buf[(j * rw + i) * 3 + 2]]);
}

// ---- atlas: relief height (no colour) and ORM
const lum = (i, j) => { const o = (j * SZ + i) * 3; return (col[o] * 0.3 + col[o + 1] * 0.59 + col[o + 2] * 0.11) / 255; };
for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) {
  let h = 0, rough = 0.4;
  if (j < BODY_ROWS) {
    const u = (i + 0.5) / SZ, phi = (j + 0.5) / BODY_ROWS * 2 * Math.PI - Math.PI, lat = Math.sin(phi), belly = Math.abs(phi) > 2.5;
    // fine skin: small granules and a faint streak along the body; the back is smooth wet mucus, the flank and belly are finer-grained.
    h = 0.5 * vnoise(i * 0.55, j * 0.55) + 0.25 * vnoise(i * 0.17, j * 0.17 + 40) + 0.2 * vnoise(i * 0.9, j * 0.12);
    h *= 0.45 + 0.55 * sm(0.3, 1.1, Math.abs(Math.cos(phi) - 0.2) + 0.2);
    if (belly) { const d = Math.hypot((u - 0.42) / 0.16, lat / 0.55 + (phi > 0 ? -0.0 : 0.0)); h += 0.9 * Math.exp(-(((d - 1) / 0.14) ** 2)) - 0.25 * (d < 1); }   // the sucker disc: a raised rim round a shallow dish
    const l = lum(i, j);
    rough = belly ? 0.5 : 0.24 + 0.4 * (1 - l);     // wet glossy yellow-green, drier dark lines
  } else {
    // fins: rays fan out of the base; a groove between them, membrane flat
    let nm = null; for (const k of Object.keys(RECT)) { const [rx, ry, rw, rh] = RECT[k]; if (i >= rx && i < rx + rw && j >= ry && j < ry + rh) nm = [k, (i - rx) / rw, (j - ry) / rh]; }
    if (nm) { const [k, a, b] = nm; const ang = k === 'caudal' ? Math.atan2(b - 0.5, a + 0.02) : k === 'dorsal' || k === 'anal' ? Math.atan2(a - 0.5, (k === 'dorsal' ? 1 - b : b) + 0.05) : Math.atan2(a - 0.5, 1 - b + 0.03); const N = k === 'caudal' ? 26 : k === 'pectoral' ? 30 : 18; h = 0.5 + 0.5 * Math.cos(ang * N * 1.6) ** 3; h *= 0.9 + 0.1 * vnoise(i * 0.4, j * 0.4); rough = 0.38 + 0.2 * h; }
  }
  H[j * SZ + i] = h;
  const o = (j * SZ + i) * 3; ORM[o] = 255; ORM[o + 1] = Math.round(Math.max(0, Math.min(1, rough)) * 255); ORM[o + 2] = 0;
}
const STR = (j) => (j < BODY_ROWS ? 3.2 : 5.5), nrm = Buffer.alloc(SZ * SZ * 3);
for (let j = 0; j < SZ; j++) for (let i = 0; i < SZ; i++) {
  const g = (a, b) => H[Math.max(0, Math.min(SZ - 1, b)) * SZ + Math.max(0, Math.min(SZ - 1, a))];
  const dx = (g(i + 1, j - 1) + 2 * g(i + 1, j) + g(i + 1, j + 1) - g(i - 1, j - 1) - 2 * g(i - 1, j) - g(i - 1, j + 1)) / 8, dy = (g(i - 1, j + 1) + 2 * g(i, j + 1) + g(i + 1, j + 1) - g(i - 1, j - 1) - 2 * g(i, j - 1) - g(i + 1, j - 1)) / 8;
  const nx = -dx * STR(j), ny = dy * STR(j), nz = 1, l = Math.hypot(nx, ny, nz), o = (j * SZ + i) * 3;
  nrm[o] = Math.round((nx / l * 0.5 + 0.5) * 255); nrm[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255); nrm[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
}
const W = (buf, f, q) => sharp(buf, { raw: { width: SZ, height: SZ, channels: 3 } }).webp({ quality: q }).toFile(`${TEXDIR}/${f}.webp`);
await Promise.all([W(col, 'color', 90), W(nrm, 'normal', 90), W(ORM, 'orm', 85)]);
// A contact sheet of the three maps for the report.
fs.mkdirSync(`${BB}/shots/S2/compare`, { recursive: true });
const sheet = await Promise.all([col, nrm, ORM].map((b) => sharp(b, { raw: { width: SZ, height: SZ, channels: 3 } }).resize(512, 512).png().toBuffer()));
await sharp({ create: { width: 1536, height: 512, channels: 3, background: '#222' } }).composite(sheet.map((b, k) => ({ input: b, left: k * 512, top: 0 }))).png().toFile(`${BB}/shots/S2/compare/hillloach-maps.png`);

// ---- GLB (metres, head +z), body and fins as two meshes (the fin material's name makes the game draw it as fin)
const doc = new Document(), buf = doc.createBuffer();
const tex = (name, f) => doc.createTexture(name).setImage(fs.readFileSync(`${TEXDIR}/${f}.webp`)).setMimeType('image/webp');
const tC = tex('color', 'color'), tN = tex('normal', 'normal'), tO = tex('orm', 'orm');
const mk = (name) => doc.createMaterial(name).setBaseColorTexture(tC).setNormalTexture(tN).setMetallicRoughnessTexture(tO).setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(name.includes('fin'));
const scene = doc.createScene('s');
for (const [name, isFin] of [['hillloach', 0], ['hillloach_fin', 1]]) {
  const keep = []; for (let t = 0; t < idx.length; t += 3) { const f = fn[idx[t]] || fn[idx[t + 1]] || fn[idx[t + 2]]; if (!!f === !!isFin) keep.push(idx[t], idx[t + 1], idx[t + 2]); }
  if (!keep.length) continue;
  const map = new Map(), pos = [], nor = [], uv = [], ind = [];
  for (const v of keep) { let m = map.get(v); if (m === undefined) { m = map.size; map.set(v, m); pos.push(Pn[v * 3] / 100, Pn[v * 3 + 1] / 100, Pn[v * 3 + 2] / 100); nor.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]); uv.push(Un[v], Vn[v]); } ind.push(m); }
  const prim = doc.createPrimitive().setMaterial(mk(name))
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(map.size > 65535 ? new Uint32Array(ind) : new Uint16Array(ind)).setBuffer(buf));
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)); scene.addChild(node);
  console.log(name, map.size, 'vertices', keep.length / 3, 'triangles');
}
await new NodeIO().write(`${OUTDIR}/hillloach.glb`, doc);
// Analytic eyes from the SDF body's own spec, and the finish, for the manifest (overrides.json).
const eyes = def.finish.eyes.map((e) => JSON.parse(JSON.stringify(e)));
const ov = { hillloach: { finish: { rough: 0.5, coat: 0.55, coatRough: 0.18, grainAmt: 0, finOpacity: 0.95, eyes } } };
fs.writeFileSync(`${OUTDIR}/overrides.json`, JSON.stringify(ov));
console.log('wrote', `${OUTDIR}/hillloach.glb`, (fs.statSync(`${OUTDIR}/hillloach.glb`).size / 1024).toFixed(0), 'kB');
