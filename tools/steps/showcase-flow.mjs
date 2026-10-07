// S3 canyon/highland probe: builds a showcase layout on tiers x seeds (PRESETS, TIERS, SEEDS, HOURS=72) after the title click,
// measures litres, pump L/h, falls, pools, wet cells, speed (p50/p90 in running water), river span (% of tank width, wet-cell
// extent outside the main pool and with it), drift of level/litres after HOURS game hours, takes the default-camera shot.
//   PRESETS=canyon TIERS=long SEEDS=1 sh "$BB/tools/gate.sh" S3 sh "$BB/tools/with-server.sh" sh -c 'node tools/shot.mjs --url="$SERVER_URL$WEBGL" --only=desktop --steps=tools/steps/showcase-flow.mjs --out="$BB/shots/S3/x"'
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  await page.getByRole('button', { name: /sandbox: an empty tank/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const ids = (process.env.PRESETS ?? 'canyon').split(','), tiers = (process.env.TIERS ?? 'long').split(','), seeds = (process.env.SEEDS ?? '1').split(',').map(Number);
  const hours = +(process.env.HOURS ?? 72);
  const measure = () => page.evaluate(() => {
    const W = window.game.world, H = W.water.hydro, f = H.f, spd = [];
    let wet = 0, x0 = 1e9, x1 = -1e9, r0 = 1e9, r1 = -1e9;
    for (let c = 0; c < H.d.length; c++) {
      const res = !!H.res?.[c], wetc = H.d[c] >= 0.3 || res;
      if (!wetc) continue;
      const x = (c % f.cols) * f.da - TANK_W / 2;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      if (res) continue;
      wet++; r0 = Math.min(r0, x); r1 = Math.max(r1, x);
      const s = Math.hypot(H.vx[c], H.vz[c]); if (s > 0.05) spd.push(s);
    }
    const bins = Array.from({ length: 10 }, () => ({ n: 0, s: 0 }));
    for (let c = 0; c < H.d.length; c++) { if (H.res?.[c] || H.d[c] < 0.3) continue; const k = Math.min(9, Math.floor(((c % f.cols) * f.da) / TANK_W * 10)); bins[k].n++; bins[k].s += Math.hypot(H.vx[c], H.vz[c]); }
    const prof = bins.map((b) => b.n ? `${b.n}@${(b.s / b.n).toFixed(0)}` : '-').join(' ');
    const T = W.terrain; const map = [];
    for (let r = 0; r < f.rows; r += 2) { let line = ''; for (let c = 0; c < f.cols; c += 2) { const i = r * f.cols + c; const g0 = T.field?.h?.[i] ?? 0; line += H.res?.[i] ? '~' : H.d[i] >= 0.3 ? (Math.hypot(H.vx[i], H.vz[i]) > 12 ? '>' : '=') : String(Math.min(9, Math.floor(g0 / 5))); } map.push(line); }
    const o = H.outlets[0]; const dbg = o ? { pos: [o.pos.x, o.pos.y, o.pos.z].map((v) => +v.toFixed(1)), q: +o.q.toFixed(1), ground: +W.terrain.heightAt(o.pos.x, o.pos.z).toFixed(1), d: [0, 2, 4, 8, 12, 20].map((k) => +H.d[H.cellOf(o.pos.x + k, o.pos.z)].toFixed(2)), g: [0, 2, 4, 8, 12, 20].map((k) => +W.terrain.heightAt(o.pos.x + k, o.pos.z).toFixed(1)) } : null;
    const fish = {};
    for (const an of W.animals.all) { if (!['hillloach', 'zacco', 'bullhead', 'shrimp'].includes(an.sp)) continue; const B = W.water.bodies.at(an.pos.x, an.pos.z); const c = H.cellOf(an.pos.x, an.pos.z); const v = Math.hypot(H.vx[c], H.vz[c]); (fish[an.sp] ??= []).push(`${(B?.flow ?? W.env.flow).toFixed(2)}/${v.toFixed(0)}`); }
    spd.sort((a, b) => a - b);
    const q = (p) => spd.length ? +spd[Math.min(spd.length - 1, Math.floor(p * spd.length))].toFixed(1) : 0;
    return { litres: +(H.total() / 1000).toFixed(1), level: +H.level.toFixed(2), pumpLph: +H.pump.lph.toFixed(0), outlets: H.outlets.length, falls: H.falls.length, fallQ: H.falls.slice(0, 3).map((x) => +x.q.toFixed(1)), pools: H.pools?.length ?? 0, wetCells: wet, speed: { n: spd.length, p50: q(0.5), p90: q(0.9), max: q(0.999) }, runSpanPct: +(100 * (r1 - r0) / TANK_W).toFixed(0), wetSpanPct: +(100 * (x1 - x0) / TANK_W).toFixed(0), prof, fish, dbg, map, topUp: +(H.topUpLph ?? 0).toFixed(1) };
  }).catch((e) => ({ err: String(e) }));
  const rows = [];
  for (const id of ids) for (const tier of tiers) for (const seed of seeds) {
    const info = await page.evaluate(async ({ id, tier, seed }) => {
      const gen = await import('/src/sim/generator.js');
      const sc = await import('/src/content/presets-showcase.js');
      if (!gen.PRESETS[id]) { Object.assign(gen.PRESETS, sc.SHOWCASE_LAYOUTS); for (const [k, s] of Object.entries(sc.SHOWCASE_SETS)) Object.assign(gen.PRESETS[k], s); }
      window.TANK_W = (await import('/src/sim/tank.js')).TANK.w;
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      window.TANK_W = (await import('/src/sim/tank.js')).TANK.w;
      const t0 = performance.now();
      const r = gen.generateTerrarium(w, { preset: id, seed, tier });
      return { genMs: Math.round(performance.now() - t0), litres: r.litres, animals: r.animals, plants: r.plants, falls: r.falls, pools: r.pools, warnings: r.warnings };
    }, { id, tier, seed });
    await page.evaluate(() => window.game.settle?.());
    await page.waitForTimeout(3000);
    const t0 = await measure();
    await shot(`${id}-${tier}-s${seed}`);
    await page.evaluate((hrs) => { for (let i = 0; i < hrs; i++) window.game.world.sim.step(60); }, hours);
    await page.waitForTimeout(2000);
    const t1 = await measure();
    rows.push({ id, tier, seed, info, t0, t1, driftLevel: +(t1.level - t0.level).toFixed(2), driftLitres: +(t1.litres - t0.litres).toFixed(1) });
  }
  const { execSync } = await import('node:child_process');
  let head = '?';
  try { head = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src tools').toString().trim() ? ' dirty' : ''); } catch { /* none */ }
  console.log(`showcase-flow HEAD ${head} stamp canyon-v1 hours=${hours}`);
  for (const r of rows) { console.log(JSON.stringify({ ...r, t0: { ...r.t0, map: undefined }, t1: { ...r.t1, map: undefined } })); if (process.env.MAP) console.log(r.t0.map.join('\n')); }
  console.log(`errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);
};
