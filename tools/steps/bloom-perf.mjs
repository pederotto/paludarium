// Frame cost with flowers on: the starter tank with six water lilies in the pool, all in flower (in builds with a bloom
// cycle; before it, the lily's fixed bud), the sim running at 1x, a fixed view over the pool. Prints frame rate and
// percentiles, the game's own frame time and main-thread time, draw calls, triangles, the time Plants.step takes a frame and
// the flower heads drawn. Compare builds interleaved (A B B A) against `vite preview`:
//   node tools/shot.mjs --steps=tools/steps/bloom-perf.mjs --only=desktop --url=http://127.0.0.1:4491/ [--query=?webgl]
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const g = window.game, W = g.world, V = W.plants.list[0].pos.constructor;
    const spots = [[-24, 6], [-14, 12], [-4, 4], [8, 12], [18, 4], [30, 10]];
    for (const [x, z] of spots) {
      const p = W.plants.add('lily', new V(x, W.water.level, z), { grown: 1, scale: 1, rot: x });
      if (p?.bloom) { p.bloom.stage = 'open'; p.bloom.t = 0.5; p._look = null; }
    }
    W.plants.flowerDirty?.('lily');
    W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 720;
    g.setSpeed(1);
    g.rig.stopOrbit(); g.rig.moved = true;
    g.controls.setLookAt(0, 34, 58, 0, 10, 4, false);
    // time Plants.step
    const P = W.plants, step = P.step.bind(P);
    window.__ps = { ms: 0, n: 0 };
    P.step = (...a) => { const t = performance.now(); const r = step(...a); window.__ps.ms += performance.now() - t; window.__ps.n++; return r; };
  });
  await page.waitForTimeout(8000);
  await shot('bloom-perf');
  const fr = await page.evaluate(async (secs) => {
    const g = window.game, info = g.renderer.info;
    window.__ps.ms = 0; window.__ps.n = 0;
    const dts = [], cpu = [], gfx = []; let last = performance.now(); const t0 = last;
    await new Promise((res) => { const f = (t) => { dts.push(t - last); last = t; cpu.push(g.gfx.cpuMs ?? 0); gfx.push(g.gfx?.stats?.frameMs ?? 0); if (t - t0 > secs * 1000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    dts.shift(); dts.sort((a, b) => a - b);
    const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(p * dts.length))].toFixed(1);
    const avg = (a) => +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2);
    const total = dts.reduce((a, b) => a + b, 0);
    let heads = 0;
    for (const fm of Object.values(g.world.plants.flowers ?? {})) heads += fm.n;
    return {
      fps: +(dts.length / (total / 1000)).toFixed(1), p50: q(0.5), p95: q(0.95), worst: q(1), cpuMs: avg(cpu), gfxFrameMs: avg(gfx),
      plantsStepMs: +(window.__ps.ms / Math.max(1, window.__ps.n)).toFixed(3), calls: info.render.drawCalls, tris: info.render.triangles,
      pr: +g.renderer.getPixelRatio().toFixed(2), backend: g.gfx?.backend, quality: g.gfx?.quality, heads,
    };
  }, +(process.env.SECS ?? 8));
  console.log('frames', JSON.stringify(fr));
  // Plants.step on its own (paused, 3000 steps of one game second), and what the flowers add to the scene.
  const st = await page.evaluate(() => {
    const g = window.game, W = g.world, P = W.plants;
    g.setSpeed(0);
    const step = Object.getPrototypeOf(P).step.bind(P);
    for (let i = 0; i < 300; i++) step(1 / 60, W.env, W);
    const t = performance.now();
    for (let i = 0; i < 3000; i++) step(1 / 60, W.env, W);
    const ms = (performance.now() - t) / 3000;
    const fl = []; g.scene.traverse((o) => { if (o.name?.startsWith('flower:')) fl.push({ name: o.name, visible: o.visible, castShadow: o.castShadow, n: o.geometry.instanceCount, vbuf: Object.keys(o.geometry.attributes).length, tris: o.geometry.attributes.position.count / 3 }); });
    return { plantsStepMs: +ms.toFixed(4), plants: P.list.length, flowerMeshes: fl };
  });
  console.log('step', JSON.stringify(st));
};
