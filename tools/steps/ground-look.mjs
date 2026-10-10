// The ground palettes (content/ground.js) side by side: for each, an empty standard tank whose floor is painted in four bands (soil, sand,
// gravel, rock, left to right) with the back wall in dark stone, seen from the front at a low angle; one picture per palette, UI hidden.
//   node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/ground-look.mjs --out=<dir> [--wait=1500]
//   env: SETS=forest,river (default all)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const sets = await page.evaluate(async (only) => {
    const { GROUND_SETS } = await import('/src/content/ground.js');
    return Object.keys(GROUND_SETS).filter((s) => !only.length || only.includes(s));
  }, (process.env.SETS ?? '').split(',').filter(Boolean));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  for (const set of sets) {
    await page.evaluate(async (set) => {
      const w = await window.game.loadTank('standard', { layout: 'empty' });
      window.game.rig.stopOrbit();
      await w.setGround(set);
      const { MAT } = await import('/src/sim/tank.js');
      const f = w.terrain.field, cols = f.cols;
      const band = (n) => Math.floor(((n % cols) / cols) * 4);
      [MAT.soil, MAT.sand, MAT.gravel, MAT.rock].forEach((m, b) => f.setMaterial(m, (n) => band(n) === b));
      w.wall.field.setMaterial(MAT.stone);
      w.groundChanged();
      w.decor.clear();
    }, set);
    await page.evaluate(() => { const g = window.game; g.rig.moved = true; g.controls.setLookAt(0, 22, 62, 0, 2, -8, false); });
    await page.waitForTimeout(3500);
    await shot(`ground-${set}`);
  }
  console.log('GROUND-LOOK sets', sets.join(','), 'errors', errors.length, JSON.stringify(errors.slice(0, 4)));
};
