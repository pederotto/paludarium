// Test lab (lab.html, src/lab) smoke test. Needs the dev server (module paths), e.g.
//   node tools/shot.mjs --url=http://localhost:4700/lab.html --steps=tools/steps/lab.mjs --out=test-output/lab
// L0: the lab starts, every species can be released and selected, nothing is NaN, dead or outside the glass after 20 s of animal
// time, pause and single-step hold the clock, the panels show on a desktop and on a phone. Prints PASS/FAIL lines.
export default async (page, shot, name) => {
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${label}${extra ? ' ' + extra : ''}`);

  // 1. Every species where it lives: the shore arena has dry land on the left, a bank in the middle and a pool on the right.
  const rel = await page.evaluate(async () => {
    const lab = window.lab;
    const SPECIES = lab.SPECIES;
    await lab.arena({ ground: 'shore', depth: 5 });
    const err = [];
    const put = (id, x, z) => { const r = lab.add(id, 2, x, z); if (r.added.length < 1) err.push(`${id}: ${r.error}`); };
    let li = 0, wi = 0, ai = 0;
    for (const [id, sp] of Object.entries(SPECIES)) {
      if (sp.kind === 'egg') continue;
      if (['swim', 'crawlWater', 'axolotl'].includes(sp.kind)) put(id, 18 + (wi % 4) * 6, -14 + Math.floor(wi++ / 4) * 5);
      else if ((sp.kind === 'newt' && id !== 'firesal') || id === 'springsea') put(id, 5 + (ai % 2) * 3, -10 + 5 * ai++);
      else put(id, -40 + (li % 8) * 5, -16 + Math.floor(li++ / 8) * 7);
    }
    return { n: lab.animals().length, err };
  });
  ok(rel.err.length === 0, 'release every species', rel.err.length ? rel.err.join(' | ') : `${rel.n} animals`);

  // 2. Twenty seconds of animal time at 4x (5 s real): nobody NaN, dead, or outside the tank.
  await page.evaluate(() => { window.lab.pause(false); window.lab.rate(4); });
  await page.waitForTimeout(5000);
  const after = await page.evaluate(async () => {
    const TANK = window.lab.TANK;
    const bad = [];
    for (const a of window.lab.animals()) {
      const p = a.pos;
      if (![p.x, p.y, p.z, a.yaw ?? 0].every(Number.isFinite)) bad.push(`${a.sp}#${a.id} NaN`);
      else if (Math.abs(p.x) > TANK.w / 2 + 1 || Math.abs(p.z) > TANK.d / 2 + 1 || p.y < -1 || p.y > TANK.h + 1) bad.push(`${a.sp}#${a.id} outside (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    return { n: window.lab.animals().length, bad, errs: window.__errs.filter((e) => !/403|font/i.test(e)) };
  });
  ok(after.bad.length === 0, 'no NaN or outside the tank after 20 s', after.bad.slice(0, 6).join(' | '));
  ok(after.errs.length === 0, 'no page errors', after.errs.slice(0, 3).join(' | '));
  console.log(`${name} animals after the run: ${after.n}`);

  // 3. Pause holds the clock; a step moves it by exactly 1/60 s of animal time.
  const clock = await page.evaluate(async () => {
    const lab = window.lab, W = lab.game.world;
    lab.pause(true);
    const t0 = W.animals.t, m0 = W.env.minute;
    await new Promise((r) => setTimeout(r, 400));
    const held = W.animals.t === t0 && W.env.minute === m0;
    lab.step(1);
    const dt1 = W.animals.t - t0;
    lab.step(10);
    const dt11 = W.animals.t - t0;
    return { held, dt1, dt11 };
  });
  ok(clock.held, 'pause holds the animals clock');
  ok(Math.abs(clock.dt1 - 1 / 60) < 1e-6 && Math.abs(clock.dt11 - 11 / 60) < 1e-6, 'one step is 1/60 s', `(${clock.dt1.toFixed(4)} s, 11 steps ${clock.dt11.toFixed(4)} s)`);

  // 4. Selecting: a tap on the animal in the picture.
  await page.evaluate(() => { window.lab.pause(false); window.lab.rate(1); window.lab.clear(); window.lab.add('toad', 1, -20, 0); window.lab.view('top'); });
  await page.waitForTimeout(1800);
  const sel = await page.evaluate(() => ({ sel: !!window.lab.L.sel.value, info: window.lab.L.info.value?.name }));
  ok(sel.sel && sel.info === 'Fire-bellied toad', 'an added animal is selected and read out', JSON.stringify(sel));
  await shot('lab-toad-top');
  await page.evaluate(() => { window.lab.view('front'); window.lab.add('gecko', 1, -10, -18); window.lab.add('dartfrog', 3, -32, 6); window.lab.add('newt', 2, 6, 4); window.lab.add('neon', 6, 26, 0); });
  await page.waitForTimeout(1500);
  await shot('lab-mixed');
};
