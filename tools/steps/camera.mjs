// Camera probe: what the player sees when they zoom and follow the way they do on the Mac.
//
//   node tools/steps/camera.mjs [--url=http://127.0.0.1:4420/] [--out=test-output/camera] [--tag=before]
//
// Opens the starter tank and, in three passes, measures:
//  1. Wheel zoom toward the pointer (camera-controls' dollyToCursor) at a grid of screen points over plants and ground,
//     24 notches each (the camera reaches its closest, 3 cm): the share of the view covered by a leaf less than 4 cm from the lens ("leaves in the lens") and
//     whether the camera ended inside the ground. A shot of each of the worst views.
//  2. Double-click an animal (the game's Zoom in, then Follow) and watch 6 s: the camera's frame-to-frame jerk (the second
//     difference of its position, which is near 0 for a smooth glide) and the share of frames the animal is hidden.
//  3. Orbit drags low over the floor after a zoom: leaves in the lens and camera in the ground.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4420/');
const out = arg('out', 'test-output/camera');
const tag = arg('tag', 'before');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const VW = 1000, VH = 640;
const page = await (await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals?.all?.length && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);

await page.evaluate(() => {
  const g = window.game, THREE = g.camera.position.constructor;
  void THREE;
  const rc = window.__tools.ray;
  const plants = () => { const m = []; g.scene.traverse((o) => { if (o.isMesh && o.visible && o.name.startsWith('plant:') && o.count > 0) m.push(o); }); return m; };
  const solid = () => { const m = []; g.scene.traverse((o) => { if (o.isMesh && o.visible && /^(terrain|wall|piece)$/.test(o.name)) m.push(o); }); return m; };
  window.__cam = {
    // Share of a 9 x 7 grid of view rays that meet a leaf closer than `near` cm to the camera (what fills the lens).
    leafy(near = 4) {
      const cam = g.camera, P = plants(); let n = 0, tot = 0;
      for (let i = 0; i < 9; i++) for (let j = 0; j < 7; j++) {
        tot++;
        rc.setFromCamera({ x: -0.9 + i * 0.225, y: -0.85 + j * 0.283 }, cam); rc.near = 0; rc.far = near;
        if (rc.intersectObjects(P, false).length) n++;
      }
      return n / tot;
    },
    // Is the camera under the drawn ground / inside a rock?
    // Is the lens inside the ground, a rock or the background? Look straight up: the first drawn surface seen from its
    // inside (its normal pointing up, away from us) means we are under it; an overhang seen from below faces down.
    buried() {
      const p = g.camera.position.clone();
      rc.set(p, p.clone().set(0, 1, 0)); rc.near = 0; rc.far = 80;
      const h = rc.intersectObjects(solid(), true)[0];
      if (!h?.face) return false;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      return n.y > 0.2;
    },
    hidden(target) {
      const cam = g.camera.position.clone(), t = target.clone(); t.y += 0.5;
      const dir = t.clone().sub(cam), len = dir.length(); dir.normalize();
      rc.set(cam, dir); rc.near = 0; rc.far = Math.max(0, len - 1.2);
      return rc.intersectObjects([...solid(), ...plants()], false).length > 0;
    },
    reset() { g.rig.view('front', false); g.rig.controls.update(0); g.rig.clipD = null; },
  };
});

const summary = { tag };

