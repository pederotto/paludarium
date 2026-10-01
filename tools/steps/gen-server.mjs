// A persistent Chrome (real WebGPU) driven over HTTP, so generator iterations skip the browser start-up.
//   node tools/steps/gen-server.mjs [--port=5199] [--url=http://localhost:5173/] &
//   curl -s localhost:5199/run --data 'return 1+1'         -> runs an async function body in the page, returns its JSON
//   curl -s 'localhost:5199/shot?name=foo&wait=1200'         -> screenshot to test-output/gen/foo.png
//   curl -s localhost:5199/errors                            -> console errors since the last call
//   curl -s localhost:5199/reload | /quit
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const port = +arg('port', 5199), url = arg('url', 'http://localhost:5173/');
const W = +arg('w', 1280), H = +arg('h', 720);
fs.mkdirSync('test-output/gen', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
let errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 400)));
async function load() {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
}
await load();
const hide = () => page.evaluate(() => { if (!document.getElementById('gen-hide')) { const s = document.createElement('style'); s.id = 'gen-hide'; s.textContent = '#ui{display:none!important}'; document.head.appendChild(s); } });
const body = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    if (u.pathname === '/run') {
      const code = await body(req);
      await hide();
      let r;
      for (let attempt = 0; ; attempt++) {
        try { r = await page.evaluate(`(async () => { ${code} })()`); break; }
        catch (e) {
          // The dev server reloads the page when someone edits a source file: wait and run again.
          if (attempt >= 3 || !/context was destroyed|navigation/.test(String(e.message))) throw e;
          await page.waitForLoadState('load').catch(() => {});
          await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone') && window.game?.world, null, { timeout: 60000 }).catch(() => {});
          await page.waitForTimeout(1500);
          await hide();
        }
      }
      send({ ok: true, r });
    } else if (u.pathname === '/shot') {
      const name = u.searchParams.get('name') || 'shot';
      await page.waitForTimeout(+(u.searchParams.get('wait') || 1200));
      await hide();
      const file = `test-output/gen/${name}.png`;
      await page.screenshot({ path: file });
      send({ ok: true, file });
    } else if (u.pathname === '/errors') { send({ ok: true, errors: [...new Set(errors)] }); errors = []; }
    else if (u.pathname === '/reload') { await load(); send({ ok: true }); }
    else if (u.pathname === '/quit') { send({ ok: true }); await browser.close(); process.exit(0); }
    else send({ ok: false, error: 'unknown' });
  } catch (e) { send({ ok: false, error: String(e.message ?? e).slice(0, 1500) }); }
}).listen(port, () => console.log('gen-server on', port));
