// Copies the textures Paludarium uses from a local SeedThree checkout
// (https://github.com/SkyeShark/SeedThree, MIT) and shrinks them for the web.
//
//   git clone --depth 1 https://github.com/SkyeShark/SeedThree ../SeedThree
//   node tools/import-seedthree.cjs ../SeedThree
//
// Needs `npm install` (for sharp).

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'assets'))) {
  console.error('usage: node tools/import-seedthree.cjs <path to SeedThree checkout>');
  process.exit(1);
}
const out = path.join(__dirname, '..', 'assets');
const G = (f) => path.join(src, 'assets', 'ground', f);
const L = (f) => path.join(src, 'assets', 'leaves', f);

// [source, destination, size, format]
const jobs = [
  // Ground (tileable) → JPEG.
  [G('desert_ground_albedo.png'), 'ground/soil.jpg', 512, 'jpg'],
  [G('gravel_albedo.png'), 'ground/gravel.jpg', 512, 'jpg'],
  [G('rock_albedo.png'), 'ground/rock.jpg', 512, 'jpg'],
  [G('rock_normal.png'), 'ground/rock_normal.jpg', 512, 'jpg'],
  // (mossy_rock.jpg now comes from Poly Haven; see import-polyhaven.mjs)
  [G('grass_albedo.png'), 'ground/moss.jpg', 512, 'jpg'],
  [G('rock2_albedo.png'), 'ground/bark.jpg', 512, 'jpg'],
  // Leaf cards (alpha) → PNG.
  [L('fern_albedo.png'), 'cards/fern.png', 512, 'png'],
  [L('cattail_reed_card.png'), 'cards/cattail.png', 512, 'png'],
  [L('grass_tuft.png'), 'cards/grass_tuft.png', 256, 'png'],
  [L('bilberry_albedo.png'), 'cards/bilberry.png', 512, 'png'],
];

(async () => {
  for (const [from, to, size, fmt] of jobs) {
    const dest = path.join(out, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let img = sharp(from).resize(size, size, { fit: 'fill' });
    img = fmt === 'jpg' ? img.flatten({ background: '#000' }).jpeg({ quality: 82, mozjpeg: true }) : img.png({ compressionLevel: 9, palette: true, quality: 90 });
    await img.toFile(dest);
    console.log(to, (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
  }
})();
