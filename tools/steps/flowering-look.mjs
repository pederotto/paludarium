// Static preview of the flowering plants (sim/flowering.js): each species with all its flower heads open, merged into its
// body (flowering.previewGeometry), one copy per colour form side by side, standing on land in the starter paludarium at
// 11:00 (pictures at night are black). The flower renderer draws the real thing; this checks shapes, sizes and colours.
// Dev server only (it imports /src modules):
//   npx vite --port 4492 --strictPort --host 127.0.0.1
//   node tools/shot.mjs --url=http://127.0.0.1:4492/ --only=desktop --steps=tools/steps/flowering-look.mjs [--query=?webgl]
//   IDS=masdevallia,…  (default: every flowering species and the bromeliad)   PALETTE=n (one colour form)   CLOSE=1 (nearer)
//   WAIT=ms before each picture (default 1500)
//   PORTRAIT=dir: instead, each colour form alone in the portrait renderer (engine/portraits.js, neutral light), into dir/
import fs from 'node:fs';

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  if (process.env.PORTRAIT) return portraits(page, process.env.PORTRAIT);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const ids = process.env.IDS ? process.env.IDS.split(',') : await page.evaluate(async () => { const { FLOWERING } = await import('/src/sim/flowering.js'); return [...Object.keys(FLOWERING), 'bromeliad']; });
  const spot = await page.evaluate(() => {
    const g = window.game, W = g.world;
    g.setSpeed(0);
    W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 11 * 60;
    for (let t = 0; t < 10; t++) W.sim.step(1);           // the lamps follow the clock (the game starts at the real time of day)
    W.plants.clear();
    // the land spot nearest the front middle, well above the water
    let best = null;
    for (let x = -30; x <= 30; x += 2) for (let z = -6; z <= 16; z += 2) {
      const y = W.terrain.heightAt(x, z), s = W.water.surfaceAt(x, z);
      if (s !== -Infinity && s > y - 1) continue;
      const sc = Math.abs(x) * 0.5 + Math.abs(z - 15) * 1.5 + Math.max(0, (s === -Infinity ? 0 : s) - y + 3) * 4;
      if (!best || sc < best.sc) best = { x, y, z, sc };
    }
    return best;
  });
  console.log('spot', JSON.stringify(spot));
  for (const id of ids) {
    const r = await page.evaluate(async ({ id, spot, pal, close }) => {
      const { PLANTS } = await import('/src/sim/plants.js');
      const { previewGeometry } = await import('/src/sim/flowering.js');
      const g = window.game, W = g.world, def = PLANTS[id];
      if (!def?.flower) return null;
      for (const p of [...W.plants.list]) W.plants.remove(p);
      const im = W.plants.meshes[id];
      im.geometry = previewGeometry(def, { palette: pal });
      im.geometry.computeBoundingBox();
      const V3 = im.position.constructor, P = W.plants.add(id, new V3(spot.x, spot.y, spot.z), { grown: 1, scale: 1, rot: 0 });
      P.reach = 0; W.plants.writeInstance(P);          // no lean away from the glass: the row stays a straight row
      const b = im.geometry.boundingBox, n = pal == null ? def.flower.palettes.length : 1, w = b.max.x - b.min.x, h = b.max.y - b.min.y;
      // the whole row, or (close) the first colour form only
      const cx = close ? b.min.x + w / n / 2 : (b.min.x + b.max.x) / 2;
      const c = { x: P.pos.x + cx, y: P.pos.y + (b.min.y + b.max.y) / 2, z: P.pos.z + (b.min.z + b.max.z) / 2 };
      const d = Math.max((close ? w / n : w) * 0.75, h * 1.6, close ? 4 : 7);
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(c.x, c.y + d * 0.3, c.z + d, c.x, c.y, c.z, false);
      return { tris: im.geometry.attributes.position.count / 3, w: +w.toFixed(1), h: +h.toFixed(1) };
    }, { id, spot, pal: process.env.PALETTE != null ? +process.env.PALETTE : null, close: !!process.env.CLOSE });
    if (!r) { console.log(id, 'no flower'); continue; }
    await page.waitForTimeout(+(process.env.WAIT ?? 1500));     // (a new material compiles in the background first; longer on WebGL 2)
    console.log(id, JSON.stringify(r));
    await shot('flower-' + id + (process.env.CLOSE ? '-close' : ''));
  }
};

async function portraits(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = await page.evaluate(async (only) => {
    const { PLANTS } = await import('/src/sim/plants.js');
    const { FLOWERING, previewGeometry } = await import('/src/sim/flowering.js');
    const { Portraits } = await import('/src/engine/portraits.js');
    const ids = only ?? [...Object.keys(FLOWERING), 'bromeliad'], res = {}, orig = {};
    for (const id of ids) orig[id] = PLANTS[id].build;
    // one portrait renderer per colour form index (plant meshes are built once per Portraits)
    for (let k = 0; k < 6; k++) {
      const now = ids.filter((id) => PLANTS[id].flower.palettes.length > k);
      if (!now.length) break;
      for (const id of now) PLANTS[id].build = () => previewGeometry({ ...PLANTS[id], build: orig[id] }, { palette: k });
      const P = new Portraits({ live: true });
      for (const id of now) res[id + '-' + k] = await P.get('plant', id);
    }
    for (const id of ids) PLANTS[id].build = orig[id];
    return res;
  }, process.env.IDS ? process.env.IDS.split(',') : null);
  for (const [k, url] of Object.entries(out)) if (url) fs.writeFileSync(`${dir}/${k}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('portraits', Object.keys(out).length, dir);
}
