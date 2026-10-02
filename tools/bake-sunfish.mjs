// The pygmy sunfish model: the supplied sunfish body (art-src/raw/bluespotted_sunfish.glb, turned, centred and scaled by
// tools/bake-texcolors.mjs) with its own photo texture, and new fins. The supplied fins took their outline and colour from a photo texture
// whose fin areas are white background crossed by dark streaks, so they read as ragged grey sheets in the game; here the
// median fins are rebuilt as clean sheets fitted to the body's own outline and painted like a displaying male Elassoma:
// smoky black membrane, fine darker rays, rows of electric-blue spangles, a pale blue rim. The spiny dorsal has notched
// membrane between its spines, the soft dorsal and the anal fin are rounded lobes set far back, the tail is a rounded fan.
// The paired fins are kept (their shape is fine) and repainted. The flat eye discs are dropped: the game draws the eye
// (finish.eyes in art-src/creatures/overrides.json).
// The texture: the photo's white background is filled outward from the fish's own colours (the edges of the body's UV map
// fell on it: a white back and white lips), and the fin pattern is painted into an unused corner (FR) that every fin samples,
// so the whole fish is one textured material, crisp at any distance.
//
//   node tools/bake-texcolors.mjs art-src/raw/bluespotted_sunfish.glb art-src/raw/pygmy_baked.glb --lengthCm=3 --rotY=-90
//   node tools/bake-sunfish.mjs [art-src/raw/pygmy_baked.glb] [art-src/creatures/pygmy.glb]
//   then npm run import-creatures (pygmy) and node tools/bench.mjs pygmy --src=glb
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [inp = 'art-src/raw/pygmy_baked.glb', out = 'art-src/creatures/pygmy.glb', raw = 'art-src/raw/bluespotted_sunfish.glb'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const FR = { u0: 0.015, du: 0.225, v0: 0.775, dv: 0.21 };      // the fin pattern's corner of the texture (uv)
const src = await io.read(inp);
const CM = 100;                                                   // the file is in metres; fins are designed in cm

const lin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => Math.pow(v / 255, 2.2));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

// Parts of the baked model.
const parts = [];
for (const node of src.getRoot().listNodes()) {
  const p = node.getMesh()?.listPrimitives()[0];
  if (!p) continue;
  parts.push({ name: node.getName(), pos: Float32Array.from(p.getAttribute('POSITION').getArray()), col: Float32Array.from(p.getAttribute('COLOR_0').getArray()), tc: p.getAttribute('TEXCOORD_0') ? Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()) : null, idx: Array.from(p.getIndices().getArray()) });
}
const body = parts.find((p) => p.name === 'body');

// The body's outline in side view: top and bottom y (cm) per z (cm), from its vertices.
const ZB = 0.05, prof = new Map();
for (let i = 0; i < body.pos.length; i += 3) {
  const z = body.pos[i + 2] * CM, y = body.pos[i + 1] * CM, b = Math.round(z / ZB);
  const o = prof.get(b) ?? { t: -9, b: 9 };
  o.t = Math.max(o.t, y); o.b = Math.min(o.b, y);
  prof.set(b, o);
}
const keys = [...prof.keys()].sort((a, b) => a - b);
const at = (z, k) => {
  const f = z / ZB, i0 = Math.floor(f);
  const a = prof.get(Math.max(keys[0], Math.min(keys.at(-1), i0))) ?? prof.get(keys[0]);
  const b = prof.get(Math.max(keys[0], Math.min(keys.at(-1), i0 + 1))) ?? a;
  return a[k] + (b[k] - a[k]) * (f - i0);
};
const top = (z) => at(z, 't'), bot = (z) => at(z, 'b');
const zTail = keys[0] * ZB, zNose = keys.at(-1) * ZB;           // body ends (cm)
const L = zNose - zTail;
const Z = (f) => zNose - f * L;                                  // 0 at the snout … 1 at the tail end of the body

// Colours (sRGB hex → linear): a displaying male.
const MEM = lin(0x101318), MEM2 = lin(0x1c2430), RAY = lin(0x06080b), BLUE = lin(0x2fb4ff), BLUE2 = lin(0x8ae4ff), RIM = lin(0x6cc8f0);
function finColour(z, y, ray, t, spineFin) {
  let c = mix(MEM, MEM2, 0.5 * t);
  c = mix(c, RAY, ray * 0.7);
  // Iridescent spangles in rows between the rays, more toward the outer half; few on the spiny dorsal.
  const gx = Math.floor(z * 9), gy = Math.floor(y * 9), h = hash(gx, gy), fx = z * 9 - gx - 0.5, fy = y * 9 - gy - 0.5;
  const spot = sm(0.22, 0.1, Math.hypot(fx, fy)) * (h > (spineFin ? 0.75 : 0.45) ? 1 : 0) * sm(0.15, 0.45, t) * (1 - ray);
  c = mix(c, mix(BLUE, BLUE2, hash(gy, gx)), spot * 0.9);
  return mix(c, RIM, sm(0.86, 1.0, t) * 0.55);                   // a pale blue edge
}

