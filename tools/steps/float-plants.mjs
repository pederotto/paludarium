// Floating plants on the water (owner, 11 Oct 2026: "water plants are floating above the water" on the live build): for every premade
// set that holds a floating plant (or PRESETS=a,b), build it and print each floater's height against the water surface under it, right
// after the build and again after RUN seconds of play at SPEED; FAIL when a floater is more than 0.3 cm off its water (or off the mud
// when its spot is dry). SHOT=1 also takes a picture of each set at noon, close on its worst floater.
//   node tools/shot.mjs --url=<dev server> --only=desktop --steps=tools/steps/float-plants.mjs --wait=1500
//   env: PRESETS=swamp,reedpool (default every set with a floater), SEED (1), RUN (seconds, 20), SPEED (game speed, 60), SHOT=1
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const only = (process.env.PRESETS ?? '').split(',').filter(Boolean), seed = +(process.env.SEED ?? 1);
  const run = +(process.env.RUN ?? 20), speed = +(process.env.SPEED ?? 60), shots = process.env.SHOT === '1';
  const list = await page.evaluate(async ({ only }) => {
    const { PRESETS, PRESET_ORDER } = await import('/src/content/presets.js');
    const { PLANTS } = await import('/src/sim/plants.js');
    const floats = (id) => [...(PRESETS[id].plants ?? []), ...(PRESETS[id].flora ?? []).map((f) => f[0])].some((p) => PLANTS[p]?.habitat === 'floating');
    return PRESET_ORDER.filter((id) => (only.length ? only.includes(id) : floats(id))).map((id) => ({ id, tier: PRESETS[id].ref || 'standard' }));
  }, { only });
  // Each floater: its y, the water surface under it (or the ground when dry) and the gap; the worst gap.
  const measure = () => page.evaluate(async () => {
    const { PLANTS } = await import('/src/sim/plants.js');
    const W = window.game.world;
    const rows = W.plants.list.filter((p) => PLANTS[p.id].habitat === 'floating').map((p) => {
      const s = W.water.surfaceAt(p.pos.x, p.pos.z, 0.2), g = W.terrain.heightAt(p.pos.x, p.pos.z);
      const want = s === -Infinity ? g : s;
      return { id: p.id, x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), y: +p.pos.y.toFixed(2), want: +want.toFixed(2), dry: s === -Infinity, gap: +(p.pos.y - want).toFixed(2) };
    });
    return { level: +W.water.level.toFixed(2), n: rows.length, worst: rows.reduce((m, r) => (Math.abs(r.gap) > Math.abs(m) ? r.gap : m), 0), rows };
  });
  let bad = 0;
  for (const { id, tier } of list) {
    const built = await page.evaluate(async ({ id, tier, seed }) => {
      const { generateTerrarium } = await import('/src/sim/generator.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      window.game.rig.stopOrbit();
      const res = generateTerrarium(w, { preset: id, seed, tier });
      return { name: res?.name, landTuned: res?.counts?.landTuned ?? null };
    }, { id, tier, seed }).catch((e) => ({ error: String(e).slice(0, 200) }));
    if (built.error) { bad++; console.log('FAIL', id, built.error); continue; }
    const a = await measure();
    await page.evaluate((v) => window.game.setSpeed(v), speed);
    await page.waitForTimeout(run * 1000);
    await page.evaluate(() => window.game.setSpeed(1));
    const b = await measure();
    const fail = Math.abs(a.worst) > 0.3 || Math.abs(b.worst) > 0.3;
    if (fail) bad++;
    console.log(fail ? 'FAIL' : 'ok  ', id, tier, `floaters ${a.n}`, `built: level ${a.level} worst gap ${a.worst}`, `after ${run}s x${speed}: level ${b.level} worst gap ${b.worst}`, built.landTuned ? 'landTuned ' + JSON.stringify(built.landTuned) : '');
    for (const r of b.rows) if (Math.abs(r.gap) > 0.3) console.log('     ', JSON.stringify(r));
    if (shots && b.rows.length) {
      await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone') ?? true, null, { timeout: 180000 }).catch(() => {});
      await page.evaluate(() => window.game.settle?.(120000)).catch(() => {});
      await page.addStyleTag({ content: '#ui{display:none!important}' });
      const r = b.rows.reduce((m, q) => (Math.abs(q.gap) > Math.abs(m.gap) ? q : m), b.rows[0]);
      await page.evaluate(async ({ r }) => {
        const { TANK } = await import('/src/sim/tank.js');
        const g = window.game, E = g.world.env, top = Math.max(r.y, r.want);
        E.minute = Math.floor(E.minute / 1440) * 1440 + 720; g.setSpeed(0); g.rig.stopOrbit(); g.rig.moved = true;
        // from in front of the glass, a little above the water, wide enough to hold the floater and its water
        g.controls.setLookAt(r.x * 0.7, top + 8, TANK.d / 2 + 30 + Math.abs(r.y - r.want) * 1.2, r.x, (r.want + top) / 2 + 2, r.z, false);
      }, { r });
      await page.waitForTimeout(2500);
      await shot(`float-${id}`);
      await page.evaluate(() => window.game.setSpeed(1));
    }
  }
  console.log(`FLOAT-PLANTS ${bad} of ${list.length} fail`);
};
