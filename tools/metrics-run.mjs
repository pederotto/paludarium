// Records the game in headless Chrome with the same recorder a remote machine uses (src/diag, docs/METRICS.md), so a run here and
// a run on someone's laptop are directly comparable. Prints the report and leaves the recording in metrics/sessions/.
//
//   node tools/metrics-run.mjs [--label=m1] [--bench=quick|none] [--secs=30] [--size=1280x720] [--dpr=1] [--cpu=1]
//        [--url=http://localhost:4173/]   a running server; without it the build in dist/ is served on a free port (npm run build first)
//        [--outDir=../archive/original-build-perf-base]   serve another build (the recorder is injected into it)
//        [--inject]   with --url=https://…: record a page served by someone else (the live GitHub Pages build): the recorder's
//                     requests are answered from this repo's collector, so the page needs no changes
//        [--query="&quality=low&fixedres&fps=60"]   extra address parameters: pin the graphics to compare builds, not governors
//        [--lan]    open it through this computer's LAN address: plain http, so no WebGPU (the WebGL 2 path weak laptops get)
//        [--screencast]   also capture the screen the way the compositor presents it, and count frames and blank frames in it
//        [--fail-on=bad]  exit 1 when the report has a finding of that severity (bad|warn)
//   --bench=quick (default) runs src/diag/bench.js, about a minute hands-off; --bench=none presses Start, plays --secs seconds and stops.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k) => args.some((a) => a === `--${k}`);
const arg = (k, d = '') => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const dpr = +arg('dpr', 1), cpu = +arg('cpu', 1), secs = +arg('secs', 30);
const bench = arg('bench', 'quick'), label = arg('label', 'run').replace(/[^\w.-]/g, '').slice(0, 24) || 'run';
const query = arg('query', '');
process.env.PALUDARIUM_METRICS_QUIET = '1';   // the report is the output, not the collector's log lines

// A server, unless one was named.
let server = null, base = arg('url', ''), collector = '';
const inject = flag('inject');
if (!base || inject) {
  const outDir = arg('outDir', '');
  server = await preview({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', build: outDir ? { outDir: path.resolve(root, outDir) } : undefined, preview: { port: 0, host: true, open: false } });
  const port = server.httpServer.address().port;
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (!base) base = `http://${flag('lan') && lan ? lan : 'localhost'}:${port}/`;
  collector = `http://localhost:${port}`;
}
const url = `${base}${base.includes('?') ? '&' : '?'}metrics=${label}&nooverlay${bench !== 'none' ? '&bench' : ''}${query}`;

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
if (inject) {
  // The page's own origin answers /__metrics/*: the requests are forwarded to the local collector (from node, so the browser's
  // rules about public pages calling local addresses do not apply), and the recorder is imported before the page's scripts run.
  await page.route('**/__metrics**', async (route) => {
    const u = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${collector}${u.pathname}${u.search}` }) });
  });
  await ctx.addInitScript(() => { import('/__metrics/diag/boot.js').catch(() => {}); });
}
const cdp = await ctx.newCDPSession(page);
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 200)));

const shots = [];
if (flag('screencast')) {
  cdp.on('Page.screencastFrame', (f) => { shots.push({ t: f.metadata.timestamp, d: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
}

try {   // macOS: below about 20% on battery Chrome's Energy Saver limits frames to 30 a second, and every number is wrong
  const batt = (await import('node:child_process')).execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /(\d+)%; (discharging|charging|charged|finishing charge)/.exec(batt);
  if (m && m[2] === 'discharging') console.error(`WARNING: this computer is on battery (${m[1]}%). Plug it in: the browser slows down to save power, and the numbers will not be what the machine can do.`);
} catch { /* not macOS */ }
console.error(`recording ${label}: ${url}  (${W}x${H} @${dpr}${cpu > 1 ? ', cpu x' + cpu : ''})`);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__metrics, null, { timeout: 30000 }).catch(() => { console.error('the recorder did not start: is the build served by this repo\'s preview server, or does it contain src/diag?'); });
if (flag('screencast')) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 35, maxWidth: 240, maxHeight: 135, everyNthFrame: 1 });

if (bench === 'none') {
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 120000 });
  await page.waitForTimeout(secs * 1000);
  await page.evaluate(() => window.__metrics.stop('runner'));
}
await page.waitForFunction(() => window.__metrics?.state === 'stopped', null, { timeout: 600000 });
if (flag('screencast')) await cdp.send('Page.stopScreencast').catch(() => {});

const text = await page.evaluate(() => window.__metrics.text());
const state = await page.evaluate(() => ({ sid: window.__metrics.sid, sink: window.__metrics.sink.state, ndjson: window.__metrics.sink.state === 'ok' ? null : window.__metrics.ndjson() }));
if (state.ndjson) {   // nobody collected it: write it here
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const file = path.join(root, 'metrics', 'sessions', `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${label}_${state.sid}.ndjson`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, state.ndjson);
  console.error('recording written to', path.relative(root, file));
}
console.log(text);

if (flag('screencast')) {
  // What the compositor actually presented: how many frames, how evenly, and how many were nearly black. A blank frame is a dip
  // against the frames around it (the camera moves, the picture changes, a single frame does not go dark on its own).
  const lum = [];
  for (const s of shots) lum.push((await sharp(Buffer.from(s.d, 'base64')).greyscale().stats()).channels[0].mean);
  let blank = 0;
  const R = 30;
  for (let i = R; i < lum.length - R; i++) {
    const near = [...lum.slice(i - R, i), ...lum.slice(i + 1, i + R + 1)].sort((a, b) => a - b), med = near[near.length >> 1];
    if (med > 15 && lum[i] < 0.55 * med) blank++;
  }
  const gaps = shots.slice(1).map((s, i) => (s.t - shots[i].t) * 1000).sort((a, b) => a - b);
  const span = shots.length > 1 ? shots[shots.length - 1].t - shots[0].t : 0;
  console.log(`\n## Screen capture (compositor output, ${shots.length} frames)\n${(shots.length / (span || 1)).toFixed(1)} frames per s presented over ${span.toFixed(0)} s · gap between captured frames: median ${gaps.length ? gaps[gaps.length >> 1].toFixed(1) : '–'} ms, p99 ${gaps.length ? gaps[Math.floor(gaps.length * 0.99)].toFixed(1) : '–'} ms · blank frames (dark against the frames around them): ${blank}`);
}
if (errors.length) console.log('\npage errors:', errors.slice(0, 5));

const S = await page.evaluate(() => window.__metrics.summary());
await browser.close();
await server?.close();
const fail = arg('fail-on', '');
if (fail && S.findings.some((f) => f.sev === 'bad' || (fail === 'warn' && f.sev === 'warn'))) process.exit(1);
