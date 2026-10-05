// N15 preset check, part 1 (build): builds every premade set on its reference tank for seeds 1-3 and reports, per build,
// the plants and animals placed, which of them the set does not list (must be none), and whether the featured animal is
// in the tank. Stamp: the generator report's `featured` field (added by N15) and the served HEAD.
// Part 2 (batch 3) adds the state-dump runs: 3 seeds x 2 game days, water/solids/pile/stuck, featured in range.
//   PRESETS=cascade,jar SEEDS=1,2,3 sh "$BB/tools/probe.sh" N15 node tools/shot.mjs --url=http://127.0.0.1:4672/ --only=desktop --steps=tools/steps/preset-check.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  const only = (process.env.PRESETS ?? '').split(',').filter(Boolean);
  const seeds = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
  const res = await page.evaluate(async ({ only, seeds }) => {
    const gen = await import('/src/sim/generator.js');
    const game = window.game;
    const ids = only.length ? only : gen.PRESET_ORDER;
    const out = [];
    for (const id of ids) {
      const P = gen.PRESETS[id];
      for (const seed of seeds) {
        const w = await game.loadTank(P.ref, { layout: 'empty' });
        const r = gen.generateTerrarium(w, { preset: id, seed, tier: P.ref });
        const plants = {};
        for (const p of w.plants.list) plants[p.id ?? p.type ?? p.sp?.id] = (plants[p.id ?? p.type ?? p.sp?.id] ?? 0) + 1;
        const animals = r.animals;
        const strayP = Object.keys(plants).filter((k) => P.plants && !P.plants.includes(k));
        const strayA = Object.keys(animals).filter((k) => P.animals && !P.animals.includes(k));
        const featured = (r.featured ?? []).map((f) => `${f}:${animals[f] ?? 0}`);
        out.push({ id, seed, tier: P.ref, stamp: r.featured ? 'N15' : 'none', featured, strayP, strayA, litres: r.litres, nPlants: w.plants.list.length, plants, animals, warnings: r.warnings?.length ?? 0 });
      }
    }
    return out;
  }, { only, seeds });
  const { execSync } = await import('node:child_process');
  let head = '?';
  try { head = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src').toString().trim() ? ' dirty' : ''); } catch { /* no git */ }
  console.log(`preset-check build, HEAD ${head}`);
  let bad = 0;
  for (const r of res) {
    const miss = r.featured.some((f) => f.endsWith(':0'));
    if (r.strayP.length || r.strayA.length || miss || r.stamp !== 'N15') bad++;
    console.log(`${r.id} s${r.seed} ${r.tier} stamp=${r.stamp} featured=${r.featured.join(',')} litres=${r.litres} nPlants=${r.nPlants} strayPlants=${r.strayP.join(',') || 0} strayAnimals=${r.strayA.join(',') || 0} plants=${JSON.stringify(r.plants)} animals=${JSON.stringify(r.animals)}`);
  }
  console.log(`builds ${res.length}, failing ${bad}; errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);
};
