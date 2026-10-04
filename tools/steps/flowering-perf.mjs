// Frame cost of the flowering plants (sim/flowering.js): the starter paludarium with none of them (A) and with one of each
// flowering species on land in view (B, eleven plants drawn with every flower head open, flowering.previewGeometry, which is
// about what the bloom renderer will add), interleaved A B B A A B B A. Prints per run the median frame interval, the main
// thread's time per frame (gfx.cpuMs) and the GPU latency the
// governor sees (engine/gpulatency.js), and the triangles the added plants draw.
// Dev server only (imports /src modules); use the governor-free query so the resolution stays put:
//   node tools/shot.mjs --url=http://127.0.0.1:4492/ --only=desktop --steps=tools/steps/flowering-perf.mjs --query="?fixedres&perf"
//   (add &webgl for the WebGL 2 path)   SECS=4
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const secs = +(process.env.SECS ?? 4);
  await page.evaluate(() => {
    const g = window.game, W = g.world;
    g.setSpeed(0);
    W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 11 * 60;
    for (let t = 0; t < 10; t++) W.sim.step(1);           // the lamps follow the clock (the game starts at the real time of day)
    g.rig.stopOrbit(); g.rig.moved = true;
    g.controls.setLookAt(0, 26, 70, 0, 12, 0, false);
  });
  const set = (on) => page.evaluate(async (on) => {
    const { PLANTS } = await import('/src/sim/plants.js');
    const { FLOWERING, previewGeometry } = await import('/src/sim/flowering.js');
    const g = window.game, W = g.world;
    window.__fl ??= [];
    if (!on) { for (const p of window.__fl) W.plants.remove(p); window.__fl = []; return 0; }
    if (window.__fl.length) return window.__fl.length;
    const V3 = W.plants.meshes.bromeliad.position.constructor, ids = Object.keys(FLOWERING);
    let k = 0;
    for (let x = -36; x <= 36 && k < ids.length; x += 3) for (let z = 14; z >= -10 && k < ids.length; z -= 4) {
      const y = W.terrain.heightAt(x, z), s = W.water.surfaceAt(x, z);
      if (s !== -Infinity && s > y - 1) continue;
      if (window.__fl.some((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < 7)) continue;
      const id = ids[k++], im = W.plants.meshes[id];
      if (!im.userData.preview) { im.geometry = previewGeometry(PLANTS[id], { palette: 0 }); im.userData.preview = true; }
      window.__fl.push(W.plants.add(id, new V3(x, y, z), { grown: 1, scale: 1, rot: Math.random() * 6 }));
    }
    return window.__fl.length;
  }, on);
  const measure = () => page.evaluate((secs) => new Promise((res) => {
    const W = window.game.world;
    const g = window.game, dts = [], gpu = [], cpu = [];
    const hook = g.gfx.governor?.gpu?.bind(g.gfx.governor);
    if (g.gfx.governor && hook) g.gfx.governor.gpu = (ms) => { gpu.push(ms); return hook(ms); };
    let last = performance.now();
    const t0 = last;
    const tick = (t) => {
      dts.push(t - last); last = t;
      if (g.gfx.cpuMs > 0) cpu.push(g.gfx.cpuMs);
      if (t - t0 < secs * 1000) requestAnimationFrame(tick);
      else {
        const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(2) : null; };
        if (hook) g.gfx.governor.gpu = hook;
        const tris = window.__fl.reduce((n, p) => n + W.plants.meshes[W.plants.key(p)].geometry.attributes.position.count / 3, 0);
        res({ frames: dts.length, frameMs: med(dts.slice(5)), cpuMs: med(cpu.slice(5)), gpuMs: med(gpu.slice(2)), addedTris: tris });
      }
    };
    requestAnimationFrame(tick);
  }), secs);
  const out = [];
  for (const on of [false, true, true, false, false, true, true, false]) {
    const n = await set(on);
    await page.waitForTimeout(1500);                  // the new meshes' shaders compile in the background
    const m = await measure();
    out.push({ run: on ? 'B' : 'A', plants: n, ...m });
    console.log(JSON.stringify(out[out.length - 1]));
  }
  const agg = (r, k) => { const v = out.filter((o) => o.run === r && o[k] != null).map((o) => o[k]).sort((a, b) => a - b); return v.length ? +((v[1] + v[2]) / 2).toFixed(2) : null; };
  console.log('A (none) frame', agg('A', 'frameMs'), 'cpu', agg('A', 'cpuMs'), 'gpu', agg('A', 'gpuMs'), '| B (11 flowering) frame', agg('B', 'frameMs'), 'cpu', agg('B', 'cpuMs'), 'gpu', agg('B', 'gpuMs'));
  await set(true);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(800);
  await shot('flowering-perf-view');
};
