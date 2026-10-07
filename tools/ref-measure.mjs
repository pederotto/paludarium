// Run "sets", S2 leg 4: k-means colour palettes of the owner's reference sheets (the invertebrates, the crypt and the ten plant strips),
// written to BB/reports/S2.refs.palettes.md. Measured, not eyeballed; the zone labels are added by hand in S2.refs.md.
//   node tools/ref-measure.mjs
import sharp from 'sharp';
import fs from 'node:fs';
const DIR = '/Users/rubykim/Documents/paludarium master/.agents/refs/new-species-1007/', BB = '/Users/rubykim/Documents/paludarium master/.agents/sets';
const IMG = { matanoshrimp: 'Gemini_Generated_Image_g9v9hfg9v9hfg9v9.jpg', tylomelania: 'Gemini_Generated_Image_gywlxdgywlxdgywl.jpg', cambarellus: 'Gemini_Generated_Image_kkcxa6kkcxa6kkcx.jpg', crypt: 'Gemini_Generated_Image_ejppm7ejppm7ejpp.jpg' };
const STRIPS = ['nidus', 'hartstongue', 'miscanthus', 'heliconia', 'aponogeton', 'pandanus', 'limnobium', 'sago', 'tussock', 'crowfoot'];
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function kmeans(P, k) {
  let C = Array.from({ length: k }, (_, i) => P[Math.floor((i + 0.5) * P.length / k)]);
  C = [...P].sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2])).filter((_, i, a) => i % Math.floor(a.length / k) === 0).slice(0, k);
  let cnt = [];
  for (let it = 0; it < 12; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    for (const p of P) { let b = 0, bd = 1e9; C.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; b = i; } }); S[b][0] += p[0]; S[b][1] += p[1]; S[b][2] += p[2]; S[b][3]++; }
    C = S.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : C[i])); cnt = S.map((s) => s[3]);
  }
  return C.map((c, i) => ({ c, f: cnt[i] / P.length })).sort((a, b) => b.f - a.f);
}
const md = ['# Palettes (k-means, k=6) measured from the reference sheets (tools/ref-measure.mjs)', ''];
const run = async (name, file, crop, mask) => {
  let im = sharp(DIR + file).removeAlpha(); if (crop) im = im.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  const { data, info } = await im.raw().toBuffer({ resolveWithObject: true });
  const bgc = [0, 1, 2].map((k) => [data[k], data[(info.width - 1) * 3 + k], data[((info.height - 1) * info.width) * 3 + k]].sort((a, b) => a - b)[1]);
  const P = [];
  for (let i = 0; i < info.width * info.height; i += 7) { const p = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]; if (mask && Math.hypot(p[0] - bgc[0], p[1] - bgc[1], p[2] - bgc[2]) < 30) continue; P.push(p); }
  const K = kmeans(P, 6);
  md.push(`**${name}** (${file}${crop ? ' strip ' + crop.join(',') : ''}, ${P.length} px sampled)`, K.map((k) => `${hex(k.c)} ${(k.f * 100).toFixed(0)}%`).join(' · '), '');
};
for (const [n, f] of Object.entries(IMG)) await run(n, f, null, true);
await new Promise((r) => setTimeout(r, 0));
const pending = STRIPS.map((n, i) => run(n, 'Gemini_Generated_Image_6hggw76hggw76hgg.jpg', [Math.round(i * 137.6) + 8, 95, 120, 560], false));
await Promise.all(pending);
fs.writeFileSync(`${BB}/reports/S2.refs.palettes.md`, md.join('\n') + '\n');
console.log(md.join('\n'));
