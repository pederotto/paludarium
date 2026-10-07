// Run "sets", S2 leg 4: measures the owner's reference sheets (.agents/refs/new-species-1007, AI-generated references supplied by
// Peder Winterniz, used to MEASURE colour and pattern only, no photo pixels shipped as a texture) and writes
//   src/render/creatures/bodies/colormaps.js   a small body-space colour grid per fish (RGB565, base64) + fin gradients
//   BB/reports/S2.refs.measured.md             the measured colour tables (hex per zone)
//   BB/shots/S2/compare/_maps.png              the polylines drawn on the sources, and the baked maps, to check the regions
// A map column is the position snout -> tail base, a row is the way round the body: dorsal edge -> ventral edge from the side view
// (the hillstream loach also has a dorsal and a belly map from its top and belly views). The body builders (bodies/streamfish.js)
// sample it per vertex at build time: no new vertex attribute, no fragment noise.
//   node tools/bake-colormap.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/Users/rubykim/Documents/paludarium master/.agents/refs/new-species-1007/';
const BB = '/Users/rubykim/Documents/paludarium master/.agents/sets';
const OUT = 'src/render/creatures/bodies/colormaps.js';
const F = {
  hillloach: 'Gemini_Generated_Image_3it3tr3it3tr3it3.jpg', zacco: 'Gemini_Generated_Image_kwcn1qkwcn1qkwcn.jpg', tanichthys: 'Gemini_Generated_Image_q5m8ebq5m8ebq5m8.jpg',
  bedotia: 'Gemini_Generated_Image_rstbz5rstbz5rstb (1).jpg', bullhead: 'Gemini_Generated_Image_k6opvuk6opvuk6op.jpg',
};
// Side views: snout x, tail-base x, dorsal and ventral outlines of the BODY (fins excluded) in image pixels, the eye [x, y, r] (painted
// out of the map: the builder draws its own eye), and the fins: rect + the point where the fin joins the body.
const SIDE = {
  tanichthys: { w: 64, h: 24, x0: 165, x1: 1055, top: [[165, 395], [200, 352], [260, 328], [330, 312], [500, 277], [700, 268], [900, 298], [1055, 328]], bot: [[165, 405], [220, 452], [330, 478], [500, 505], [650, 498], [800, 470], [950, 440], [1055, 415]], eye: [246, 392, 38],
    fins: { dorsal: { rect: [690, 195, 875, 298], at: [740, 285] }, caudal: { rect: [1058, 252, 1270, 525], at: [1062, 390] }, anal: { rect: [765, 438, 950, 545], at: [800, 450] }, pelvic: { rect: [605, 488, 725, 548], at: [640, 495] } } },
  zacco: { w: 56, h: 20, x0: 135, x1: 1095, top: [[135, 375], [190, 335], [260, 302], [330, 287], [450, 268], [600, 262], [800, 285], [950, 305], [1095, 322]], bot: [[135, 395], [200, 440], [300, 482], [450, 506], [600, 506], [780, 490], [950, 440], [1095, 415]], eye: [232, 368, 34],
    fins: { dorsal: { rect: [622, 145, 815, 282], at: [690, 268] }, caudal: { rect: [1098, 242, 1292, 520], at: [1100, 368] }, anal: { rect: [832, 425, 1062, 552], at: [880, 450] }, pelvic: { rect: [636, 485, 772, 578], at: [680, 495] } } },
  bedotia: { w: 80, h: 32, x0: 100, x1: 1050, top: [[100, 375], [170, 340], [250, 305], [330, 280], [450, 252], [570, 240], [700, 255], [850, 285], [1000, 322], [1050, 336]], bot: [[100, 395], [170, 440], [250, 482], [400, 516], [550, 526], [700, 520], [850, 500], [1000, 452], [1050, 425]], eye: [200, 380, 38],
    fins: { dorsal1: { rect: [582, 182, 765, 248], at: [650, 240] }, dorsal2: { rect: [738, 192, 1020, 312], at: [800, 285] }, caudal: { rect: [1052, 218, 1288, 548], at: [1056, 385] }, anal: { rect: [618, 448, 992, 598], at: [700, 520] }, pelvic: { rect: [478, 524, 598, 632], at: [540, 526] } } },
  bullhead: { w: 80, h: 28, x0: 80, x1: 1110, top: [[80, 385], [120, 345], [200, 300], [320, 262], [420, 250], [560, 262], [700, 290], [900, 320], [1110, 345]], bot: [[80, 435], [150, 478], [260, 495], [400, 500], [560, 485], [700, 462], [900, 440], [1110, 420]], eye: [204, 340, 22],
    fins: { dorsal1: { rect: [458, 178, 668, 265], at: [540, 258] }, dorsal2: { rect: [678, 198, 1058, 335], at: [760, 290] }, caudal: { rect: [1112, 280, 1305, 485], at: [1115, 385] }, anal: { rect: [722, 442, 1035, 525], at: [800, 462] }, pectoral: { rect: [402, 360, 696, 592], at: [450, 440] } } },
  hillloach: { w: 96, h: 32, x0: 62, x1: 700, top: [[62, 588], [100, 548], [160, 528], [300, 508], [360, 500], [500, 520], [600, 548], [700, 562]], bot: [[62, 604], [100, 624], [200, 640], [300, 642], [400, 625], [500, 612], [600, 600], [700, 596]], eye: [148, 552, 15],
    fins: { dorsal: { rect: [358, 472, 532, 528], at: [420, 520] }, caudal: { rect: [705, 532, 838, 650], at: [708, 585] }, pelvic: { rect: [403, 618, 548, 690], at: [440, 625] }, anal: { rect: [552, 615, 645, 668], at: [570, 600] }, pectoral: { rect: [175, 590, 395, 648], at: [200, 600] } } },
};
// Hillstream loach top (dorsal) and belly views: centreline + half-width of the body along it.
const HILL_VIEWS = {
  dorsal: { w: 96, h: 32, horiz: true, a0: 62, a1: 720, cen: [[62, 238], [720, 233]], half: [[62, 6], [80, 46], [120, 76], [200, 84], [300, 70], [400, 55], [500, 45], [600, 32], [720, 14]], eyes: [[146, 190, 16], [146, 280, 16]] },
  belly: { w: 64, h: 24, horiz: false, a0: 78, a1: 600, cen: [[78, 1075], [600, 1075]], half: [[78, 8], [110, 58], [150, 78], [250, 62], [350, 44], [450, 36], [550, 24], [600, 14]], eyes: [] },
};

