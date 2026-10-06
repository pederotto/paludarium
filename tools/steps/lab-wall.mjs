// Test lab: a climber sent to a point on the background wall (sim/labdrive.js goto wall, Animals.labHerp). A gecko goes floor -> wall
// point -> another wall point -> back down to the floor; one that starts on the wall goes to a point; a toad is refused.
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-wall.mjs --out=test-output/lab
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  const leg = (label, start, goal) => page.evaluate(async ([label, start, goal]) => {
    const lab = window.lab, W = lab.game.world;
    if (start) { await lab.arena({ ground: 'flat', depth: 0 }); lab.rate(4); lab.pause(false); start.wall ? lab.addOnWall('gecko', 1, start.x, start.y) : lab.add('gecko', 1, start.x, 0); }
    const a = lab.L.sel.value;
    if (goal.wall) lab.driver.gotoWall(goal.x, goal.y, W.wall.zAt(goal.x, goal.y)); else lab.driver.goto(goal.x, goal.z);
    const t0 = performance.now(); let done = null;
    while (performance.now() - t0 < 45000) { await new Promise((r) => setTimeout(r, 250)); if (a.lab.drive.done) { done = (performance.now() - t0) / 1000; break; } }
    const kinds = {}; for (const x of lab.radar.rows()) kinds[x.kind] = (kinds[x.kind] ?? 0) + x.n;
    return { label, done, onWall: !!(a.onWall || a.wallMode), pos: [a.pos.x, a.pos.y, a.pos.z].map((v) => +v.toFixed(1)), off: goal.wall ? Math.hypot(a.pos.x - goal.x, a.pos.y - goal.y) : Math.hypot(a.pos.x - goal.x, a.pos.z - goal.z), kinds, finite: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite) };
  }, [label, start, goal]);

  const r1 = await leg('floor -> wall (-15, 30)', { x: 0 }, { wall: true, x: -15, y: 30 });
  console.log(JSON.stringify(r1));
  ok(r1.done != null && r1.onWall && r1.off < 4.5 && r1.finite, 'a gecko from the floor climbs to a point on the wall', `${r1.done?.toFixed(0)} s real, ${r1.off.toFixed(1)} cm off`);
  const r2 = await leg('wall -> wall (20, 45)', null, { wall: true, x: 20, y: 45 });
  console.log(JSON.stringify(r2));
  ok(r2.done != null && r2.onWall && r2.off < 4.5, 'and from there to another point on the wall', `${r2.done?.toFixed(0)} s real, ${r2.off.toFixed(1)} cm off`);
  await page.evaluate(() => window.lab.view('back'));
  await page.waitForTimeout(1500);
  await shot('lab-wall-goto');
  const wasOnWall = await page.evaluate(() => { const a = window.lab.L.sel.value; return !!(a.onWall || a.wallMode); });
  const r3 = await leg('wall -> floor (10, 5)', null, { x: 10, z: 5 });
  console.log(JSON.stringify(r3));
  ok(wasOnWall && r3.done != null && !r3.onWall && r3.off < 4.5, 'and back down to a point on the floor', `${r3.done?.toFixed(0)} s real, ${r3.off.toFixed(1)} cm off`);
  const r4 = await leg('starts on the wall (-30, 20) -> (30, 35)', { wall: true, x: -30, y: 20 }, { wall: true, x: 30, y: 35 });
  console.log(JSON.stringify(r4));
  ok(r4.done != null && r4.onWall && r4.off < 4.5, 'one that starts on the wall goes to a point on it', `${r4.done?.toFixed(0)} s real, ${r4.off.toFixed(1)} cm off`);

  // The real tap: the Go to tab, then a click on the wall in the picture (the camera on the Back view), as a person does it.
  await page.evaluate(async () => { const lab = window.lab; await lab.arena({ ground: 'flat', depth: 0 }); lab.rate(4); lab.pause(false); lab.add('gecko', 1, 0, 0); lab.view('back'); });
  await page.waitForTimeout(2500);
  const px = await page.evaluate(() => { const lab = window.lab, cam = lab.game.camera, W = lab.game.world; const v = new cam.position.constructor(12, 30, W.wall.zAt(12, 30)); v.project(cam); const r = lab.game.renderer.domElement.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; });
  await page.evaluate(() => { window.lab.L.tab.value = 'sel'; window.lab.L.dtab.value = 'goto'; window.lab.L.pick.value = 'goto'; });
  await page.mouse.click(px.x, px.y);
  await page.waitForTimeout(800);
  const tap = await page.evaluate(() => { const a = window.lab.L.sel.value, D = a.lab?.drive; return D ? { type: D.type, wall: D.wall, x: D.x, y: D.y, pick: window.lab.L.pick.value } : null; });
  ok(tap?.wall === true && Math.abs(tap.x - 12) < 2.5 && Math.abs(tap.y - 30) < 2.5 && tap.pick === null, 'a tap on the wall in the picture sends the gecko to that point', JSON.stringify(tap));
  await page.waitForTimeout(6000);
  const arrived = await page.evaluate(() => { const a = window.lab.L.sel.value; return { done: a.lab.drive.done, onWall: !!(a.onWall || a.wallMode), off: Math.hypot(a.pos.x - 12, a.pos.y - 30) }; });
  ok(arrived.done && arrived.onWall && arrived.off < 4, 'and it gets there', JSON.stringify(arrived));
  await shot('lab-wall-tap');

  // A toad cannot: the lab says so and gives it no drive.
  const t = await page.evaluate(async () => { const lab = window.lab; await lab.arena({ ground: 'flat', depth: 0 }); lab.add('toad', 1, 0, 0); const a = lab.L.sel.value; const r = lab.driver.gotoWall(0, 30, -22); return { r, drive: !!a.lab?.drive, note: lab.L.note.value }; });
  ok(t.r === false && !t.drive && /climber/i.test(t.note), 'a toad sent to the wall is refused with a reason', JSON.stringify(t));

  // The wall goal survives the scenario format.
  const sc = await page.evaluate(async () => {
    const lab = window.lab; await lab.arena({ ground: 'flat', depth: 0 }); lab.add('gecko', 1, 0, 0); lab.driver.gotoWall(-10, 25, lab.game.world.wall.zAt(-10, 25));
    const spec = lab.snapshot(); await lab.apply(spec); const a = lab.L.sel.value;
    return { drive: spec.animals[0].drive, back: a.lab?.drive?.wall, y: a.lab?.drive?.y };
  });
  ok(sc.drive?.wall === true && sc.back === true && sc.y === 25, 'a wall go-to is saved and restored with the lab', JSON.stringify(sc.drive));
  const errs = await page.evaluate(() => window.__errs.filter((e) => !/403|font/i.test(e)));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
};
