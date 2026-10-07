// S3 "before" baseline: builds the existing `stream` and `cascade` layouts on given tiers (TIERS=long,show) for seed(s)
// (SEEDS=1) and measures the water: litres, pump lph, outlets, falls, pools, wet-cell count and surface speed in running
// water (cm/s of vx,vz over cells with 0.3 < d, outside the main pool) after a settle, then screenshots the default camera.
// Stamp: git short HEAD + dirty. Used through the gate:
//   PRESETS=stream,cascade TIERS=long,show SEEDS=1 sh "$BB/tools/gate.sh" S3 sh "$BB/tools/with-server.sh" sh -c 'node tools/shot.mjs --url="$SERVER_URL" --only=desktop --steps=tools/steps/showcase-before.mjs --out="$BB/shots/S3/before"'
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  const ids = (process.env.PRESETS ?? 'stream,cascade').split(',');
  const tiers = (process.env.TIERS ?? 'long,show').split(',');
  const seeds = (process.env.SEEDS ?? '1').split(',').map(Number);
  const measure = () => page.evaluate(async () => {
    const W = window.game.world, H = W.water.hydro;
    const spd = [];
    let wet = 0;
    for (let c = 0; c < H.d.length; c++) {
      if (H.res?.[c]) continue;
      if (H.d[c] >= 0.3) { wet++; const s = Math.hypot(H.vx[c], H.vz[c]); if (s > 0.05) spd.push(s); }
    }
    spd.sort((a, b) => a - b);
    const q = (p) => spd.length ? +spd[Math.min(spd.length - 1, Math.floor(p * spd.length))].toFixed(1) : 0;
    const pools = H.pools?.length ?? 0;
    return { litres: +(H.total() / 1000).toFixed(1), reservoirL: +(H.resVol / 1000).toFixed(1), level: +H.level.toFixed(1), pumpLph: +H.pump.lph.toFixed(0), rateSet: H.pump.rate, outlets: H.outlets.length, falls: H.falls.length, fallQ: H.falls.slice(0, 4).map((f) => +f.q.toFixed(1)), pools, wetCells: wet, speedCmS: { n: spd.length, p50: q(0.5), p90: q(0.9), max: q(0.999) }, topUpLph: +(H.topUpLph ?? 0).toFixed(1) };
  });
  const rows = [];
  for (const id of ids) for (const tier of tiers) for (const seed of seeds) {
    const info = await page.evaluate(async ({ id, tier, seed }) => {
      const gen = await import('/src/sim/generator.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      const r = gen.generateTerrarium(w, { preset: id, seed, tier });
      return { litres: r.litres, animals: r.animals };
    }, { id, tier, seed });
    await page.waitForTimeout(3000);
    const t0 = await measure();
    // 3 game minutes... 6 game hours of water steps to see drift
    await page.evaluate(() => { for (let i = 0; i < 6; i++) window.game.world.sim.step(60); });
    await page.waitForTimeout(2000);
    const t1 = await measure();
    await shot(`before-${id}-${tier}-s${seed}`);
    rows.push({ id, tier, seed, info, t0, t1 });
  }
  const { execSync } = await import('node:child_process');
  let head = '?';
  try { head = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src tools').toString().trim() ? ' dirty' : ''); } catch { /* none */ }
  console.log(`showcase-before HEAD ${head}`);
  for (const r of rows) console.log(JSON.stringify(r));
  console.log(`errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);
};
