// Frame cost of the four orchids with their LIVE flowers open (the real flower renderer, not previewGeometry): the starter paludarium with
// none (A) and with THREE of each orchid on land in front of a close camera (B, twelve plants), interleaved A B B A A B B A. Run it on the
// tree under test and on the base tree, each against its own dev server, and compare the cost B - A of each (the machine's drift cancels
// inside a run). Prints per run the median frame interval, the main thread's time per frame and the GPU latency, then the A / B medians.
//   node tools/shot.mjs --url=http://127.0.0.1:PORT/ --only=desktop --steps=tools/steps/orchid-perf.mjs --query="?fixedres&perf" [&webgl]
//   SECS=4   IDS=pleurothallis,masdevallia,dracula,cuthbertsonii   N=3 (plants of each)
// Stamp: STAMP orchid-perf <git sha[-dirty] of the cwd tree> <backend> <plants> <heads drawn>
import { execSync } from 'node:child_process';
const sha = () => { try { const r = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); return r('git rev-parse --short HEAD') + (r('git status --porcelain --untracked-files=no') ? '-dirty' : ''); } catch { return 'no-git'; } };
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const secs = +(process.env.SECS ?? 4), ids = (process.env.IDS || 'pleurothallis,masdevallia,dracula,cuthbertsonii').split(','), per = +(process.env.N ?? 3);
  await page.evaluate(() => {
    const g = window.game, W = g.world;
    g.setSpeed(0);
    W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 11 * 60;
    for (let t = 0; t < 10; t++) W.sim.step(1);
  });
  const set = (on) => page.evaluate(async ({ on, ids, per }) => {
    const { PLANTS } = await import('/src/sim/plants.js');
    const g = window.game, W = g.world;
    window.__op ??= [];
    if (!on) { for (const p of window.__op) W.plants.remove(p); window.__op = []; return { plants: 0, drawn: 0 }; }
    if (window.__op.length) return { plants: window.__op.length, drawn: 0 };
    const V3 = g.camera.position.constructor, spots = [];
    for (let x = -34; x <= 34; x += 2) for (let z = 18; z >= -8; z -= 2) {
      const y = W.terrain.heightAt(x, z), s = W.water.surfaceAt(x, z);
      if (s !== -Infinity && s > y - 1) continue;
      spots.push({ x, y, z, k: Math.abs(x) * 0.5 + Math.abs(z - 12) * 1.2 });
    }
    spots.sort((a, b) => a.k - b.k);
    const used = [];
    for (const id of ids) for (let n = 0; n < per; n++) {
      const sp = spots.find((s) => used.every((u) => Math.hypot(u.x - s.x, u.z - s.z) >= 5));
      if (!sp) continue; used.push(sp);
      const P = W.plants.add(id, new V3(sp.x, sp.y, sp.z), { grown: 1, scale: 1, rot: n * 2.1 });
      if (!P) continue;
      P.reach = 0; W.plants.writeInstance(P);
      if (PLANTS[id].flower) { P.bloom = { stage: 'open', t: 0.5, palette: n % PLANTS[id].flower.palettes.length, j: 0.5, k: 1, why: null }; W.plants.live = true; W.plants._dirty?.add(P.id); }
      window.__op.push(P);
    }
    for (let t = 0; t < 3; t++) W.sim.step(1);
    for (const P of window.__op) { if (P.bloom) P.bloom.stage = 'open'; W.plants.flowerDirty(P.id); }
    W.plants.flushFlowers();
    const drawn = ids.reduce((n, id) => n + (W.plants.flowers?.[id]?.n ?? 0), 0);
    g.rig.stopOrbit(); g.rig.moved = true;
    const cx = used.reduce((a, u) => a + u.x, 0) / Math.max(1, used.length), cy = used.reduce((a, u) => a + u.y, 0) / Math.max(1, used.length), cz = used.reduce((a, u) => a + u.z, 0) / Math.max(1, used.length);
    g.controls.setLookAt(cx, cy + 14, cz + 34, cx, cy + 4, cz, false);
    return { plants: window.__op.length, drawn, spots: spots.length };
  }, { on, ids, per });
  const measure = () => page.evaluate((secs) => new Promise((res) => {
    const g = window.game, dts = [], gpu = [], cpu = [];
    const hook = g.gfx.governor?.gpu?.bind(g.gfx.governor);
    if (g.gfx.governor && hook) g.gfx.governor.gpu = (ms) => { gpu.push(ms); return hook(ms); };
    let last = performance.now(); const t0 = last;
    const tick = (t) => {
      dts.push(t - last); last = t;
      if (g.gfx.cpuMs > 0) cpu.push(g.gfx.cpuMs);
      if (t - t0 < secs * 1000) requestAnimationFrame(tick);
      else {
        const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(2) : null; };
        if (hook) g.gfx.governor.gpu = hook;
        res({ frames: dts.length, frameMs: med(dts.slice(5)), cpuMs: med(cpu.slice(5)), gpuMs: med(gpu.slice(2)), backend: g.renderer?.backend?.isWebGLBackend ? 'webgl2' : 'webgpu' });
      }
    };
    requestAnimationFrame(tick);
  }), secs);
  const tree = sha(), out = [];
  for (const on of [false, true, true, false, false, true, true, false]) {
    const s = await set(on);
    await page.waitForTimeout(2500);                  // the new meshes' shaders compile in the background
    const m = await measure();
    out.push({ run: on ? 'B' : 'A', ...s, ...m });
    console.log(JSON.stringify(out[out.length - 1]));
  }
  const agg = (r, k) => { const v = out.filter((o) => o.run === r && o[k] != null).map((o) => o[k]).sort((a, b) => a - b); return v.length ? +((v[1] + v[2]) / 2).toFixed(2) : null; };
  const b = out.find((o) => o.run === 'B');
  console.log('STAMP orchid-perf', tree, b.backend, 'plants', b.plants, 'heads drawn', out.filter((o) => o.run === 'B').map((o) => o.drawn).join('/'));
  console.log('A (none) frame', agg('A', 'frameMs'), 'cpu', agg('A', 'cpuMs'), 'gpu', agg('A', 'gpuMs'), '| B (orchids) frame', agg('B', 'frameMs'), 'cpu', agg('B', 'cpuMs'), 'gpu', agg('B', 'gpuMs'));
  await set(true);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(800);
  await shot('orchid-perf-view');
};
