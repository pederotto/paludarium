// Test lab random paths, scenarios, links and the saved session (sim/labrandom.js, src/lab/{driver,scenario,fuzz}.js). Desktop only.
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-random.mjs --out=test-output/lab
//   LAB_SECONDS=8 (real seconds per style run, at 4x)   LAB_FUZZ=3 (random scenarios)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  const seconds = +(process.env.LAB_SECONDS ?? 8);

  // 1. Random paths: every style on a few kinds; the same seed twice is the same path.
  console.log('random paths (seed 11): species / style / waypoints reached / walked cm / off-line max cm / radar');
  const STYLES = ['mixed', 'wander', 'dashes', 'tight', 'edges', 'obstacles'];
  const rows = [];
  for (const [sp, wet] of [['gecko', false], ['toad', false], ['panther', false], ['neon', true]]) for (const style of STYLES) {
    const r = await page.evaluate(async ([sp, wet, style, seconds]) => {
      const lab = window.lab;
      await lab.arena({ ground: 'flat', depth: wet ? 12 : 0 });
      lab.rate(4); lab.pause(false);
      if (!wet) { lab.obstacles.add({ kind: 'boulder', size: 10, rot: 0 }, -8, 4); lab.obstacles.add({ kind: 'step', w: 12, d: 12, h: 3, rot: 0 }, 12, -6); }
      lab.add(sp, 1, 0, 0);
      lab.L.pace.value = 1.2; lab.L.pathMode.value = 'loop';
      lab.driver.random(style, 11, { length: 240 });
      const a = lab.L.sel.value, d1 = a.lab.drive.pts.map((p) => [p.x, p.z]);
      lab.driver.random(style, 11, { length: 240 });
      const same = JSON.stringify(d1) === JSON.stringify(a.lab.drive.pts.map((p) => [p.x, p.z]));
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const S = a.lab.stats, kinds = {}; for (const x of lab.radar.rows()) kinds[x.kind] = (kinds[x.kind] ?? 0) + x.n;
      return { sp, style, same, reached: a.lab.drive.reached, n: a.lab.drive.pts.length, dist: S?.dist ?? 0, xteMax: S?.xteMax ?? 0, kinds, finite: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite) };
    }, [sp, wet, style, seconds]);
    rows.push(r);
    console.log(`  ${r.sp.padEnd(8)} ${r.style.padEnd(10)} ${String(r.reached).padStart(3)}/${String(r.n).padEnd(4)} ${r.dist.toFixed(0).padStart(5)}  ${r.xteMax.toFixed(1).padStart(5)}  ${JSON.stringify(r.kinds)}`);
  }
  ok(rows.every((r) => r.same), 'the same seed gives the same path for the same animal', `(${rows.length} runs)`);
  ok(rows.every((r) => r.finite), 'nobody is NaN after random paths');
  ok(rows.every((r) => r.dist > 5), 'every random path got the animal moving', rows.filter((r) => !(r.dist > 5)).map((r) => `${r.sp}/${r.style}`).join(' '));

  // 2. The session survives a reload; ?fresh does not restore.
  await page.evaluate(async () => {
    const lab = window.lab;
    await lab.arena({ ground: 'shore', depth: 5 });
    lab.obstacles.add({ kind: 'wall', w: 20, d: 2, h: 5, rot: 0.3 }, -20, 0); lab.obstacles.add({ kind: 'boulder', size: 10, rot: 0 }, -30, 10);
    lab.add('toad', 2, -35, -8); lab.add('gecko', 1, -12, 8); lab.add('neon', 4, 30, 0);
    lab.L.sel.value = lab.animals()[0]; lab.driver.random('mixed', 5);
    lab.driver.follow('wander');
    lab.rate(2);
  });
  await page.waitForTimeout(3600);                       // the session is saved every 3 s
  const before = await page.evaluate(() => { const s = window.lab.snapshot(); return { animals: s.animals.length, obstacles: s.obstacles.length, dots: s.dots.length, drives: s.animals.map((a) => a.drive?.type ?? null).join(','), ground: s.ground, depth: s.depth }; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => { const s = window.lab.snapshot(); return { animals: s.animals.length, obstacles: s.obstacles.length, dots: s.dots.length, drives: s.animals.map((a) => a.drive?.type ?? null).join(','), ground: s.ground, depth: s.depth, restored: window.lab.L.restored.value, note: window.lab.L.note.value }; });
  ok(before.animals === after.animals && before.obstacles === after.obstacles && before.dots === after.dots && before.ground === after.ground && before.depth === after.depth && after.restored, 'a reload puts the lab back: animals, obstacles, dots, ground and water', `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  ok(before.drives.split(',').filter(Boolean).length === after.drives.split(',').filter(Boolean).length, 'and the animals are back on their drives', `${before.drives} -> ${after.drives}`);
  await page.goto(page.url().split('#')[0].split('?')[0] + '?fresh', { waitUntil: 'load' });
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  ok(await page.evaluate(() => window.lab.animals().length === 0 && !window.lab.L.restored.value), '?fresh starts empty');

  // 3. A link opens the same lab in a new page.
  await page.evaluate(async () => { const lab = window.lab; lab.add('dartfrog', 3, 0, 0); lab.add('gecko', 1, 10, 5); lab.obstacles.add({ kind: 'post', w: 2.5, d: 2.5, h: 8, rot: 0 }, 5, 5); lab.L.sel.value = lab.animals()[0]; lab.driver.path('circle'); });
  const link = await page.evaluate(() => window.lab.link());
  const page2 = await page.context().newPage();
  await page2.goto(link, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  await page2.waitForTimeout(1500);
  const opened = await page2.evaluate(() => { const s = window.lab.snapshot(); return { animals: s.animals.length, obstacles: s.obstacles.length, drives: s.animals.filter((a) => a.drive).length, note: window.lab.L.note.value }; });
  ok(opened.animals === 4 && opened.obstacles === 1 && opened.drives === 1, 'a link opens the same lab in a new page', `${JSON.stringify(opened)} (${link.length} characters)`);
  await page2.close();

  // 4. Random scenarios: repeatable from a seed, a small batch runs and records findings.
  const n = +(process.env.LAB_FUZZ ?? 3);
  const f = await page.evaluate(async (n) => {
    const lab = window.lab;
    const a = await lab.fuzz.one(100, 1, { keep: true }), b = await lab.fuzz.one(100, 1, { keep: true });
    await lab.fuzz.run({ n, seconds: 7, seed0: 200 });
    return { sameSpec: JSON.stringify(a.spec) === JSON.stringify(b.spec), rows: lab.L.fuzz.value.rows.map((r) => ({ seed: r.seed, animals: r.animals, obstacles: r.obstacles, ground: r.ground, depth: r.depth, bad: r.bad, warn: r.warn, kinds: r.kinds })), text: lab.fuzz.text(), running: lab.L.fuzz.value.running };
  }, n);
  ok(f.sameSpec, 'a random scenario is the same for the same seed');
  ok(f.rows.length === n && !f.running, `a batch of ${n} random scenarios ran`);
  console.log(f.text);
  const errs = await page.evaluate(() => window.__errs.filter((e) => !/403|font/i.test(e)));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await page.evaluate(() => { window.lab.view('top'); window.lab.L.tab.value = 'fuzz'; });
  await page.waitForTimeout(1500);
  await shot('lab-random');
};
