// The live portrait of each flowering plant (engine/portraits.js renders it with the Plants class): its flowers show open.
// Writes <out>/portrait-<id>.png; IDS=lily,... picks the plants (default: every species with a flower).
//   node tools/shot.mjs --steps=tools/steps/bloom-portrait.mjs --only=desktop --url=http://127.0.0.1:4491/ --out=<dir>
import fs from 'node:fs';
import path from 'node:path';
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=test-output').slice(6);
  const ids = await page.evaluate(async () => { const { PLANTS } = await import('/src/sim/plants.js'); return Object.keys(PLANTS).filter((k) => PLANTS[k].flower); });
  const want = process.env.IDS ? process.env.IDS.split(',') : ids;
  for (const id of want) {
    const r = await page.evaluate(async (id) => {
      const { Portraits } = await import('/src/engine/portraits.js');
      window.__bloomP ??= new Portraits({ live: true });
      const url = await window.__bloomP.get('plant', id);
      const fm = window.__bloomP.plants?.flowers?.[id];
      return { url, heads: fm ? fm.n : 0 };
    }, id);
    if (!r.url) { console.log('FAIL', id, 'no portrait'); continue; }
    const file = path.join(out, `portrait-${id}.png`);
    fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
    console.log('portrait', id, file);
  }
};
