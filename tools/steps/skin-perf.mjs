// What runtime skinning costs in the game (standalone; docs/SKELETON.md "Runtime"): the starter tank, frames uncapped (vsync off,
// ?fps=240, fixed resolution, High), the simulation paused so every run draws the same thing, in two views: the default view and
// a close view of a frog (so the vertebrates nearby use their fine, skinned mesh). Runs builds interleaved A B B A.
//
//   node tools/steps/skin-perf.mjs --a=http://127.0.0.1:4578/ --b=http://127.0.0.1:4478/ [--bq=noskin] [--webgl=1] [--secs=5]
//
// Prints per run and view: mean and median frame time (ms; with vsync off this is what a frame costs), the GPU time of the render
// pass when the backend reports it (WebGPU timestamps, ?perf), how many animals drew skinned (window.__skin, 0 on a build without
// it), draw calls. Self-contained: the same file measures a build without skinning.
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const A = arg('a', 'http://127.0.0.1:4578/'), B = arg('b', 'http://127.0.0.1:4478/'), aq = arg('aq', ''), bq = arg('bq', '');
const webgl = arg('webgl', '0') === '1', secs = +arg('secs', 5), views = arg('views', 'default,close').split(',');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });

async function run(base, extra) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  const q = ['quality=high', 'fixedres', 'fps=240', 'perf', webgl ? 'webgl' : '', extra].filter(Boolean).join('&');
  await page.goto(`${base}?${q}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForFunction(() => window.game?.world?.animals, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const out = {};
  for (const view of views) {
    const where = await page.evaluate((view) => {
      const g = window.game, by = g.world.animals.by;
      g.setSpeed(0);
      const frog = ['dartfrog', 'leucomelas', 'auratus', 'strawberry', 'bumblebee', 'redeye', 'reedfrog', 'toad', 'firesal', 'newt', 'gecko'].find((id) => by[id]?.length);
      if (view === 'close' && frog) {
        const p = by[frog][0].pos;
        g.rig.stopOrbit?.(); g.rig.moved = true;
        g.controls.setLookAt(p.x + 6, p.y + 7, p.z + 14, p.x, p.y, p.z, false);
      }
      return frog;
    }, view);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(async (secs) => {
      const g = window.game, dts = [], gpu = [];
      let last = performance.now();
      const t0 = last;
      await new Promise((res) => { const f = (t) => { dts.push(t - last); last = t; const gm = g.gfx?.stats?.gpuMs; if (gm != null) gpu.push(gm); if (t - t0 > secs * 1000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      dts.shift(); dts.sort((a, b) => a - b);
      const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
      return { mean: +mean(dts).toFixed(2), p50: +dts[dts.length >> 1].toFixed(2), gpu: gpu.length ? +mean(gpu).toFixed(2) : null, skinned: window.__skin?.drawn ?? 0, calls: g.renderer.info.render.drawCalls };
    }, secs);
    out[view] = { ...r, frog: where };
  }
  await page.close();
  return { out, errors };
}

const runs = [];
for (const [tag, base, extra] of [['A', A, aq], ['B', B, bq], ['B', B, bq], ['A', A, aq]]) {
  const r = await run(base, extra);
  runs.push([tag, r]);
  console.log(tag, webgl ? 'WebGL2' : 'WebGPU', JSON.stringify(r.out), r.errors.length ? 'errors: ' + [...new Set(r.errors)].slice(0, 3).join(' | ') : '');
}
for (const v of views) {
  const m = (t, k) => { const xs = runs.filter((r) => r[0] === t).map((r) => r[1].out[v]?.[k]).filter((x) => x != null); return xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : null; };
  console.log(`${v}: A mean ${m('A', 'mean')} ms (gpu ${m('A', 'gpu')})   B mean ${m('B', 'mean')} ms (gpu ${m('B', 'gpu')})   B-A ${(m('B', 'mean') - m('A', 'mean')).toFixed(2)} ms, skinned in B ${m('B', 'skinned')}`);
}
await browser.close();
