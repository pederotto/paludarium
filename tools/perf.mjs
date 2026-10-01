// Load time and frame rate, measured the way a player meets them.
//
//   node tools/perf.mjs [--url=http://localhost:4173/] [--size=1280x720] [--dpr=1] [--secs=6] [--cpu=1]
//        [--start=starter] [--json=test-output/perf.json]
//
// Run it against `npm run build && npx vite preview --port 4173`, not the dev server: dev serves
// every module separately and says nothing about what a player downloads. Prints
//   load     navigation to first paint, to the loading veil lifting, bytes and slowest requests
//   start    the click on the start button to a drawn tank
//   frames   fps over --secs, frame-time percentiles, draw calls, triangles, pixel ratio
//   long     main-thread tasks over 50 ms during load and play
// --profile=1 adds a CPU profile of load-to-drawn and of steady play (top functions by self time).
// --cpu=N throttles the CPU N times (4 is a mid-range phone). Needs the installed Chrome with WebGPU.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:4173/');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const dpr = +arg('dpr', 1), secs = +arg('secs', 6), cpu = +arg('cpu', 1);
const startLabel = new RegExp(arg('start', 'starter paludarium'), 'i');

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const prof = arg('profile', '') === '1';
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

// Long tasks from the very first script.
await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
});

const top = (p, n = 14) => {
  const self = new Map(); const dt = p.timeDeltas; const byId = new Map(p.nodes.map((x) => [x.id, x]));
  p.samples.forEach((id, i) => { self.set(id, (self.get(id) || 0) + (dt[i] || 0)); });
  const agg = new Map();
  for (const [id, us] of self) { const f = byId.get(id).callFrame; const k = `${f.functionName || '(anon)'}  ${f.url.replace(/^.*\//, '')}:${f.lineNumber + 1}`; agg.set(k, (agg.get(k) || 0) + us); }
  const tot = [...agg.values()].reduce((a, b) => a + b, 0);
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms ${(100 * us / tot).toFixed(1).padStart(5)}%  ${k}`).join('\n');
};
// Inclusive time: a function's own time plus everything it calls, each sample counted once per function.
const incl = (p, n = 30) => {
  const byId = new Map(p.nodes.map((x) => [x.id, x])); const parent = new Map();
  for (const x of p.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const agg = new Map(); const dt = p.timeDeltas;
  p.samples.forEach((id, i) => {
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const f = byId.get(cur).callFrame; if (!f.url && f.functionName.startsWith('(')) continue;
      const k = `${f.functionName || '(anon)'}  ${f.url.replace(/^.*\//, '')}:${f.lineNumber + 1}`;
      if (!seen.has(k)) { seen.add(k); agg.set(k, (agg.get(k) || 0) + (dt[i] || 0)); }
    }
  });
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n');
};
if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
const loadEvent = Date.now() - t0;
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
const veilGone = Date.now() - t0;

const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const res = performance.getEntriesByType('resource').map((r) => ({ name: r.name.replace(location.origin, ''), kb: Math.round((r.transferSize || r.encodedBodySize) / 1024), ms: Math.round(r.responseEnd - r.startTime), start: Math.round(r.startTime) }));
  return { dcl: Math.round(n.domContentLoadedEventEnd), paint, res };
});
const bytes = nav.res.reduce((s, r) => s + r.kb, 0);
console.log('load', JSON.stringify({ domContentLoadedMs: nav.dcl, ...nav.paint, loadEventMs: loadEvent, veilGoneMs: veilGone, requests: nav.res.length, totalKB: bytes }));
console.log('  slowest:', nav.res.sort((a, b) => b.ms - a.ms).slice(0, 6).map((r) => `${r.name} ${r.kb}kB ${r.ms}ms@${r.start}`).join('\n           '));

// Press the start button and time until the tank is drawing.
const tStart = Date.now();
await page.getByRole('button', { name: startLabel }).click({ force: true, timeout: 120000 });
await page.waitForFunction(() => window.game?.world?.sim && document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
console.log('start', JSON.stringify({ clickToDrawnMs: Date.now() - tStart }));
if (prof) { const { profile } = await cdp.send('Profiler.stop'); console.log('--- profile: load to drawn tank (self)\n' + top(profile, 22) + '\n--- inclusive\n' + incl(profile, 40)); }
await page.waitForTimeout(2500);
if (prof) { await cdp.send('Profiler.start'); await page.waitForTimeout(4000); const { profile } = await cdp.send('Profiler.stop'); console.log('--- profile: steady play\n' + top(profile, 22)); }

const fr = await page.evaluate(async (secs) => {
  const g = window.game, info = g.renderer.info;
  const dts = []; let last = performance.now(); const t0 = last;
  await new Promise((res) => { const f = (t) => { dts.push(t - last); last = t; if (t - t0 > secs * 1000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  dts.shift(); dts.sort((a, b) => a - b);
  const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(p * dts.length))].toFixed(1);
  const total = dts.reduce((a, b) => a + b, 0);
  return {
    fps: +(dts.length / (total / 1000)).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: q(1),
    over33ms: dts.filter((d) => d > 33.4).length, frames: dts.length,
    gfxFrameMs: g.gfx?.stats?.frameMs, adapt: g.gfx?.stats?.adapt ?? g.gfx?.stats?.scale, quality: g.gfx?.quality, backend: g.gfx?.backend,
    calls: info.render.calls, tris: info.render.triangles, geoms: info.memory.geometries, textures: info.memory.textures,
    pr: +g.renderer.getPixelRatio().toFixed(2), animals: Object.values(g.world.animals.by).reduce((s, a) => s + a.length, 0),
  };
}, secs);
console.log('frames', JSON.stringify(fr));
const long = await page.evaluate(() => window.__long);
console.log('long', JSON.stringify({ count: long.length, totalMs: long.reduce((s, l) => s + l[1], 0), top: long.sort((a, b) => b[1] - a[1]).slice(0, 6) }));
if (errors.length) console.log('errors', errors.slice(0, 5));
const json = arg('json', '');
if (json) { fs.mkdirSync(json.replace(/\/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(json, JSON.stringify({ load: { loadEvent, veilGone, ...nav }, fr, long }, null, 1)); }
await browser.close();
