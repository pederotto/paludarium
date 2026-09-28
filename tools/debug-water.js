// Used by `node tools/test.cjs --script=tools/debug-water.js`: drops a big
// ripple, then reports the ripple and caustics textures' ranges and where the
// waterfalls run.
(async () => {
  const w = window.paludarium, fx = w.fx, r = fx.renderer;
  const half = (h) => { const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF; return (s ? -1 : 1) * (e === 0 ? Math.pow(2, -14) * (f / 1024) : Math.pow(2, e - 15) * (1 + f / 1024)); };
  const range = (px) => { let mn = Infinity, mx = -Infinity, s = 0, n = 0; for (let i = 0; i < px.length; i += 4) { const v = px instanceof Uint16Array ? half(px[i]) : px[i]; mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; n++; } return `min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${(s / n).toFixed(3)}`; };
  fx.addDrop(10, 5, 40, 2);
  for (let k = 0; k < 6; k++) fx.step();
  const rp = await r.readRenderTargetPixelsAsync(fx.rt[0], 0, 0, 256, 128);
  const cp = await r.readRenderTargetPixelsAsync(fx.causRT, 0, 0, 512, 256);
  const falls = w.water.falls.map((f) => `${f.pts.length} pts ${f.pts[0].toArray().map((v) => v.toFixed(1))} → ${f.pts.at(-1).toArray().map((v) => v.toFixed(1))}`);
  console.warn(`RIP\nripple ${range(rp)}\ncaustics ${range(cp)}\nfalls ${falls.join(' | ')}\nanimals ${Object.entries(w.animals.by).map(([k, v]) => k + ':' + v.length).join(' ')}`);
})();
