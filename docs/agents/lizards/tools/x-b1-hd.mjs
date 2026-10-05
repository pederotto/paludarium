// X-B1 / B5b: is the pool part of hydro d? plantFlow gates on H.d >= 0.3.
import { start } from './x-b1-lib.mjs';
export default async (page) => {
  await start(page, /starter paludarium/i);
  console.log('HD', await page.evaluate(async () => {
    const { poolCurrent } = await import('/src/sim/filterflow.js');
    const W = window.game.world, H = W.water.hydro, T = W.terrain; let pool = 0, wet = 0, sum = 0;
    for (let x = -44; x <= 44; x += 2) for (let z = -21; z <= 21; z += 2) { const g = T.heightAt(x, z); if (W.water.surfaceAt(x, z) - g > 1) { pool++; const d = H.d[H.cellOf(x, z)]; sum += d; if (d >= 0.3) wet++; } }
    const pl = []; for (const p of W.plants.list) { if (!W.plants.meshes[W.plants.key(p)]?.geometry.attributes.flow) continue; const c = H.cellOf(p.pos.x, p.pos.z), pc = poolCurrent(H, p.pos.x, p.pos.y + 1, p.pos.z, { x: 0, y: 0, z: 0 }); pl.push(`${p.sp ?? p.type}@${p.pos.x.toFixed(0)},${p.pos.z.toFixed(0)} under=${(W.water.surfaceAt(p.pos.x, p.pos.z) - p.pos.y).toFixed(1)} d=${H.d[c].toFixed(2)} jet=${Math.hypot(pc.x, pc.z).toFixed(2)}`); }
    return `pool samples ${pool}, with H.d>=0.3: ${wet}, mean H.d ${(sum / Math.max(1, pool)).toFixed(2)} | ${pl.slice(0, 14).join(' ; ')}`;
  }));
};
