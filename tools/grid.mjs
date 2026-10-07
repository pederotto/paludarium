// Lays bench PNGs out as a grid: node tools/grid.mjs <out.png> <cols> <file> … (each tile labelled by the bench already).
import sharp from 'sharp';
const [out, cols, ...files] = process.argv.slice(2);
const metas = await Promise.all(files.map((f) => sharp(f).metadata()));
const w = metas[0].width, h = metas[0].height, n = +cols, rows = Math.ceil(files.length / n);
await sharp({ create: { width: w * n, height: h * rows, channels: 3, background: '#000' } })
  .composite(files.map((f, i) => ({ input: f, left: (i % n) * w, top: Math.floor(i / n) * h }))).png().toFile(out);
console.log(out, w * n, 'x', h * rows);