const load = async (f) => { const { data, info } = await sharp(DIR + f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; };
const px = (im, x, y) => { x = Math.max(0, Math.min(im.w - 1, Math.round(x))); y = Math.max(0, Math.min(im.h - 1, Math.round(y))); const i = (y * im.w + x) * 3; return [im.d[i], im.d[i + 1], im.d[i + 2]]; };
const box = (im, x, y, r) => { let a = [0, 0, 0], n = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const p = px(im, x + i, y + j); a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; n++; } return a.map((v) => v / n); };
const lerpPoly = (P, x) => { if (x <= P[0][0]) return P[0][1]; for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const t = (x - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[i - 1][1] + t * (P[i][1] - P[i - 1][1]); } return P[P.length - 1][1]; };
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const to565 = (c) => { const r = Math.round(c[0] / 255 * 31), g = Math.round(c[1] / 255 * 63), b = Math.round(c[2] / 255 * 31); return (r << 11) | (g << 5) | b; };
// 16-colour palette (k-means on the cells, 4-bit indices packed two per byte): ~1 kB for a 64x24 map.
const packQ = (grid, K = 16) => {
  let pal = Array.from({ length: K }, (_, i) => grid[Math.floor((i + 0.5) * grid.length / K)]);
  const sorted = [...grid].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  pal = Array.from({ length: K }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / K)]);
  let idx = new Array(grid.length).fill(0);
  for (let it = 0; it < 14; it++) {
    const S = pal.map(() => [0, 0, 0, 0]);
    grid.forEach((c, n) => { let bi = 0, bd = 1e9; pal.forEach((p, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); idx[n] = bi; S[bi][0] += c[0]; S[bi][1] += c[1]; S[bi][2] += c[2]; S[bi][3]++; });
    pal = S.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : pal[i]));
  }
  const pb = Buffer.alloc(K * 3); pal.forEach((p, i) => { pb[i * 3] = Math.round(p[0]); pb[i * 3 + 1] = Math.round(p[1]); pb[i * 3 + 2] = Math.round(p[2]); });
  const ib = Buffer.alloc(Math.ceil(idx.length / 2)); idx.forEach((v, n) => { ib[n >> 1] |= n & 1 ? v : v << 4; });
  return { pal: pb.toString('base64'), idx: ib.toString('base64') };
};
const pack = (grid) => { const b = Buffer.alloc(grid.length * 2); grid.forEach((c, i) => b.writeUInt16BE(to565(c), i * 2)); return b.toString('base64'); };
const bg = (im) => { const c = []; for (const [x, y] of [[5, 5], [im.w - 5, 5], [5, im.h - 5], [im.w - 5, im.h - 5], [im.w / 2, 5]]) c.push(px(im, x, y)); return c[0].map((_, k) => c.map((p) => p[k]).sort((a, b) => a - b)[2]); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Eye painted out: replace a disc by the mean of the ring around it.
const fixEye = (grid, W, H, im, side, eye) => {
  if (!eye) return;
  const [ex, ey, er] = eye;
  const ring = []; for (let a = 0; a < 16; a++) ring.push(box(im, ex + Math.cos(a * 0.3927) * er * 1.4, ey + Math.sin(a * 0.3927) * er * 1.4, 2));
  const m = [0, 1, 2].map((k) => ring.reduce((s, c) => s + c[k], 0) / ring.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = side.x0 + (i + 0.5) / W * (side.x1 - side.x0), yt = lerpPoly(side.top, x), yb = lerpPoly(side.bot, x), y = yt + (j + 0.5) / H * (yb - yt);
    if (Math.hypot(x - ex, y - ey) < er * 1.1) grid[j * W + i] = m;
  }
};

const result = {}, md = [], boxes = [];
for (const [id, S] of Object.entries(SIDE)) {
  const im = await load(F[id]), W = S.w, H = S.h, grid = [];
  const r = Math.max(2, Math.round((S.x1 - S.x0) / W / 2));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = S.x0 + (i + 0.5) / W * (S.x1 - S.x0), yt = lerpPoly(S.top, x), yb = lerpPoly(S.bot, x);
    grid.push(box(im, x, yt + (j + 0.5) / H * (yb - yt), r));
  }
  fixEye(grid, W, H, im, S, S.eye);
  const entry = { w: W, h: H, ...packQ(grid), fins: {}, views: {} };
  // Zone colours (rows: back 0.1, flank-upper 0.3, flank-mid 0.5, flank-lower 0.7, belly 0.92; columns: head 0.1, mid 0.5, rear 0.85).
  md.push(`### ${id} (${F[id]}, side view${id === 'hillloach' ? ' + top + belly' : ''}): body ${S.x1 - S.x0} px long`);
  md.push('| zone | head (u 0.1-0.2) | mid (u 0.45-0.55) | rear (u 0.8-0.9) |', '|---|---|---|---|');
  const zone = (j0, j1, i0, i1) => { let a = [0, 0, 0], n = 0; for (let j = Math.floor(j0 * H); j < Math.ceil(j1 * H); j++) for (let i = Math.floor(i0 * W); i < Math.ceil(i1 * W); i++) { const c = grid[j * W + i]; a[0] += c[0]; a[1] += c[1]; a[2] += c[2]; n++; } return hex(a.map((v) => v / n)); };
  for (const [nm, a, b] of [['back', 0, 0.2], ['flank upper', 0.2, 0.4], ['flank mid', 0.4, 0.6], ['flank lower', 0.6, 0.8], ['belly', 0.8, 1]]) md.push(`| ${nm} | ${zone(a, b, 0.1, 0.2)} | ${zone(a, b, 0.45, 0.55)} | ${zone(a, b, 0.8, 0.9)} |`);
  // Silhouette: body length : max height from the outlines.
  let hmax = 0; for (let x = S.x0; x <= S.x1; x += 5) hmax = Math.max(hmax, lerpPoly(S.bot, x) - lerpPoly(S.top, x));
  entry.ratio = +((S.x1 - S.x0) / hmax).toFixed(2);
  md.push(`Silhouette (side): body length : max height = ${entry.ratio} : 1.`);
  // Fins: the foreground pixels of the rect, in 5 bins by distance from the join point (base -> tip), and the dark ray colour.
  const B = bg(im); md.push('| fin | base -> tip (5 bins) | dark rays | size px (w x h) |', '|---|---|---|---|');
  for (const [fn, fin] of Object.entries(S.fins)) {
    const [x0, y0, x1, y1] = fin.rect, pts = [];
    let maxd = 1;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const c = px(im, x, y); if (dist(c, B) > 26) { const d = Math.hypot(x - fin.at[0], y - fin.at[1]); pts.push({ c, d }); maxd = Math.max(maxd, d); } }
    const bins = Array.from({ length: 5 }, () => ({ a: [0, 0, 0], n: 0 }));
    for (const p of pts) { const b = bins[Math.min(4, Math.floor(p.d / maxd * 5))], w = (Math.max(...p.c) - Math.min(...p.c) + 10) ** 2; b.a[0] += p.c[0] * w; b.a[1] += p.c[1] * w; b.a[2] += p.c[2] * w; b.n += w; }   // chroma-weighted: translucent fins average to grey, the pigment is what we want
    const g = bins.map((b, k) => (b.n ? b.a.map((v) => v / b.n) : k ? [255, 255, 255] : [128, 128, 128]));
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, sorted = [...pts].sort((a, b) => lum(a.c) - lum(b.c)), dk = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));
    const dark = [0, 1, 2].map((k) => dk.reduce((s, p) => s + p.c[k], 0) / dk.length);
    entry.fins[fn] = { g: g.map(hex), dark: hex(dark), wh: [x1 - x0, y1 - y0] };
    md.push(`| ${fn} | ${g.map(hex).join(' ')} | ${hex(dark)} | ${x1 - x0} x ${y1 - y0} |`);
  }
  // Eye colours (the iris ring and the pupil) from the source.
  if (S.eye) { const [ex, ey] = S.eye; entry.eye = { iris: hex(box(im, ex, ey - S.eye[2] * 0.6, 2)), pupil: hex(box(im, ex, ey, 1)) }; md.push(`Eye: iris ${entry.eye.iris}, pupil ${entry.eye.pupil}.`); }
  if (id === 'hillloach') {
    for (const [vn, V] of Object.entries(HILL_VIEWS)) {
      const g = [], rr = 3;
      for (let j = 0; j < V.h; j++) for (let i = 0; i < V.w; i++) {
        const a = V.a0 + (j >= 0 ? 0 : 0) + (V.horiz ? (i + 0.5) / V.w : (i + 0.5) / V.w) * (V.a1 - V.a0), c = lerpPoly(V.cen.map(([p, q]) => [p, q]), a), hw = lerpPoly(V.half, a), o = ((j + 0.5) / V.h * 2 - 1) * hw;
        g.push(box(im, V.horiz ? a : c + o, V.horiz ? c + o : a, rr));
      }
      if (V.eyes?.length) { const m = [0, 1, 2].map((k) => g.reduce((s, c) => s + c[k], 0) / g.length); for (const [ex, ey, er] of V.eyes) for (let j = 0; j < V.h; j++) for (let i = 0; i < V.w; i++) { const a = V.a0 + (i + 0.5) / V.w * (V.a1 - V.a0), c = lerpPoly(V.cen, a), hw = lerpPoly(V.half, a), o = ((j + 0.5) / V.h * 2 - 1) * hw; if (Math.hypot(a - ex, c + o - ey) < er * 1.3) g[j * V.w + i] = m; } }
      entry.views[vn] = { w: V.w, h: V.h, ...packQ(g) };
      const m = [0, 1, 2].map((k) => g.reduce((s, c) => s + c[k], 0) / g.length); md.push(`${vn} view mean ${hex(m)}`);
    }
  }
  result[id] = entry;
  // Preview: map upscaled.
  boxes.push({ id, im, S, grid });
  md.push('');
}

