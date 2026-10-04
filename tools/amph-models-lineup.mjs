// Every amphibian in one contact sheet (the round-4 quality bar): the starter tank emptied, the world paused at noon, one of each
// species, dart frog morph and life stage set apart on open ground (the aquatic ones in the pond; the plants cleared so
// nothing hides them), the same light and camera rules
// for all: a close tile per animal from the front at a distance by its body size, with a 1 cm bar drawn at the animal so tiles
// compare at true scale, and a last tile with all of them in a row seen from one camera. Labels say what the mesh drew (skinned,
// rig, procedural), read from the creature meshes.
//
//   node tools/amph-models-lineup.mjs [--url=http://127.0.0.1:4501/] [--out=test-output/amph-lineup.png] [--webgl=1] [--size=400]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const webgl = arg('webgl', '0') === '1';
const url = arg('url', 'http://127.0.0.1:4501/') + (webgl ? '?webgl' : ''), size = +arg('size', 400);
const out = arg('out', 'test-output/amph-lineup.png'), tmp = path.join(path.dirname(out), '.amph-tiles');
// key (id[:morph][@parent]), where, camera distance (cm)
const LIST = [
  ['dartfrog', 'land', 10], ['dartfrog:cobalt_clean', 'land', 10], ['dartfrog:sky_spotted', 'land', 10], ['dartfrog:sky_clean', 'land', 10],
  ['leucomelas', 'land', 10], ['strawberry', 'land', 9], ['auratus', 'land', 10], ['bumblebee', 'land', 9], ['reedfrog', 'land', 10],
  ['redeye', 'land', 13], ['toad', 'land', 12], ['tadpole', 'water', 8], ['eggs', 'land', 7], ['newt', 'land', 16], ['marbled', 'land', 20],
  ['firesal', 'land', 24], ['axolotl', 'water', 26], ['tadpole@firesal', 'water', 8],
];
fs.mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /creature model|pose model/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#ui{display:none!important}' });
console.log('placing');
const spots = await page.evaluate((LIST) => {
  let seed = 7; Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, V3 = g.camera.position.constructor;
  g.setSpeed(0);
  for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
  W.plants?.clear?.();     // an open stage (the hardscape stays: clearing it leaves its stamp in the ground heights)
  const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
  const land = [], water = [];
  for (let x = -60; x <= 60; x += 2) for (let z = -30; z <= 30; z += 2) {
    const gnd = T.heightAt(x, z), top = A.waterTop(x, z);
    if (top - gnd > 3.5) { water.push({ x, z, y: gnd + Math.min(2.5, (top - gnd) * 0.45), f: -z + Math.abs(x) * 0.3 }); continue; }
    if (top > gnd - 0.5 || T.normalAt(x, z).y < 0.95) continue;
    land.push({ x, z, y: gnd, f: -z + Math.abs(x) * 0.3 });     // the front of the tank first: nothing between it and the camera
  }
  land.sort((a, b) => a.f - b.f); water.sort((a, b) => a.f - b.f);
  const out = [];
  for (const [key, where, d] of LIST) {
    const [idm, parent] = key.split('@'), [id, morph] = idm.split(':');
    const pool = where === 'water' && water.length ? water : land, gap = Math.max(8, d * 0.55);
    const c = pool.find((c) => out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > gap));
    if (!c) { out.push({ key, missing: 'no spot' }); continue; }
    const a = A.add(id, new V3(c.x, c.y, c.z), { age: 1e6, hunger: 0.1, ...(morph ? { morph } : {}) });
    if (!a) { out.push({ key, missing: 'add failed' }); continue; }
    if (parent) { a.parent = parent; a.age = 0; }
    a.yaw = 0.6; a.calm = 1;
    out.push({ key, d, x: c.x, y: c.y, z: c.z, id: a.id, where });
  }
  return out;
}, LIST);
await page.waitForTimeout(12000);   // models load, shaders build
const tiles = [];
for (const s of spots) {
  if (s.missing) { tiles.push({ s, file: null }); continue; }
  const info = await page.evaluate((s) => {
    const g = window.game, A = g.world.animals, a = [...Object.values(A.by)].flat().find((b) => b.id === s.id);
    const p = a ? a.pos : { x: s.x, y: s.y, z: s.z }, d = s.d, h = 0.45;
    g.controls.setLookAt(p.x + d * 0.35, p.y + d * h, p.z + d * 0.85, p.x, p.y + 0.6, p.z, false);
    return { y: p.y, x: p.x, z: p.z };
  }, s);
  await page.waitForTimeout(1500);
  const meta = await page.evaluate(({ s, info }) => {
    const g = window.game, cam = g.camera, A = g.world.animals, V3 = cam.position.constructor;
    cam.updateMatrixWorld();
    const a = new V3(info.x, info.y, info.z).project(cam), b = new V3(info.x + 1, info.y, info.z).project(cam);
    const id = s.key.split(/[:@]/)[0], m = A.meshes?.[s.key.split('@')[0]] ?? A.meshes?.[id];
    const mode = m?.skinned?.n ? 'skinned' : A.models?.[id] ? 'scan, rig' : 'procedural';
    return { px: Math.hypot(a.x - b.x, (a.y - b.y)) * 0.5 * innerWidth, cx: (a.x * 0.5 + 0.5) * innerWidth, cy: (-a.y * 0.5 + 0.5) * innerHeight, mode };
  }, { s, info });
  console.log('shot', s.key);
  const file = `${tmp}/${s.key.replace(/[:@]/g, '-')}.png`;
  await page.screenshot({ path: file });
  tiles.push({ s, file, meta });
}
// the whole lineup in one camera: move them into a row on the land spots near the middle, true scale
const group = await page.evaluate(() => {
  const g = window.game, A = g.world.animals, T = g.world.terrain, all = [...Object.values(A.by)].flat();
  let x = -all.length * 2.2;
  for (const a of all) { a.pos.x = x; a.pos.z = 8; a.pos.y = Math.max(T.heightAt(x, 8), A.waterTop(x, 8) - 1); x += a.sp.size > 2 ? 9 : 4.4; a.yaw = 0.3; }
  const mid = (all[0].pos.x + all[all.length - 1].pos.x) / 2, y = all[0].pos.y;
  g.controls.setLookAt(mid, y + 22, 8 + 70, mid, y + 2, 8, false);
  return all.map((a) => a.sp.name ?? a.id).length;
});
await page.waitForTimeout(2000);
const gfile = `${tmp}/group.png`;
await page.screenshot({ path: gfile });
const backend = await page.evaluate(() => (window.game?.renderer?.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'));
await browser.close();
const cols = 5, w = 320, rowsN = Math.ceil(tiles.length / cols), H = rowsN * w + w * 1.2 + 30;
const label = (t, sub) => Buffer.from(`<svg width="${w}" height="${w}"><rect x="0" y="0" width="${w}" height="22" fill="rgba(0,0,0,0.6)"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#fff">${t}</text><text x="6" y="${w - 8}" font-family="Helvetica" font-size="12" fill="#ff0">${sub}</text></svg>`);
const comp = [];
for (const [i, t] of tiles.entries()) {
  const left = (i % cols) * w, top = Math.floor(i / cols) * w;
  if (t.file) {
    comp.push({ input: await sharp(t.file).resize(w, w).toBuffer(), left, top });
    const k = w / size, bar = Math.max(2, t.meta.px * k), bx = 8, by = w - 30;
    comp.push({ input: Buffer.from(`<svg width="${w}" height="${w}"><rect x="${bx}" y="${by}" width="${bar}" height="4" fill="#ff0"/></svg>`), left, top });
    comp.push({ input: label(t.s.key, `1 cm bar · ${t.meta.mode}`), left, top });
  } else comp.push({ input: label(t.s.key, `MISSING: ${t.s.missing}`), left, top });
}
comp.push({ input: await sharp(gfile).resize(Math.round(cols * w), Math.round(w * 1.2), { fit: 'cover' }).toBuffer(), left: 0, top: rowsN * w });
comp.push({ input: Buffer.from(`<svg width="${cols * w}" height="30"><text x="6" y="20" font-family="Helvetica" font-size="15" fill="#fff">${backend}, noon, starter tank · bottom: all ${group} in one camera (true scale)</text></svg>`), left: 0, top: Math.round(H - 30) });
await sharp({ create: { width: cols * w, height: Math.round(H), channels: 3, background: '#000' } }).composite(comp).png().toFile(out);
console.log('backend', backend, 'tiles', tiles.length, '->', out);
for (const t of tiles) console.log(t.s.key, t.meta ? `${t.meta.mode}, ${t.meta.px.toFixed(0)} px/cm` : t.s.missing);
if (errors.length) console.log('errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
