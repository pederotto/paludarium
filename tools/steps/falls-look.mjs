// A waterfall landing in the main pool, close up by day (Cascade canyon, seed 1, standard tank), with numbers read from
// the pictures. Against the dev server (it imports /src modules), desktop only:
//   node tools/shot.mjs --steps=tools/steps/falls-look.mjs --only=desktop [--query=?webgl] [--out=test-output/falls]
//   FALLS_TAG=<name> prefixes the files; FALLS_WAIT=<ms> waits longer for the shaders on a loaded machine;
//   FALLS_PRESET=<id> another generated tank; FALLS_KIND=wall the biggest fall down the background (an outlet) instead.
// Numbers (shares of sampled pixels; samples are points on the sheet, the pool and the gap, projected to the screen):
//   sheetTop    white on the upper half of the falling sheet (glassy near the lip: low)
//   sheetLow    white on the lower half (aerated: higher than sheetTop)
//   foot        white in the plunge zone, a disc round the foot on the pool
//   down        white and the spread of brightness (sd) on the pool 4-14 cm downstream, toward the pump: the current
//   seam        the longest run (px) of dark samples in the column from the sheet's lower part down to the foot:
//               0 when the sheet runs into its foam, large when it ends above the water
//   seamWhite   white share of that column (the sheet's lower part running into the foam)
import fs from 'node:fs';
import sharp from 'sharp';

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const isWhite = (r, g, b) => lum(r, g, b) > 0.55 && Math.max(r, g, b) - Math.min(r, g, b) < 60;

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const tag = process.env.FALLS_TAG ?? 'falls';
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  const preset = process.env.FALLS_PRESET ?? 'cascade', kind = process.env.FALLS_KIND ?? 'pool';
  await page.evaluate(async (preset) => {
    const gen = await import('/src/sim/generator.js');
    const w = await window.game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset, seed: 1, tier: 'standard' });
    for (let i = 0; i < 60; i++) w.sim.step(10);
    w.env.lights = 'on'; w.env.minute = 13 * 60;
  }, preset);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(+(process.env.FALLS_WAIT ?? 12000));
  await page.evaluate(() => window.game.settle?.(8000));

  // The biggest fall that lands in the main pool, and the views of it.
  const info = await page.evaluate((kind) => {
    const W = window.game.world.water, H = W.hydro;
    const r = [...W.ribbons.entries()].filter(([k, x]) => (kind === 'wall' ? k[0] === 'o' : H.res[H.cellOf(x.end.x, x.end.z)])).map((e) => e[1]).sort((a, b) => b.q - a.q)[0];
    if (!r) return null;
    const pump = H.pump.intake ?? { x: 0, z: 0 };
    return { end: [r.end.x, r.end.y, r.end.z], top: r.curve.getPointAt(0).toArray(), q: r.q, width: r.width, len: r.len, level: H.level, pump: [pump.x, pump.z] };
  }, kind);
  if (!info) { console.log(`FAIL no ${kind} fall in ${preset}`); return; }
  console.log('fall', JSON.stringify({ q: +info.q.toFixed(1), width: +info.width.toFixed(1), len: +info.len.toFixed(1), end: info.end.map((v) => +v.toFixed(1)) }));
  const [ex, ey, ez] = info.end;
  const views = {
    front: [[ex + 4, ey + 14, ez + 34], [ex, ey + 4, ez]],
    side: [[ex + 26, ey + 10, ez + 22], [ex, ey + 3, ez]],
    wide: [[ex + 12, ey + 30, ez + 62], [ex + 8, ey, ez - 2]],
  };
  const out = {};
  for (const [label, [pos, tgt]] of Object.entries(views)) {
    // Samples projected to the screen, as [kind, x, y] (kind: sheetTop, sheetLow, foot, down, seam).
    const samples = await page.evaluate(([pos, tgt, info, kind]) => {
      const g = window.game, W = g.world.water, H = W.hydro;
      g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...pos, ...tgt, false);
      g.controls.update(0); g.camera.updateMatrixWorld();
      const V = g.camera.position.constructor;
      const r = [...W.ribbons.entries()].filter(([k, x]) => (kind === 'wall' ? k[0] === 'o' : H.res[H.cellOf(x.end.x, x.end.z)])).map((e) => e[1]).sort((a, b) => b.q - a.q)[0];
      const vw = innerWidth, vh = innerHeight, s = [];
      const put = (kind, p) => { const v = p.clone().project(g.camera); if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) s.push([kind, Math.round((v.x + 1) / 2 * vw), Math.round((1 - v.y) / 2 * vh)]); };
      // Across the sheet: the side vector of its first segment, flat.
      const a = r.curve.getPointAt(0), b = r.curve.getPointAt(0.3);
      const side = new V(b.z - a.z, 0, a.x - b.x).normalize();
      for (let t = 0.05; t < 0.95; t += 0.03) for (let c = -0.3; c <= 0.3; c += 0.1) put(t < 0.5 ? 'sheetTop' : 'sheetLow', r.curve.getPointAt(t).addScaledVector(side, c * r.width));
      const L = r.end.y;   // the surface it lands in (the main pool, or a pond)
      for (let rad = 0.3; rad < 3.2; rad += 0.35) for (let k = 0; k < 16; k++) put('foot', new V(r.end.x + Math.cos(k / 16 * 6.283) * rad, L, r.end.z + Math.sin(k / 16 * 6.283) * rad));
      const dx = info.pump[0] - r.end.x, dz = info.pump[1] - r.end.z, dl = Math.hypot(dx, dz) || 1;
      for (let d = 4; d <= 14; d += 0.5) for (let c = -3; c <= 3; c += 1) put('down', new V(r.end.x + dx / dl * d - dz / dl * c, L, r.end.z + dz / dl * d + dx / dl * c));
      const p0 = r.curve.getPointAt(0.7), p1 = r.end.clone();
      for (let t = 0; t <= 1; t += 0.01) put('seam', p0.clone().lerp(p1, t));
      return s;
    }, [pos, tgt, info, kind]);
    await page.waitForTimeout(1500);
    await shot(`${tag}-${label}`);
    const file = `${process.env.FALLS_OUT ?? 'test-output'}/${tag}-${label}-desktop.png`;
    if (!fs.existsSync(file)) continue;
    const { data, info: im } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const o = (y * im.width + x) * im.channels; return [data[o], data[o + 1], data[o + 2]]; };
    const acc = {};
    for (const [kind, x, y] of samples) {
      if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
      const c = px(x, y);
      (acc[kind] ??= []).push({ w: isWhite(...c), l: lum(...c), y });
    }
    const share = (k) => (acc[k]?.length ? +(acc[k].filter((s) => s.w).length / acc[k].length).toFixed(3) : null);
    const sd = (k) => { const l = (acc[k] ?? []).map((s) => s.l); if (!l.length) return null; const m = l.reduce((a, b) => a + b, 0) / l.length; return +Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length).toFixed(3); };
    // Seam: brightness down the column; a run of samples darker than half the sheet's median, measured in screen px.
    let seam = null;
    if (acc.seam?.length && acc.sheetLow?.length) {
      const med = acc.sheetLow.map((s) => s.l).sort((a, b) => a - b)[acc.sheetLow.length >> 1];
      let run = 0, best = 0, y0 = 0;
      for (const s of acc.seam) { if (s.l < med * 0.5) { if (!run) y0 = s.y; run = 1; best = Math.max(best, Math.abs(s.y - y0)); } else run = 0; }
      seam = best;
    }
    out[label] = { sheetTop: share('sheetTop'), sheetLow: share('sheetLow'), foot: share('foot'), down: share('down'), downSd: sd('down'), seam, seamWhite: share('seam') };
    console.log(`${tag} ${label}`, JSON.stringify(out[label]));
  }
  fs.mkdirSync(process.env.FALLS_OUT ?? 'test-output', { recursive: true });
  fs.writeFileSync(`${process.env.FALLS_OUT ?? 'test-output'}/${tag}-numbers.json`, JSON.stringify({ info, out }, null, 1));
};
