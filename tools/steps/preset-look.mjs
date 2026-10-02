// A generated preset seen from the front, the interface hidden: PRESET=streambank SEED=1 TIER=standard, then a close-up of the
// first animal of FOCUS (optional) and of the first piece of PIECE (optional).
//   node tools/shot.mjs --url=http://localhost:4377/ --only=desktop --steps=tools/steps/preset-look.mjs --wait=2500
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
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
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
