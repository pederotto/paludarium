// Side-by-side: the owner's reference (crop) | the game picture, one PNG per species in BB/shots/S2/compare/<id>.png.
//   node tools/s2-compare.mjs <portraits|dir-of-close-ups> [suffix]
import sharp from 'sharp';
const DIR = '/Users/rubykim/Documents/paludarium master/.agents/refs/new-species-1007/', BB = '/Users/rubykim/Documents/paludarium master/.agents/sets';
const R = { hillloach: ['Gemini_Generated_Image_3it3tr3it3tr3it3.jpg'], tanichthys: ['Gemini_Generated_Image_q5m8ebq5m8ebq5m8.jpg'], zacco: ['Gemini_Generated_Image_kwcn1qkwcn1qkwcn.jpg'], bedotia: ['Gemini_Generated_Image_rstbz5rstbz5rstb (1).jpg'], bullhead: ['Gemini_Generated_Image_k6opvuk6opvuk6op.jpg'], matanoshrimp: ['Gemini_Generated_Image_g9v9hfg9v9hfg9v9.jpg'], cambarellus: ['Gemini_Generated_Image_kkcxa6kkcxa6kkcx.jpg'], tylomelania: ['Gemini_Generated_Image_gywlxdgywlxdgywl.jpg'], crypt: ['Gemini_Generated_Image_ejppm7ejppm7ejpp.jpg'] };
const STRIPS = ['nidus', 'hartstongue', 'miscanthus', 'heliconia', 'aponogeton', 'pandanus', 'limnobium', 'sago', 'tussock', 'crowfoot'];
const ANIMALS = new Set(['hillloach', 'tanichthys', 'zacco', 'bedotia', 'bullhead', 'matanoshrimp', 'cambarellus', 'tylomelania']);
const src = process.argv[2] ?? 'portraits', suffix = process.argv[3] ?? '';
const refOf = async (id) => {
  if (R[id]) return sharp(DIR + R[id][0]).resize(768, 432, { fit: 'contain', background: '#ddd' }).png().toBuffer();
  const i = STRIPS.indexOf(id); if (i < 0) return null;
  return sharp(DIR + 'Gemini_Generated_Image_6hggw76hggw76hgg.jpg').extract({ left: Math.round(i * 137.6), top: 90, width: 138, height: 590 }).resize(null, 432).png().toBuffer();
};
const ids = [...Object.keys(R), ...STRIPS];
for (const id of ids) {
  let game;
  try { game = src === 'portraits' ? `public/assets/portraits/${ANIMALS.has(id) || id === 'crypt' ? (ANIMALS.has(id) ? 'animal-' : 'plant-') : 'plant-'}${id}.webp` : `${src}/close-${id}-desktop.png`; await sharp(game).metadata(); } catch { continue; }
  const ref = await refOf(id), g = await sharp(game).resize(432, 432, { fit: 'contain', background: '#cfd8d0' }).png().toBuffer();
  const rm = await sharp(ref).metadata();
  await sharp({ create: { width: rm.width + 432 + 8, height: 432, channels: 3, background: '#222' } }).composite([{ input: ref, left: 0, top: 0 }, { input: g, left: rm.width + 8, top: 0 }]).png().toFile(`${BB}/shots/S2/compare/${id}${suffix}.png`);
  console.log('compare', id);
}
