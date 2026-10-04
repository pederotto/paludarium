// The player's journey, step by step: how long each step takes, how long the page is frozen during it and how many
// shaders it builds. Run against a production build (vite preview), on either graphics path:
//
//   node tools/journey.mjs [--url=http://localhost:4173/] [--webgl] [--cpu=4] [--size=1280x720] [--json=out.json]
//        [--only=step,step] [--label=x]
//
// --webgl forces the WebGL 2 path (the path a page opened over plain http gets: the Windows laptop's). For each step:
//   wall      ms from the start of the step until the game draws smoothly again with everything on screen (or 15 s)
//   frozen    the longest single main-thread block (frame gap) during the step
//   long      main-thread tasks of 50 ms or more: count and total
//   progs     shader programs / render pipelines built during the step (three's info.memory.programs, WebGL) or
//             pipelines (WebGPU)
//   nodeMs    time inside three's node builder (TSL -> shader code) during the step, when measured
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const has = (k) => process.argv.includes(`--${k}`);
const url = arg('url', 'http://localhost:4173/');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const cpu = +arg('cpu', 1);
const webgl = has('webgl');
const only = arg('only', '') ? arg('only', '').split(',') : null;
const label = arg('label', webgl ? 'webgl2' : 'webgpu');

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const cdp = await ctx.newCDPSession(page);
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

// Installed before any page script: a frame-gap watcher, a long-task log and a counter of pipelines built.
if (has('keep')) await page.addInitScript(() => { window.__keep = true; });
await page.addInitScript(() => {
  const J = window.__J = { gaps: [], long: [], t0: performance.now() };
  let last = performance.now();
  // Per frame also: was the loading veil covering it, and was the picture half-built (an object skipped for want of shaders).
  const tick = () => {
    const n = performance.now(), el = document.getElementById('loading'), c = window.game?.gfx?.compiler;
    J.gaps.push([n, n - last, !!el && !el.classList.contains('gone'), !!c && !c.idle]);
    if (J.gaps.length > 20000) J.gaps.splice(0, 10000);
    last = n; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) J.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
});

