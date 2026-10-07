// Test lab: animals and what is in the way (sim/labroute.js, Animals.labSteer, the gecko's crossing, wallNeed). Found by the owner's reports of 6 Oct 2026:
// "3 toads and 4 logs, they can't do the 8 path", "geckos can't transition back from wall to ground", "the crocodile skink got its head through the back wall".
//   A  a gecko goes over the foot of the wall as one movement (no step bigger than a stride, no radar teleport), both ways
//   B  every walker sent at the back relief ends with its drawn nose, tail and sides in front of it
//   C  a figure of eight across four logs (the owner's arena): each species keeps going, as it does without the logs
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-avoid.mjs --out=test-output/lab
//   LAB_SECONDS=30 (real seconds per species in C, at 4x)   LAB_ONLY=toad,gecko (C and B)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  const only = process.env.LAB_ONLY ? process.env.LAB_ONLY.split(',') : null;

  // --- A: the gecko over the foot of the wall ---
  const cross = async (from, drive, secs) => page.evaluate(async ([from, drive, secs]) => {
    const lab = window.lab;
    await lab.apply({ v: 1, tank: 'column', ground: 'flat', depth: 0, rate: 1, obstacles: [], animals: [from], dots: [] });
    lab.radar.clear(); lab.rate(1); lab.pause(false);
    const A = lab.game.world.animals, a = A.all[0];
    if (drive) lab.driver.assign(a, drive);
    let last = null, worst = 0, crossed = 0, t0 = A.t;
    while (A.t - t0 < secs) {
      await new Promise((r) => setTimeout(r, 40));
      const t = A.t;
      if (last && t - last.t > 0.005) { const d = Math.hypot(a.pos.x - last.x, a.pos.y - last.y, a.pos.z - last.z); worst = Math.max(worst, d); if (a.gx) crossed += t - last.t; }
      last = { t, x: a.pos.x, y: a.pos.y, z: a.pos.z };
    }
    const kinds = {}; for (const r of lab.radar.rows()) kinds[r.kind] = (kinds[r.kind] ?? 0) + r.n;
    return { worst, crossed, onWall: !!(a.onWall || a.wallMode), done: a.lab?.drive?.done, pos: [a.pos.x, a.pos.y, a.pos.z], kinds, finite: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite) };
  }, [from, drive, secs]);
  const down = await cross({ sp: 'gecko', x: 0, y: 16, z: -19.9, yaw: 0, wall: true }, { type: 'goto', x: 0, z: 3 }, 12);
  ok(!down.onWall && down.done && down.finite, 'a gecko on the wall sent to a floor point gets down and there', JSON.stringify({ pos: down.pos.map((v) => +v.toFixed(1)), done: down.done }));
  ok(down.worst < 1.2 && !down.kinds.teleport, 'the way down is one movement: no step over 1.2 cm per 40 ms, no radar teleport', `worst step ${down.worst.toFixed(2)} cm, radar ${JSON.stringify(down.kinds)}`);
  ok(down.crossed > 0.5, 'and it takes time (the body turns over the foot of the wall, legs stepping)', `${down.crossed.toFixed(2)} s`);
  const up = await cross({ sp: 'gecko', x: 0, z: -10, yaw: Math.PI }, { type: 'goto', wall: true, x: 0, y: 22, z: -20 }, 14);
  ok(up.onWall && up.done && up.finite, 'a gecko on the floor sent to a point on the wall gets up and there', JSON.stringify({ pos: up.pos.map((v) => +v.toFixed(1)), done: up.done }));
  ok(up.worst < 1.2 && !up.kinds.teleport, 'the way up is one movement too', `worst step ${up.worst.toFixed(2)} cm, radar ${JSON.stringify(up.kinds)}`);

  // --- B: the drawn body against the back relief ---
  const WALKERS = ['toad', 'dartfrog', 'skink', 'panther', 'firesal', 'newt'].filter((s) => !only || only.includes(s));
  for (const sp of WALKERS) for (const yaw of [Math.PI, Math.PI / 2]) {
    const r = await page.evaluate(async ([sp, yaw]) => {
      const lab = window.lab;
      await lab.apply({ v: 1, tank: 'column', ground: 'flat', depth: 0, rate: 4, obstacles: [], animals: [{ sp, x: 0, z: -9, yaw, drive: { type: 'goto', x: 0, z: -21.5, tol: 0.3 } }], dots: [] });
      lab.radar.clear(); lab.rate(4); lab.pause(false);
      await new Promise((r) => setTimeout(r, 14000));
      const A = lab.game.world.animals, a = A.all[0];
      if (!a) return null;
      const s = lab.SPECIES[a.sp], W = lab.game.world, bx = A.bodyBox(a, s);
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), y = a.pos.y + 0.6, zm = (bx.z0 + bx.z1) / 2;
      const m = [[bx.z1, 0], [bx.z0, 0], [zm, bx.X], [zm, -bx.X]].map(([l, w]) => { const px = a.pos.x + fx * l + fz * w, pz = a.pos.z + fz * l - fx * w; return pz - W.wall.zAt(px, y); });
      return { z: a.pos.z, min: Math.min(...m) };
    }, [sp, yaw]);
    if (!r) { console.log(`SKIP ${sp}: not in this build`); continue; }
    ok(r.min > -0.06, `${sp} sent at the back relief (heading ${yaw > 3 ? 'at it' : 'along it'}): its drawn body stays in front of it`, `closest ${r.min.toFixed(2)} cm, standing at z ${r.z.toFixed(1)}`);
  }

  // --- C: a figure of eight across four logs ---
  const LOGS = [{ kind: 'wood', x: 2.84, z: 4.16, size: 23, rot: 0 }, { kind: 'wood', x: -15.38, z: -13.1, size: 23, rot: 0 }, { kind: 'wood', x: 2.08, z: 12.77, size: 23, rot: Math.PI / 2 }, { kind: 'wood', x: -1.91, z: -12.09, size: 23, rot: Math.PI / 2 }];
  const STARTS = [[0.2, 0.9, 0.57, 1.35], [4.8, 2, -0.97, 1.48], [8.2, -2.2, 2.21, 5.02]];
  const seconds = +(process.env.LAB_SECONDS ?? 30);
  console.log('\nfigure of eight across four logs: 3 of each, waypoints reached / skipped (inside a log), radar');
  for (const sp of ['toad', 'dartfrog', 'gecko', 'skink', 'panther', 'firesal'].filter((s) => !only || only.includes(s))) {
    const run = async (logs) => page.evaluate(async ([sp, logs, starts, seconds]) => {
      const lab = window.lab;
      await lab.apply({ v: 1, tank: 'column', ground: 'flat', depth: 0, rate: 4, obstacles: logs, animals: starts.map(([x, z, yaw, h]) => ({ sp, x, z, yaw, drive: { type: 'path', shape: 'figure8', size: 28, mode: 'loop', cx: x, cz: z, sx: x, sz: z, h, pace: 1, gait: 'auto' } })), dots: [] });
      lab.radar.clear(); lab.rate(4); lab.pause(false);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const kinds = {}; for (const x of lab.radar.rows()) kinds[x.kind] = (kinds[x.kind] ?? 0) + x.n;
      const an = lab.game.world.animals.all.filter((a) => a.sp === sp).map((a) => ({ reached: a.lab.drive.reached, skipped: a.lab.drive.skipped ?? 0, fin: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite) }));
      return { an, kinds };
    }, [sp, logs, STARTS, seconds]);
    const withLogs = await run(LOGS), free = await run([]);
    const tot = (r) => r.an.reduce((s, a) => s + a.reached, 0);
    // (three animals in a pocket of logs: most of them keep making progress along the line, as they do without the logs; before the planner
    // every one of them stood at its first or second waypoint, 1 to 3 of 72)
    ok(withLogs.an.every((a) => a.fin) && withLogs.an.filter((a) => a.reached >= 4).length >= 2,
      `${sp}: keeps going across the logs (reached ${withLogs.an.map((a) => a.reached).join('/')} against ${free.an.map((a) => a.reached).join('/')} without them)`,
      `skipped ${withLogs.an.map((a) => a.skipped).join('/')}, radar ${JSON.stringify(withLogs.kinds)}`);
  }
  const errs = await page.evaluate(() => (window.__errs ?? []).filter((e) => !/403|font/i.test(e)));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
};
