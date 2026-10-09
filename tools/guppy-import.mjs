// Puts the owner's prepared guppy models (art-src/guppy/out/, made by art-src/guppy/prep_glb.py) into the game:
//   public/assets/creatures/guppy.glb, guppy.lo.glb              the male (the species' default model, with the owner's own texture)
//   public/assets/creatures/guppy-female.glb, guppy-female.lo.glb the female (and the fry)
//   public/assets/creatures/guppy/<sex>-coords.png, -parts.png, -base.webp   the maps the strain painter reads (guppypaint.js)
//   public/assets/creatures/guppy/tail-<shape>.glb, .lo.glb     the male's twelve tails (art-src/guppy/tails.py), in his UVs, one file
//                                                                each (a tank loads only the tails its strains have)
// then records them in art-src/creatures/overrides.json under "guppy" and writes the manifest key with
// `npm run import-creatures -- --baked=guppy` (never hand-edit the manifest).
//   node tools/guppy-import.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PropertyType } from '@gltf-transform/core';
import { dedup, prune, textureCompress, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const SRC = 'art-src/guppy/out', OUT = 'public/assets/creatures';
fs.mkdirSync(`${OUT}/guppy`, { recursive: true });
const files = { male: 'guppy', female: 'guppy-female' };
// The male's tails (art-src/guppy/tails.py) paint into a strip below his own atlas: his maps are W wide and W + strip.h high, and his
// body's UVs move into the top W x W (v scaled by W / (W + strip.h); the game's v runs down the image).
const TJ = JSON.parse(fs.readFileSync(`${SRC}/tails/tails.json`, 'utf8')), STRIP = TJ.strip, W = STRIP.w, HM = W + STRIP.h;
const meta = {};
for (const [sex, name] of Object.entries(files)) {
  for (const lod of ['', '.lo']) {
    const doc = await io.read(`${SRC}/${sex}${lod}.glb`);
    // the prepared file is in cm; the game reads metres (glb.js multiplies by 100)
    for (const n of doc.getRoot().listScenes()[0].listChildren()) n.setScale([0.01, 0.01, 0.01]);
    if (sex === 'male') {
      const done = new Set();
      for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
        const uv = prim.getAttribute('TEXCOORD_0');
        if (!uv || done.has(uv)) continue;
        done.add(uv); const e = [];
        for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, e); uv.setElement(i, [e[0], e[1] * W / HM]); }
      }
      // his own colour texture, padded with the strip's (the model's texture, used if a look could not be painted)
      for (const tex of doc.getRoot().listTextures()) {
        const img = sharp(tex.getImage()), meta0 = await img.metadata(), w = meta0.width, h = Math.round(w * STRIP.h / W);
        const strip = await sharp(fs.readFileSync(`${SRC}/tails/strip-base.rgba`), { raw: { width: W, height: STRIP.h, channels: 4 } }).resize(w, h).png().toBuffer();
        tex.setImage(await sharp(tex.getImage()).resize(w, w).extend({ bottom: h, background: { r: 0, g: 0, b: 0, alpha: 1 } }).composite([{ input: strip, top: w, left: 0 }]).png().toBuffer()).setMimeType('image/png');
      }
    }
    // (dedup must not merge the body and fin materials: they differ only by name, and the name is how the game tells a fin)
    await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: sex === 'male' ? [lod ? 512 : 1024, (lod ? 512 : 1024) * HM / W] : [lod ? 512 : 1024, lod ? 512 : 1024] }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(`${OUT}/${name}${lod}.glb`, doc);
  }
  // the game paints each look at 512 x 512 (1 MB of texture a look): the maps go at that size (nearest for the coordinates and parts,
  // which must not be blended across a UV seam)
  const pad = async (img, m) => (sex !== 'male' ? img : sharp(await img.toBuffer()).extend({ bottom: STRIP.h, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .composite([{ input: fs.readFileSync(`${SRC}/tails/strip-${m}.rgba`), raw: { width: W, height: STRIP.h, channels: 4 }, top: W, left: 0 }]));
  for (const m of ['coords', 'parts']) await (await pad(sharp(`${SRC}/${sex}-${m}.png`).resize(W, W, { kernel: 'nearest' }).ensureAlpha(), m)).png({ compressionLevel: 9 }).toFile(`${OUT}/guppy/${sex}-${m}.png`);
  await (await pad(sharp(`${SRC}/${sex}-base.png`).resize(W, W).ensureAlpha(), 'base')).webp({ quality: 92 }).toFile(`${OUT}/guppy/${sex}-base.webp`);
  const j = JSON.parse(fs.readFileSync(`${SRC}/${sex}.json`, 'utf8'));
  meta[sex] = { file: `${name}.glb`, lo: `${name}.lo.glb`, coords: `guppy/${sex}-coords.png`, parts: `guppy/${sex}-parts.png`, base: `guppy/${sex}-base.webp`, slCm: j.slCm, totalCm: j.totalCm, ...(j.eye ? { eye: j.eye } : {}) };
  console.log(sex, fs.statSync(`${OUT}/${name}.glb`).size, 'bytes', fs.statSync(`${OUT}/${name}.lo.glb`).size, 'bytes (lo)');
}
// the male's twelve tails (art-src/guppy/tails.py: a mesh 'tail_<shape>' each, in the male's UVs): the game removes his own tail (his
// fin faces behind zCut) and puts the strain's tail in its place (render/creatures/guppymodel.js)
{
  const T = `${SRC}/tails`, tj = TJ;
  let bytes = 0;
  for (const lod of ['', '.lo']) {
    const names = (await io.read(`${T}/tails${lod}.glb`)).getRoot().listNodes().map((n) => n.getName()).filter((n) => n.startsWith('tail_'));
    for (const name of names) {
      const doc = await io.read(`${T}/tails${lod}.glb`);
      for (const n of doc.getRoot().listNodes()) if (n.getName() !== name) n.dispose();
      for (const n of doc.getRoot().listScenes()[0].listChildren()) n.setScale([0.01, 0.01, 0.01]);
      await doc.transform(prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const f = `${OUT}/guppy/${name.replace('_', '-').replace(/\.\d+$/, '')}${lod}.glb`;   // (the low set's objects are 'tail_x.001' in Blender)
      await io.write(f, doc); bytes += fs.statSync(f).size;
    }
  }
  // (the prepared frame has the head toward -y; the game's z is -y)
  meta.male.tails = { file: 'guppy/tail-{shape}.glb', lo: 'guppy/tail-{shape}.lo.glb', zEnd: +(-tj.stalkEnd).toFixed(4), zCut: +(-(tj.stalkEnd - tj.caudalAhead)).toFixed(4) };
  console.log('tails', bytes, 'bytes in 24 files');
}
// Strains the owner sent models of (8 Oct 2026: Meshy models from his pictures, prepared by art-src/guppy/prep_glb.py --root=width,
// the four-fish group split by art-src/guppy/split_group.py): a male of exactly that strain is drawn with the model and its own
// colour, normal and roughness maps instead of a painted texture (render/creatures/guppymodel.js); the parts map tells his fins apart.
{
  const S = `${SRC}/strains`, ids = fs.readdirSync(S).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  meta.strains = {};
  let bytes = 0;
  for (const id of ids) {
    for (const lod of ['', '.lo']) {
      const doc = await io.read(`${S}/${id}${lod}.glb`);
      for (const n of doc.getRoot().listScenes()[0].listChildren()) n.setScale([0.01, 0.01, 0.01]);
      await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod ? 512 : 1024, lod ? 512 : 1024] }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const f = `${OUT}/guppy/strain-${id}${lod}.glb`;
      await io.write(f, doc); bytes += fs.statSync(f).size;
    }
    await sharp(`${S}/${id}-parts.png`).resize(512, 512, { kernel: 'nearest' }).ensureAlpha().png({ compressionLevel: 9 }).toFile(`${OUT}/guppy/strain-${id}-parts.png`);
    const j = JSON.parse(fs.readFileSync(`${S}/${id}.json`, 'utf8'));
    meta.strains[id] = { file: `guppy/strain-${id}.glb`, lo: `guppy/strain-${id}.lo.glb`, parts: `guppy/strain-${id}-parts.png`, slCm: j.slCm, totalCm: j.totalCm, ...(j.eye ? { eye: j.eye } : {}) };
  }
  console.log('strains', ids.length, bytes, 'bytes');
}
const ov = 'art-src/creatures/overrides.json', o = JSON.parse(fs.readFileSync(ov, 'utf8'));
o.guppy = { ...(o.guppy ?? {}), finish: { rough: 0.38, coat: 0.3, coatRough: 0.25, grainAmt: 0.15, finOpacity: 0.85, finAlpha: 1, flutter: 0.03, finFlow: { lag: 0.45, ripple: 0.022, wave: 7, rate: 7, pect: 0.45, pectRate: 26 }, finFray: { start: 0.62, scale: 14 } }, guppy: meta };
fs.writeFileSync(ov, JSON.stringify(o, null, 1) + '\n');
execSync('npm run import-creatures -- --baked=guppy', { stdio: 'inherit' });
