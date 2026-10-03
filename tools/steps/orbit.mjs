// Orbit probe: the player drags the camera round the tank, level and from lower down, as far as it goes.
//
//   node tools/steps/orbit.mjs [tag]      (dev server on http://127.0.0.1:4420/; shots in test-output/orbit)
//
// Prints abrupt frames (camera acceleration over 3 cm/frame^2), frames with the lens inside the tank, and saves a shot after
// each drag, one of each camera compartment (CameraRig.zones) and one of a followed animal with its card.
import { chromium } from 'playwright';
import fs from 'node:fs';
const tag = process.argv[2] ?? 'before', out = 'test-output/orbit'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const VW = 1200, VH = 760;
const page = await (await browser.newContext({ viewport: { width: VW, height: VH } })).newPage();
await page.goto('http://127.0.0.1:4420/', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals?.all?.length, null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game; window.__rec = [];
  const f = () => { const c = g.camera; const d = c.getWorldDirection(c.position.clone()); window.__rec.push([c.position.x, c.position.y, c.position.z, d.x, d.y, d.z, g.rig.clipD ?? -1]); requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
for (const pitch of [0, 120]) {           // level, then from lower down
  await page.evaluate(() => { window.game.rig.view('front', false); });
  await page.waitForTimeout(500);
  if (pitch) { await page.mouse.move(VW / 2, VH / 2); await page.mouse.down(); await page.mouse.move(VW / 2, VH / 2 - pitch, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(500); }
  for (let k = 0; k < 8; k++) {
    await page.mouse.move(VW / 2, VH / 2); await page.mouse.down();
    for (let s = 1; s <= 12; s++) { await page.mouse.move(VW / 2 + s * 15, VH / 2); await page.waitForTimeout(25); }
    await page.mouse.up(); await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${tag}-p${pitch}-${k}.jpg`, quality: 70 });
  }
}
const rec = await page.evaluate(() => window.__rec);
const box = await page.evaluate(() => { const c = window.game.rig.controls; return [c.maxAzimuthAngle, c.maxPolarAngle]; });
console.log('limits az/polar', box);
let posJ = 0, dirJ = 0, jerkN = 0; const ex = [];
for (let i = 2; i < rec.length; i++) { const a = rec[i], b = rec[i - 1], c = rec[i - 2]; const j = Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]); if (j > 3) jerkN++; }
console.log('abrupt frames (camera acceleration > 3 cm/frame^2):', jerkN);
for (let i = 1; i < rec.length; i++) {
  const a = rec[i], b = rec[i - 1];
  const dp = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const dd = Math.acos(Math.min(1, a[3] * b[3] + a[4] * b[4] + a[5] * b[5])) * 57.3;
  if (dp > 6) { posJ++; if (ex.length < 12) ex.push(`f${i} moved ${dp.toFixed(1)}cm clipD ${b[6].toFixed(1)}->${a[6].toFixed(1)} y${a[1].toFixed(1)}`); }
  if (dd > 6) dirJ++;
}
console.log(`${tag}: frames ${rec.length}, position jumps >6 cm/frame ${posJ}, view turns >6 deg/frame ${dirJ}`);
console.log(ex.join('\n'));
const inside = await page.evaluate((rec) => {
  const T = window.game.world.terrain, W = window.game.world.wall; let n = 0;
  for (const [x, y, z] of rec) if (T && y > 0 && y < 60 && Math.abs(x) < 44 && z < 22 && z > W.zAt(x, y)) n++;   // inside the standard tank's glass
  return n;
}, rec);
console.log('frames with the lens inside the tank volume (rough box):', inside);
for (const z of ['tank', 'bottom', 'back', 'top']) { await page.evaluate((z) => window.game.rig.setZone(z, false), z); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${tag}-zone-${z}.jpg`, quality: 75 }); }
await page.evaluate(() => window.game.rig.setZone('tank', false));
const id = await page.evaluate(() => { const A = window.game.world.animals; const a = A.all.find((x) => !x.dead && /frog|leucomelas|auratus|newt|gecko|dartfrog/.test(x.sp)); window.__tools.select({ kind: 'animal', obj: a }); window.__tools.zoomTo({ kind: 'animal', obj: a }); return a.sp; });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/${tag}-follow-card.jpg`, quality: 75 });
console.log('followed', id);
await browser.close();
