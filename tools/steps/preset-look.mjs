// A generated preset seen from the front, the interface hidden: PRESET=streambank SEED=1 TIER=standard, then a close-up of the
// first animal of FOCUS (optional) and of the first piece of PIECE (optional).
//   node tools/shot.mjs --url=http://localhost:4377/ --only=desktop --steps=tools/steps/preset-look.mjs --wait=2500
//   VIEW=front: the camera in front of the glass, close, so the rock and wood can be judged (default: the game's own view of the room)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  const preset = process.env.PRESET ?? 'streambank', seed = +(process.env.SEED ?? 1), tier = process.env.TIER ?? 'standard';
  const info = await page.evaluate(async ({ preset, seed, tier }) => {
    const game = window.game;
    const gen = await import('/src/sim/generator.js');
    const w = await game.loadTank(tier, { layout: 'empty' });
    return gen.generateTerrarium(w, { preset, seed, tier })?.name;
  }, { preset, seed, tier }).catch((e) => String(e));
  console.log('start:', info);
  // (the shaders of a new tank build behind a veil: wait for it, or the picture is the loading screen)
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone') ?? true, null, { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => window.game.settle?.(120000)).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  if (process.env.VIEW === 'front') {
    await page.evaluate(async () => { const { TANK } = await import('/src/sim/tank.js'), g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, TANK.h * 0.5, TANK.d / 2 + TANK.w * 0.62, 0, TANK.h * 0.38, 0, false); });
    await page.waitForTimeout(2500);
  }
  await shot(`preset-${preset}`);
  for (const [kind, id] of [['animal', process.env.FOCUS], ['piece', process.env.PIECE]]) {
    if (!id) continue;
    const ok = await page.evaluate(({ kind, id }) => {
      const g = window.game, W = g.world;
      const p = kind === 'animal' ? W.animals.by[id]?.[0]?.pos : W.decor.pieces.find((q) => q.type === id)?.mesh?.position;
      if (!p) return false;
      g.setSpeed(0); g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(p.x + 6, p.y + 9, p.z + 22, p.x, p.y + 1, p.z, false);
      return true;
    }, { kind, id });
    await page.waitForTimeout(1200);
    if (ok) await shot(`preset-${preset}-${id}`);
  }
};
