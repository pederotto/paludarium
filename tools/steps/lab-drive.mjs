// Test lab drives (src/lab/driver.js, sim/labdrive.js, the hooks in Animals): a figure of eight on a representative of every kind
// the lab can drive, then a go-to and a follow of a wandering dot. Prints one line per animal: waypoints reached, laps, distance off
// the line, how fast it went. Desktop only. Needs the dev server:
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-drive.mjs --out=test-output/lab
//   LAB_SECONDS=30 (real seconds per animal, at 4x animal time)   LAB_ONLY=toad,gecko
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const seconds = +(process.env.LAB_SECONDS ?? 12);
  const only = process.env.LAB_ONLY ? process.env.LAB_ONLY.split(',') : null;
  const LAND = ['dartfrog', 'leucomelas', 'redeye', 'reedfrog', 'bumblebee', 'toad', 'firesal', 'gecko', 'skink', 'panther'];
  const WET = ['neon', 'betta', 'axolotl', 'cory'];
  const one = async (id, wet) => {
    await page.evaluate(([id, wet]) => {
      const lab = window.lab;
      lab.L.sel.value = null; lab.clear();
      if (wet) { lab.ground('flat'); lab.depth(12); } else { lab.ground('flat'); lab.depth(0); }
      lab.rate(4); lab.pause(false);
      lab.add(id, 1, 0, 0);
      lab.L.pace.value = 1; lab.L.size.value = 28; lab.L.pathMode.value = 'loop';
      lab.driver.path('figure8');
    }, [id, wet]);
    await page.waitForTimeout(seconds * 1000);
    return page.evaluate(() => {
      const lab = window.lab, a = lab.L.sel.value, S = a.lab?.stats, D = a.lab?.drive;
      return { id: a.sp, kind: lab.L.info.value?.kind, reached: D?.reached, laps: D?.laps, n: D?.pts.length, t: S?.t, dist: S?.dist, xte: S?.xteN ? S.xteSum / S.xteN : null, xteMax: S?.xteMax, speed: a.speedNow, table: window.lab.game.world.animals.constructor && null, pos: [a.pos.x, a.pos.y, a.pos.z], ok: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite) };
    });
  };
  const rows = [];
  for (const id of LAND) if (!only || only.includes(id)) rows.push(await one(id, false));
  for (const id of WET) if (!only || only.includes(id)) rows.push(await one(id, true));
  console.log('species      kind      reached/laps  t(s)  walked(cm)  avg(cm/s)  off-line mean/max(cm)');
  for (const r of rows) {
    const avg = r.t > 0 ? r.dist / r.t : 0;
    console.log(`${r.id.padEnd(12)} ${String(r.kind).padEnd(9)} ${String(r.reached).padStart(4)}/${String(r.n).padEnd(4)} ${String(r.laps).padStart(2)}   ${r.t?.toFixed(0).padStart(4)}  ${r.dist?.toFixed(0).padStart(8)}  ${avg.toFixed(2).padStart(8)}   ${r.xte != null ? r.xte.toFixed(1) : '—'} / ${r.xteMax?.toFixed(1) ?? '—'}${r.ok ? '' : '   NaN!'}`);
  }
  const bad = rows.filter((r) => !r.ok || !(r.dist > 8));
  console.log(bad.length ? `FAIL ${bad.length} animals hardly moved: ${bad.map((r) => r.id).join(', ')}` : `PASS every animal got going along its figure of eight (more than 8 cm walked)`);
  // Go to a tapped point, and follow a dot that wanders about: one of each kind, on dry ground (fish in water).
  const GO = [['toad', false], ['dartfrog', false], ['gecko', false], ['skink', false], ['panther', false], ['firesal', false], ['neon', true], ['axolotl', true]];
  console.log('\ngo to (22, 12) from (-20, -8), then follow a wandering dot for the same time');
  for (const [id, wet] of GO) {
    if (only && !only.includes(id)) continue;
    const r = await page.evaluate(async ([id, wet, seconds]) => {
      const lab = window.lab;
      lab.clear(); lab.ground('flat'); lab.depth(wet ? 12 : 0); lab.rate(4); lab.pause(false);
      lab.add(id, 1, -20, -8);
      lab.driver.goto(22, 12);
      const t0 = performance.now();
      let arrived = null;
      while (performance.now() - t0 < seconds * 1000) { await new Promise((r) => setTimeout(r, 250)); if (lab.L.sel.value.lab.drive.done) { arrived = (performance.now() - t0) / 1000; break; } }
      const a = lab.L.sel.value, d0 = Math.hypot(a.pos.x - 22, a.pos.z - 12);
      lab.L.dotKind.value = 'wander'; lab.L.dotSpeed.value = 3; lab.L.keep.value = 4;
      lab.driver.follow();
      const dot = [...lab.driver.dots.values()][0];
      let near = 0, n = 0;
      const t1 = performance.now();
      while (performance.now() - t1 < seconds * 1000) { await new Promise((r) => setTimeout(r, 250)); n++; if (Math.hypot(a.pos.x - dot.x, a.pos.z - dot.z) < 12) near++; }
      return { id, arrived, d0, nearShare: near / n, dot: [dot.x, dot.z], pos: [a.pos.x, a.pos.z] };
    }, [id, wet, seconds * 1.5]);
    console.log(`${r.id.padEnd(10)} go-to: ${r.arrived != null ? `arrived after ${r.arrived.toFixed(0)} s real` : `not there (${r.d0.toFixed(1)} cm short)`}   follow: within 12 cm of the dot ${(r.nearShare * 100).toFixed(0)} % of the time`);
  }
  const errs = await page.evaluate(() => window.__errs.filter((e) => !/403|font/i.test(e)));
  console.log(errs.length ? `FAIL page errors: ${errs.slice(0, 3).join(' | ')}` : 'PASS no page errors');
  await page.evaluate(() => { const lab = window.lab; lab.clear(); lab.ground('flat'); lab.depth(0); lab.rate(2); lab.add('toad', 1, 0, 0); lab.view('top'); lab.driver.path('figure8'); });
  await page.waitForTimeout(14000);
  await shot('lab-drive-toad-8');
};
