// Test lab obstacles (src/lab/obstacles.js, sim/labshapes.js). Part A: every shape and piece can be placed, the ground under a shape has
// the height it should, removing one gives the ground back, clearing empties the arena. Part B: a short obstacle course per species,
// start at x = -12 and goal at x = +12 with an obstacle across the way: who gets there, who is stopped, and what the radar says.
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-obstacles.mjs --out=test-output/lab
//   LAB_SECONDS=10 (real seconds per run, at 4x)   LAB_ONLY=toad,gecko
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);

  // --- Part A ---
  const A = await page.evaluate(async () => {
    const lab = window.lab, ob = lab.obstacles, W = () => lab.game.world, T = () => W().terrain;
    await lab.arena({ ground: 'flat', depth: 0 });
    const base = T().heightAt(0, 0), out = { base, shapes: {}, pieces: {} };
    const expect = { step: 3, wall: 6, post: 8, ramp: 2.5, trench: -2, mound: 5 };
    for (const [k, rise] of Object.entries(expect)) {
      lab.L.obKind.value = k; ob.clear();
      const d = { step: [14, 14, 3], wall: [30, 2, 6], post: [2.5, 2.5, 8], ramp: [18, 12, 5], trench: [30, 4, 2], mound: [20, 20, 5] }[k];
      lab.L.obW.value = d[0]; lab.L.obD.value = d[1]; lab.L.obH.value = d[2]; lab.L.obRot.value = 0;
      ob.place(0, 0);
      const at = T().heightAt(0, 0), far = T().heightAt(25, 15);
      ob.remove(ob.items[0].id);
      out.shapes[k] = { want: base + rise, got: at, far, back: T().heightAt(0, 0) };
    }
    ob.clear();
    for (const k of Object.keys(window.lab.PIECES ?? {})) { /* filled below */ }
    const kinds = ['boulder', 'spire', 'roots', 'stump', 'wood', 'cork', 'slate', 'bamboopole', 'pebbles'];
    for (const k of kinds) {
      lab.L.obKind.value = k; lab.L.obSize.value = 12;
      const n0 = W().decor.pieces.length, it = ob.place(-20, 5);
      const n1 = W().decor.pieces.length;
      if (it) ob.remove(it.id);
      out.pieces[k] = { placed: !!it, added: n1 - n0, removed: W().decor.pieces.length === n0 };
    }
    ob.place(0, 0); ob.place(10, 10); lab.L.obKind.value = 'boulder'; ob.place(-10, 0);
    const n = ob.items.length; ob.clear();
    out.cleared = { n, left: ob.items.length, pieces: W().decor.pieces.length, ground: T().heightAt(0, 0) };
    return out;
  });
  for (const [k, r] of Object.entries(A.shapes)) ok(Math.abs(r.got - r.want) < 0.35 && Math.abs(r.far - A.base) < 1e-6 && Math.abs(r.back - A.base) < 1e-6, `shape ${k}: ground ${r.got.toFixed(2)} (want ${r.want.toFixed(2)}), clear of it ${r.far.toFixed(2)}, removed -> ${r.back.toFixed(2)}`);
  for (const [k, r] of Object.entries(A.pieces)) ok(r.placed && r.added === 1 && r.removed, `piece ${k}: placed ${r.placed}, pieces added ${r.added}, removed ${r.removed}`);
  ok(A.cleared.left === 0 && A.cleared.pieces === 0 && Math.abs(A.cleared.ground - A.base) < 1e-6, `clear removes all ${A.cleared.n} obstacles and gives the ground back`);

  // --- Part B ---
  const seconds = +(process.env.LAB_SECONDS ?? 10);
  const only = process.env.LAB_ONLY ? process.env.LAB_ONLY.split(',') : null;
  const SPECIES = ['toad', 'dartfrog', 'gecko', 'skink', 'panther', 'firesal'].filter((s) => !only || only.includes(s));
  const COURSES = {
    'step 3 cm across': { kind: 'step', w: 44, d: 6, h: 3, rot: Math.PI / 2 },
    'wall 6 cm, 4 cm gaps': { kind: 'wall', w: 36, d: 2, h: 6, rot: Math.PI / 2 },
    'boulder 12 cm': { kind: 'boulder', size: 12, rot: 0 },
    'trench 2 cm deep across': { kind: 'trench', w: 44, d: 6, h: 2, rot: Math.PI / 2 },
  };
  console.log('\nobstacle course: start (-12, 0) -> goal (12, 0), obstacle across x = 0');
  console.log('species      course                      result        closest(cm)  radar');
  const rows = [];
  for (const sp of SPECIES) for (const [cname, spec] of Object.entries(COURSES)) {
    const r = await page.evaluate(async ([sp, spec, seconds]) => {
      const lab = window.lab;
      await lab.arena({ ground: 'flat', depth: 0 });
      lab.radar.clear(); lab.rate(4); lab.pause(false);
      lab.obstacles.add(spec, 0, 0);
      lab.add(sp, 1, -12, 0);
      const a = lab.L.sel.value; a.yaw = Math.PI / 2;
      lab.L.pace.value = 1.4; lab.L.gait.value = 'auto';
      lab.driver.goto(12, 0);
      let best = Infinity, arrived = null; const t0 = performance.now();
      while (performance.now() - t0 < seconds * 1000) {
        await new Promise((r) => setTimeout(r, 200));
        best = Math.min(best, Math.hypot(a.pos.x - 12, a.pos.z));
        if (a.lab.drive.done) { arrived = (performance.now() - t0) / 1000; break; }
      }
      const kinds = {}; for (const x of lab.radar.rows()) kinds[x.kind] = (kinds[x.kind] ?? 0) + x.n;
      return { arrived, best, kinds, finite: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite), under: a.pos.y < lab.game.world.terrain.heightAt(a.pos.x, a.pos.z) - 0.6 };
    }, [sp, spec, seconds]);
    rows.push({ sp, cname, ...r });
    console.log(`${sp.padEnd(12)} ${cname.padEnd(27)} ${(r.arrived != null ? `got there ${r.arrived.toFixed(0)}s` : 'stopped').padEnd(13)} ${r.best.toFixed(1).padStart(8)}     ${JSON.stringify(r.kinds)}`);
  }
  ok(rows.every((r) => r.finite && !r.under), 'nobody is NaN or under the ground after the courses');
  const errs = await page.evaluate(() => window.__errs.filter((e) => !/403|font/i.test(e)));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await page.evaluate(async () => {
    const lab = window.lab;
    await lab.arena({ ground: 'flat', depth: 0 });
    for (const [k, x, z, w, d, h, rot] of [['step', -22, -10, 14, 14, 3, 0], ['wall', 0, 8, 30, 2, 6, 0.4], ['post', 8, -8, 2.5, 2.5, 8, 0], ['ramp', 24, 6, 18, 12, 5, 0.3], ['trench', -4, -4, 30, 4, 2, 1.2], ['mound', -26, 10, 20, 20, 5, 0]]) lab.obstacles.add({ kind: k, w, d, h, rot }, x, z);
    lab.obstacles.add({ kind: 'boulder', size: 12, rot: 0 }, 14, -10); lab.obstacles.add({ kind: 'wood', size: 24, rot: 0.5 }, 12, 14);
    lab.view('top');
  });
  await page.waitForTimeout(2500);
  await shot('lab-obstacles');
};
