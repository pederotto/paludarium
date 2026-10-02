// Bakes the species and plant portraits (the pictures on the Add menu's cards, the Field Guide and Kids mode) into
// public/assets/portraits/<animal|plant>-<id>.webp, so the game shows a file instead of rendering each one in the player's
// browser. Rendering them live meant a second renderer, every plant model, every species' body and shaders: about a minute
// of loading and freezes of up to 3 s the first time the animal menu opened (tools/steps/menu-open.mjs).
// Run after adding or changing a species' or a plant's model:   node tools/bake-portraits.mjs [--only=crab,fern]
// Uses engine/portraits.js (the same code the game falls back to for a species without a file) in headless Chrome.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';
import fs from 'node:fs';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const OUT = 'public/assets/portraits', SIZE = 256;
fs.mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 4311, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url + '?portraitbake', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 180000 });
const ids = await page.evaluate(async () => {
  const { SPECIES } = await import('/src/sim/animals.js');
  const { PLANTS } = await import('/src/sim/plants.js');
  return { animal: Object.keys(SPECIES), plant: Object.keys(PLANTS) };
});
let n = 0;
for (const kind of ['animal', 'plant']) {
  for (const id of ids[kind]) {
    if (only.length && !only.includes(id)) continue;
    const data = await page.evaluate(async ([k, i]) => {
      const { Portraits } = await import('/src/engine/portraits.js');
      window.__bakeP ??= new Portraits({ live: true });
      return window.__bakeP.get(k, i);
    }, [kind, id]);
    if (!data) { console.log('skip', kind, id); continue; }
    const png = Buffer.from(data.split(',')[1], 'base64');
    await sharp(png).resize(SIZE, SIZE).webp({ quality: 82, alphaQuality: 90 }).toFile(`${OUT}/${kind}-${id}.webp`);
    n++;
  }
}
const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.webp')).sort();
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(files.map((f) => f.replace(/\.webp$/, ''))) + '\n');
console.log(`${n} portraits written to ${OUT} (${files.length} in all, ${Math.round(files.reduce((s, f) => s + fs.statSync(`${OUT}/${f}`).size, 0) / 1024)} kB)`);
await browser.close();
await server.close();
