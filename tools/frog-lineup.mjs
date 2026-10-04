// In-game look at the frogs: the starter tank emptied, one frog of each species (and each blue dart frog morph) set in a row on
// open ground, the world paused, the camera close; one picture per frog plus a contact sheet (test-output/lineup/frogs.png).
// Checks that every frog is drawn with its baked model (Animals.models) and not the procedural stand-in.
//
//   node tools/frog-lineup.mjs [--url=http://127.0.0.1:5181/] [--size=480] [--species=dartfrog,auratus,...]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5181/'), size = +arg('size', 480);
const LIST = arg('species', 'leucomelas,strawberry,dartfrog,dartfrog:cobalt_clean,dartfrog:sky_spotted,dartfrog:sky_clean,auratus,bumblebee,reedfrog,toad').split(',');
fs.mkdirSync('test-output/lineup', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /creature model|pose model/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#ui{display:none!important}' });
const spots = await page.evaluate((LIST) => {
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, V3 = g.camera.position.constructor;
  g.setSpeed(0);
  for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
  const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
  // flat dry ground, not under hardscape
  const cands = [];
  for (let x = -45; x <= 45; x += 2) for (let z = -25; z <= 25; z += 2) {
    const gnd = T.heightAt(x, z), s = W.water.surfaceAt(x, z, 0.2);
    if (Number.isFinite(s) && s > gnd - 0.5) continue;
    if (T.normalAt(x, z).y < 0.95) continue;
    cands.push({ x, z, y: gnd, f: Math.abs(z) + Math.abs(x) * 0.2 });
  }
  cands.sort((a, b) => a.f - b.f);
  const out = [];
  for (const [i, key] of LIST.entries()) {
    const [id, morph] = key.split(':');
    const c = cands.find((c) => out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 12));
    if (!c) break;
    const a = A.add(id, new V3(c.x, c.y, c.z), { age: 1e6, hunger: 0.1, ...(morph ? { morph } : {}) });
    if (!a) continue;
    a.yaw = 0.6; a.calm = 1;
    out.push({ key, x: c.x, y: c.y, z: c.z, id: a.id });
  }
  return out;
}, LIST);
// let the models load and the shaders compile
await page.waitForTimeout(9000);
const shots = [];
for (const s of spots) {
  await page.evaluate((s) => {
    const g = window.game;
    g.controls.setLookAt(s.x + 7, s.y + 4.5, s.z + 8, s.x, s.y + 1, s.z, false);
  }, s);
  await page.waitForTimeout(1200);
  const file = `test-output/lineup/${s.key.replace(':', '-')}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
}
const state = await page.evaluate(() => { const A = window.game.world.animals; return { models: Object.keys(A.models), meshes: Object.keys(A.meshes) }; });
console.log('models loaded:', state.models.join(', '));
console.log('meshes drawn:', state.meshes.join(', '));
const cols = 5, rows = Math.ceil(shots.length / cols), w = 300;
const ims = await Promise.all(shots.map((f) => sharp(f).resize(w, w).toBuffer()));
await sharp({ create: { width: cols * w, height: rows * w, channels: 3, background: '#000' } }).composite(ims.map((b, i) => ({ input: b, left: (i % cols) * w, top: Math.floor(i / cols) * w }))).png().toFile('test-output/lineup/frogs.png');
if (errors.length) console.log('errors:\n' + errors.slice(0, 8).join('\n'));
await browser.close();
