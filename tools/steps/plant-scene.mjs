// A plant as the player sees it: each species (IDS) alone in the starter paludarium at 11:00 (pictures at night are
// black), on the background wall at several spins about the wall normal (SPINS; wall plants get a random spin in the
// game, so a hanging plant must look right at all of them) and on land, camera DIST cm away, with its flowers drawn
// by the LIVE flower renderer (bloom forced open, colour form PALETTE). At game speed 0 the live flower meshes are only
// refilled through plants.flowerDirty / flushFlowers, which this calls; without that no flower is drawn.
// Dev server only (it imports /src modules):
//   npx vite --port 4492 --strictPort --host 127.0.0.1
//   IDS=dracula,cuthbertsonii node tools/shot.mjs --url=http://127.0.0.1:4492/ --only=desktop \
//     --steps=tools/steps/plant-scene.mjs --out=test-output/scene [--query=?webgl]
//   IDS=a,b          species ids from sim/plants.js PLANTS (default dracula)
//   WHERES=wall,land (default both)   SPINS=0.7,2.2,4.4 wall spins in radians   LANDROT=2.2 turn on land
//   DIST=cm          camera distance (default 40, the player's usual distance)
//   PALETTE=k        colour form of the open flowers (default 0)   PAT=n set that form's pattern code in the page only
//   NEAR=1           one more picture per species and place, framed on the plant's drawn box
//   WAIT=ms          before each picture (default 2500)
// Pictures: <out>/plant-scene-<id>-<wall-s<spin>|land>-p<palette>-desktop.png. Stamp per picture:
//   STAMP plant-scene <git sha of the cwd tree[-dirty]> <id> where spin palette code bloom heads drawn headTris backend
// (drawn = flower instances in the live flower mesh; 0 means no flower is on screen and the picture does not count).
import { execSync } from 'node:child_process';

