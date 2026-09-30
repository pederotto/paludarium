// Creature bench runner: renders a species from several angles and writes a
// contact sheet (test-output/bench/<id>.png) plus per-view PNGs.
//
//   node tools/bench.mjs <id> [<id> …] [--lod=lo|hi] [--water=1] [--views=front,side,back,top,three,low] [--size=520]
//
// Genetic morphs: <species>:<morph> renders one variant (axolotl:golden); <species>:* renders every morph of the species into
// ONE contact sheet test-output/bench/<species>-morphs.png (a column per morph, a row per view; try --views=three,closeup).
//
// Needs the dev server (npx vite --port 5173). Uses real WebGPU through the installed Chrome.
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const MORPHS = {      // morph ids per species (docs/GENETICS_SPEC.md; the bodies are registered in bodies/index.js)
  axolotl: ['wild', 'leucistic', 'golden', 'melanoid', 'white_albino'],
  dartfrog: ['cobalt_spotted', 'cobalt_clean', 'sky_spotted', 'sky_clean'],
  guppy: ['red', 'purple', 'blue', 'gold'],
  betta: ['red', 'purple', 'blue', 'cellophane'],
  shrimp: ['wild', 'red', 'yellow', 'orange'],
};
const sheets = [];    // species whose morphs are laid out as one sheet
const ids = args.filter((a) => !a.startsWith('--')).flatMap((a) => {
  const [sp, m] = a.split(':');
  if (m !== '*') return [a];
  if (!MORPHS[sp]) { console.error(`no morph list for ${sp}`); process.exit(2); }
  sheets.push(sp);
  return MORPHS[sp].map((k) => `${sp}:${k}`);
});
if (!ids.length) { console.error('usage: node tools/bench.mjs <species id> … [--lod=hi] [--water=1]'); process.exit(2); }
const src = opt('src', ''), lod = opt('lod', 'lo'), water = opt('water', '0'), size = +opt('size', 520), url = opt('url', 'http://localhost:5173');
const views = opt('views', 'front,side,back,top,three,low').split(',');
fs.mkdirSync('test-output/bench', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
const errors = [];
const shotsById = {};
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 300)));
for (const id of ids) {
  await page.goto(`${url}/bench.html?sp=${encodeURIComponent(id)}&src=${src}&lod=${lod}&water=${water}&size=${size}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.bench?.ready, null, { timeout: 60000 }).catch(() => {});
  if (!(await page.evaluate(() => !!window.bench))) { console.log(id, 'FAILED to load\n' + errors.slice(0, 5).join('\n')); continue; }
  const shots = [];
  for (const v of views) {
    await page.evaluate((v) => { window.bench.setView(v); }, v);
    await page.waitForTimeout(350);
    const png = await page.screenshot();
    fs.writeFileSync(`test-output/bench/${id.replace(':', '_')}-${v}.png`, png);
    shots.push([v, png]);
  }
  shotsById[id] = shots;
  const verts = await page.evaluate(() => window.bench.verts());
  const cols = Math.min(3, shots.length), rows = Math.ceil(shots.length / cols);
  const comps = shots.map(([v, png], i) => ({ input: png, left: (i % cols) * size, top: Math.floor(i / cols) * size }));
  const labels = shots.map(([v], i) => ({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="26"><text x="10" y="18" font-family="sans-serif" font-size="14" fill="#9fd">${id} · ${v} · ${lod}</text></svg>`),
    left: (i % cols) * size, top: Math.floor(i / cols) * size + size - 26,
  }));
  await sharp({ create: { width: cols * size, height: rows * size, channels: 3, background: '#050607' } }).composite([...comps, ...labels]).png().toFile(`test-output/bench/${id.replace(':', '_')}.png`);
  console.log(`${id}: ${views.length} views → test-output/bench/${id.replace(':', '_')}.png  (lo ${verts.lo} verts, hi ${verts.hi})`);
}
// One sheet per species for <species>:*: a column per morph, a row per view.
for (const sp of sheets) {
  const morphIds = MORPHS[sp].map((k) => `${sp}:${k}`).filter((k) => shotsById[k]);
  const rows = views.length, cols = morphIds.length, lab = 26;
  const comps = [], labels = [];
  morphIds.forEach((mid, c) => shotsById[mid].forEach(([v, png], r) => {
    comps.push({ input: png, left: c * size, top: r * size });
    labels.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${lab}"><text x="10" y="18" font-family="sans-serif" font-size="14" fill="#9fd">${mid} · ${v} · ${lod}</text></svg>`), left: c * size, top: r * size + size - lab });
  }));
  await sharp({ create: { width: cols * size, height: rows * size, channels: 3, background: '#050607' } }).composite([...comps, ...labels]).png().toFile(`test-output/bench/${sp}-morphs.png`);
  console.log(`${sp}: ${cols} morphs x ${rows} views → test-output/bench/${sp}-morphs.png`);
}
if (errors.length) console.log('console errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