const t0 = Date.now();
await page.goto(url + (webgl ? '?webgl' : ''), { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone') && window.game?.world, null, { timeout: 180000 });
const bootMs = Date.now() - t0;

// Counts pipelines on both backends: wrap the backend's createRenderPipeline (and createProgram on WebGL).
await page.evaluate(() => {
  const J = window.__J, r = window.game.renderer, b = r.backend;
  J.pipes = 0; J.nodeMs = 0; J.stages = 0;
  if (b.createProgram) { const f = b.createProgram; b.createProgram = function (...a) { J.stages++; return f.apply(this, a); }; }
  if (window.__keep) { const P = r._pipelines; P._releasePipeline = () => {}; P._releaseProgram = () => {}; }
  for (const k of ['createRenderPipeline', 'createComputePipeline']) {
    const f = b[k]; if (!f) continue;
    b[k] = function (...a) { J.pipes++; return f.apply(this, a); };
  }
  // The node builder: three's NodeBuilder.build is reached through renderer._nodes.getForRender.
  const nodes = r._nodes;
  if (nodes?.getForRender) {
    const f = nodes.getForRender;
    nodes.getForRender = function (...a) { const s = performance.now(); try { return f.apply(this, a); } finally { J.nodeMs += performance.now() - s; } };
  }
});

const boot = await page.evaluate(async () => {
  const J = window.__J;
  await new Promise((res) => { let ok = 0, last = performance.now(); const lim = last + 15000; const t = () => { const n = performance.now(), c = window.game.gfx.compiler; ok = n - last < 40 && c.idle ? ok + 1 : 0; last = n; if (ok >= 20 || n > lim) res(); else requestAnimationFrame(t); }; requestAnimationFrame(t); });
  const seen = J.gaps.filter((g) => !g[2] && window.game);
  const gaps = J.gaps.map((g) => g[1]);
  return { readyAt: Math.round(performance.now() - 20 * 16.7), seenStall: seen.filter((g) => g[1] > 50).length, seenHalf: seen.filter((g) => g[3]).length, worstGap: Math.max(...gaps), long: J.long.length, longMs: J.long.reduce((s, l) => s + l[1], 0), progs: window.game.renderer.info.memory?.programs ?? null, backend: window.game.gfx.backend, quality: window.game.gfx.quality };
});

// One step: run `fn` in the page, then wait until 20 frames in a row came within 40 ms (or 15 s), and report.
const profileOf = arg('profile', '');
async function step(name, fn, arg) {
  if (only && !only.some((o) => name.startsWith(o))) return null;
  const prof = profileOf && name.startsWith(profileOf);
  if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const r = await page.evaluate(async ({ src, arg }) => {
    const J = window.__J;
    const start = performance.now();
    const p0 = J.pipes, s0 = J.stages, n0 = J.nodeMs, prog0 = window.game.renderer.info.memory?.programs ?? 0;
    const f = new Function('return ' + src)();
    let note = null;
    try { note = await f(arg); } catch (e) { note = 'ERROR ' + (e?.message ?? e); }
    const called = performance.now() - start;
    // Settle: 20 consecutive frames under 40 ms with every object drawn (no shader still building, engine/compiler.js).
    await new Promise((res) => {
      let ok = 0, last = performance.now();
      const lim = performance.now() + 15000;
      const t = () => { const n = performance.now(); const c = window.game.gfx.compiler; ok = n - last < 40 && (!c || c.idle) ? ok + 1 : 0; last = n; if (ok >= 20 || n > lim) res(); else requestAnimationFrame(t); };
      requestAnimationFrame(t);
    });
    const end = performance.now() - 20 * 16.7;
    const fr = J.gaps.filter((g) => g[0] >= start), gaps = fr.map((g) => g[1]);
    // What the player saw: frames presented while the veil was not covering them, stalled (> 50 ms) or half-built.
    const seen = fr.filter((g) => !g[2]), lastCov = fr.filter((g) => g[2]).pop();
    const long = J.long.filter((l) => l[0] >= start - 1);
    return {
      wall: Math.round(end - start), call: Math.round(called), frozen: Math.round(Math.max(0, ...gaps)),
      over100: gaps.filter((g) => g > 100).length,
      seenStall: seen.filter((g) => g[1] > 50).length, seenHalf: seen.filter((g) => g[3]).length,
      playable: Math.round(Math.max(called, lastCov ? lastCov[0] - start : 0)),   // until the busy box or the veil goes
      long: long.length, longMs: Math.round(long.reduce((s, l) => s + l[1], 0)),
      pipes: J.pipes - p0, stages: J.stages - s0, progs: (window.game.renderer.info.memory?.programs ?? 0) - prog0, nodeMs: Math.round(J.nodeMs - n0),
      note: note == null ? null : String(note).slice(0, 80),
    };
  }, { src: fn.toString(), arg });
  if (prof) {
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map(), dt = profile.timeDeltas;
    const hits = new Map();
    profile.samples.forEach((id, i) => hits.set(id, (hits.get(id) ?? 0) + (dt[i] ?? 0)));
    // Self time by function, and inclusive time by function (each sample counted once per function on its stack).
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map();
    for (const [id, us] of hits) {
      const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + us);
      const seen = new Set();
      for (let x = id; x != null; x = parent.get(x)) {
        const cf = byId.get(x).callFrame, kk = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`;
        if (seen.has(kk)) continue; seen.add(kk);
        incl.set(kk, (incl.get(kk) ?? 0) + us);
      }
    }
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `    ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n');
    console.log('  self time:\n' + top(self, 25));
    console.log('  inclusive:\n' + top(incl, 45));
    fs.writeFileSync(`test-output/journey-${name.replace(/\W+/g, '_')}.cpuprofile`, JSON.stringify(profile));
  }
  console.log(`${name.padEnd(28)} wall ${String(r.wall).padStart(6)} ms · seen stalled ${r.seenStall} half-built ${r.seenHalf} · playable ${r.playable} ms · frozen ${String(r.frozen).padStart(5)} ms · >100ms frames ${String(r.over100).padStart(3)} · long ${r.long}/${r.longMs} ms · pipelines ${r.pipes} (new code ${r.stages}) · node build ${r.nodeMs} ms${r.note ? ' · ' + r.note : ''}`);
  return { name, ...r };
}

console.log(`# journey ${label} · ${boot.backend} · ${boot.quality} · cpu x${cpu} · ${W}x${H}`);
console.log(`boot                         ${bootMs} ms to the title, ${boot.readyAt} ms to smooth · seen stalled ${boot.seenStall} half-built ${boot.seenHalf} (worst frame ${Math.round(boot.worstGap)} ms, ${boot.long} long tasks ${Math.round(boot.longMs)} ms)`);
const out = [{ name: 'boot', seenStall: boot.seenStall, seenHalf: boot.seenHalf, wall: bootMs, frozen: Math.round(boot.worstGap), long: boot.long, longMs: Math.round(boot.longMs) }];
const push = (r) => { if (r) out.push(r); };

const sleep = (ms) => page.waitForTimeout(ms);
await sleep(1500);
push(await step('title idle', () => new Promise((r) => setTimeout(r, 1000))));
const steps = [
  ['start starter sandbox', async () => { await window.__ctx.start.sandbox('starter'); return Object.values(window.game.world.animals.by).flat().length + ' animals'; }],
  ['open the plant/animal panels', async () => { const S = window.__S; for (const t of ['animals', 'plants', 'build', 'care']) { try { S.tab && (S.tab.value = t); } catch { /* */ } await new Promise((r) => setTimeout(r, 120)); } return 'ok'; }],
];
for (const sp of ['neon', 'guppy', 'cory', 'loach', 'shrimp', 'crab', 'isopod', 'springtail', 'dartfrog', 'strawberry', 'toad', 'newt', 'firesal', 'axolotl', 'gecko', 'cardinal', 'ember', 'betta', 'oto', 'snail', 'leucomelas', 'auratus']) {
  steps.push(['add 3 ' + sp, async (id) => {
    const W = window.game.world, A = W.animals;
    const had = !!A.meshes?.[id] || (A.by[id]?.length ?? 0) > 0;
    let n = 0;
    for (let k = 0; k < 400 && n < 3; k++) {
      const p = W.randomSpot(() => true, 1);
      if (!p) continue;
      const r = A.placement(id, { point: p, surface: 'ground' });
      if (r?.pos && A.add(id, r.pos)) n++;
    }
    return `${n} added${had ? ' (species was present)' : ' (new species)'}`;
  }, sp]);
}
for (const pl of ['fernph', 'weed', 'fern', 'bilberry', 'grass', 'oldfern', 'bromeliad', 'pothos', 'cattail', 'bamboo', 'vallisneria', 'sword', 'javafern', 'frogbit', 'lily']) {
  steps.push(['plant 3 ' + pl, async (id) => {
    const W = window.game.world, P = W.plants;
    const had = P.count(id) > 0;
    let n = 0;
    for (let k = 0; k < 600 && n < 3; k++) {
      const p = W.randomSpot(() => true, 1);
      if (!p) continue;
      const s = W.water.surfaceAt(p.x, p.z);
      let ok = false;
      if (!P.canPlace(id, { point: p, surface: 'terrain' }, W)) ok = true;
      else if (s > -Infinity) { p.y = s; ok = !P.canPlace(id, { point: p, surface: 'water' }, W); }
      if (ok && P.add(id, p, { grown: 0.8, surface: p.y === s ? 'water' : 'terrain' })) n++;
    }
    return `${n} planted${had ? '' : ' (new kind)'}`;
  }, pl]);
}
for (const l of ['humidity', 'temperature', 'light', 'soil', 'flow', 'fertility', 'quality', 'stability', 'sediment', 'off']) {
  steps.push(['lens ' + l, async (n) => { window.__S.lens.value = n; await new Promise((r) => setTimeout(r, 300)); return 'ok'; }, l]);
}
steps.push(
  ['photo mode on', async () => { window.__S.photo.value = true; await new Promise((r) => setTimeout(r, 300)); return 'ok'; }],
  ['photo mode off', async () => { window.__S.photo.value = false; await new Promise((r) => setTimeout(r, 300)); return 'ok'; }],
  ['time-lapse 3 s', async () => { const g = window.game; g.lapse = 600; await new Promise((r) => setTimeout(r, 3000)); g.lapse = 0; return 'ok'; }],
  ['save', async () => { await window.__director.save(); return 'ok'; }],
  ['load (continue)', async () => { await window.__ctx.start.continue(); return 'ok'; }],
  ['career start', async () => { await window.__ctx.start.career(); return 'ok'; }],
);
for (const [id, tier] of [['cascade', 'standard'], ['suriname', 'standard'], ['blackwater', 'standard'], ['swamp', 'grand'], ['jar', 'jar']]) {
  steps.push(['preset ' + id + ' (' + tier + ')', async ([i, t]) => { await window.__ctx.start.preset(i, 7, t); const W = window.game.world; return `${Object.values(W.animals.by).flat().length} animals, ${W.plants.list.length} plants`; }, [id, tier]]);
}
steps.push(['back to starter', async () => { await window.__ctx.start.sandbox('starter'); return 'ok'; }]);

for (const [name, fn, a] of steps) push(await step(name, fn, a));

// Steady play on the last tank.
const steady = await page.evaluate(async () => {
  const g = []; let last = performance.now(); const end = last + 5000;
  await new Promise((res) => { const t = () => { const n = performance.now(); g.push(n - last); last = n; if (n > end) res(); else requestAnimationFrame(t); }; requestAnimationFrame(t); });
  g.sort((a, b) => a - b);
  const info = window.game.renderer.info.render;
  return { fps: +(1000 * g.length / g.reduce((s, x) => s + x, 0)).toFixed(1), p95: +g[Math.floor(g.length * 0.95)].toFixed(1), calls: info.drawCalls, tris: info.triangles, progs: window.game.renderer.info.memory?.programs };
});
console.log('steady play', JSON.stringify(steady));
const tot = out.slice(1).reduce((s, r) => ({ wall: s.wall + r.wall, long: s.longMs + r.longMs, pipes: s.pipes + (r.pipes ?? 0) }), { wall: 0, longMs: 0, pipes: 0 });
const worst = [...out].sort((a, b) => b.frozen - a.frozen).slice(0, 8);
console.log('\nworst freezes:'); for (const r of worst) console.log(`  ${String(r.frozen).padStart(6)} ms  ${r.name}${r.pipes ? ' (' + r.pipes + ' pipelines)' : ''}`);
if (errors.length) console.log('\npage errors:\n  ' + [...new Set(errors)].slice(0, 10).join('\n  '));
const json = arg('json', '');
if (json) fs.writeFileSync(json, JSON.stringify({ label, webgl, cpu, size: [W, H], steps: out, steady, errors }, null, 1));
await browser.close();