const sha = () => {
  try {
    const run = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return run('git rev-parse --short HEAD') + (run('git status --porcelain --untracked-files=no') ? '-dirty' : '');
  } catch { return 'no-git'; }
};

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const tree = sha(), wait = +(process.env.WAIT || 2500);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const pal = +(process.env.PALETTE || 0), pat = process.env.PAT != null ? +process.env.PAT : null, dist = +(process.env.DIST || 40);
  const jobs = [];
  for (const id of (process.env.IDS || 'dracula').split(','))
    for (const where of (process.env.WHERES || 'wall,land').split(','))
      if (where === 'wall') for (const spin of (process.env.SPINS || '0.7,2.2,4.4').split(',').map(Number)) jobs.push([id, where, spin]);
      else jobs.push([id, where, +(process.env.LANDROT || 2.2)]);
  const near = new Set();
  for (const [id, where, spin] of jobs) {
    const r = await page.evaluate(async ({ id, where, spin, pal, pat, dist }) => {
      const { PLANTS } = await import('/src/sim/plants.js');
      const { Builder } = await import('/src/render/geo.js');
      const g = window.game, W = g.world, def = PLANTS[id];
      if (!def) return { err: 'unknown plant ' + id };
      g.setSpeed(0);
      W.env.minute = Math.floor(W.env.minute / 1440) * 1440 + 11 * 60;
      for (let t = 0; t < 10; t++) W.sim.step(1);
      for (const p of [...W.plants.list]) W.plants.remove(p);
      const V3 = g.camera.position.constructor;
      const f = def.flower, pals = f?.palettes ?? [];
      const p = Math.min(pal, Math.max(0, pals.length - 1));
      if (f) { window.__plantSceneOrig ??= {}; window.__plantSceneOrig[id] ??= pals.map((q) => [...q]); window.__plantSceneOrig[id].forEach((q, i) => { pals[i] = [...q]; }); }
      if (f && pat != null) pals[p][3] = pat;
      let pos, opt = { grown: 1, scale: 1, rot: spin };
      if (where === 'wall') {
        const x = 0, y = 22, z = W.wall.zAt(x, y) + 0.2;
        pos = new V3(x, y, z); Object.assign(opt, { surface: 'wall', normal: new V3(0, 0, 1) });
      } else {                                         // dry ground nearest the front middle
        let best = null;
        for (let x = -30; x <= 30; x += 2) for (let z = -6; z <= 16; z += 2) {
          const y = W.terrain.heightAt(x, z), s = W.water.surfaceAt(x, z);
          if (s !== -Infinity && s > y - 1) continue;
          const sc = Math.abs(x) * 0.5 + Math.abs(z - 15) * 1.5;
          if (!best || sc < best.sc) best = { x, y, z, sc };
        }
        pos = new V3(best.x, best.y, best.z);
      }
      const P = W.plants.add(id, pos, opt);
      if (!P) return { err: 'add failed ' + id + ' ' + where };
      P.reach = 0; W.plants.writeInstance(P);
      let tris = 0, drawn = 0;
      if (f) {                                         // live flowers: open, refilled by hand at game speed 0
        const gb = new Builder(); f.build(gb); tris = gb.build().attributes.position.count / 3;
        P.bloom = { stage: 'open', t: 0.5, palette: p, j: 0.5, k: 1, why: null };
        W.plants.live = true; W.plants._dirty?.add(P.id);
        for (let t = 0; t < 3; t++) W.sim.step(1);
        P.bloom.stage = 'open'; W.plants.flowerDirty(P.id); W.plants.flushFlowers();
        drawn = W.plants.flowers?.[id]?.n ?? 0;
      }
      const im = W.plants.meshes[W.plants.key ? W.plants.key(P) : id] ?? W.plants.meshes[id];
      if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
      const M = new im.matrixWorld.constructor(); im.getMatrixAt(P.index, M); M.premultiply(im.matrixWorld);
      const B = im.geometry.boundingBox.clone().applyMatrix4(M), c = B.getCenter(new V3()), sz = B.getSize(new V3()).length();
      g.rig.stopOrbit(); g.rig.moved = true;
      const D = dist / 40; g.controls.setLookAt(c.x, c.y + 8 * D, c.z + 39 * D, c.x, c.y, c.z, false);
      window.__plantScene = { c, sz };
      const be = g.renderer?.backend;
      return { id, where, spin, pal: p, code: pals[p]?.[3] ?? 0, bloom: P.bloom?.stage ?? 'none', heads: f ? W.plants.headsOf(P).length : 0,
        drawn, tris, backend: be?.isWebGLBackend ? 'webgl2' : 'webgpu',
        box: [B.min.toArray(), B.max.toArray()].map((a) => a.map((v) => +v.toFixed(1))) };
    }, { id, where, spin, pal, pat, dist });
    if (r.err) { console.log('STAMP plant-scene', tree, id, where, 'ERROR', r.err); continue; }
    console.log('STAMP plant-scene', tree, id, where, 'spin', spin, 'palette', r.pal, 'code', r.code, 'bloom', r.bloom,
      'heads', r.heads, 'drawn', r.drawn, 'headTris', r.tris, r.backend, 'box', JSON.stringify(r.box));
    await page.waitForTimeout(wait);
    const tag = `plant-scene-${id}-${where === 'wall' ? 'wall-s' + spin : 'land'}-p${r.pal}${pat != null ? '-c' + pat : ''}`;
    await shot(tag);
    if (process.env.NEAR !== '1' || near.has(id + where)) continue;
    near.add(id + where);
    await page.evaluate(() => { const { c, sz } = window.__plantScene; const d = Math.max(6, sz * 0.75); window.game.controls.setLookAt(c.x + d * 0.2, c.y + d * 0.3, c.z + d, c.x, c.y, c.z, false); });
    await page.waitForTimeout(1500);
    await shot(tag + '-near');
  }
};
