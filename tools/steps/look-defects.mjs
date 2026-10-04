// The rendering defects in the user's photos of 2026-10-04, measured in a generated tank by day: white blobs on the floor
// (the mist), the back wall's brightness, a dark slab in a corner view, the render scale the governor settles on, and leaves.
// Standalone:
//
//   node tools/steps/look-defects.mjs [--url=http://127.0.0.1:5173/] [--webgl=1] [--scene=karst:4766|suriname:3459]
//        [--tier=standard] [--tag=now] [--out=test-output/look-defects] [--size=1280x800] [--settle=6000] [--hour=12]
//        [--query=quality=low] [--views=front,corner,side,close,leaf] [--eval="<js run in the page before the shots>"]
//        [--plants=monstera,anubias]   (plants added at the front left for the `leaf` view)
//
// Per view (front, corner, side, close) writes <out>/<scene>-<backend>-<tag>-<view>.png and prints one line of numbers:
//   ratio      the renderer's pixel ratio (and preset, governor scale) when the shot is taken
//   mist       live mist puffs, how many are in the lower 15 % of the tank, and their largest opacity
//   blobs      soft bright patches the mist adds: the screen with the mist minus the screen without it, pixels brighter by
//              more than 8 % luminance, counted as connected patches of 60 cells or more on a quarter-size grid (about 0.02 % of
//              the screen), the share of the screen they cover and the largest brightening anywhere (peak)
//   wallL      mean luminance (0 … 1, sRGB as shown) of the screen where the back wall is the first thing hit
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), webgl = arg('webgl', '0') === '1', tag = arg('tag', 'now');
const [preset, seedS] = arg('scene', 'karst:4766').split(':'), tier = arg('tier', 'standard');
const out = arg('out', 'test-output/look-defects'), settle = +arg('settle', 6000), hour = +arg('hour', 12), query = arg('query', '');
const only = arg('views', 'front,corner,side,close').split(','), pre = arg('eval', ''), addPlants = arg('plants', '').split(',').filter(Boolean);
const [W, H] = arg('size', '1280x800').split('x').map(Number);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url + '?' + [webgl ? 'webgl' : '', query].filter(Boolean).join('&'), { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.waitForFunction(() => window.__ctx?.start, null, { timeout: 60000 });
await page.evaluate(([p, s, t]) => window.__ctx.start.preset(p, +s, t), [preset, seedS, tier]);
await page.waitForFunction(() => window.__S?.screen?.value === 'play' && !window.__S?.busy?.value, null, { timeout: 120000 }).catch(() => {});
await page.addStyleTag({ content: '#ui{display:none!important}' });
await page.evaluate((hour) => {
  const g = window.game, E = g.world.env;
  window.__gov = []; const ap = g.gfx.apply.bind(g.gfx), t0 = performance.now();
  g.gfx.apply = (ch) => { window.__gov.push(`${((performance.now() - t0) / 1000).toFixed(0)}s ${ch.q}@${ch.scale}/${ch.cap} ${ch.reason}`); return ap(ch); };
  g.setSpeed?.(0);
  E.minute = Math.floor(E.minute / 1440) * 1440 + hour * 60;     // noon by default
}, hour);
if (pre) console.log('eval:', await page.evaluate(pre));
// --plants=monstera,anubias: grown plants of those species side by side at the front left, for the `leaf` view.
if (addPlants.length) console.log('plants added:', await page.evaluate((ids) => {
  const W = window.game.world, l = window.game.stage.parts.lid.geometry.parameters, out = [];
  ids.forEach((id, i) => {
    const x = -l.width * 0.28 + i * 9, z = l.depth * 0.3, y = W.terrain.heightAt(x, z);
    const V3 = window.game.camera.position.constructor, p = W.plants.add(id, new V3(x, y, z), { grown: 1, rot: 0.6 });
    if (p) out.push(id);
    if (i === 0) window.__leafAt = [x, y, z];
  });
  return out;
}, addPlants));
await page.waitForTimeout(settle);
const backend = await page.evaluate(() => window.game.gfx.backend);
// Faceted leaves: where triangles of a leaf meet, the normals the vertices are drawn with should agree (one smooth sheet). The
// mean angle between the normals at a shared leaf position, per procedural plant species (degrees; flat facets give tens of
// degrees). Built from PLANTS (dev server only: it imports /src).
const creases = await page.evaluate(async () => {
  const out = {};
  const { PLANTS } = await import('/src/sim/plants.js').catch(() => ({ PLANTS: {} }));
  for (const [key, sp] of Object.entries(PLANTS)) {
    if (sp.model || !sp.build) continue;
    const g = sp.build(), P = g.attributes.position, N = g.attributes.normal, L = g.attributes.leaf;
    if (!L || !N) continue;
    const groups = new Map();
    for (let i = 0; i < P.count; i++) {
      if (L.getY(i) < 0) continue;
      const k = `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
      (groups.get(k) ?? groups.set(k, []).get(k)).push([N.getX(i), N.getY(i), N.getZ(i)]);
    }
    let sum = 0, n = 0;
    for (const ns of groups.values()) {
      if (ns.length < 2) continue;
      const mx = ns.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]), ml = Math.hypot(...mx) || 1;
      for (const v of ns) { sum += Math.acos(Math.min(1, Math.abs((v[0] * mx[0] + v[1] * mx[1] + v[2] * mx[2]) / ml))) * 180 / Math.PI; n++; }
    }
    if (n) out[key] = +(sum / n).toFixed(1);
  }
  return out;
});
console.log('leaf crease (deg, mean angle between normals at a shared leaf vertex):', JSON.stringify(creases));

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
async function raw(buf) { const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
// Connected patches (4-neighbour) of a mask, those of at least `min` pixels.
function patches(mask, w, h, min) {
  const seen = new Uint8Array(w * h); let n = 0, px = 0;
  const st = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let c = 0; st.push(i); seen[i] = 1;
    while (st.length) {
      const j = st.pop(); c++;
      const x = j % w, y = (j / w) | 0;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (k >= 0 && mask[k] && !seen[k]) { seen[k] = 1; st.push(k); }
    }
    if (c >= min) { n++; px += c; }
  }
  return { n, px };
}

const VIEWS = {
  front: ({ w, h, d }) => null,
  corner: ({ w, h, d }) => [-w * 0.62, h * 0.72, d * 0.5 + w * 0.62, w * 0.08, h * 0.36, -d * 0.12],
  side: ({ w, h, d }) => [-w * 0.95, h * 0.75, d * 0.5 + w * 0.42, w * 0.05, h * 0.35, -d * 0.1],
  leaf: () => null,
  close: ({ w, h, d }) => [-w * 0.18, h * 0.32, d * 0.5 + w * 0.22, -w * 0.12, h * 0.16, d * 0.1],
};
for (const [view, at] of Object.entries(VIEWS)) {
  if (!only.includes(view)) continue;
  await page.evaluate(async (v) => {
    const g = window.game;
    const L = window.__leafAt;
    if (v === 'leaf' && L) g.rig.controls.setLookAt(L[0] + 6, L[1] + 7, L[2] + 15, L[0] + 3, L[1] + 4, L[2], false);
    else if (!v) g.rig.view('front', false);
    else g.rig.controls.setLookAt(...v, false);
  }, view === 'leaf' ? 'leaf' : at(await page.evaluate(() => { const l = window.game.stage.parts.lid; return { w: l.geometry.parameters.width, d: l.geometry.parameters.depth, h: l.position.y - 0.2 }; })));
  await page.waitForTimeout(1500);
  // Freeze the mist where it is, so the two pictures differ only by it.
  const info = await page.evaluate(async () => {
    const g = window.game, m = g.mist, TANK = { h: g.stage.parts.lid.position.y - 0.2 };
    m._upd = m._upd ?? m.update; m.update = () => {};
    const k = m.geo.instanceCount, P = m.posA.array, F = m.fadeA.array;
    let low = 0, amax = 0;
    for (let i = 0; i < k; i++) { if (P[i * 4 + 1] < TANK.h * 0.15) low++; amax = Math.max(amax, F[i * 2]); }
    const r = g.gfx.renderer;
    return { ratio: +r.getPixelRatio().toFixed(3), q: g.gfx.quality, scale: g.gfx.adapt, mist: k, low, amax: +amax.toFixed(3), hum: +g.world.env.humidity.toFixed(0), envMist: +g.world.env.mist.toFixed(2), fogger: g.world.env.fogger, backdrop: g.world.env.backdrop };
  });
  await page.waitForTimeout(300);
  const file = `${out}/${preset}-${backend === 'WebGPU' ? 'webgpu' : 'webgl'}-${tag}-${view}.png`;
  const a = await page.screenshot({ path: file });
  await page.evaluate(() => { window.game.mist.mesh.visible = false; });
  await page.waitForTimeout(300);
  const b = await page.screenshot();
  await page.evaluate(() => { const m = window.game.mist; m.mesh.visible = true; m.update = m._upd; });
  // Where the back wall is the first thing a ray from the camera hits (the plants, rocks and wood in front count).
  const wallPts = await page.evaluate(async () => {
    const g = window.game, cam = g.camera, W = g.world;
    const rc = window.__tools.ray, pts = [];
    const targets = [W.wall.mesh, W.terrain.mesh, ...(W.decor?.pieces ?? []).map((p) => p.mesh ?? p.group).filter(Boolean)];
    for (let j = 1; j < 18; j++) for (let i = 1; i < 28; i++) {
      const nx = i / 28 * 2 - 1, ny = 1 - j / 18 * 2;
      rc.setFromCamera({ x: nx, y: ny }, cam);
      const hit = rc.intersectObjects(targets, true)[0];
      if (hit && hit.object === W.wall.mesh) pts.push([(nx + 1) / 2, (1 - ny) / 2]);
    }
    return pts;
  });
  const A = await raw(a), B = await raw(b);
  let wl = 0;
  for (const [u, v] of wallPts) {
    let s = 0, n = 0;
    const cx = Math.round(u * A.w), cy = Math.round(v * A.h);
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) { if (x < 0 || y < 0 || x >= A.w || y >= A.h) continue; const i = (y * A.w + x) * 3; s += lum(B.data[i], B.data[i + 1], B.data[i + 2]); n++; }
    wl += s / Math.max(1, n);
  }
  // Mist patches, on a quarter-size grid.
  const qw = A.w >> 2, qh = A.h >> 2, mask = new Uint8Array(qw * qh);
  let peak = 0;
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) {
    const i = ((y * 4) * A.w + x * 4) * 3;
    const dl = lum(A.data[i], A.data[i + 1], A.data[i + 2]) - lum(B.data[i], B.data[i + 1], B.data[i + 2]);
    mask[y * qw + x] = dl > 0.08 ? 1 : 0;
    peak = Math.max(peak, dl);
  }
  const p = patches(mask, qw, qh, 60);
  console.log(`${preset} ${backend} ${tag} ${view}: ratio ${info.ratio} (${info.q}, scale ${info.scale}) mist ${info.mist} (low ${info.low}, max alpha ${info.amax}; rh ${info.hum}%, misting ${info.envMist}, fogger ${info.fogger}) blobs ${p.n} (${(100 * p.px / (qw * qh)).toFixed(1)}% of screen, peak +${peak.toFixed(2)}) wallL ${(wl / Math.max(1, wallPts.length)).toFixed(3)} (${wallPts.length} pts, backdrop ${info.backdrop}) -> ${file}`);
}
console.log('governor:', (await page.evaluate(() => window.__gov)).join(' · ') || 'no change', '| ratio now', await page.evaluate(() => window.game.gfx.renderer.getPixelRatio().toFixed(3)));
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 6).join('\n'));
await browser.close();
