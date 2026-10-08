// The colour of the skin tools/rig/fill-holes.mjs added (the common frog, 7 Oct 2026): the colour bake (tools/blender/texture-transfer.py) casts each texel's ray into
// the owner's textured model, which has an opening where the patch is, so the patch's rays went through it and came back with the inside's dark (a black mark on the
// chest). Here every texel of a face the fill made (fill.json: the new vertices, the new faces' centres) is painted again from the skin round the patch: the colour at each of the nearest old vertices (their texel
// and its 8 neighbours), blended by inverse square distance in 3-d at the texel's own place on the body; a texel and a half round each face too (the atlas's filtering).
//   node tools/rig/fill-colour.mjs <body.glb with the atlas UVs> <colour.png> <fill.json> <out.png>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptDecoder.ready;
const [GLB, IMG, FILL, OUT] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(GLB), node = doc.getRoot().listNodes().find((n) => n.getMesh()), M = node.getWorldMatrix(), prim = node.getMesh().listPrimitives()[0];
const pa = prim.getAttribute('POSITION'), ua = prim.getAttribute('TEXCOORD_0'), n = pa.getCount(), P = new Float64Array(n * 3), U = new Float64Array(n * 2), e = [];
for (let i = 0; i < n; i++) { pa.getElement(i, e); for (let r = 0; r < 3; r++) P[i * 3 + r] = M[r] * e[0] + M[4 + r] * e[1] + M[8 + r] * e[2] + M[12 + r]; ua.getElement(i, e); U[i * 2] = e[0]; U[i * 2 + 1] = e[1]; }
const I = prim.getIndices().getArray(), FJ = JSON.parse(fs.readFileSync(FILL, 'utf8')), F = FJ.positionsM, FC = FJ.faceCentresM ?? [];
// the new vertices: the body's nearest to each place the fill wrote (the file's positions are quantized: within 0.05 mm)
const isNew = new Uint8Array(n);
for (const q of F) { let best = 1e9, bi = -1; for (let i = 0; i < n; i++) { const d = (P[i * 3] - q[0]) ** 2 + (P[i * 3 + 1] - q[1]) ** 2 + (P[i * 3 + 2] - q[2]) ** 2; if (d < best) { best = d; bi = i; } }
  if (Math.sqrt(best) < 5e-4 * 0.1) isNew[bi] = 1; for (let i = 0; i < n; i++) if ((P[i * 3] - q[0]) ** 2 + (P[i * 3 + 1] - q[1]) ** 2 + (P[i * 3 + 2] - q[2]) ** 2 < 25e-10) isNew[i] = 1; }
const { data, info } = await sharp(IMG).removeAlpha().raw().toBuffer({ resolveWithObject: true }), W = info.width, H = info.height, C = info.channels;
const texel = (u, v) => [Math.min(W - 1, Math.max(0, Math.floor(u * W))), Math.min(H - 1, Math.max(0, Math.floor(v * H)))];
const at = (x, y) => { const k = (y * W + x) * C; return [data[k], data[k + 1], data[k + 2]]; };
// the skin round the patch: old vertices within 1.2 cm of a new one, each with its texel's colour (3 x 3 mean)
const nw = []; for (let i = 0; i < n; i++) if (isNew[i]) nw.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); for (const c of FC) nw.push(c);      // (round the new vertices and every new face)
const ring = [];
for (let i = 0; i < n; i++) { if (isNew[i]) continue; let near = false; for (const c of nw) if ((P[i * 3] - c[0]) ** 2 + (P[i * 3 + 1] - c[1]) ** 2 + (P[i * 3 + 2] - c[2]) ** 2 < 1.44e-4) { near = true; break; } if (!near) continue;
  const [x, y] = texel(U[i * 2], U[i * 2 + 1]), c = [0, 0, 0]; let k = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = at(Math.min(W - 1, Math.max(0, x + dx)), Math.min(H - 1, Math.max(0, y + dy))); c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; k++; }
  ring.push({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], c: c.map((v) => v / k) }); }
// every face with a new vertex, painted texel by texel (and 1.5 texels round it)
let painted = 0, faces = 0; const outBuf = Buffer.from(data);
for (let t = 0; t < I.length; t += 3) {
  // (a face of the fill: one with a new vertex, or one the fill made over the rim's own vertices (its centre where the fill put one))
  const v = [I[t], I[t + 1], I[t + 2]], cen = [0, 1, 2].map((k) => (P[v[0] * 3 + k] + P[v[1] * 3 + k] + P[v[2] * 3 + k]) / 3);
  if (!v.some((i) => isNew[i]) && !FC.some((c) => (c[0] - cen[0]) ** 2 + (c[1] - cen[1]) ** 2 + (c[2] - cen[2]) ** 2 < 25e-10)) continue; faces++;
  const uv = v.map((i) => [U[i * 2] * W, U[i * 2 + 1] * H]), pp = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  const area = (uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[1][1] - uv[0][1]) * (uv[2][0] - uv[0][0]); if (Math.abs(area) < 1e-9) continue;
  const x0 = Math.floor(Math.min(...uv.map((q) => q[0])) - 2), x1 = Math.ceil(Math.max(...uv.map((q) => q[0])) + 2), y0 = Math.floor(Math.min(...uv.map((q) => q[1])) - 2), y1 = Math.ceil(Math.max(...uv.map((q) => q[1])) + 2);
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
    const px = x + 0.5, py = y + 0.5, w0 = ((uv[1][0] - px) * (uv[2][1] - py) - (uv[1][1] - py) * (uv[2][0] - px)) / area, w1 = ((uv[2][0] - px) * (uv[0][1] - py) - (uv[2][1] - py) * (uv[0][0] - px)) / area, w2 = 1 - w0 - w1;
    // (inside the face, or within 1.5 texels of it: the barycentric weights' shortfall over the edge lengths)
    const out = Math.max(-w0, -w1, -w2, 0); if (out > 0 && out * Math.sqrt(Math.abs(area)) > 1.5) continue;
    const c0 = Math.max(0, w0), c1 = Math.max(0, w1), c2 = Math.max(0, w2), s = c0 + c1 + c2, q = [0, 1, 2].map((k) => (c0 * pp[0][k] + c1 * pp[1][k] + c2 * pp[2][k]) / s);
    const near = ring.map((r) => [(r.p[0] - q[0]) ** 2 + (r.p[1] - q[1]) ** 2 + (r.p[2] - q[2]) ** 2, r.c]).sort((a, b) => a[0] - b[0]).slice(0, 12);
    let sw = 0; const col = [0, 0, 0]; for (const [d2, c] of near) { const w = 1 / (d2 + 1e-10); sw += w; for (let k = 0; k < 3; k++) col[k] += w * c[k]; }
    const k = (y * W + x) * C; for (let j = 0; j < 3; j++) outBuf[k + j] = Math.round(col[j] / sw); painted++;
  }
}
await sharp(outBuf, { raw: { width: W, height: H, channels: C } }).png().toFile(OUT);
console.log(`${isNew.reduce((u, v) => u + v, 0)} new vertices found of ${F.length}; ${faces} faces, ${painted} texels painted from ${ring.length} skin vertices round them -> ${OUT}`);
