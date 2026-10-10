// Test lab: the one-body common frog (gate 4, 7 Oct 2026) on terrain, the owner's "make sure it also handles obstacles and water to land transitions and vice
// versa". Needs the dev server:
//   node tools/shot.mjs --url=http://localhost:4620/lab.html --steps=tools/steps/lab-commonfrog-terrain.mjs --out=test-output/lab-cf-terrain --only=desktop
// Scenes (SCENES=wall,step,shore to pick):
//   wall   prey behind a 6 cm wall across its way: it never strikes through the wall
//   step   prey on top of a 3 cm step: it strikes up at it, or hops up and strikes
//   shore  the pool and bank: driven from the land into the pool, then back onto the land: it gets in, swims, gets out and sits, with no pose jump at either change
// Prints PASS/FAIL lines and takes pictures from the frog's side at the moments that matter.
export default async (page, shot, name) => {
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${label}${extra ? ' ' + extra : ''}`);
  const scenes = (process.env.SCENES ?? 'wall,step,shore').split(',');
  const side = () => page.evaluate(() => { const a = window.__cf, c = window.lab.game.rig.controls, fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), up = a.swimming ? 16 : 6;     // (in the water: from higher, over the bank)
    c.setLookAt(a.pos.x + fz * 26 + fx * 4, a.pos.y + up, a.pos.z - fx * 26 + fz * 4, a.pos.x + fx * 4, a.pos.y + 2, a.pos.z + fz * 4, false); });
  const pic = async (label) => { await page.evaluate(() => window.lab.pause(true)); await side(); await page.waitForTimeout(300); await shot('cf-' + label); await page.evaluate(() => window.lab.pause(false)); };
  // a sampler run in the page every tick: the frog's state, its strikes (with whether the line to the prey was clear of the ground), and the drawn body's jumps
  const watch = () => page.evaluate(() => {
    const a = window.__cf, R = window.__cfR, A = window.lab.game.world.animals, T = window.lab.game.world.terrain;
    if (!a || a.dead) return { dead: true };
    if (R.hunt && !a.order && !a.st && R.n % 20 === 0) A.order(a, 'flylarva');      // (the meal made due, as the sim does when its clock says so: it hunts the nearest)
    const ph = a.st?.ph ?? null;
    if (ph === 'out' && R.last !== 'out') {
      R.strikes++;
      const p = a.st.prey.pos, m = A.mouth(a, window.lab.SPECIES.commonfrog, a.pos.clone());
      let top = -1e9; for (let i = 1; i < 8; i++) { const k = i / 9; top = Math.max(top, T.heightAt(m.x + (p.x - m.x) * k, m.z + (p.z - m.z) * k) - (m.y + (p.y - m.y) * k)); }
      if (top > 0.3) R.through++;
    }
    if (ph === 'gulp' && R.last !== 'gulp') R.got++;
    R.last = ph;
    const body = a.swimming ? 'swim' : a.hop ? 'hop' : 'land';
    if (body !== R.body) { R.changes.push(`${R.body}>${body}`); R.body = body; }
    if (a.swimming) R.swam++;
    if (![a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite)) R.nan = true;
    // (the drawn body: where the instance was put, frame to frame; a jump of more than 2 cm in one tick that the sim's own position did not make is a pop: the model's origin sweeps round the hips as the body pitches, 1.0-1.5 cm a tick on a 12 cm hop before the hop started from the sit stance on 9 Oct, 1.3-1.8 after it, the stance lifting the origin 1.1 cm further from the hips)
    const d = a.drawnAt; if (d) { if (R.dp && R.pp) { const jump = Math.hypot(d.x - R.dp.x, d.y - R.dp.y, d.z - R.dp.z) - Math.hypot(a.pos.x - R.pp.x, a.pos.y - R.pp.y, a.pos.z - R.pp.z); if (jump > R.pop) { R.pop = jump; R.popAt = `${R.body} t ${R.n}`; } } R.dp = { ...d }; R.pp = a.pos.clone(); }
    R.n++;
    return { ph, body, swimming: !!a.swimming, fs: a.fs, x: a.pos.x, y: a.pos.y, z: a.pos.z, strikes: R.strikes, got: R.got, through: R.through };
  });
  const fresh = (x, z, yaw) => page.evaluate(([x, z, yaw]) => {
    const lab = window.lab; lab.clearAll();
    const f = lab.add('commonfrog', 1, x, z), a = f.added[0]; if (a) { a.yaw = yaw; a.hunger = 0.9; }
    window.__cf = a; window.__cfR = { hunt: false, strikes: 0, got: 0, through: 0, last: null, body: 'land', changes: [], swam: 0, nan: false, pop: 0, popAt: '', n: 0 };
    return !!a;
  }, [x, z, yaw]);
  const run = async (secs, until = null) => { let s = null; for (let i = 0; i < secs * 20; i++) { s = await watch(); if (s.dead || (until && until(s))) break; await page.waitForTimeout(50); } return s; };
  const report = () => page.evaluate(() => window.__cfR);
  const errs = async () => (await page.evaluate(() => (window.__errs ?? []).filter((e) => !/403|font/i.test(e))));

  if (scenes.includes('wall')) {
    await page.evaluate(async () => { const lab = window.lab; await lab.arena({ ground: 'flat', depth: 0 }); lab.rate(1); lab.pause(false); });
    await fresh(0, 0, Math.PI / 2);
    await page.evaluate(() => { const lab = window.lab; lab.obstacles.add({ kind: 'wall', w: 2, d: 30, h: 6, rot: 0 }, 9, 0); lab.add('flylarva', 6, 13, 0); lab.select(window.__cf); window.__cfR.hunt = true; });
    await page.waitForTimeout(500);
    await pic('wall-start');
    const s = await run(25, (s) => s.got > 0);
    const R = await report();
    ok(R.through === 0, 'wall: it never strikes through the wall', `strikes ${R.strikes}, through the wall ${R.through}, catches ${R.got}, body ${R.changes.join(' ') || 'land'}`);
    ok(!R.nan, 'wall: no NaN position');
    void s;
  }
  if (scenes.includes('step')) {
    await page.evaluate(async () => { const lab = window.lab; await lab.arena({ ground: 'flat', depth: 0 }); lab.rate(1); lab.pause(false); });
    await fresh(-2, 0, Math.PI / 2);
    await page.evaluate(() => { const lab = window.lab; lab.obstacles.add({ kind: 'step', w: 10, d: 14, h: 3, rot: 0 }, 13, 0); lab.add('flylarva', 6, 12, 0); lab.select(window.__cf); window.__cfR.hunt = true; });
    await page.waitForTimeout(500);
    let pics = 0;
    for (let i = 0; i < 40 * 20; i++) { const s = await watch(); if (s.dead) break; if (s.ph === 'out' && pics < 1) { pics++; await pic('step-strike'); } if (s.got > 0 && !s.ph) break; await page.waitForTimeout(50); }
    const R = await report();
    ok(R.got > 0, 'step: it catches prey on a 3 cm step', `strikes ${R.strikes}, catches ${R.got}, through the ground ${R.through}, body ${R.changes.join(' ') || 'land'}`);
    ok(R.through === 0 && !R.nan, 'step: no strike into the step, no NaN');
  }
  if (scenes.includes('shore')) {
    await page.evaluate(async () => { const lab = window.lab; await lab.arena({ ground: 'shore', depth: 5 }); lab.rate(1); lab.pause(false); });
    await fresh(-14, 0, Math.PI / 2);
    await page.evaluate(() => { const lab = window.lab; lab.select(window.__cf); lab.driver.goto(30, 0); });
    let s = await run(30, (s) => s.swimming);
    ok(!!s?.swimming, 'shore: driven into the pool, it gets in the water', `at x ${s?.x?.toFixed(1)}, body ${(await report()).changes.join(' ')}`);
    if (s?.swimming) await pic('shore-in-water');
    await run(4);
    await page.evaluate(() => { window.lab.select(window.__cf); window.lab.driver.goto(-16, 0); });
    s = await run(40, (s) => !s.swimming && s.x < 0 && s.fs === 'sit');
    const R = await report();
    ok(!s?.swimming && s?.x < 2, 'shore: driven back, it gets out onto the land', `at x ${s?.x?.toFixed(1)} y ${s?.y?.toFixed(1)}, ${R.swam} ticks swimming, body ${R.changes.join(' ')}`);
    if (!s?.swimming) await pic('shore-back-on-land');
    ok(R.pop < 2, 'shore: no jump of the drawn body at the changes', `largest ${R.pop.toFixed(2)} cm (${R.popAt})`);
    ok(!R.nan, 'shore: no NaN position');
  }
  const e = await errs();
  ok(e.length === 0, 'no page errors', e.slice(0, 3).join(' | '));
};
