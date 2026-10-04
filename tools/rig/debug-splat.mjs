// Debug view of a baked rig: splats the vertices into side / top / front images coloured by leg id and legT.
//   import { splat } from './debug-splat.mjs'; await splat(pos, rig, 'test-output/bake/frog-rig.png')
import sharp from 'sharp';
const COL = [[150, 150, 150], [230, 60, 60], [60, 200, 60], [60, 90, 240], [240, 200, 40]];
export async function splat(pos, rig, file, S = 420) {
  const n = pos.length / 3;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], pos[i * 3 + c]); mx[c] = Math.max(mx[c], pos[i * 3 + c]); }
  const span = Math.max(...mx.map((v, c) => v - mn[c])) * 1.05;
  const views = [[2, 1, 0, 1], [0, 2, 1, 1], [0, 1, 2, 1]];     // side (z right, y up, depth x), top (x, z, depth y), front (x, y, depth z)
  const img = Buffer.alloc(S * 3 * S * 3, 20);
  views.forEach(([a, b, dpt], v) => {
    const zb = new Float32Array(S * S).fill(-1e9);
    for (let i = 0; i < n; i++) {
      const px = Math.floor(((pos[i * 3 + a] - (mn[a] + mx[a]) / 2) / span + 0.5) * S), py = Math.floor((0.5 - (pos[i * 3 + b] - (mn[b] + mx[b]) / 2) / span) * S);
      const d = pos[i * 3 + dpt];
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
        const X = px + ox, Y = py + oy; if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
        if (d <= zb[Y * S + X]) continue; zb[Y * S + X] = d;
        const c = COL[rig.leg[i]] ?? [255, 255, 255], t = rig.leg[i] ? 0.35 + 0.65 * rig.legT[i] : 1;
        const o = (Y * S * 3 + v * S + X) * 3; img[o] = c[0] * t; img[o + 1] = c[1] * t; img[o + 2] = c[2] * t;
      }
    }
  });
  await sharp(img, { raw: { width: S * 3, height: S, channels: 3 } }).png().toFile(file);
}
