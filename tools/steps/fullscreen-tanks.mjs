// New tank sizes: build each with a generated preset, check camera fit (screenshot) and frame time; also a custom size.
export default async (page, shot, name) => {
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  const ids = ['cube', 'tall', 'long', 'wide', 'show', 'standard', 'custom'];
  for (const id of ids) {
    const info = await page.evaluate(async (id) => {
      const gen = await import('/src/sim/generator.js');
      const tk = await import('/src/content/tanks.js');
      if (id === 'custom') tk.setCustomTank(100, 50, 60);
      const g = window.game;
      const w = await g.loadTank(id, { layout: 'empty' });
      gen.generateTerrarium(w, { preset: 'cascade', seed: 3, tier: id });
      g.rig.view('front', false);
      const T = tk.TANKS[id];
      await new Promise((r) => setTimeout(r, 2500));
      const t0 = performance.now(); let n = 0;
      await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 > 3000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      return { id, size: [T.w, T.d, T.h], cpc: T.cellsPerCm, fps: +(n / 3).toFixed(1), frameMs: g.gfx.stats.frameMs, animals: Object.values(w.animals.by).reduce((s, a) => s + a.length, 0) };
    }, id);
    console.log(name, JSON.stringify(info));
    if (['show', 'tall', 'cube', 'custom'].includes(id)) await shot('tank-' + id);
  }
};