// 0. A Mac trackpad, replayed as the wheel events Chrome sends: a pinch is a stream of small deltaY with ctrlKey set (fingers
// spread to twice their span is about -70 in all); a two-finger swipe is a burst of pixel deltas followed by a momentum
// tail. Reported: how much closer the camera got (distance before / after), and the lens zoom (camera.zoom, 1 = untouched).
const pad = async (events) => page.evaluate(async (events) => {
  const g = window.game, cv = g.rig.controls._domElement ?? document.querySelector('canvas');
  const r = cv.getBoundingClientRect(), cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.62;
  window.__cam.reset(); g.camera.zoom = 1; g.camera.updateProjectionMatrix(); g.rig.controls.zoomTo(1, false);
  await new Promise((res) => setTimeout(res, 400));
  const d0 = g.camera.position.distanceTo(g.rig.controls.getTarget(new g.camera.position.constructor()));
  for (const [dy, ctrl] of events) {
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, ctrlKey: ctrl, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 16));
  }
  await new Promise((res) => setTimeout(res, 1200));
  const d1 = g.camera.position.distanceTo(g.rig.controls.getTarget(new g.camera.position.constructor()));
  const fps = await new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); });
  return { fps, endCloser: +(d0 / g.rig.controls.distance).toFixed(2), closer: +(d0 / d1).toFixed(2), lensZoom: +g.camera.zoom.toFixed(2), d0: +d0.toFixed(1), d1: +d1.toFixed(1) };
}, events);
const pinch = await pad(Array.from({ length: 24 }, () => [-3, true]));              // fingers spread to ~2x
const pinchOut = await pad(Array.from({ length: 24 }, () => [3, true]));
const swipe = await pad(Array.from({ length: 50 }, (_, i) => [-Math.round(30 * Math.exp(-i / 14)), false]));   // ~400 px with momentum
const gentle = await pad(Array.from({ length: 10 }, () => [-4, false]));             // a slow nudge
summary.trackpad = { pinch, pinchOut, swipe, gentle };
console.log('trackpad pinch in (2x fingers):', JSON.stringify(pinch), ' pinch out:', JSON.stringify(pinchOut));
console.log('trackpad swipe (~400 px + momentum):', JSON.stringify(swipe), ' slow nudge (40 px):', JSON.stringify(gentle));
await page.evaluate(() => { const g = window.game; g.camera.zoom = 1; g.rig.controls.zoomTo(1, false); g.camera.updateProjectionMatrix(); });
if (process.argv.includes('--only-pad')) { console.log(errors.join('\n')); await browser.close(); process.exit(0); }

