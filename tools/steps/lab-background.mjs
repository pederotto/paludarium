// Test lab background run (src/lab/background.js): while the tab is hidden the world keeps going. A hidden tab is imitated as a browser does it:
// document.hidden is true, visibilitychange fires, and no frames are drawn (the animation loop is stopped). Desktop only.
//   node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-background.mjs --out=test-output/lab
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(300000);
  const ok = (cond, label, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  const hide = (on) => page.evaluate((on) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => on });
    if (on) window.game.renderer.setAnimationLoop(null); else window.game.start();
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);
  const read = () => page.evaluate(() => { const lab = window.lab, a = lab.L.sel.value; return { t: lab.game.world.animals.t, dist: a.lab.stats?.dist ?? 0, hidden: lab.L.hiddenRun.value, running: lab.background.running(), frames: window.__frames }; });

  await page.evaluate(async () => {
    const lab = window.lab;
    await lab.arena({ ground: 'flat', depth: 0 });
    lab.add('toad', 1, -20, 0);
    lab.add('gecko', 1, 0, 0); lab.driver.path('circle');          // (the gecko is the selected one, and the one on a drive)
    lab.rate(4); lab.pause(false); lab.L.background.value = true;
    window.__frames = 0; lab.game.frameHooks.push(() => { window.__frames++; });
  });
  await page.waitForTimeout(2000);
  const a0 = await read();

  // 1. Hidden for 4 s: the world goes on (4 x 4 = 16 s of animal time), the gecko keeps walking, and no frame is drawn.
  await hide(true);
  const f0 = (await read()).frames;
  await page.waitForTimeout(4000);
  const a1 = await read();
  ok(a1.running && a1.hidden > 0, 'a hidden tab runs the world from a worker', `(${a1.hidden} ticks)`);
  const dt = a1.t - a0.t;
  ok(dt > 12 && dt < 20, 'about 16 s of animal time pass in 4 s hidden at 4x', `(${dt.toFixed(1)} s)`);
  ok(a1.dist - a0.dist > 8, 'the gecko keeps walking its circle while hidden', `(${(a1.dist - a0.dist).toFixed(0)} cm)`);

  // 2. Back in view: the worker stops and the frame loop takes the clock without a jump or a double step.
  await hide(false);
  await page.waitForTimeout(2500);
  const a2 = await read();
  ok(!a2.running, 'shown again: the worker stops');
  ok(a2.frames > a1.frames + 20, 'and frames are drawn again', `(${a2.frames - a1.frames} frames)`);
  const dt2 = a2.t - a1.t;
  ok(dt2 > 6 && dt2 < 14, 'the clock goes on at 4x, not twice as fast', `(${dt2.toFixed(1)} s in 2.5 s)`);

  // 3. The switch: off, a hidden tab waits as it did.
  await page.evaluate(() => { window.lab.L.background.value = false; });
  await hide(true);
  const b0 = await read();
  await page.waitForTimeout(2500);
  const b1 = await read();
  ok(!b1.running && b1.t === b0.t, 'with the switch off a hidden tab does not run the world');
  await page.evaluate(() => { window.lab.L.background.value = true; });
  await hide(false);

  // 4. Paused stays paused while hidden.
  await page.evaluate(() => window.lab.pause(true));
  await hide(true);
  const c0 = await read();
  await page.waitForTimeout(1500);
  const c1 = await read();
  ok(c1.t === c0.t, 'a paused lab stays paused while hidden');
  await hide(false);
  await page.evaluate(() => window.lab.pause(false));
  const errs = await page.evaluate(() => window.__errs.filter((e) => !/403|font/i.test(e)));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
};
