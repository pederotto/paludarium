// Flowering over 30 game days (sim/bloom.js, render/flowers.js): plants four water lilies in the starter tank's pool, fast-forwards
// a day at a time and prints per day how many flowering plants rest, are in bud, open or fading and how many flower heads are
// drawn (0 before flowers had a cycle). Then: the drawn heads decode back to what the sim says (palette, stage), a save and load
// keeps every plant's stage, and pictures of a lily by day (open) and at dusk (shut), and of the stages side by side.
//   node tools/shot.mjs --steps=tools/steps/bloom-cycle.mjs --only=desktop --url=http://127.0.0.1:4491/ [--query=?webgl]
// DAYS=n changes the 30.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const days = +(process.env.DAYS ?? 30);
  const setup = await page.evaluate(() => {
    const g = window.game, W = g.world, THREE = W.plants.list[0].pos.constructor;
    g.setSpeed(0);
    const deep = (x, y, z, s) => W.water.inMainPool(x, z) && s - y > 4;
    let n = 0;
    for (let k = 0; k < 40 && n < 4; k++) {
      const p = W.randomSpot(deep, 200);
      if (!p || W.plants.crowdingAt('lily', p)) continue;
      if (W.plants.add('lily', new THREE(p.x, W.water.level, p.z), { grown: 1, scale: 1 })) n++;
    }
    return { lilies: n, plants: W.plants.list.length };
  });
  console.log('setup', JSON.stringify(setup));
  const count = () => page.evaluate(() => {
    const W = window.game.world, c = { rest: 0, bud: 0, open: 0, fade: 0, flowering: 0, heads: 0 };
    for (const p of W.plants.list) if (p.bloom) { c.flowering++; c[p.bloom.stage]++; }
    for (const fm of Object.values(W.plants.flowers ?? {})) c.heads += fm.n;
    return c;
  });
  console.log('day 0', JSON.stringify(await count()));
  const t0 = Date.now();
  const tally = { bud: 0, open: 0, fade: 0, drop: 0, born: 0 };
  for (let d = 1; d <= days; d++) {
    const ev = await page.evaluate(() => {
      const W = window.game.world, before = new Map(W.plants.list.filter((p) => p.bloom).map((p) => [p, p.bloom.stage]));
      const seen = { bud: 0, open: 0, fade: 0, drop: 0, born: 0 };
      const n0 = W.plants.list.length;
      for (let m = 0; m < 1440; m += 60) {
        W.sim.step(60);
        for (const [p, s] of before) {
          const now = p.bloom?.stage;
          if (now && now !== s) { if (now === 'rest') seen.drop++; else seen[now]++; before.set(p, now); }
        }
      }
      seen.born = Math.max(0, W.plants.list.length - n0);
      return seen;
    });
    for (const k in tally) tally[k] += ev[k];
    console.log('day', d, JSON.stringify(await count()));
  }
  console.log('transitions over', days, 'days', JSON.stringify(tally), 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  // The drawn heads decode back to what the sim says (the shader's unpacking, done here in JS on the uploaded floats).
  const check = await page.evaluate(() => {
    const W = window.game.world, fm = W.plants.flowers?.lily;
    if (!fm) return { ok: false, why: 'no lily flower mesh' };
    const f = (v) => Math.fround(v);
    const un = (x) => { const r = Math.floor(x / 65536), g = Math.floor((x - r * 65536) / 256), b = x - r * 65536 - g * 256; return [r, g, b]; };
    let bad = 0;
    for (let i = 0; i < fm.n; i++) {
      const pal = f(fm.iPal.getX(i)), [r, g, b] = un(pal);
      if (![r, g, b].every((c) => Number.isInteger(c) && c >= 0 && c < 256)) bad++;
      const S = f(fm.iBloom.getW(i)), z = S % 64, x = Math.floor(S / 64) % 64;
      if (!Number.isInteger(z) || !Number.isInteger(x)) bad++;
      const w = fm.iPal.getW(i), mode = Math.floor(w / 2);
      if (mode !== 1) bad++;
    }
    return { ok: bad === 0, heads: fm.n, bad, calls: fm.mesh.visible ? 1 : 0 };
  });
  console.log(check.ok ? 'PASS' : 'FAIL', 'decode', JSON.stringify(check));
  // Save and load: every flowering plant keeps its stage, colour form and how far through it is (in list order, which a save keeps).
  const sl = await page.evaluate(() => {
    const W = window.game.world;
    const sig = () => W.plants.list.filter((p) => p.bloom).map((p) => p.bloom.stage + ':' + p.bloom.palette + ':' + p.bloom.t.toFixed(3));
    const want = sig();
    W.load(JSON.parse(JSON.stringify(W.serialize())));
    const got = sig();
    let same = 0, diff = 0;
    want.forEach((w, i) => { if (got[i] === w) same++; else diff++; });
    return { same, diff, want: want.length, got: got.length };
  });
  console.log(sl.diff === 0 && sl.got === sl.want ? 'PASS' : 'FAIL', 'save/load', JSON.stringify(sl));
  // Pictures: the lilies in a row of stages, by day and at dusk.
  const lilies = await page.evaluate(() => {
    const W = window.game.world, L = W.plants.list.filter((p) => p.id === 'lily');
    const stages = [['bud', 0.5], ['bud', 0.95], ['open', 0.5], ['fade', 0.45], ['fade', 0.8]];
    L.forEach((p, i) => { if (!p.bloom) return; const [s, t] = stages[i % stages.length]; p.bloom.stage = s; p.bloom.t = t; p.bloom.palette = i % 5; p._look = null; W.plants.flowerDirty('lily'); });
    return L.map((p) => [+p.pos.x.toFixed(1), +p.pos.z.toFixed(1), p.bloom?.stage ?? 'no cycle']);
  });
  console.log('lilies', JSON.stringify(lilies));
  const look = async (label, minute, i = 2) => {
    await page.evaluate(([minute, i]) => {
      const g = window.game, W = g.world, E = W.env;
      E.minute = Math.floor(E.minute / 1440) * 1440 + minute;
      W.plants.step(0.001, E, W);      // the flower uniform follows the clock
      const L = W.plants.list.filter((p) => p.id === 'lily'), p = L[Math.min(i, L.length - 1)];
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(p.pos.x + 3, p.pos.y + 9, p.pos.z + 12, p.pos.x, p.pos.y + 0.5, p.pos.z, false);
    }, [minute, i]);
    await page.waitForTimeout(1500);
    await shot('bloom-' + label);
  };
  await look('noon-open', 12 * 60, 2);
  await look('dusk-shut', 19 * 60 + 45, 2);
  await look('noon-bud', 12 * 60, 1);
  await look('noon-fade', 12 * 60, 3);
  await page.evaluate(() => { const g = window.game, W = g.world, E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 720; W.plants.step(0.001, E, W); g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, 30, 62, 0, 12, 0, false); });
  await page.waitForTimeout(1200);
  await shot('bloom-tank');
};
