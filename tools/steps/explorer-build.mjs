// Builds the same scene in Explorer or Naturalist (MODE=explorer|naturalist, default explorer) and counts the user actions
// (clicks, taps, slider changes): 5 rocks, 1 kit, about 10 plants, a school of fish and a frog.
// Run: MODE=explorer node tools/shot.mjs --only=phone --steps=tools/steps/explorer-build.mjs --wait=2500
export default async (page, shot, name) => {
  const mode = process.env.MODE === 'naturalist' ? 'naturalist' : 'explorer';
  const phone = name === 'phone';
  let taps = 0;
  const ui = async (loc) => { taps++; await loc.click({ force: true, timeout: 20000 }); await page.waitForTimeout(250); };
  const probe = () => page.evaluate(() => { const W = window.game.world; return { pieces: W.decor.pieces.length, plants: W.plants.list.length, animals: W.animals.all.length, undo: W.undoStack.length, mode: W.realism?.mode, level: W.water.level }; });
  // screen position of a point on the ground
  const scr = (x, z) => page.evaluate(([x, z]) => { const g = window.game, W = g.world; const v = new (g.camera.position.constructor)(x, W.terrain.heightAt(x, z), z).project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, [x, z]);
  const says = () => page.evaluate(() => [...document.querySelectorAll('.toasts > *')].map((e) => e.textContent).join(' | '));
  const tap = async (x, z) => { const p = await scr(x, z); taps++; await page.mouse.click(p.x, p.y); await page.waitForTimeout(500); };

  await page.waitForSelector('.modecard', { timeout: 90000 });
  await page.waitForTimeout(800);
  await shot('e0-title');
  await page.locator('.modecard', { hasText: mode === 'explorer' ? 'Explorer' : 'Naturalist' }).click({ force: true });
  await page.getByRole('button', { name: /Sandbox: the starter paludarium/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.rail'), null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const W = window.game.world; W.plants.clear(); W.animals.clear(); W.decor.clear(); W.groundChanged(); });
  await page.waitForTimeout(800);
  console.log(name, mode, 'start', JSON.stringify(await probe()));
  const T = await page.evaluate(async () => { const { TANK } = await import('/src/sim/tank.js'); return { w: TANK.w, d: TANK.d }; });
  // A wet spot for fish and a dry spot for the frog.
  const spots = await page.evaluate(() => {
    const W = window.game.world, L = W.water.level, wet = [], land = [];
    for (let x = -42; x <= 42; x += 2.6) for (let z = -19; z <= 19; z += 2.6) {
      const h = W.terrain.heightAt(x, z);
      if (h > L + 1.5) land.push({ x, z }); else if (L - h > 8) wet.push({ x, z });
    }
    let best = null, nb = -1;
    for (const c of land) { const n = land.filter((q) => Math.hypot(q.x - c.x, q.z - c.z) < 7).length; if (n > nb) { nb = n; best = c; } }
    const near = land.filter((q) => Math.hypot(q.x - best.x, q.z - best.z) < 9).sort((a, b) => Math.hypot(a.x - best.x, a.z - best.z) - Math.hypot(b.x - best.x, b.z - best.z));
    return { wet: wet[Math.floor(wet.length / 2)], c: best, near, n: land.length };
  });
  console.log('spots', JSON.stringify({ wet: spots.wet, c: spots.c, n: spots.n, near: spots.near.length }), JSON.stringify(T));
  // The grouped rail: one tap on the group, one on its tab when the tab is not already showing (both count as taps).
  const TOOLID = { Rocks: 'rock', Hardscape: 'rock', Plants: 'plant', Animals: 'animal', Kits: 'kits' };
  const GROUPOF = { rock: 'add', plant: 'add', animal: 'add', kits: 'add' };
  const tool = async (n) => {
    const id = TOOLID[n];
    let cur = await page.evaluate(() => window.__tools.tool);
    if (!['rock', 'plant', 'animal'].includes(cur)) { await ui(page.locator(`.rail .tool[data-group="${GROUPOF[id]}"]`)); cur = await page.evaluate(() => window.__tools.tool); }
    if (await page.locator('.opts.oc-chip').count()) await ui(page.locator('.opts.oc-chip'));
    if (id !== 'kits' && cur !== id) await ui(page.locator(`.opts [data-tool="${id}"]`));
    if (id === 'kits') await ui(page.locator('.opts [data-tool="kits"]'));
  };
  const pick = (n) => ui(page.locator('.opts .pick', { hasText: n }).first());
  const sx = (T.w / 2) * 0.55;

  // --- Rocks
  await tool(mode === 'explorer' ? 'Rocks' : 'Hardscape');
  await page.waitForTimeout(500);
  if (mode === 'explorer') {
    await ui(page.locator('.smartbar .sb-seg button', { hasText: '5' }));
    await tap(-sx, -3);
  } else {
    const sizes = [11, 9, 8, 6, 5];
    for (let i = 0; i < 5; i++) {
      taps++; await page.locator('.opts input[type=range]').first().fill(String(sizes[i])); await page.waitForTimeout(150);
      if (i > 0) await tap(-sx + i * 3, -3 + (i % 2) * 5);       // the first click only lets go of the last piece
      await tap(-sx + i * 3, -3 + (i % 2) * 5);
    }
  }
  console.log(name, mode, 'rocks', taps, JSON.stringify(await probe()));
  await shot('e1-rocks');
  // --- A kit
  if (mode !== 'explorer') await tool('Kits');
  await pick('Stepping stones');
  await tap(sx, 3);
  console.log(name, mode, 'kit', taps, JSON.stringify(await probe()));
  await shot('e2-kit');
  // --- Plants
  await tool('Plants');
  await pick('Lady fern');
  if (mode === 'explorer') {
    await tap(spots.c.x, spots.c.z);                       // five at once (Each tap places 5)
    const a = await scr(spots.c.x + 3, spots.c.z + 4), b = await scr(spots.c.x + 8, spots.c.z + 4);
    taps++;
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(600);
    for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x + (b.x - a.x) * k / 8, a.y + (b.y - a.y) * k / 8); await page.waitForTimeout(160); }
    await page.mouse.up(); await page.waitForTimeout(500);
  } else {
    for (const q of spots.near.slice(0, 10)) await tap(q.x, q.z);
  }
  console.log(name, mode, 'toasts', await says());
  console.log(name, mode, 'plants', taps, JSON.stringify(await probe()));
  await shot('e3-plants');
  // --- Animals
  await tool('Animals');
  await pick('Neon');
  if (spots.wet) await tap(spots.wet.x, spots.wet.z);
  if (mode === 'explorer') await ui(page.locator('.smartbar .sb-seg button', { hasText: 'One' }));
  await pick('Dart');
  const fr = spots.near[spots.near.length - 1] ?? spots.c;
  await tap(fr.x, fr.z);
  console.log(name, mode, 'toasts', await says());
  console.log(name, mode, 'animals', taps, JSON.stringify(await probe()));
  await shot('e4-animals');
  if (mode === 'explorer') {
    const before = await probe();
    await ui(page.locator('.smartbar button', { hasText: 'Undo' }));
    console.log(name, mode, 'after undo', JSON.stringify(before), '->', JSON.stringify(await probe()));
  }
  console.log('RESULT', name, mode, 'user actions:', taps);
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 8))));
};
