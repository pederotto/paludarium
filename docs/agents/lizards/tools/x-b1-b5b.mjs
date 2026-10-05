// X-B1 / B5b: __AIR.probe, a row of vallisneria downstream of the filter return, jitter, flowDepth per species, filter on/off shots.
import path from 'node:path';
import { start, grid, OUT } from './x-b1-lib.mjs';
export default async (page, shot, name) => {
  await start(page, /starter paludarium/i);
  const pre = await page.evaluate(() => {
    const g = window.game, W = g.world, E = W.env, H = W.water?.hydro, P = W.plants, T = W.terrain, r = H?.ports?.ret;
    const out = { filter: E.filter, kind: E.filterKind, lph: H?.ports?.lph, ret: r ? [r.x, r.y, r.z, r.dx, r.dz].map((v) => +(+v).toFixed(2)) : null, wl: +W.water.level.toFixed(2), plants: P.list.length };
    try { const p = window.__AIR?.probe ? window.__AIR.probe('vallisneria') : null; out.probe = p ? { src: p.src, errDeg: p.errDeg, speed: p.speed, expected: p.expected, flowWorld: p.flowWorld, depth: p.depth, error: p.error, msPerFrame: p.msPerFrame, maxMs: p.maxMs, plants: p.plants } : 'no __AIR.probe'; } catch (e) { out.probe = 'throw ' + e.message; }
    window.__row = [];
    if (r) { const ref = P.list[0].pos; for (const d of [3, 7, 12, 18, 26, 36]) { const x = r.x + r.dx * d, z = r.z + r.dz * d; if (H.d[H.cellOf(x, z)] < 0.3) { window.__row.push({ d, dry: true }); continue; } window.__row.push({ d, p: P.add('vallisneria', ref.clone().set(x, T.heightAt(x, z), z), { grown: 1, rot: 0.9 }) }); } }
    window.__readRow = () => { const W = window.game.world, H = W.water.hydro, P = W.plants; return window.__row.map(({ d, dry, p }) => { if (dry) return `${d}:dry`; if (!p) return `${d}:notplanted`; const im = P.meshes[P.key(p)], f = im?.geometry.attributes.flow; if (!f) return `${d}:noattr`; const o = p.index * 4, fd = im.geometry.attributes.flowDepth?.array[p.index], c = H.cellOf(p.pos.x, p.pos.z), ex = H.vx[c], ez = H.vz[c]; const wv = p.pos.clone().set(f.array[o + 2], 0, f.array[o + 3]).applyQuaternion(p._q); const sp = Math.hypot(wv.x, wv.z), se = Math.hypot(ex, ez); const err = sp > 1e-4 && se > 1e-4 ? Math.acos(Math.max(-1, Math.min(1, (wv.x * ex + wv.z * ez) / (sp * se)))) * 180 / Math.PI : null; return `${d}cm sp=${sp.toFixed(2)} field=${se.toFixed(2)} err=${err == null ? '-' : err.toFixed(0)} dep=${fd == null ? '-' : fd.toFixed(1)} ang=${(Math.atan2(wv.z, wv.x) * 180 / Math.PI).toFixed(0)}`; }).join(' | '); };
    return out;
  });
  console.log('B5b pre', JSON.stringify(pre));
  await page.waitForTimeout(3000);
  console.log('B5b on ', await page.evaluate(() => window.__readRow()));
  console.log('B5b jitter nearest row plant 15x0.2s', await page.evaluate(async () => { const s = []; for (let k = 0; k < 15; k++) { s.push(window.__readRow().split(' | ').find((t) => / sp=/.test(t)) ?? ''); await new Promise((r) => setTimeout(r, 200)); } const ang = s.map((t) => +(t.match(/ang=(-?\d+)/)?.[1] ?? NaN)), sp = s.map((t) => +(t.match(/sp=([\d.]+)/)?.[1] ?? NaN)); return `ang ${Math.min(...ang)}..${Math.max(...ang)} sp ${Math.min(...sp)}..${Math.max(...sp)}`; }));
  console.log('B5b flowDepth by species', await page.evaluate(() => { const P = window.game.world.plants, o = {}; for (const p of P.list) { const a = P.meshes[P.key(p)]?.geometry.attributes.flowDepth; if (!a) continue; const k = p.sp ?? p.type ?? p.id ?? '?'; (o[k] ??= []).push(+a.array[p.index].toFixed(1)); } return Object.entries(o).map(([k, v]) => `${k}:${v.slice(0, 5).join('/')}`).join(' '); }));
  console.log('B5b camera', await page.evaluate(() => { const g = window.game, r = g.world.water.hydro?.ports?.ret; if (!r) return 'no ret'; const f = Object.keys(g).filter((k) => g[k] && typeof g[k] === 'object' && g[k].target?.isVector3); if (!f.length) return 'no rig with .target'; const c = g[f[0]], cam = g.camera, t = cam.position.clone().set(r.x + r.dx * 12, r.y - 2, r.z + r.dz * 12), off = cam.position.clone().sub(c.target).multiplyScalar(0.4); c.target.copy(t); cam.position.copy(t).add(off); c.update?.(); return 'moved rig ' + f.join(','); }));
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => { const g = window.game, r = g.world.water.hydro.ports.ret, v = g.camera.position.clone().set(r.x + r.dx * 12, r.y, r.z + r.dz * 12).project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  const clip = { x: Math.max(0, Math.min(640, s.x - 320)), y: Math.max(0, Math.min(360, s.y - 180)), width: 640, height: 360 };
  const on = await page.screenshot({ clip }); await shot('b5b-on');
  await page.evaluate(() => { window.game.world.env.filter = false; });
  await page.waitForTimeout(9000);
  console.log('B5b off', await page.evaluate(() => `lph=${window.game.world.water.hydro.ports?.lph} ` + window.__readRow()));
  const off = await page.screenshot({ clip }); await shot('b5b-off');
  await grid(page, [[on, 'filter ON'], [off, 'filter OFF']], 2, 640, path.join(OUT, 'b5b-onoff.png'));
};
