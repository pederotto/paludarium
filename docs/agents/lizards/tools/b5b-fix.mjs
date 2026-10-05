// B5b-fix: __AIR.probe on a POOL plant near the filter return (on vs off), a row of vallisneria in the pool down the return's axis,
// flowDepth by species, two crops of the same pool plants with the filter on and off (test-output/plants/). Numbers only, by design.
// Run: node tools/shot.mjs --only=desktop --steps=docs/agents/lizards/tools/b5b-fix.mjs
import fs from 'node:fs';
import { start } from './x-b1-lib.mjs';
const OUT = 'test-output/plants';
export default async (page) => {
  fs.mkdirSync(OUT, { recursive: true });
  await start(page, /starter paludarium/i);
  const pre = await page.evaluate(() => {
    const W = window.game.world, H = W.water.hydro, P = W.plants, T = W.terrain, r = H.ports?.ret;
    const out = { filter: W.env.filter, lph: H.ports?.lph, ret: r && [r.x, r.y, r.z, r.dx, r.dz].map((v) => +(+v).toFixed(2)), level: +W.water.level.toFixed(2) };
    try { out.probe = window.__AIR.probe('vallisneria'); } catch (e) { out.probe = 'throw ' + e.message; }
    window.__row = [];
    if (r) for (let d = 4; d <= 24; d += 4) {
      const x = r.x + r.dx * d, z = r.z + r.dz * d;
      if (!H.res[H.cellOf(x, z)] || !(W.water.surfaceAt(x, z, 0.3) > T.heightAt(x, z) + 1)) continue;
      const p = P.add('vallisneria', P.list[0].pos.clone().set(x, T.heightAt(x, z), z), { grown: 1, rot: 0.9 });
      if (p) window.__row.push({ d, p });
    }
    window.__readRow = () => {
      const P = window.game.world.plants, r = window.game.world.water.hydro.ports.ret;
      return window.__row.map(({ d, p }) => {
        const im = P.meshes[P.key(p)], f = im.geometry.attributes.flow.array, o = p.index * 4, wv = p.pos.clone().set(f[o + 2], 0, f[o + 3]).applyQuaternion(p._q);
        const sp = Math.hypot(wv.x, wv.z), l = Math.tanh(Math.atanh(0.5) * sp / 4), lean = Math.atan2(0.4 * l, 1 - 0.2 * l * l) * 180 / Math.PI;
        const ax = sp > 1e-4 ? Math.acos(Math.max(-1, Math.min(1, (wv.x * r.dx + wv.z * r.dz) / (sp * Math.hypot(r.dx, r.dz))))) * 180 / Math.PI : null;
        return { d, sp: +sp.toFixed(2), axisDeg: ax == null ? null : +ax.toFixed(1), leanDeg: +lean.toFixed(1), dep: +im.geometry.attributes.flowDepth.array[p.index].toFixed(2) };
      });
    };
    return out;
  });
  console.log('B5b-fix pre', JSON.stringify(pre));
  await page.waitForTimeout(3000);
  const on = await page.evaluate(() => window.__readRow());
  console.log('B5b-fix row ON ', JSON.stringify(on));
  console.log('B5b-fix flowDepth>0 by species', await page.evaluate(() => { const P = window.game.world.plants, o = {}; for (const p of P.list) { const a = P.meshes[P.key(p)]?.geometry.attributes.flowDepth; if (!a) continue; const k = p.sp?.id ?? p.id ?? p.type ?? '?'; o[k] ??= [0, 0]; o[k][a.array[p.index] > 0 ? 0 : 1]++; } return Object.entries(o).map(([k, [w, d]]) => `${k}:${w}wet/${d}dry`).join(' '); }));
  const s = await page.evaluate(() => { const g = window.game, r = g.world.water.hydro.ports.ret, v = g.camera.position.clone().set(r.x + r.dx * 12, r.y, r.z + r.dz * 12).project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  const clip = { x: Math.max(0, Math.min(640, s.x - 320)), y: Math.max(0, Math.min(360, s.y - 180)), width: 640, height: 360 };
  await page.screenshot({ clip, path: `${OUT}/pool-filter-on.png` });
  await page.evaluate(() => { window.game.world.env.filter = false; });
  await page.waitForTimeout(9000);
  const off = await page.evaluate(() => ({ lph: window.game.world.water.hydro.ports?.lph, row: window.__readRow() }));
  console.log('B5b-fix row OFF', JSON.stringify(off));
  await page.screenshot({ clip, path: `${OUT}/pool-filter-off.png` });
  const dl = on.map((a, i) => +(a.leanDeg - (off.row[i]?.leanDeg ?? NaN)).toFixed(1));
  console.log('B5b-fix lean on-off deg per row plant', JSON.stringify(dl), 'clip', JSON.stringify(clip));
  console.log('B5b-fix cost', await page.evaluate(() => { const p = window.__AIR.probe('vallisneria'); return JSON.stringify({ plants: p.plants, frames: p.frames, calls: p.calls, msPerCall: p.msPerCall, msPerFrame: p.msPerFrame, maxMs: p.maxMs }); }));
};