// 1. Wheel zooms.
const pts = [];
for (const fx of [0.3, 0.42, 0.55, 0.68]) for (const fy of [0.55, 0.68, 0.8]) pts.push([Math.round(VW * fx), Math.round(VH * fy)]);
const zooms = [];
for (const [x, y] of pts) {
  await page.evaluate(() => window.__cam.reset());
  await page.waitForTimeout(300);
  await page.mouse.move(x, y);
  for (let k = 0; k < 24; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ leafy: window.__cam.leafy(), buried: window.__cam.buried(), d: +window.game.rig.controls.distance.toFixed(1) }));
  zooms.push({ x, y, ...r });
}
zooms.sort((a, b) => b.leafy - a.leafy);
for (const z of zooms.slice(0, 3)) {
  await page.evaluate(() => window.__cam.reset());
  await page.waitForTimeout(300);
  await page.mouse.move(z.x, z.y);
  for (let k = 0; k < 24; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${tag}-zoom-${z.x}-${z.y}.png` });
}
const lz = zooms.map((z) => z.leafy);
summary.zoom = { n: zooms.length, leafyMean: +(lz.reduce((a, b) => a + b, 0) / lz.length).toFixed(3), leafyMax: +Math.max(...lz).toFixed(3), over20: lz.filter((v) => v > 0.2).length, buried: zooms.filter((z) => z.buried).length };
console.log('wheel zoom: leaves in the lens (share of view <4 cm) per point:', zooms.map((z) => `${z.x},${z.y}:${(z.leafy * 100).toFixed(0)}%${z.buried ? ' BURIED' : ''} d${z.d}`).join('  '));

// 2. Double-click an animal, follow.
const picks = await page.evaluate(() => {
  const A = window.game.world.animals, out = [];
  for (const id of ['leucomelas', 'auratus', 'dartfrog', 'firesal', 'newt', 'gecko', 'toad', 'crab', 'skink']) {
    const a = (A.by[id] ?? []).find((x) => !x.dead && !x.swimming); if (a) out.push(a.id);
    if (out.length >= 4) break;
  }
  return out;
});
const follows = [];
for (const id of picks) {
  await page.evaluate(() => window.__cam.reset());
  await page.waitForTimeout(300);
  await page.evaluate((id) => {
    const T = window.__tools, a = window.game.world.animals.all.find((x) => x.id === id);
    T.select?.({ kind: 'animal', obj: a }) ?? (window.__S ? null : null);
    const S = T.S ?? null; void S;
    T.zoomTo({ kind: 'animal', obj: a });
  }, id);
  await page.waitForTimeout(1500);
  const rec = await page.evaluate((id) => new Promise((res) => {
    const g = window.game, a = g.world.animals.all.find((x) => x.id === id), cp = [], tp = [];
    let hid = 0, n = 0, leaf = 0;
    const t0 = performance.now();
    const step = () => {
      const p = g.camera.position; cp.push([p.x, p.y, p.z]); tp.push([a.pos.x, a.pos.y, a.pos.z]);
      if (n % 6 === 0) { if (window.__cam.hidden(a.pos)) hid++; leaf += window.__cam.leafy(); }
      n++;
      if (performance.now() - t0 < 6000) requestAnimationFrame(step); else res({ cp, tp, hid, n, leaf, sp: a.sp });
    };
    requestAnimationFrame(step);
  }), id);
  const jerk = [];
  for (let i = 2; i < rec.cp.length; i++) {
    const a = rec.cp[i], b = rec.cp[i - 1], c = rec.cp[i - 2];
    jerk.push(Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]));
  }
  const tm = []; let tmove = 0;
  for (let i = 1; i < rec.tp.length; i++) tmove += Math.hypot(rec.tp[i][0] - rec.tp[i - 1][0], rec.tp[i][2] - rec.tp[i - 1][2]);
  void tm;
  jerk.sort((a, b) => a - b);
  const checks = Math.ceil(rec.n / 6);
  follows.push({ sp: rec.sp, frames: rec.n, jerkP50: +jerk[Math.floor(jerk.length / 2)].toFixed(3), jerkP99: +jerk[Math.floor(jerk.length * 0.99)].toFixed(3), jumps: jerk.filter((j) => j > 0.25).length, hidden: +(rec.hid / checks).toFixed(2), leafy: +(rec.leaf / checks).toFixed(2), animalMoved: +tmove.toFixed(1) });
  await page.screenshot({ path: `${out}/${tag}-follow-${rec.sp}.png` });
}
summary.follow = follows;
for (const f of follows) console.log(`follow ${f.sp.padEnd(11)} frames ${f.frames} jerk p50 ${f.jerkP50} p99 ${f.jerkP99} cm, jumps>0.25cm ${f.jumps}, animal hidden ${(f.hidden * 100).toFixed(0)}%, leaves in lens ${(f.leafy * 100).toFixed(0)}%, animal moved ${f.animalMoved} cm`);

// 3. Low orbit drags after a zoom toward the floor.
const orbits = [];
await page.evaluate(() => window.__tools.follow?.(null));
for (const [x, y] of [[VW * 0.4, VH * 0.75], [VW * 0.6, VH * 0.7]]) {
  await page.evaluate(() => window.__cam.reset());
  await page.waitForTimeout(300);
  await page.mouse.move(x, y);
  for (let k = 0; k < 18; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
  await page.waitForTimeout(700);
  for (const [dx, dy] of [[260, 0], [0, 140], [-400, 0], [0, 120]]) {
    await page.mouse.move(VW / 2, VH / 2);
    await page.mouse.down();
    for (let s = 1; s <= 10; s++) { await page.mouse.move(VW / 2 + dx * s / 10, VH / 2 + dy * s / 10); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(700);
    orbits.push(await page.evaluate(() => ({ leafy: window.__cam.leafy(), buried: window.__cam.buried(), y: +window.game.camera.position.y.toFixed(1) })));
  }
  await page.screenshot({ path: `${out}/${tag}-orbit-${Math.round(x)}.png` });
}
summary.orbit = { leafyMean: +(orbits.reduce((a, o) => a + o.leafy, 0) / orbits.length).toFixed(3), over20: orbits.filter((o) => o.leafy > 0.2).length, buried: orbits.filter((o) => o.buried).length, n: orbits.length };
console.log('orbit after zoom:', orbits.map((o) => `${(o.leafy * 100).toFixed(0)}%${o.buried ? ' BURIED' : ''} y${o.y}`).join('  '));

summary.errors = errors;
fs.writeFileSync(`${out}/summary-${tag}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ zoom: summary.zoom, orbit: summary.orbit }));
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
