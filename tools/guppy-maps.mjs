// Paints guppy looks onto the owner's models (src/render/creatures/guppypaint.js paintGuppyModel) and writes them as PNG files, for the
// Blender preview (art-src/guppy/look_painted.py) and for checking by eye.
//   node tools/guppy-maps.mjs <maps dir> <model: male|female> <out dir> [look …]
// <maps dir> holds <model>-coords.png, <model>-parts.png and <model>-base.png (art-src/guppy/prep_glb.py).
import sharp from 'sharp';
import fs from 'node:fs';
import { paintGuppyModel } from '../src/render/creatures/guppypaint.js';

const [dir, model, out, ...looks] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const raw = async (f) => { const { data, info } = await sharp(`${dir}/${model}-${f}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), N: info.width }; };
const [c, p, b] = await Promise.all([raw('coords'), raw('parts'), raw('base')]);
const maps = { N: c.N, coords: c.data, parts: p.data, base: b.data };
for (const l of looks) {
  const t = Date.now(), img = paintGuppyModel(l, maps);
  await sharp(Buffer.from(img.rgba.buffer), { raw: { width: img.N, height: img.N, channels: 4 } }).png().toFile(`${out}/${l}.png`);
  console.log(`${l}.png`, Date.now() - t, 'ms');
}
