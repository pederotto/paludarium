// Insects and crustaceans in the running game: for each group, a handful of animals put side by side in a generated tank (land
// or water as they need), the clock running, and a strip of frames from close up. Writes test-output/bugs/<group>.png.
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/bugs-look.mjs --wait=2500 --url=http://localhost:5173/
//   BUGS=isopods,shrimp,springtails,flies,crickets,dubia,crabs  BUGS_FRAMES=6  BUGS_DT=400 (ms between frames)
import fs from 'node:fs';
import sharp from 'sharp';

const GROUPS = {
  isopods: { where: 'land', mix: { isopod: 5, purpleiso: 4, pandaking: 3 }, dist: 9, threat: 'pandaking' },
  shrimp: { where: 'water', mix: { shrimp: 6, blueshrimp: 5 }, dist: 10 },
  springtails: { where: 'land', mix: { springtail: 8, springpink: 6 }, dist: 6 },
  flies: { where: 'land', mix: { fly: 10 }, dist: 7 },
  crickets: { where: 'land', mix: { cricket: 4 }, dist: 12 },
  dubia: { where: 'land', mix: { dubia: 4 }, dist: 12 },
  crabs: { where: 'land', mix: { crab: 2, panther: 1 }, dist: 22 },
};

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(300000);
  const list = (process.env.BUGS ?? Object.keys(GROUPS).join(',')).split(',');
  const frames = +(process.env.BUGS_FRAMES ?? 6), gap = +(process.env.BUGS_DT ?? 400);
  fs.mkdirSync('test-output/bugs', { recursive: true });
  await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const w = await window.game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'suriname', seed: 5, tier: 'standard' });
    w.animals.syncOccupancy(true);
    const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden';
  });
  for (const g of list) {
    const G = GROUPS[g];
    if (!G) continue;
    const ok = await page.evaluate(({ G }) => {
      const game = window.game, W = game.world, A = W.animals, T = W.terrain;
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      // A flat-ish open spot of the right kind near the front of the tank.
      let best = null, bs = -1e9;
      for (let k = 0; k < 400; k++) {
        const x = (Math.random() - 0.5) * 50, z = Math.random() * 12 - 2;
        const gy = T.heightAt(x, z), d = W.water.surfaceAt(x, z) - gy;
        if (G.where === 'water' ? !(d > 3) : d > -0.5) continue;
        let rough = 0;
        for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) rough += Math.abs(T.heightAt(x + dx, z + dz) - gy);
        if (A.occ.solidAt(x, gy + 1, z)) continue;
        const s = -rough + z * 0.2;
        if (s > bs) { bs = s; best = { x, z }; }
      }
      if (!best) return false;
      for (const [id, n] of Object.entries(G.mix)) for (let i = 0; i < n; i++) {
        for (let k = 0; k < 40; k++) {
          const x = best.x + (Math.random() - 0.5) * 6, z = best.z + (Math.random() - 0.5) * 5;
          const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
          if (r.pos) { A.add(id, r.pos); break; }
        }
      }
      window.__spot = best;
      game.frozen = false;
      return true;
    }, { G });
    if (!ok) { console.log(g, 'no spot'); continue; }
    await page.waitForTimeout(2500);
    const shots = [];
    for (let i = 0; i < frames; i++) {
      // follow the group's middle from the front and a little above
      await page.evaluate(({ dist, i, threat }) => {
        const game = window.game, A = game.world.animals, all = A.all.filter((a) => !a.dead);
        if (!all.length) return;
        let x = 0, y = 0, z = 0;
        for (const a of all) { x += a.pos.x; y += a.pos.y; z += a.pos.z; }
        x /= all.length; y /= all.length; z /= all.length;
        game.rig?.stopOrbit?.(); if (game.rig) game.rig.moved = true;
        // on the third frame the camera comes right down to them (a danger: shrimp flick, panda kings roll, springtails jump)
        const d = threat && i >= 2 && i <= 3 ? dist * 0.35 : dist;
        game.controls.setLookAt(x + d * 0.15, y + d * 0.55, z + d, x, y + 0.3, z, false);
      }, { dist: G.dist, i, threat: G.threat || g === 'shrimp' || g === 'springtails' });
      await page.waitForTimeout(gap);
      const f = `test-output/bugs/${g}-${i}.png`;
      await page.screenshot({ path: f, clip: { x: 240, y: 90, width: 800, height: 540 } });
      shots.push(f);
    }
    const W = 400, H = 270, cols = 3, rows = Math.ceil(shots.length / cols);
    const tiles = await Promise.all(shots.map((f) => sharp(f).resize(W, H).toBuffer()));
    await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#000' } })
      .composite(tiles.map((b, i) => ({ input: b, left: (i % cols) * W, top: Math.floor(i / cols) * H }))).png().toFile(`test-output/bugs/${g}.png`);
    for (const f of shots) fs.unlinkSync(f);
    const st = await page.evaluate(() => window.game.world.animals.all.map((a) => `${a.sp}:${a.hop?.kind ?? (a.curl ? 'rolled' : a.state)}`).join(' '));
    console.log(g, '->', `test-output/bugs/${g}.png`, st);
  }
};
