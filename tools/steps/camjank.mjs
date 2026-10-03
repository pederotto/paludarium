// Camera jank probe: does the camera move by itself, jump, or end up inside the scene, while a player turns, zooms and follows?
//
//   node tools/steps/camjank.mjs [--url=http://127.0.0.1:4420/] [--tag=before] [--out=test-output/camjank]
//
// Plays the inputs a player makes on a Mac (mouse drags, trackpad wheel events) and records every frame:
//   self      code that moves the camera without the player: calls to setLookAt, moveTo, rotatePolarTo, dollyTo,
//             setTarget made by the game (not by this probe), and the distance between where the controls put the camera
//             and where it is drawn (the game's collision adjustments)
//   jumps     frames where the drawn camera turns more than 4 degrees or its distance to the target changes more than 8 %
//             in one frame beyond what the controls themselves did
//   dblclick  double-click events fired by two quick drags (each one flies the camera to the ground)
//   inside    frames with the lens inside the ground, the background or a rock or root
// Scenarios: a full turn at three heights, quick double drags, trackpad zoom in toward six points then a full turn close up,
// following an animal without touching anything.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4420/');
const tag = arg('tag', 'before');
const out = arg('out', 'test-output/camjank');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const VW = 1200, VH = 760;
const page = await (await browser.newContext({ viewport: { width: VW, height: VH } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals?.all?.length, null, { timeout: 90000 });
await page.waitForTimeout(6000);

await page.evaluate(() => {
  const g = window.game, c = g.rig.controls, V = g.camera.position.constructor;
  const R = window.__jank = { frames: [], self: {}, probe: false, dbl: 0, phase: '' };
  for (const m of ['setLookAt', 'moveTo', 'rotatePolarTo', 'dollyTo', 'setTarget', 'rotateAzimuthTo']) {
    const f = c[m].bind(c);
    c[m] = (...a) => { if (!R.probe) { const k = R.phase + ':' + m; R.self[k] = (R.self[k] ?? 0) + 1; } return f(...a); };
  }
  g.renderer.domElement.addEventListener('dblclick', () => { R.dbl++; });
  const W = () => g.world;
  const inside = (p) => {
    const w = W(), T = w.terrain, hw = 45, hd = 22.5;   // the standard tank
    void hw; void hd;
    if (Math.abs(p.x) > 44.5 || Math.abs(p.z) > 22 || p.y > 60 || p.y < 0) return 0;
    if (p.y < T.heightAt(p.x, p.z) - 0.1) return 1;
    if (p.z < w.wall.zAt(p.x, p.y) - 0.1) return 2;
    if (w.animals?.occ?.solidAt(p.x, p.y, p.z)) return 3;
    return 0;
  };
  const tick = () => {
    const p = g.camera.position, t = c.getTarget(new V(), false), cp = c.getPosition(new V(), false);
    const d = g.camera.getWorldDirection(new V());
    R.frames.push({ ph: R.phase, p: [p.x, p.y, p.z], t: [t.x, t.y, t.z], cp: [cp.x, cp.y, cp.z], d: [d.x, d.y, d.z], in: inside(p) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const phase = (p) => page.evaluate((p) => { window.__jank.phase = p; }, p);
const probe = (on) => page.evaluate((on) => { window.__jank.probe = on; }, on);
const reset = async () => { await probe(true); await page.evaluate(() => { const g = window.game; window.__tools.follow?.(null); g.rig.view('front', false); }); await probe(false); await page.waitForTimeout(500); };
const drag = async (dx, dy, steps = 10, ms = 20) => {
  await page.mouse.move(VW / 2, VH / 2); await page.mouse.down();
  for (let s = 1; s <= steps; s++) { await page.mouse.move(VW / 2 + (dx * s) / steps, VH / 2 + (dy * s) / steps); await page.waitForTimeout(ms); }
  await page.mouse.up();
};
const wheel = (x, y, dy, n, ctrl = false) => page.evaluate(async ({ x, y, dy, n, ctrl }) => {
  const cv = window.game.renderer.domElement;
  for (let i = 0; i < n; i++) { cv.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: ctrl, clientX: x, clientY: y, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 16)); }
}, { x, y, dy, n, ctrl });

// A. Full turns at three heights.
for (const [h, dy] of [['level', 0], ['high', -120], ['low', 110]]) {
  await reset(); await phase('turn-' + h);
  if (dy) { await drag(0, dy); await page.waitForTimeout(400); }
  for (let k = 0; k < 16; k++) { await drag(150, 0, 8, 18); await page.waitForTimeout(120); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${tag}-turn-${h}.jpg`, quality: 70 });
}
// B. Quick double drags (a player nudging the view twice).
await reset(); await phase('double-drag');
for (let k = 0; k < 4; k++) {
  await page.mouse.move(VW * 0.45, VH * 0.7); await page.mouse.down(); await page.mouse.move(VW * 0.45 + 4, VH * 0.7 + 1); await page.mouse.up();
  await page.waitForTimeout(90);
  await page.mouse.down(); await page.mouse.move(VW * 0.45 + 8, VH * 0.7 + 2); await page.mouse.up();
  await page.waitForTimeout(900);
}
// C. Trackpad zoom toward points, then a full turn close up, then zoom out.
const pts = [[0.35, 0.75], [0.5, 0.62], [0.62, 0.45], [0.42, 0.35], [0.7, 0.72], [0.28, 0.55]];
let i = 0;
for (const [fx, fy] of pts) {
  await reset(); await phase('zoom-' + i);
  await wheel(VW * fx, VH * fy, -4, 60, true);           // pinch in (about 10x closer)
  await page.waitForTimeout(700);
  await phase('closeturn-' + i);
  for (let k = 0; k < 12; k++) { await drag(130, 0, 8, 18); await page.waitForTimeout(100); }
  await drag(0, 90); await page.waitForTimeout(300); await drag(0, -160); await page.waitForTimeout(500);
  if (i < 2) await page.screenshot({ path: `${out}/${tag}-closeturn-${i}.jpg`, quality: 70 });
  await phase('zoomout-' + i);
  await wheel(VW * 0.5, VH * 0.5, 4, 60, true);
  await page.waitForTimeout(700);
  i++;
}
// D. Follow without touching.
await reset(); await phase('follow');
await probe(true);
await page.evaluate(() => { const A = window.game.world.animals; const a = A.all.find((x) => !x.dead && /dartfrog|leucomelas|auratus|newt|gecko/.test(x.sp)); window.__tools.select({ kind: 'animal', obj: a }); window.__tools.zoomTo({ kind: 'animal', obj: a }); });
await probe(false);
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/${tag}-follow.jpg`, quality: 70 });

const R = await page.evaluate(() => { const r = window.__jank; return { frames: r.frames, self: r.self, dbl: r.dbl }; });
const F = R.frames;
const ang = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 57.2958;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const by = {};
for (let k = 1; k < F.length; k++) {
  const f = F[k], e = F[k - 1];
  if (f.ph !== e.ph) continue;
  const grp = f.ph.replace(/-\d+$/, '');
  const s = (by[grp] ??= { frames: 0, jumps: 0, inside: 0, what: {}, override: 0, overrideMax: 0 });
  s.frames++;
  if (f.in) { s.inside++; const k = ['', 'ground', 'background', 'rock or root'][f.in]; s.what[k] = (s.what[k] ?? 0) + 1; }
  const ov = dist(f.p, f.cp);
  s.override += ov > 0.3 ? 1 : 0;
  s.overrideMax = Math.max(s.overrideMax, ov);
  // Turn of the drawn view beyond the controls' own turn, and the drawn distance change beyond the controls' own.
  const dDrawn = ang(f.d, e.d);
  const cdir = (q) => { const v = [q.t[0] - q.cp[0], q.t[1] - q.cp[1], q.t[2] - q.cp[2]]; const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const dCtrl = ang(cdir(f), cdir(e));
  const rD = dist(f.p, f.t), rE = dist(e.p, e.t), cD = dist(f.cp, f.t), cE = dist(e.cp, e.t);
  const zoomJump = Math.abs(rD / rE - 1) - Math.abs(cD / cE - 1);
  if (dDrawn - dCtrl > 4 || zoomJump > 0.08) s.jumps++;
}
const self = {};
for (const [k, v] of Object.entries(R.self)) { const grp = k.replace(/-\d+:/, ':'); self[grp] = (self[grp] ?? 0) + v; }
console.log(`${tag}: double-click flights fired by quick drags: ${R.dbl}`);
console.log('camera moved by the game itself (calls):', JSON.stringify(self));
for (const [k, s] of Object.entries(by)) console.log(`  ${k.padEnd(11)} frames ${String(s.frames).padStart(4)}  jumps ${String(s.jumps).padStart(3)}  lens inside ${String(s.inside).padStart(4)}  drawn away from the orbit ${String(s.override).padStart(4)} frames (max ${s.overrideMax.toFixed(1)} cm)${s.inside ? '  ' + JSON.stringify(s.what) : ''}`);
fs.writeFileSync(`${out}/summary-${tag}.json`, JSON.stringify({ dbl: R.dbl, self, by, errors }, null, 1));
if (errors.length) console.log('errors:', errors.slice(0, 5).join(' | '));
await browser.close();
