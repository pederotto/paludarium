// Test lab bug radar (src/lab/radar.js, sim/labradar.js) in the live page: a crowd sent to one point must show up as findings, a
// lone animal walking a clear path must not, 'pause on a bug' freezes the clock, and the report carries the scenario. Desktop only.
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-radar.mjs --out=test-output/lab
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);

  // 1. A lone gecko on a figure of eight in open floor: a clean run.
  await page.evaluate(() => { const lab = window.lab; lab.clear(); lab.ground('flat'); lab.depth(0); lab.rate(4); lab.pause(false); lab.add('gecko', 1, 0, 0); lab.driver.path('figure8'); });
  await page.waitForTimeout(9000);
  const clean = await page.evaluate(() => window.lab.radar.rows().map((r) => `${r.kind}: ${r.msg}`));
  ok(clean.length === 0, 'a lone gecko on a clear figure of eight raises nothing', clean.slice(0, 3).join(' | '));

  // 2. Twelve frogs on a 6 cm spiral, all sent to the same point.
  await page.evaluate(() => { const lab = window.lab; lab.clear(); lab.rate(4); lab.pause(false); lab.add('dartfrog', 12, 0, 0); lab.L.all.value = true; lab.driver.goto(10, 5); });
  await page.waitForTimeout(12000);
  const crowd = await page.evaluate(() => { const r = window.lab.radar.rows(); const by = {}; for (const x of r) by[x.kind] = (by[x.kind] ?? 0) + x.n; return { n: r.length, by, first: r.slice(0, 5).map((x) => `${x.name} #${x.id} ${x.kind}: ${x.msg}`) }; });
  ok(crowd.n > 0, 'twelve frogs sent to one point show findings', JSON.stringify(crowd.by));
  console.log(crowd.first.join('\n'));
  await shot('lab-radar-crowd');

  // 3. The report: has the findings and a scenario that parses.
  const rep = await page.evaluate(() => window.lab.report());
  const scen = rep.split('\n').find((l) => l.startsWith('scenario: '));
  let parsed = null; try { parsed = JSON.parse(scen.slice(10)); } catch { /* checked below */ }
  ok(rep.includes('bug radar:') && parsed?.animals?.length === 12, 'the report lists findings and a scenario of 12 animals', `(${rep.split('\n').length} lines)`);

  // 4. Pause on a bug: a skink whose heading is made NaN by hand is a finding that is bad on its face; the clock must stop.
  //    (A body pushed under the ground is mended by the engine in the same step, before the radar looks: that is not a fault to plant.)
  const paused = await page.evaluate(async () => {
    const lab = window.lab, A = lab.game.world.animals;
    lab.clear(); lab.radar.clear(); lab.rate(1); lab.pause(false); lab.L.pauseOnBug.value = true;
    const r = lab.add('skink', 1, 0, 0), a = r.added[0];
    await new Promise((res) => setTimeout(res, 600));
    a.yaw = NaN;                                   // (a deliberate fault)
    await new Promise((res) => setTimeout(res, 800));
    const t0 = A.t; await new Promise((res) => setTimeout(res, 500));
    return { paused: lab.L.paused.value, held: A.t === t0, rows: lab.radar.rows().map((x) => x.kind) };
  });
  ok(paused.paused && paused.held && paused.rows.includes('nan'), 'pause on a bug freezes the clock on a deliberate fault', JSON.stringify(paused.rows));
  await page.evaluate(() => { window.lab.L.pauseOnBug.value = false; window.lab.pause(false); });

  const errs = await page.evaluate(() => window.__errs.filter((e) => !/403|font/i.test(e)));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
};