// A fin sheet: base points B(s) and outline points O(s) for s 0 … 1, a grid of `ns` x `nt`, both faces (offset ±h along x).
function sheet(B, O, ns, nt, { rays = 12, spine = false, h = 0.004 } = {}) {
  const pos = [], col = [], tc = [], idx = [];
  for (const side of [1, -1]) {
    const o = pos.length / 3;
    for (let i = 0; i <= ns; i++) {
      const s = i / ns, b = B(s), e = O(s);
      for (let j = 0; j <= nt; j++) {
        const t = j / nt, p = [b[0] + (e[0] - b[0]) * t, b[1] + (e[1] - b[1]) * t, b[2] + (e[2] - b[2]) * t];
        pos.push((p[0] + side * h) / CM, p[1] / CM, p[2] / CM);
        const ray = Math.pow(Math.max(0, Math.cos(s * rays * Math.PI * 2)), 12);   // a thin darker ray every 1/rays of the base
        col.push(...finColour(p[2], p[1], ray * (0.4 + 0.6 * t), t, spine && s < 0.5));
        tc.push(FR.u0 + ((s * rays / 14) % 1) * FR.du, FR.v0 + t * FR.dv);   // the painted pattern has 14 rays across: repeat it
      }
    }
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
      const a = o + i * (nt + 1) + j, b = a + nt + 1;
      if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { name: 'fin', pos: Float32Array.from(pos), col: Float32Array.from(col), tc: Float32Array.from(tc), idx };
}

const fins = [];
const depth = (z) => top(z) - bot(z);
const D = Math.max(...keys.map((k) => depth(k * ZB)));            // greatest body depth

// Dorsal: spiny part (front, s < 0.45, notched membrane between 6 spines), then a tall rounded soft lobe set far back.
{
  const z0 = Z(0.36), z1 = Z(0.86);
  const B = (s) => { const z = z0 + (z1 - z0) * s; return [0, top(z) - 0.05, z]; };
  const O = (s) => {
    const z = z0 + (z1 - z0) * s;
    let hgt;
    if (s < 0.45) {
      const u = s / 0.45, spines = 6, ph = (u * spines) % 1;
      hgt = D * (0.12 + 0.2 * u) * (1 - 0.3 * Math.sin(ph * Math.PI));   // spine tips at the phase ends, membrane dips between
    } else {
      const u = (s - 0.45) / 0.55;
      hgt = D * (0.3 + 0.32 * Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.8) * (1 - sm(0.85, 1, u) * 0.85);
    }
    const back = s > 0.45 ? 0.18 * D * sm(0.45, 1, s) : 0;        // the soft rays sweep back
    return [0, top(z) + hgt, z - back];
  };
  fins.push(sheet(B, O, 40, 9, { rays: 13, spine: true }));
}
// Anal: three short spines, then a rounded soft lobe mirroring the soft dorsal.
{
  const z0 = Z(0.58), z1 = Z(0.88);
  const B = (s) => { const z = z0 + (z1 - z0) * s; return [0, bot(z) + 0.05, z]; };
  const O = (s) => {
    const z = z0 + (z1 - z0) * s;
    const hgt = D * (0.1 + 0.38 * Math.sin(Math.min(1, s * 1.1) * Math.PI) ** 0.8) * (1 - sm(0.85, 1, s) * 0.85);
    return [0, bot(z) - hgt, z - 0.16 * D * sm(0.2, 1, s)];
  };
  fins.push(sheet(B, O, 28, 8, { rays: 10, spine: false }));
}
// Tail: a rounded fan from the caudal peduncle.
{
  const zp = zTail + 0.12, yc = (top(zp) + bot(zp)) / 2, h0 = depth(zp) * 0.42, R = 0.36 * L, H = 0.62 * D;
  const B = (s) => { const a = (s - 0.5) * 2; return [0, yc + a * h0, zp]; };
  const O = (s) => { const a = (s - 0.5) * 2, th = a * 1.05; return [0, yc + Math.sin(th) * H, zp - Math.cos(th) * R * (0.86 + 0.14 * Math.cos(a * 1.6))]; };
  fins.push(sheet(B, O, 36, 10, { rays: 14 }));
}

// Paired fins: keep the shapes, repaint smoky with a blue sheen toward the edge.
for (const p of parts) {
  if (p.name !== 'fin' || p.pos.length / 3 > 200) continue;
  let y0 = 9, y1 = -9, z0 = 9, z1 = -9;
  for (let i = 0; i < p.pos.length; i += 3) { y0 = Math.min(y0, p.pos[i + 1]); y1 = Math.max(y1, p.pos[i + 1]); z0 = Math.min(z0, p.pos[i + 2]); z1 = Math.max(z1, p.pos[i + 2]); }
  for (let i = 0; i < p.pos.length; i += 3) {
    const t = (z1 - p.pos[i + 2]) / Math.max(1e-6, z1 - z0);
    const c = finColour(p.pos[i + 2] * CM, p.pos[i + 1] * CM, 0, t * 0.8, false);
    p.col.set(mix(c, lin(0x3a4a58), 0.35), i);
  }
  p.tc = new Float32Array(p.pos.length / 3 * 2);
  for (let i = 0, k = 0; i < p.pos.length; i += 3, k += 2) { p.tc[k] = FR.u0 + (p.pos[i + 1] - y0) / Math.max(1e-6, y1 - y0) * FR.du * 0.5; p.tc[k + 1] = FR.v0 + (z1 - p.pos[i + 2]) / Math.max(1e-6, z1 - z0) * FR.dv * 0.85; }
  fins.push(p);
}

// The texture.
const rawDoc = await io.read(raw);
const bodyTex = rawDoc.getRoot().listMaterials().find((m) => m.getAlphaMode() === 'OPAQUE' && m.getBaseColorTexture())?.getBaseColorTexture();
const { data, info } = await sharp(Buffer.from(bodyTex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, px = new Float32Array(W * H * 3), filled = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
  const white = Math.min(r, g, b) > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 80;   // the white background and the pale photo fins
  px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b;
  filled[i] = a > 128 && !white ? 1 : 0;
}
// Grow the fish outward over the background, a ring of pixels per pass (the mean of the filled neighbours).
for (let pass = 0; pass < 48; pass++) {
  const next = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (filled[i]) continue;
    let n = 0, r = 0, g = 0, b = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (filled[j]) { n++; r += px[j * 3]; g += px[j * 3 + 1]; b += px[j * 3 + 2]; }
    }
    if (n >= 2) next.push(i, r / n, g / n, b / n);
  }
  if (!next.length) break;
  for (let k = 0; k < next.length; k += 4) { const i = next[k]; px[i * 3] = next[k + 1]; px[i * 3 + 1] = next[k + 2]; px[i * 3 + 2] = next[k + 3]; filled[i] = 1; }
}
// The fin pattern (sRGB): s across the fin (14 rays), t from the base (0) to the rim (1).
const srgb = (c) => c.map((v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255));
const x0 = Math.round(FR.u0 * W), x1 = Math.round((FR.u0 + FR.du) * W), y0p = Math.round(FR.v0 * H), y1p = Math.round((FR.v0 + FR.dv) * H);
for (let y = y0p; y < y1p; y++) for (let x = x0; x < x1; x++) {
  const s = (x - x0) / (x1 - x0), t = (y - y0p) / (y1p - y0p);
  const ray = Math.pow(Math.max(0, Math.cos(s * 14 * Math.PI * 2)), 10) * (0.35 + 0.65 * t);
  let c = mix(MEM, MEM2, 0.5 * t);
  c = mix(c, RAY, ray * 0.75);
  // spangles: rows of small round blue dots between the rays, denser outward
  const gx = Math.floor(s * 28), gy = Math.floor(t * 9), fx = s * 28 - gx - 0.5, fy = t * 9 - gy - 0.5;
  const spot = sm(0.34, 0.2, Math.hypot(fx, fy * 1.3)) * (hash(gx, gy) > 0.42 ? 1 : 0) * sm(0.12, 0.4, t) * (gx % 2 ? 1 : 0);
  c = mix(c, mix(BLUE, BLUE2, hash(gy, gx) * 0.6), spot * 0.95);
  c = mix(c, RIM, sm(0.9, 0.99, t) * 0.6);
  const i = y * W + x, o = srgb(c);
  px[i * 3] = o[0]; px[i * 3 + 1] = o[1]; px[i * 3 + 2] = o[2];
}
const png = await sharp(Buffer.from(Uint8Array.from(px, (v) => Math.max(0, Math.min(255, Math.round(v))))), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();

const keep = [body, ...fins];
const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene(), mats = {};
const tex = doc.createTexture('sunfish').setImage(png).setMimeType('image/png');
for (const p of keep) {
  mats[p.name] ??= doc.createMaterial(p.name).setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(tex).setRoughnessFactor(0.4).setMetallicFactor(0);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(p.pos)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(p.tc)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(p.idx)).setBuffer(buf))
    .setMaterial(mats[p.name]);
  scene.addChild(doc.createNode(p.name).setMesh(doc.createMesh(p.name).addPrimitive(prim)));
}
await io.write(out, doc);
console.log(`${out}: body + ${fins.length} fins, ${keep.reduce((n, p) => n + p.idx.length / 3, 0)} tris; body ${zTail.toFixed(2)} … ${zNose.toFixed(2)} cm, depth ${D.toFixed(2)} cm`);
