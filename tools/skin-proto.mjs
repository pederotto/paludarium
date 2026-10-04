// Measures the skinning prototype (src/bench/skinproto.js): per-instance bone-texture skinning against the game's per-vertex rig,
// the same species, instances and shading, frames not capped (vsync off), interleaved A B B A per setting.
//
//   node tools/skin-proto.mjs [--url=http://localhost:5173] [--sp=dartfrog] [--n=100,400] [--lod=lo,hi] [--webgl=0|1] [--secs=4] [--b=engine]
//
// Prints per setting: frame time (ms, mean and median of the uncapped frames: the GPU's cost), the CPU time per frame of the
// per-instance update (bone matrices or the rig's instance words), and the vertex count. Needs the dev server.
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:5173'), spId = arg('sp', 'dartfrog'), secs = +arg('secs', 4), webgl = arg('webgl', '0') === '1';
const B = arg('b', 'skin');            // the mode measured against the rig: skin (the prototype) or engine (the game's skinning, n <= 64)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
async function run(mode, n, lod) {
  const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.goto(`${url}/bench.html?sp=${spId}&src=glb&proto=${mode}&n=${n}&lod=${lod}&size=900${webgl ? '&webgl' : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.proto?.frames > 30, null, { timeout: 120000 }).catch(() => {});
  const r = await page.evaluate(async (secs) => {
    const s = window.proto; if (!s) return null;
    const f0 = s.frames, c0 = s.cpuMs, ts = [];
    let last = performance.now();
    await new Promise((res) => { const end = last + secs * 1000; const tick = () => { const now = performance.now(); ts.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    ts.sort((a, b) => a - b);
    return { mean: ts.reduce((a, b) => a + b, 0) / ts.length, p50: ts[Math.floor(ts.length / 2)], cpu: (s.cpuMs - c0) / Math.max(1, s.frames - f0), verts: s.verts };
  }, secs);
  await page.close();
  return { ...r, errs };
}
for (const lod of arg('lod', 'lo').split(',')) for (const n of arg('n', '100,400').split(',').map(Number)) {
  const out = { rig: [], skin: [] };
  for (const mode of ['rig', B, B, 'rig']) out[mode === 'rig' ? 'rig' : 'skin'].push(await run(mode, n, lod));
  const f = (a, k) => (a.reduce((s, r) => s + (r?.[k] ?? NaN), 0) / a.length).toFixed(2);
  console.log(`${spId} ${lod} n=${n} verts=${out.rig[0]?.verts} ${webgl ? 'WebGL' : 'WebGPU'}  rig ${f(out.rig, 'mean')} ms (p50 ${f(out.rig, 'p50')}, cpu ${f(out.rig, 'cpu')})   skin ${f(out.skin, 'mean')} ms (p50 ${f(out.skin, 'p50')}, cpu ${f(out.skin, 'cpu')})   runs rig ${out.rig.map((r) => r?.mean?.toFixed(1)).join('/')} skin ${out.skin.map((r) => r?.mean?.toFixed(1)).join('/')}`);
  const e = [...out.rig, ...out.skin].flatMap((r) => r?.errs ?? []);
  if (e.length) console.log('  errors: ' + [...new Set(e)].slice(0, 3).join(' | '));
}
await browser.close();
