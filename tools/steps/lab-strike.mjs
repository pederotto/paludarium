// Test lab: a one-body frog (the common frog, gate 4, 7 Oct 2026) hunting in the lab arena: its strikes drive its own jaw, hyoid and tongue bones
// (util/frogstrike.js, render/creatures/skeleton.js poseHead), it sits in its own body, it never walks (sp.noWalk: it hops). Needs the dev server:
//   node tools/shot.mjs --url=http://localhost:4620/lab.html --steps=tools/steps/lab-strike.mjs --out=test-output/lab-strike --only=desktop
// Prints PASS/FAIL lines and takes pictures: sitting, mid-strike (the tongue out), and the gulp.
export default async (page, shot, name) => {
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${label}${extra ? ' ' + extra : ''}`);
  const id = process.env.FROG ?? 'commonfrog';
  const rel = await page.evaluate(async ([id, preyId]) => {
    window.__prey = preyId;
    const lab = window.lab; await lab.arena({ ground: 'flat', depth: 0 }); lab.rate(1); lab.pause(false);
    const f = lab.add(id, 1, 0, 0), prey = lab.add(preyId, 8, 14, 0);      // (ahead of it, beyond the reach of one lunge: it closes in, then strikes)
    const a = f.added[0]; if (a) { a.yaw = Math.PI / 2; a.hunger = 0.9; lab.focus(a); }      // (hungry: a frog hunts above 0.3; the prey ahead, beyond its lunge: it closes in with a hop, then strikes)
    window.__fr = { a, log: [], strikes: 0, got: 0, maxT: 0, walk: 0, hops: 0, last: null, lastHop: false, prey: null, goneAt: null };
    return { frog: f.added.length, prey: prey.added.length, err: f.error ?? prey.error ?? null };
  }, [id, process.env.PREY ?? 'flylarva']);
  ok(rel.frog === 1, `release a ${id}`, JSON.stringify(rel));
  if (!rel.frog) return;
  // watch: 60 samples a second of game time for up to 30 s, until a strike has been seen through
  let pics = { sit: false, out: false, gulp: false };
  for (let i = 0; i < 600; i++) {
    const s = await page.evaluate((i) => {
      const R = window.__fr, a = R.a; if (!a || a.dead) return { dead: true };
      const ph = a.st?.ph ?? null;
      if (ph === 'out' && R.last !== 'out') R.strikes++;
      if (ph === 'gulp' && R.last !== 'gulp') R.got++;
      if (a.fs === 'walk') R.walk++;
      if (a.hop && !R.lastHop) R.hops++;
      R.lastHop = !!a.hop; R.last = ph; R.maxT = Math.max(R.maxT, a.strikeT ?? 0);
      if (a.st?.got) R.prey = a.st.prey;
      if (a.st?.inMouth && R.goneAt == null) R.goneAt = a.st.inMouth;      // (the catch swallowed: where on the timeline the sim did it)
      if (i % 40 === 0) window.lab.focus(a);
      if (!a.order && !a.st && i % 20 === 0) window.lab.game.world.animals.order(a, window.__prey);      // (the meal made due, as the sim does when its clock says so: the frog hunts the nearest)
      return { ph, t: a.strikeT ?? 0, fs: a.fs, strikes: R.strikes, got: R.got, walk: R.walk, hops: R.hops, maxT: R.maxT, goneAt: R.goneAt, nan: ![a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite) };
    }, i);
    if (s.dead) break;
    if (!pics.sit && i > 20 && !s.ph) { pics.sit = true; await shot('commonfrog-sitting'); }
    if (!pics.out && s.ph && s.t > 0.3 && s.t < 0.5) { pics.out = true; await page.evaluate(() => { window.lab.pause(true); const a = window.__fr.a, c = window.lab.game.rig.controls, fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      c.setLookAt(a.pos.x + fz * 24 + fx * 5, a.pos.y + 4, a.pos.z - fx * 24 + fz * 5, a.pos.x + fx * 5, a.pos.y + 3, a.pos.z + fz * 5, false); });      // (from its side)
      await page.waitForTimeout(300); await shot('commonfrog-strike'); await page.evaluate(() => window.lab.pause(false)); }
    if (!pics.gulp && s.ph === 'gulp') { pics.gulp = true; await shot('commonfrog-gulp'); }
    if (s.got >= 1 && i > 60 && !s.ph) { console.log('stopped after the first catch at sample', i); Object.assign(pics, { s }); break; }
    pics.s = s;
    await page.waitForTimeout(50);
  }
  const s = pics.s ?? {};
  const errs = await page.evaluate(() => (window.__errs ?? []).filter((e) => !/403|font/i.test(e)));
  ok(s.strikes > 0, 'it strikes at its prey', `strikes ${s.strikes}, catches ${s.got}, hops ${s.hops}`);
  ok(s.maxT > 0.35, 'the strike timeline runs through contact', `max strikeT ${(s.maxT ?? 0).toFixed(2)}`);
  ok(s.got > 0 && s.goneAt != null && s.goneAt <= 0.84, 'the catch is gone into the mouth by the time the jaws shut', `swallowed at strikeT ${s.goneAt?.toFixed?.(2)}`);
  ok(s.walk === 0, 'it never walks (hops only)', `walk samples ${s.walk}`);
  ok(!s.nan, 'no NaN position');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
};
