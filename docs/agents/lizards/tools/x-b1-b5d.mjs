// X-B1 / B5d: X-ray and Surface shots of the starter tank as a false bottom and as plain substrate, with belowGround numbers.
import path from 'node:path';
import { start, grid, OUT } from './x-b1-lib.mjs';
export default async (page, shot, name) => {
  await start(page, /starter paludarium/i);
  const items = [];
  for (const [label, v] of [['false bottom', 1], ['plain substrate', 0]]) {
    const info = await page.evaluate(async (v) => { const { belowGround } = await import('/src/sim/plenum.js'); const g = window.game, W = g.world, E = W.env, T = W.terrain; E.drainage = v; E.plenumLevel = undefined; E.groundLevel = undefined; if (v >= 1) E.plenumH = Math.round((W.water.level + 1) * 2) / 2; W.sim.step(10); g.layers.set('xray'); const b = belowGround(E, W.water.level); let lo = 1e9, hi = -1e9, under = 0, n = 0; for (let x = -40; x <= 40; x += 4) for (let z = -18; z <= 18; z += 4) { const h = T.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); n++; if (h < b.level) under++; } return `mode=${b.mode} level=${b.level.toFixed(2)} L=${b.L.toFixed(1)} layerH=${b.layerH} pool=${W.water.level.toFixed(2)} plenumH=${E.plenumH} ground ${lo.toFixed(1)}..${hi.toFixed(1)}, ${under}/${n} sample cells below the level`; }, v);
    console.log('B5d', label, info);
    await page.waitForTimeout(2500); items.push([await page.screenshot(), 'X-ray: ' + label]); await shot('b5d-xray-' + (v ? 'fb' : 'plain'));
    await page.evaluate(() => window.game.layers.set('surface')); await page.waitForTimeout(2000); items.push([await page.screenshot(), 'Surface: ' + label]); await shot('b5d-surface-' + (v ? 'fb' : 'plain'));
  }
  await grid(page, [items[0], items[2], items[1], items[3]], 2, 640, path.join(OUT, 'b5d-grid.png'));
};
