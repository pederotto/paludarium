// The scanned plants of 8 Oct 2026 (PLANTS with `lazy`) in the game: the land plants in a row on the empty standard tank's ground, then the
// waterside ones (bulrush at the edge, lotus and lilies floating) in a tank with water; UI hidden, one picture per scene, and a line per
// plant (its variants, whether it went in). Checks the lazy load (plants.ready) too.
//   node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/meshy-plants-look.mjs --out=<dir> [--wait=1500]
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  for (const scene of ['land', 'water']) {
    const info = await page.evaluate(async (scene) => {
      const { PLANTS } = await import('/src/sim/plants.js');
      const w = await window.game.loadTank('standard', { layout: 'empty' });
      window.game.rig.stopOrbit();
      await w.plants.ready;
      w.decor.clear(); w.plants.clear();
      if (scene === 'water') w.water.setLevel(14);
      const ids = Object.keys(PLANTS).filter((id) => PLANTS[id].lazy && (scene === 'land' ? PLANTS[id].habitat.includes('land') : !PLANTS[id].habitat.includes('land')));
      const V = window.game.camera.position.constructor;   // a Vector3
      const up = new V(0, 1, 0), out = [];
      ids.forEach((id, i) => {
        const x = (-(ids.length - 1) / 2 + i) * (scene === 'land' ? 26 : 30), z = scene === 'land' ? 2 : 4;
        const floating = PLANTS[id].habitat === 'floating';
        const y = floating ? w.water.level : w.terrain.heightAt(x, z);
        const p = w.plants.add(id, new V(x, y, z), { normal: up, grown: 1, surface: floating ? 'water' : 'terrain' });
        out.push({ id, variants: w.plants.variants[id], placed: !!p });
      });
      return { out, level: w.water.level };
    }, scene).catch((e) => ({ error: String(e) }));
    console.log('PLANTS-LOOK', scene, JSON.stringify(info));
    await page.evaluate((scene) => { const g = window.game; g.rig.moved = true; g.controls.setLookAt(0, scene === 'land' ? 40 : 34, scene === 'land' ? 150 : 90, 0, scene === 'land' ? 14 : 6, 0, false); }, scene);
    await page.waitForTimeout(3500);
    await shot(`plants-${scene}`);
  }
  console.log('PLANTS-LOOK errors', errors.length, JSON.stringify(errors.slice(0, 4)));
};
