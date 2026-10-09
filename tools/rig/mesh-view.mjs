// A posed mesh looked at without a renderer: orthographic, z-buffered, two-sided (back faces dark, so a hole or a torn sheet shows), lit by a light over the shoulder.
//   node tools/rig/mesh-view.mjs <pose.json ({ pos, idx })> <out.png> [view=side|top|back|front|3q|3qb] [BOX="x0,x1,y0,y1,z0,z1"] [W=900]
// The frame is the bake's: +z the head, +y up, +x the frog's right. BOX: the part to frame and draw (the vertices inside, and the faces of three of them).
import fs from 'node:fs';
import sharp from 'sharp';
const [, , file, out, view = 'side'] = process.argv, E = process.env, W = +(E.W ?? 900);
const d = JSON.parse(fs.readFileSync(file, 'utf8')), pos = d.pos, idx = d.idx, n = pos.length / 3;
const COL = E.COL ? JSON.parse(fs.readFileSync(E.COL, 'utf8')) : null;   // COL=<json: per-vertex [r, g, b] 0..255>: colour the surface (a rig's limbs, say) instead of the grey-green
const BOX = E.BOX ? E.BOX.split(',').map(Number) : null, inB = (i) => !BOX || (pos[i * 3] >= BOX[0] && pos[i * 3] <= BOX[1] && pos[i * 3 + 1] >= BOX[2] && pos[i * 3 + 1] <= BOX[3] && pos[i * 3 + 2] >= BOX[4] && pos[i * 3 + 2] <= BOX[5]);
const EYE = { side: [1, 0.05, 0], top: [0, 1, 0.001], back: [0.001, 0.15, -1], front: [0, 0.15, 1], '3q': [0.8, 0.55, -0.6], '3qb': [-0.8, 0.55, 0.6] }[view] ?? [1, 0, 0];
const el = Math.hypot(...EYE), ey = EYE.map((v) => v / el), UP = view === 'top' ? [0, 0, 1] : [0, 1, 0];
const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const f = ey.map((v) => -v), R = nm(cr(f, UP)), U = cr(R, f);
const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
for (let i = 0; i < n; i++) { const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; X[i] = p[0] * R[0] + p[1] * R[1] + p[2] * R[2]; Y[i] = p[0] * U[0] + p[1] * U[1] + p[2] * U[2]; Z[i] = p[0] * ey[0] + p[1] * ey[1] + p[2] * ey[2]; }
let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < n; i++) if (inB(i)) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
const pad = 0.04 * Math.max(x1 - x0, y1 - y0), sc = (W - 20) / (x1 - x0 + 2 * pad), H = Math.ceil((y1 - y0 + 2 * pad) * sc) + 20;
const px = (i) => 10 + (X[i] - x0 + pad) * sc, py = (i) => H - 10 - (Y[i] - y0 + pad) * sc;
const N3 = new Float32Array(n * 3);
for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2], u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]], v = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]], q = cr(u, v); for (const i of [a, b, c]) { N3[i * 3] += q[0]; N3[i * 3 + 1] += q[1]; N3[i * 3 + 2] += q[2]; } }
for (let i = 0; i < n; i++) { const l = Math.hypot(N3[i * 3], N3[i * 3 + 1], N3[i * 3 + 2]) || 1; N3[i * 3] /= l; N3[i * 3 + 1] /= l; N3[i * 3 + 2] /= l; }
const L = nm([ey[0] + R[0] * -0.5 + U[0] * 0.7, ey[1] + R[1] * -0.5 + U[1] * 0.7, ey[2] + R[2] * -0.5 + U[2] * 0.7]);
const img = new Uint8Array(W * H * 3).fill(58), zb = new Float32Array(W * H).fill(-1e9);
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (!(inB(a) && inB(b) && inB(c))) continue;
  const ax = px(a), ay = py(a), bx = px(b), by = py(b), cx = px(c), cy = py(c), den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
  const mnx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), mxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))), mny = Math.max(0, Math.floor(Math.min(ay, by, cy))), mxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  // face facing: the geometric normal against the eye (a back face is drawn dark)
  const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]], v = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]], q = nm(cr(u, v)), front = q[0] * ey[0] + q[1] * ey[1] + q[2] * ey[2] > 0;
  for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) {
    const w0 = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den, w1 = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den, w2 = 1 - w0 - w1; if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c], k = y * W + x; if (z <= zb[k]) continue; zb[k] = z;
    let nx = w0 * N3[a * 3] + w1 * N3[b * 3] + w2 * N3[c * 3], ny = w0 * N3[a * 3 + 1] + w1 * N3[b * 3 + 1] + w2 * N3[c * 3 + 1], nz = w0 * N3[a * 3 + 2] + w1 * N3[b * 3 + 2] + w2 * N3[c * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const lit = Math.max(0.12, nx * L[0] + ny * L[1] + nz * L[2]), s = front ? 0.35 + 0.65 * lit : 0.18 * lit;
    const bc = COL ? [0, 1, 2].map((q) => w0 * COL[a][q] + w1 * COL[b][q] + w2 * COL[c][q]) : [150, 190, 140];
    img[k * 3] = Math.min(255, bc[0] * s + 20); img[k * 3 + 1] = Math.min(255, bc[1] * s + 20); img[k * 3 + 2] = Math.min(255, bc[2] * s + 20);
    if (!front) { img[k * 3] = 120; img[k * 3 + 1] = 20; img[k * 3 + 2] = 20; }
  }
}
await sharp(Buffer.from(img), { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log(`${out}: ${W} x ${H}, view ${view}`);
