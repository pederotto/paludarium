// Contact sheet of screenshots: node tools/steps/gen-sheet.mjs <out.png> <cols> <cell width> <a.png> <b.png> ...
import sharp from 'sharp';
import path from 'node:path';
const [out, colsArg, wArg, ...files] = process.argv.slice(2);
const cols = +colsArg, cw = +wArg, ch = Math.round(cw * 9 / 16);
const rows = Math.ceil(files.length / cols);
const comps = [];
for (let i = 0; i < files.length; i++) {
  const left = (i % cols) * cw, top = Math.floor(i / cols) * ch;
  const buf = await sharp(files[i]).resize(cw, ch, { fit: 'cover' }).png().toBuffer();
  comps.push({ input: buf, left, top });
  const label = path.basename(files[i]).replace(/\.png$/, '');
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="18"><rect width="${cw}" height="18" fill="#000a"/><text x="6" y="13" font-family="sans-serif" font-size="12" fill="#9fd">${label}</text></svg>`), left, top });
}
await sharp({ create: { width: cols * cw, height: rows * ch, channels: 3, background: '#000' } }).composite(comps).png().toFile(out);
console.log(out);
