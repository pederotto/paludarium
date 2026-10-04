// Frog skin finish probe (standalone, on the creature bench: bench.html, lit like the tank, no post-processing): each frog's
// scanned model in three poses, each shot with the frog and without it (so its own pixels are known):
//   front  the frog turned round (yaw 180 degrees) to face the camera
//   graze  the camera level with the frog at its side: back and flanks edge-on under the overhead LED, where a plastic clear
//          coat turns into a bright rim
//   wall   the frog head-down on a vertical surface with its back to the camera, as on the background or the glass
// The frog is always turned away from its model frame (yaw / pitch), so a shading term left in that frame shows (a frog walking
// toward the viewer is turned 180 degrees from its model).
// Prints per shot: hi = share of frog pixels brighter than 0.9 (luminance of the picture), hi8 the same above 0.8, p99 the 99th
// percentile, mean, rim = mean luminance of the frog's outermost 3 px over that of its inside (above 1: a glowing outline),
// sat = mean saturation and grey = share of bright colourless pixels (a coat reflection washing the skin's colour out: chrome).
//
//   node tools/steps/frog-skin.mjs [--url=http://127.0.0.1:5173/] [--out=test-output/frog-skin] [--webgl] [--size=420]
//                                  [--species=dartfrog,auratus,...]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output/frog-skin'), size = +arg('size', 420);
const webgl = process.argv.includes('--webgl');
const LIST = arg('species', 'dartfrog,dartfrog:cobalt_clean,dartfrog:sky_spotted,dartfrog:sky_clean,leucomelas,strawberry,auratus,bumblebee,reedfrog,toad,redeye').split(',');
fs.mkdirSync(out, { recursive: true });
const watchdog = setTimeout(() => { console.log('TIMEOUT: no result in 8 min'); process.exit(2); }, 480000);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: size + 20, height: size + 60 }, deviceScaleFactor: 1 })).newPage();
page.setDefaultTimeout(90000);      // (a loaded machine: shots and page work can take a while)
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /no GLB|failed/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));

const VIEWS = {
  front: { cam: 'back', st: { yaw: Math.PI } },
  graze: { cam: 'side', st: { yaw: Math.PI } },
  wall: { cam: 'front', st: { pitch: Math.PI / 2, y: 1.2, yaw: 0 } },
};
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
async function measure(withF, withoutF) {
  const a = await sharp(withF).raw().toBuffer({ resolveWithObject: true }), b = await sharp(withoutF).raw().toBuffer();
  const { width: w, height: h, channels: ch } = a.info, A = a.data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(A[i * ch] - b[i * ch]) + Math.abs(A[i * ch + 1] - b[i * ch + 1]) + Math.abs(A[i * ch + 2] - b[i * ch + 2]);
    mask[i] = d > 30 ? 1 : 0;
  }
  // depth into the silhouette (chessboard px), for the outline
  const dist = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] ? 999 : 0;
  for (let pass = 0; pass < 6; pass++) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    let m = dist[i];
    for (const o of [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1]) m = Math.min(m, dist[i + o] + 1);
    dist[i] = m;
  }
  const L = [];
  let edge = 0, ne = 0, inner = 0, ni = 0, sat = 0, grey = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const l = lum(A[i * ch], A[i * ch + 1], A[i * ch + 2]);
    L.push(l);
    const mx = Math.max(A[i * ch], A[i * ch + 1], A[i * ch + 2]), S = mx ? (mx - Math.min(A[i * ch], A[i * ch + 1], A[i * ch + 2])) / mx : 0;
    sat += S; if (S < 0.3 && mx > 90) grey++;
    if (dist[i] <= 3) { edge += l; ne++; } else if (dist[i] > 5) { inner += l; ni++; }
  }
  L.sort((x, y) => x - y);
  const n = L.length || 1;
  return { px: L.length, hi: L.filter((v) => v > 0.9).length / n, hi8: L.filter((v) => v > 0.8).length / n, p99: L[Math.floor(n * 0.99)] ?? 0, mean: L.reduce((s, v) => s + v, 0) / n, rim: ni && ne ? (edge / ne) / Math.max(1e-3, inner / ni) : 0, sat: sat / n, grey: grey / n };
}

const rows = [];
for (const key of LIST) try {
  await page.goto(`${url}bench.html?sp=${encodeURIComponent(key)}&src=glb&size=${size}${webgl ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 120000 });
  const ok = await page.waitForFunction(() => window.bench?.ready, null, { timeout: 60000 }).then(() => true).catch(() => false);
  if (!ok) { console.log(key, 'bench did not start'); continue; }
  await page.waitForTimeout(2500);                                     // the model loads, the shaders compile
  const canvas = page.locator('#c canvas');
  for (const [v, { cam, st }] of Object.entries(VIEWS)) {
    await page.evaluate(([cam, st]) => { window.bench.pose('stand'); window.bench.setState({ yaw: 0, pitch: 0, roll: 0, y: 0, ...st }); window.bench.setView(cam); }, [cam, st]);
    await page.waitForTimeout(500);
    const f1 = `${out}/${key.replace(':', '-')}-${v}.png`, f0 = `${out}/${key.replace(':', '-')}-${v}-bg.png`;
    await canvas.screenshot({ path: f1 });
    await page.evaluate(() => window.bench.setState({ y: -1000 }));
    await page.waitForTimeout(300);
    await canvas.screenshot({ path: f0 });
    const m = await measure(f1, f0);
    rows.push({ key, v, ...m });
    console.log(`${key.padEnd(22)} ${v.padEnd(5)} px ${String(m.px).padStart(6)}  hi ${(m.hi * 100).toFixed(2).padStart(5)}%  hi8 ${(m.hi8 * 100).toFixed(2).padStart(5)}%  p99 ${m.p99.toFixed(3)}  mean ${m.mean.toFixed(3)}  rim ${m.rim.toFixed(2)}  sat ${m.sat.toFixed(3)}  grey ${(m.grey * 100).toFixed(1)}%`);
  }
} catch (e) { console.log(key, 'skipped:', String(e.message ?? e).split('\n')[0]); }
const avg = (v, k) => { const r = rows.filter((x) => x.v === v); return r.reduce((s, x) => s + x[k], 0) / (r.length || 1); };
for (const v of Object.keys(VIEWS)) console.log(`MEAN ${v.padEnd(5)}: hi ${(avg(v, 'hi') * 100).toFixed(2)}%  hi8 ${(avg(v, 'hi8') * 100).toFixed(2)}%  p99 ${avg(v, 'p99').toFixed(3)}  mean ${avg(v, 'mean').toFixed(3)}  rim ${avg(v, 'rim').toFixed(2)}  sat ${avg(v, 'sat').toFixed(3)}  grey ${(avg(v, 'grey') * 100).toFixed(1)}%`);
fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(rows, null, 1));
if (errors.length) console.log('errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
await browser.close();
clearTimeout(watchdog);
