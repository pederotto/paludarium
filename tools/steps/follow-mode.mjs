// C2 check: follow mode (src/editor/followmode.js). The real player path: title, "New career", the loading veil, an open modal
// dismissed with Escape. The sim is paused (game.setSpeed(0)) so the animals stay where they are put; a gecko, a skink and a dart
// frog are added on three ground spots of the screen. Then, numbers only:
//   follow   the gecko is selected and the banner's Follow button clicked: body.focus-hide, .topbar opacity 0, home pose saved;
//   esc      Escape: after 1.5 s the camera (position and target) is within 0.5 of the pose before following, the menu is back;
//   dbl      following the gecko again, a real double click (phone: two touch taps) on the skink: the follow switches, menu hidden,
//            home pose unchanged;
//   long     a long press (desktop: mouse held 750 ms; phone: a CDP touch held 750 ms) on the dart frog: the follow switches;
//   tap      a single click or tap on empty ground: free again, menu back, camera within 0.5 of home after 1.5 s.
// "covered" = the point clicked is not the canvas (a card lies over it). PASS = every row.
//   node tools/shot.mjs --steps=tools/steps/follow-mode.mjs --url=http://127.0.0.1:4630/ [--only=desktop|phone] [--query=?webgl]
export default async (page, shot, name) => {
  page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) console.log(`${name} !! the page reloaded during the run (dev-server HMR after an edit by someone else?)`); });
  await page.getByRole('button', { name: /new career/i }).click();
  await page.waitForFunction(() => window.__S?.screen.value === 'play', null, { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  if (await page.evaluate(() => !!window.__S.modal.value)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  const setup = await page.evaluate(() => {
    const g = window.game, W = g.world, T = window.__tools, V3 = g.camera.position.constructor;
    g.setSpeed(0);
    const put = (sp, nx, ny) => {   // the first ground spot near (nx, ny) where the animal can be added
      for (const dy of [0, -0.1, -0.2, -0.3, 0.1, -0.4]) for (const dx of [0, 0.1, -0.1, 0.2, -0.2]) {
        T.mouse.set(nx + dx, ny + dy); const h = T.pick(['terrain']); if (!h) continue;
        const n = W.animals.by[sp]?.length ?? 0;
        const a = W.animals.add(sp, h.point.clone().add(new V3(0, 0.8, 0)), { age: 1e6 });
        if (a || (W.animals.by[sp]?.length ?? 0) > n) return a ?? W.animals.by[sp].at(-1);
      }
      // Fallback: any ground spot of the screen at least 4 away from the animals already put.
      const used = Object.values(window.__fm ?? {}).filter(Boolean);
      for (const ny of [-0.3, -0.15, 0, -0.45, 0.15, -0.6]) for (const nx of [-0.6, 0.6, -0.3, 0.3, -0.8, 0.8, 0]) {
        T.mouse.set(nx, ny); const h = T.pick(['terrain']); if (!h || used.some((u) => u.pos.distanceTo(h.point) < 4)) continue;
        const n = W.animals.by[sp]?.length ?? 0;
        const a = W.animals.add(sp, h.point.clone().add(new V3(0, 0.8, 0)), { age: 1e6 });
        if (a || (W.animals.by[sp]?.length ?? 0) > n) return a ?? W.animals.by[sp].at(-1);
      }
      return null;
    };
    window.__fm = {}; window.__fm.gecko = put('gecko', 0, -0.3); window.__fm.skink = put('skink', -0.45, 0); window.__fm.dartfrog = put('dartfrog', 0.45, 0);
    window.__pose = () => ({ pos: T.controls.getPosition(new V3()), target: T.controls.getTarget(new V3()) });
    window.__d = (a, b) => Math.max(a.pos.distanceTo(b.pos), a.target.distanceTo(b.target));
    window.__scr = (a) => {
      const r = T.dom.getBoundingClientRect(), v = a.pos.clone().project(g.camera);
      const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
      return { x, y, covered: document.elementFromPoint(x, y) !== T.dom, on: v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 };
    };
    return `animals=${W.animals.all.length} gecko=${!!window.__fm.gecko} skink=${!!window.__fm.skink} dartfrog=${!!window.__fm.dartfrog} backend=${g.gfx?.backend} viewport=${innerWidth}x${innerHeight}`;
  });
  console.log(`${name} ${setup}`);
  const state = () => page.evaluate(() => {
    const S = window.__S, T = window.__tools, top = document.querySelector('.topbar');
    const fol = S.following.value, sp = fol ? Object.keys(window.__fm).find((k) => window.__fm[k] === fol) ?? fol.sp : 'none';
    const home = T.fm?.home, now = window.__pose();
    const parts = ['.topbar', '.rail', '.opts', '.sdrawer', '.hud-stack', '.smartbar'].filter((s) => document.querySelector(s));
    const shown = parts.filter((s) => getComputedStyle(document.querySelector(s)).visibility !== 'hidden').length;
    return { mode: T.fm?.mode ?? 'free', cls: document.body.classList.contains('focus-hide'), top: top ? +getComputedStyle(top).opacity : -1,
      fol: sp, shown, parts: parts.length, home, dSaved: window.__saved ? window.__d(now, window.__saved) : -1,
      dHome: home && window.__saved ? window.__d(home, window.__saved) : -1, banner: !!document.querySelector('.banner') };
  });
  const fmt = (s) => `mode=${s.mode} body.focus-hide=${s.cls} topbar.opacity=${s.top} parts shown=${s.shown}/${s.parts} following=${s.fol} camera-to-saved=${s.dSaved.toFixed(3)} home-to-saved=${s.dHome.toFixed(3)}`;
  const rows = [];
  const row = (id, ok, s, extra = '') => { rows.push(ok); console.log(`${name} ${id.padEnd(6)} ${ok ? 'PASS' : 'FAIL'} ${fmt(s)}${extra}`); };
  const follow = async () => {
    await page.evaluate(() => { window.__tools.select({ kind: 'animal', obj: window.__fm.gecko }); window.__saved = window.__pose(); });
    await page.waitForTimeout(500);
    const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /follow|zoom/i.test(t)).join('|') + ` sel=${window.__S.selection.value?.kind} banner=${!!document.querySelector('.banner')}`);
    const btn = page.locator('button', { hasText: /^Follow$/ });
    if (!(await btn.count())) { console.log(`${name} !! no Follow button: ${btns}`); await page.evaluate(() => window.__tools.followMode(window.__fm.gecko)); }
    else await btn.first().click();
    await page.waitForTimeout(1200);
  };
  const touchHold = async (x, y, ms) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  const at = (k) => page.evaluate((k) => window.__scr(window.__fm[k]), k);
  const phone = name === 'phone';

  await follow();
  let s = await state();
  row('follow', s.mode === 'focus' && s.cls && s.top === 0 && s.shown === 0 && s.fol === 'gecko' && s.dHome < 0.01, s);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  s = await state();
  row('esc', s.mode === 'free' && !s.cls && s.top === 1 && s.shown === s.parts && s.fol === 'none' && s.dSaved < 0.5, s);

  await follow();
  let p = await at('skink');
  if (phone) { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(80); await page.touchscreen.tap(p.x, p.y); } else await page.mouse.dblclick(p.x, p.y);
  await page.waitForTimeout(700);
  s = await state();
  row('dbl', s.mode === 'focus' && s.cls && s.top === 0 && s.fol === 'skink' && s.dHome < 0.01, s, ` at=${p.x.toFixed(0)},${p.y.toFixed(0)} on=${p.on} covered=${p.covered}`);

  // The follow moved the camera: if the dart frog is now off screen or under a card, it is moved (sim paused) to a free ground
  // spot in view, at least 3 away from the other animals ("moved=true").
  const moved = await page.evaluate(() => {
    const T = window.__tools, a = window.__fm.dartfrog, sc = window.__scr(a);
    if (sc.on && !sc.covered) return false;
    const r = T.dom.getBoundingClientRect(), others = window.game.world.animals.all.filter((o) => o !== a);
    for (const ny of [-0.3, -0.1, 0.1, -0.5, 0.3]) for (const nx of [0.5, -0.5, 0.3, -0.3, 0.6, -0.6]) {
      T.mouse.set(nx, ny); const h = T.pick(['terrain']); if (!h) continue;
      const x = r.left + (nx + 1) / 2 * r.width, y = r.top + (1 - ny) / 2 * r.height;
      if (document.elementFromPoint(x, y) !== T.dom || others.some((o) => o.pos.distanceTo(h.point) < 3)) continue;
      a.pos.copy(h.point); a.pos.y += 0.3;
      return true;
    }
    return 'nospot';
  });
  p = await at('dartfrog');
  if (phone) await touchHold(p.x, p.y, 750);
  else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up(); }
  await page.waitForTimeout(500);
  s = await state();
  row('long', s.mode === 'focus' && s.cls && s.top === 0 && s.fol === 'dartfrog' && s.dHome < 0.01, s, ` at=${p.x.toFixed(0)},${p.y.toFixed(0)} on=${p.on} covered=${p.covered} moved=${moved}`);

  // Empty ground: a canvas point whose ray finds terrain and no animal.
  const g = await page.evaluate(() => {
    const T = window.__tools, W = window.game.world, r = T.dom.getBoundingClientRect();
    const miss = {};
    for (const ny of [-0.5, -0.3, -0.65, -0.1, 0.1, -0.8, 0.3]) for (const nx of [0.6, -0.6, 0.3, -0.3, 0.8, -0.8, 0]) {
      T.mouse.set(nx, ny);
      const x = r.left + (nx + 1) / 2 * r.width, y = r.top + (1 - ny) / 2 * r.height;
      const h = T.pick(['terrain']);
      T.mouse.set(nx, ny); T.ray.setFromCamera(T.mouse, window.game.camera);
      const why = !h ? 'noground' : W.animals.pick(T.ray.ray, 2.2) ? 'animal' : document.elementFromPoint(x, y) !== T.dom ? 'covered' : '';
      if (!why) return { x, y };
      miss[why] = (miss[why] ?? 0) + 1;
    }
    return { miss: JSON.stringify(miss) };
  });
  if (g?.x) { if (phone) await page.touchscreen.tap(g.x, g.y); else await page.mouse.click(g.x, g.y); }
  await page.waitForTimeout(1500);
  s = await state();
  row('tap', !!g?.x && s.mode === 'free' && !s.cls && s.top === 1 && s.fol === 'none' && s.dSaved < 0.5, s, g?.x ? ` at=${g.x.toFixed(0)},${g.y.toFixed(0)}` : ` no empty ground found ${g?.miss}`);
  console.log(`${name} RESULT ${rows.every(Boolean) ? 'PASS' : 'FAIL'} (${rows.filter(Boolean).length}/${rows.length})`);
};
