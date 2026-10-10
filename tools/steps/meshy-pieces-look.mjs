// The generated hardscape of 8 Oct 2026 (PIECES with `lazy`: mesa, pillar, arch, limestone, scatter, bigrock, fallenlog, sculpt, hollowlog,
// logpile, branch) put on the empty standard tank's flat ground: every variant of a type in a row, one picture per type, UI hidden, and
// a line per variant (its real size in cm, how far its lowest vertex is under the ground). Checks the lazy load (decor.ready) too.
//   node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/meshy-pieces-look.mjs --out=<dir> [--wait=1500]
//   env: TYPES=mesa,arch (default all lazy types); ALSO=boulder,wood (the game's older pieces too, to compare the look)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const info = await page.evaluate(async ({ only, also }) => {
    const { PIECES } = await import('/src/sim/decor.js');
    const { TANK } = await import('/src/sim/tank.js');
    const w = await window.game.loadTank('standard', { layout: 'empty' });
    window.game.rig.stopOrbit();
    const t0 = performance.now();
    await w.decor.ready;
    const types = Object.keys(PIECES).filter((t) => (PIECES[t].lazy && (!only.length || only.includes(t))) || also.includes(t));
    return { tank: [TANK.w, TANK.d, TANK.h], types, loadMs: Math.round(performance.now() - t0), parts: Object.fromEntries(types.map((t) => [t, w.decor.parts[t]?.length ?? 0])) };
  }, { only: (process.env.TYPES ?? '').split(',').filter(Boolean), also: (process.env.ALSO ?? '').split(',').filter(Boolean) });
  console.log('PIECES-LOOK', JSON.stringify(info));
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const [W, D] = info.tank;
  for (const type of info.types) {
    const rows = await page.evaluate(async (type) => {
      const w = window.paludarium, d = w.decor;
      d.clear(); w.plants.clear(); w.groundChanged();
      const n = d.parts[type].length, cols = Math.min(n, 5), out = [];
      for (let i = 0; i < n; i++) {
        const x = (-(cols - 1) / 2 + (i % cols)) * 24, z = -4 + Math.floor(i / cols) * 22;
        const p = d.addPiece(type, x, z, { variant: i, rot: 0.5 });
        if (!p) { out.push({ i, error: 'not placed' }); continue; }
        // (size from the geometry and the piece's scale, so unturned; the geometry's base is at y = 0, so the mesh's y is how far its base sits above the ground)
        const g = d.parts[type][i].geometry.boundingBox, s = p.mesh.scale, ground = w.terrain.heightAt(x, z);
        out.push({ i, name: d.parts[type][i].name, cm: [(g.max.x - g.min.x) * s.x, (g.max.y - g.min.y) * s.y, (g.max.z - g.min.z) * s.z].map((v) => +Math.abs(v).toFixed(1)), baseAboveGround: +(p.mesh.position.y - ground).toFixed(2) });
      }
      w.groundChanged();
      return out;
    }, type);
    console.log('PIECES-LOOK', type, JSON.stringify(rows));
    const cols = Math.min(rows.length, 5), nrow = Math.ceil(rows.length / cols), span = Math.max(cols * 24, 60);
    await page.evaluate(([span, nrow, D]) => {
      const g = window.game; g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(0, 26 + nrow * 6, 20 + span * 0.55 + nrow * 16, 0, 5, -4 + (nrow - 1) * 8, false);
    }, [span, nrow, D]);
    await page.waitForTimeout(2500);
    await shot(`piece-${type}`);
  }
  console.log('PIECES-LOOK errors', errors.length, JSON.stringify(errors.slice(0, 5)));
};