const js = `// GENERATED by tools/bake-colormap.mjs from the owner's reference sheets (new-species-1007; AI-generated references supplied by Peder
// Winterniz, used to measure colour and pattern). Do not edit by hand. Each map: w x h cells as 4-bit indices into a 16-colour RGB palette, columns snout -> tail
// base, rows dorsal edge -> ventral edge; fins: five colours base -> tip and the dark ray colour; ratio = body length : height.
export const COLORMAPS = ${JSON.stringify(result)};
`;
fs.writeFileSync(OUT, js);
console.log('wrote', OUT, Math.round(js.length / 1024) + ' kB');
fs.mkdirSync(`${BB}/shots/S2/compare`, { recursive: true });
fs.writeFileSync(`${BB}/reports/S2.refs.measured.md`, '# Measured from the reference sheets (tools/bake-colormap.mjs)\n\n' + md.join('\n') + '\n');

// Check picture: for each fish the source with the outlines drawn (top) and the baked map (bottom), stacked.
const tiles = [];
for (const { id, im, S, grid } of boxes) {
  const lines = (P, c) => `<polyline points="${P.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="3"/>`;
  const fins = Object.values(S.fins).map((f) => `<rect x="${f.rect[0]}" y="${f.rect[1]}" width="${f.rect[2] - f.rect[0]}" height="${f.rect[3] - f.rect[1]}" fill="none" stroke="#0af" stroke-width="2"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="688" height="384" viewBox="0 0 ${im.w} ${im.h}">${lines(S.top, '#f0f')}${lines(S.bot, '#f0f')}<circle cx="${S.eye[0]}" cy="${S.eye[1]}" r="${S.eye[2]}" fill="none" stroke="#0f0" stroke-width="3"/>${fins}<line x1="${S.x0}" y1="0" x2="${S.x0}" y2="${im.h}" stroke="#ff0"/><line x1="${S.x1}" y1="0" x2="${S.x1}" y2="${im.h}" stroke="#ff0"/></svg>`);
  const base = await sharp(im.d, { raw: { width: im.w, height: im.h, channels: 3 } }).resize(688, 384).png().toBuffer();
  const src = await sharp(base).composite([{ input: svg }]).png().toBuffer();
  const raw = Buffer.alloc(S.w * S.h * 3); grid.forEach((c, i) => { raw[i * 3] = c[0]; raw[i * 3 + 1] = c[1]; raw[i * 3 + 2] = c[2]; });
  const map = await sharp(raw, { raw: { width: S.w, height: S.h, channels: 3 } }).resize(688, 120, { kernel: 'nearest' }).png().toBuffer();
  tiles.push({ src, map });
}
const comp = []; tiles.forEach((t, k) => { const x = (k % 2) * 688, y = Math.floor(k / 2) * 504; comp.push({ input: t.src, left: x, top: y }, { input: t.map, left: x, top: y + 384 }); });
await sharp({ create: { width: 1376, height: 504 * Math.ceil(tiles.length / 2), channels: 3, background: '#222' } }).composite(comp).png().toFile(`${BB}/shots/S2/compare/_maps.png`);
console.log('check picture written');
