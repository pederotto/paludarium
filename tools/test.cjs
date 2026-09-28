// Smoke test: serves the repo, loads the page in headless Chromium, fails on
// any console error, and saves a screenshot.
//
//   npm test                      (screenshot → test-output/shot.png)
//   node tools/test.cjs --seconds=8 --query="fresh&webgl" --out=shot.png
//
// three.js is served from node_modules instead of the CDN so the test runs
// offline.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const root = path.join(__dirname, '..');
const seconds = +arg('seconds', 6);
const query = arg('query', 'fresh');
const out = path.join(root, 'test-output', arg('out', 'shot.png'));
const script = arg('script', '');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    const idx = path.join(p, 'index.html');
    if (fs.existsSync(idx)) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(idx)); }
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({ viewport: { width: +arg('w', 1200), height: +arg('h', 740) } });
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    if (process.env.VERBOSE || m.type() === 'warning') console.log(`[${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.186.1/**', (route) => {
    const rel = route.request().url().split('three@0.186.1/')[1];
    const f = path.join(root, 'node_modules', 'three', rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404 });
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
  });
  await page.goto(`http://localhost:${port}/${arg("page", "")}?${query}`);
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone') || /Couldn/.test(document.getElementById('loading')?.textContent ?? ''), null, { timeout: 90000 });
  if (script) await page.evaluate(fs.readFileSync(script, 'utf8'));
  await page.waitForTimeout(seconds * 1000);
  const info = arg('page', '') ? {} : await page.evaluate(() => {
    const w = window.paludarium;
    if (!w) return { error: document.getElementById('loading').textContent };
    return {
      backend: document.getElementById('backend').textContent,
      fps: document.getElementById('fps').textContent,
      animals: Object.fromEntries(Object.entries(w.animals.by).map(([k, v]) => [k, v.length])),
      plants: w.plants.list.length,
      ponds: w.water.ponds.length,
      falls: w.water.falls.length,
      pieces: w.decor.pieces.length,
      env: { day: w.env.day, clock: w.env.clock, temp: +w.env.temp.toFixed(1), rh: +w.env.humidity.toFixed(0), nh3: +w.env.ammonia.toFixed(3), no3: +w.env.nitrate.toFixed(1), o2: +w.env.oxygen.toFixed(1) },
      log: w.logs.slice(0, 5).map((l) => l.msg),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, timeout: 240000 });
  await browser.close();
  server.close();
  if (errors.length) {
    console.error('Console errors:\n' + errors.slice(0, 20).join('\n'));
    process.exit(1);
  }
  console.log('OK →', path.relative(root, out));
})().catch((e) => { console.error(e); process.exit(1); });
