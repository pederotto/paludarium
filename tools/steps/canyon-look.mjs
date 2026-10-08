// The canyon seen from several sides (run "sets", 7 Oct): default view, the waterfall and shelf, each massif, the lagoon floor through the front glass,
// a three-quarter view and a top-down. Builds the set (PRESET=canyon, TIER=show, SEED=1) and takes one picture per view, UI hidden.
//   PRESET=canyon TIER=show SEED=1 node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/canyon-look.mjs --out=<dir>
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const preset = process.env.PRESET ?? 'canyon', tier = process.env.TIER ?? 'show', seed = +(process.env.SEED ?? 1);
  const info = await page.evaluate(async ({ preset, tier, seed }) => {
    const { generateTerrarium } = await import('/src/sim/generator.js');
    const w = await window.game.loadTank(tier, { layout: 'empty' });
    window.game.rig.stopOrbit();
    const r = generateTerrarium(w, { preset, seed, tier });
    window.game.settle?.();
    const { TANK } = await import('/src/sim/tank.js');
    return { litres: r.litres, level: r.level, falls: r.falls, plants: r.plants, c: r.canyon ?? null, w: TANK.w, d: TANK.d, h: TANK.h };
  }, { preset, tier, seed });
  console.log('CANYON-LOOK', JSON.stringify(info));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForTimeout(3000);
  const { w, d, h, level, c } = info;
  const view = async (tag, p, t) => {
    await page.evaluate(([p, t]) => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], false); }, [p, t]);
    await page.waitForTimeout(2500);
    await shot(`look-${tag}`);
  };
  const fx = c?.fall?.x ?? w * 0.2, fz = c?.fall?.z ?? -d * 0.4, sy = c?.shelfY ?? level + 9;
  await view('fall', [fx - 8, sy + 18, d / 2 + 38], [fx - 4, sy + 6, fz + 14]);
  await view('left', [-w * 0.2, h * 0.55, d / 2 + 52], [-w * 0.32, h * 0.5, 0]);
  await view('right', [w * 0.2, h * 0.55, d / 2 + 52], [w * 0.3, h * 0.5, 0]);
  await view('floor', [0, level * 0.5, d / 2 + 48], [0, level * 0.4, 0]);
  await view('threeq', [-w * 0.55, h * 0.85, d / 2 + 70], [w * 0.05, h * 0.4, -d * 0.1]);
  await view('top', [0, h * 1.9, d * 0.3], [0, level, -d * 0.1]);
  console.log('CANYON-LOOK errors', errors.length, JSON.stringify(errors.slice(0, 3)));
};
