// Frame time and draw statistics for the starter tank, a grand generated swamp and a time-lapse, at the harness's viewport.
export default async (page, shot, name) => {
  const measure = async (label) => {
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async () => {
      const g = window.game, info = g.renderer.info;
      const samples = [];
      let n = 0; const t0 = performance.now();
      await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 > 4000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const secs = (performance.now() - t0) / 1000;
      return { fps: +(n / secs).toFixed(1), frameMs: g.gfx.stats.frameMs, adapt: g.gfx.stats.adapt ?? g.gfx.stats.scale, calls: info.render.calls, tris: info.render.triangles, pr: +g.renderer.getPixelRatio().toFixed(2), animals: Object.values(g.world.animals.by).reduce((s, a) => s + a.length, 0) };
    });
    console.log(name, label, JSON.stringify(r));
  };
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await measure('starter');
  await page.evaluate(async () => { const { startTimelapse } = await import('/src/app/timelapse.js'); startTimelapse(30); });
  await measure('timelapse');
};
