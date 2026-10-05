// C1 check: clicking an animal or a plant must open the information card (.banner), visible and inside the viewport.
// It follows the real player path: the title screen, a click on the start button (C1_START=career|starter|empty, default
// career = "New career"), no setTool, wait for the loading veil (#loading.gone), dismiss an open modal with Escape, then click.
// Targets are the plants and animals already on screen; what the tank lacks is added through game.world (10 plants, then 10 each of
// gecko, skink, frog) on distinct ground spots of a screen grid. Each type is clicked 10 times (different animals/plants) with the
// real mouse (desktop) or a touch tap (phone) and the hit rate is printed. A hit = the selection is the target, .banner exists with
// opacity 1 and lies inside the viewport. On a miss: "d" = the target's distance to the click ray in units at the moment of the
// release, "win" = what Animals.pick returned, "wd" = its distance. Rows:
//   plant-foot                a plant clicked on its foot with NO animal in the tank (asserted when none);
//   plant-stem                the same plants up the stem (3 units, or 0.6 of a shorter plant's height), no animal (asserted when none);
//   gecko skink dartfrog      each animal clicked at its own projected position, in the crowd of 30 (asserted);
//   plant-crowd               the plants clicked on the foot again among the 30 animals: REPORT (an animal in front of one may win);
//   plant-front               an animal put 1.5 behind each plant (away from the camera), the plant clicked up the stem (asserted 8/10);
//   animal-front              an animal put 1.5 in front of each plant (toward the camera), the animal clicked (asserted 9/10);
//   gecko-stall               the main thread is busy for 650 ms right after the press, so the release is handled late.
// "animal on ray"/"plant on ray" = clicks where, at the release, the old test (Animals.pick without depth) found an animal / Plants.onRay
// found a plant: how contested the row was. A click whose target is behind another plant's leaves (its mesh, ray-cast at the
// release) and that selects that plant is counted apart as "covered" (context: the player may see that plant there); rates are raw. PASS = every asserted row at its rate (9 of 10 unless stated) and the stall probe selects.
// Numbers only, no screenshots.
//   node tools/shot.mjs --steps=tools/steps/select-panel.mjs --url=http://127.0.0.1:4630/ [--only=desktop|phone] [--query=?webgl]
const N = 10;
export default async (page, shot, name) => {
  const START = process.env.C1_START || 'career';
  page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) console.log(`${name} !! the page reloaded during the run (dev-server HMR after an edit by someone else?)`); });
  const button = { career: /new career/i, starter: /starter paludarium/i, empty: /empty tank/i }[START];
  await page.getByRole('button', { name: button }).click();
  await page.waitForFunction(() => window.__S?.screen.value === 'play', null, { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const flags = () => page.evaluate(() => {
    const S = window.__S, T = window.__tools;
    let modal = 'none';
    try { modal = S.modal.value ? JSON.stringify(S.modal.value).slice(0, 50) : 'none'; } catch { modal = 'object'; }
    const mounted = S.screen.value === 'play' && !S.kids.value && !S.photo.value && !S.timelapse.value;
    return `screen=${S.screen.value} tool=${T.tool} smart.on=${T.smart.on} kids=${!!S.kids.value} photo=${!!S.photo.value} lapse=${!!S.timelapse.value} bannerMounted=${mounted} modal=${modal} pairing=${!!S.pairing.value} layer=${S.layer.value}`;
  });
  let line = await flags();
  if (!/modal=none/.test(line)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); line += ' -> Escape -> ' + (await flags()).match(/modal=\S+/)[0]; }
  const world = await page.evaluate(() => `veil=${document.getElementById('loading').className || 'up'} compact=${window.__S.compact.value} viewport=${innerWidth}x${innerHeight} animals=${window.game.world.animals.all.length} plants=${window.game.world.plants.list.length} backend=${window.game.gfx?.backend} ui=[${[...document.querySelectorAll('#ui > *')].map((e) => String(e.className || e.tagName).split(' ')[0] + ':' + getComputedStyle(e).pointerEvents).join(' ')}]`);
  console.log(`${name} [${START}] ${world}\n${name} ${line}`);

  await page.evaluate(() => {
    const g = window.game, T = window.__tools, V3 = g.camera.position.constructor;
    const spots = [];
    for (const ny of [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3]) for (const nx of [-0.8, -0.57, -0.34, -0.11, 0.11, 0.34, 0.57, 0.8]) { T.mouse.set(nx, ny); const h = T.pick(['terrain']); if (h) spots.push(h.point.clone().add(new V3(0, 0.8, 0))); }
    let k = 0;
    window.__next = () => { const p = spots[k % spots.length].clone(); p.x += 0.7 * Math.floor(k / spots.length); k++; return p; };
    window.__on = (p) => { const v = p.pos.clone().project(g.camera); return v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.8; };
    window.__tg = {};
    const o = T.tap; T.tap = function () { window.__tapN = (window.__tapN ?? 0) + 1; const r = o.call(this); window.__afterTap = window.__S.selection.value ? 'sel' : 'null'; return r; };   // counts the controller's tap() calls
  });
  const addPlants = () => page.evaluate((N) => {
    const W = window.game.world;
    const plants = W.plants.list.filter(window.__on).slice(0, N);
    const have = plants.length;
    const ids = [...new Set(Object.keys(W.plants.meshes ?? {}).map((k) => k.split('#')[0]))];
    for (let guard = 0; plants.length < N && ids.length && guard < N * 2; guard++) {
      const before = W.plants.list.length;
      W.plants.add(ids[guard % ids.length], window.__next(), { grown: 1 });
      if (W.plants.list.length > before) plants.push(W.plants.list.at(-1));
    }
    window.__tg['plant-foot'] = plants.map((obj) => ({ obj, off: 0 }));
    window.__tg['plant-stem'] = plants.map((obj) => ({ obj, off: Math.min(3, 0.6 * W.plants.heightOf(obj)) }));
    window.__tg['plant-crowd'] = window.__tg['plant-foot'];
    return `plants ${have}+${plants.length - have}`;
  }, N);
  const addAnimals = () => page.evaluate((N) => {
    const W = window.game.world, info = [];
    for (const sp of ['gecko', 'skink', 'dartfrog']) {
      const list = (W.animals.by[sp] ?? []).filter((a) => !a.dead && window.__on(a)).slice(0, N).map((obj) => ({ obj, off: 0 }));
      const have = list.length;
      for (let guard = 0; list.length < N && guard < N * 2; guard++) {
        const a = W.animals.add(sp, window.__next(), { age: 1e6 }) ?? W.animals.by[sp].at(-1);
        if (a && !list.some((e) => e.obj === a)) list.push({ obj: a, off: 0 });
      }
      window.__tg[sp] = list; info.push(`${sp} ${have}+${list.length - have}`);
    }
    return info.join(', ');
  }, N);

  const click = (pt) => (name === 'phone' ? page.touchscreen.tap(pt.x, pt.y) : page.mouse.click(pt.x, pt.y));
  let bad = 0;
  const runType = async (type, assert, min = 9) => {
    let hits = 0, n = 0, onA = 0, onP = 0, cov = 0;
    const misses = [], lost = {};
    const crowd = await page.evaluate(() => window.game.world.animals.all.length);
    for (let i = 0; i < N; i++) {
      await page.evaluate(() => window.__tools.select(null));
      await page.waitForTimeout(120);
      const pt = await page.evaluate(([type, i]) => {
        const e = window.__tg[type][i];
        if (!e) return null;
        const T = window.__tools, g = window.game;
        const v = e.obj.pos.clone(); v.y += e.off; v.project(g.camera);
        const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
        window.__pr = null; window.__tapN0 = window.__tapN ?? 0;
        addEventListener('pointerup', (ev) => {   // measured at the release, before the game's own handler runs
          const r = T.dom.getBoundingClientRect();
          const m = new T.mouse.constructor(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
          const rc = new T.ray.constructor(); rc.setFromCamera(m, g.camera);
          const tp = e.obj.pos.clone(); tp.y += e.off;
          const w = g.world.animals.pick(rc.ray, 2.2);
          const ons = g.world.plants.onRay?.(rc.ray) ?? [], td = tp.clone().sub(rc.ray.origin).dot(rc.ray.direction) - (e.off || e.obj.sp ? 0.5 : 0);
          window.__pr = { pl: ons.length, cov: ons.find((h) => h.obj !== e.obj && h.mt < td)?.obj.id ?? null, armed: !!T._tap, dt: T._tap ? Math.round(ev.timeStamp - T._tap.t) : null, d: +rc.ray.distanceToPoint(tp).toFixed(1), win: w ? `${w.sp}#${w.id}` : 'none', wd: w ? +rc.ray.distanceToPoint(w.pos).toFixed(1) : 0 };
        }, { capture: true, once: true });
        const top = document.elementFromPoint(x, y);
        return { x, y, off: x < 0 || y < 0 || x > innerWidth || y > innerHeight, top: top ? top.tagName.toLowerCase() + (typeof top.className === 'string' && top.className.trim() ? '.' + top.className.trim().split(/\s+/)[0] : '') : 'none' };
      }, [type, i]);
      if (!pt) break;
      await click(pt);
      await page.waitForTimeout(350);
      const r = await page.evaluate(([type, i]) => {
        const sel = window.__S.selection.value, o = window.__tg[type][i].obj;
        const b = document.querySelector('.banner'), rc = b?.getBoundingClientRect();
        const op = b ? getComputedStyle(b).opacity : 'n/a';
        const inView = !!rc && rc.width > 0 && rc.left >= 0 && rc.top >= 0 && rc.right <= innerWidth && rc.bottom <= innerHeight;
        const won = sel && sel.obj !== o ? `${sel.kind}:${sel.obj?.sp ?? sel.obj?.id ?? '?'}` : sel ? '' : 'nothing';
        return { sel: !!sel && sel.obj === o, banner: !!b, op, inView, won, pr: window.__pr, taps: (window.__tapN ?? 0) - window.__tapN0, after: window.__afterTap };
      }, [type, i]);
      n++;
      if (r.pr && r.pr.win !== 'none') onA++;
      if (r.pr?.pl) onP++;
      const ok = r.sel && r.banner && Number(r.op) === 1 && r.inView;
      if (ok) hits++; else if (r.pr?.cov && r.won === 'plant:' + r.pr.cov) cov++; else {
        lost[r.won || 'no card'] = (lost[r.won || 'no card'] ?? 0) + 1;
        misses.push(`#${i}@${Math.round(pt.x)},${Math.round(pt.y)} on=${pt.top}${pt.off ? ' OFFSCREEN' : ''} sel=${r.sel ? 'yes' : 'no'}${r.won ? ' won=' + r.won : ''} banner=${r.banner ? 'yes' : 'no'} op=${r.op} inView=${r.inView ? 'yes' : 'no'} d=${r.pr?.d} win=${r.pr?.win} wd=${r.pr?.wd} armed=${r.pr?.armed} dt=${r.pr?.dt} tapCalls=${r.taps} afterTap=${r.after}`);
      }
      if (i === 0) console.log(`${name} click-time ${type}: ${await flags()} elementFromPoint=${pt.top}`);
    }
    const asserted = assert(crowd);
    const typeOk = n >= N && hits >= min;   // raw hits; "covered" is printed for context only
    if (asserted && !typeOk) bad++;
    console.log(`${name} ${type.padEnd(11)} hits ${hits}/${n} (min ${min}, animals in tank: ${crowd}, animal on ray ${onA}, plant on ray ${onP}, covered by another plant's leaves and given to it ${cov}) ${asserted ? (typeOk ? 'PASS' : 'FAIL') : typeOk ? 'REPORT ok' : 'REPORT'}${Object.keys(lost).length ? '  lost to ' + JSON.stringify(lost) : ''}${misses.length ? '  misses: ' + misses.slice(0, 3).join(' | ') : ''}`);
  };

  console.log(`${name} ${await addPlants()}`);
  await runType('plant-foot', (c) => c === 0);
  await runType('plant-stem', (c) => c === 0);
  console.log(`${name} ${await addAnimals()}`);
  await page.waitForTimeout(2500);   // added animals drop and settle before they are clicked
  for (const type of ['gecko', 'skink', 'dartfrog']) await runType(type, () => true);
  await runType('plant-crowd', () => false);
  // An animal put 1.5 units behind (side -1) or in front of (side 1) each plant target, on the camera's side; the last batch goes.
  const placeBy = (side) => page.evaluate((side) => {
    const g = window.game, W = g.world, sps = ['gecko', 'skink', 'dartfrog'], out = [];
    for (const a of window.__placed ?? []) W.animals.remove(a, 'removed');
    window.__placed = [];
    window.__tg['plant-foot'].forEach(({ obj }, i) => {
      const dir = g.camera.position.clone().sub(obj.pos); dir.y = 0; dir.normalize();
      const p = obj.pos.clone().addScaledVector(dir, side * 1.5); p.y += 0.8;
      const a = W.animals.add(sps[i % 3], p, { age: 1e6 }) ?? W.animals.by[sps[i % 3]]?.at(-1);
      if (a && !window.__placed.includes(a)) { window.__placed.push(a); out.push({ obj: a, off: 0 }); }
    });
    window.__tg['animal-front'] = out;
    window.__tg['plant-front'] = window.__tg['plant-foot'].map(({ obj }) => ({ obj, off: Math.min(2, 0.5 * W.plants.heightOf(obj)) }));
    return `placed ${out.length} animals ${side > 0 ? 'in front of' : 'behind'} the plants`;
  }, side);
  console.log(`${name} ${await placeBy(-1)}`);
  await page.waitForTimeout(1200);
  await runType('plant-front', () => true, 8);
  console.log(`${name} ${await placeBy(1)}`);
  await page.waitForTimeout(1200);
  await runType('animal-front', () => true, 9);
  await page.evaluate(() => { for (const a of window.__placed) window.game.world.animals.remove(a, 'removed'); window.__placed = []; });

  // Regression case: the main thread is busy for 650 ms right after the press (a slow machine, a shader build), so the release is
  // handled late. The event carries its own time stamp; a tap that times the handlers instead drops the click.
  await page.evaluate(() => window.__tools.select(null));
  await page.waitForTimeout(300);
  const pt = await page.evaluate(() => { const v = window.__tg.gecko[0].obj.pos.clone().project(window.game.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  await page.mouse.move(pt.x, pt.y);
  await page.evaluate(() => {   // what the release saw: was the tap armed, how long since the press, where the gecko was, what Animals.pick returned
    const T = window.__tools, g = window.game, o = window.__tg.gecko[0].obj;
    window.__tapN0 = window.__tapN ?? 0;
    addEventListener('pointerup', (ev) => {
      const r = T.dom.getBoundingClientRect(), m = new T.mouse.constructor(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      const rc = new T.ray.constructor(); rc.setFromCamera(m, g.camera);
      const w = g.world.animals.pick(rc.ray, 2.2);
      window.__sp = { armed: !!T._tap, dt: T._tap ? Math.round(ev.timeStamp - T._tap.t) : null, d: +rc.ray.distanceToPoint(o.pos).toFixed(1), win: w ? w.sp + '#' + w.id : 'none' };
    }, { capture: true, once: true });
  });
  await page.evaluate(() => { window.__gap = {}; addEventListener('pointerdown', () => { window.__gap.d = performance.now(); }, { capture: true, once: true }); addEventListener('pointerup', () => { window.__gap.u = performance.now(); }, { capture: true, once: true }); });
  await page.mouse.down();
  const stall = page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 650); });
  await page.waitForTimeout(150);   // the release must arrive while the page is busy, or the probe proves nothing
  await page.mouse.up();
  await stall;
  await page.waitForTimeout(1200);
  const s = await page.evaluate(() => ({ sel: window.__S.selection.value?.obj === window.__tg.gecko[0].obj, banner: !!document.querySelector('.banner'), gap: Math.round((window.__gap.u ?? 0) - (window.__gap.d ?? 0)), sp: window.__sp, taps: (window.__tapN ?? 0) - window.__tapN0 }));
  const stallOk = s.sel && s.banner && s.gap >= 500;
  if (!stallOk) bad++;
  console.log(`${name} gecko-stall press-to-release gap=${s.gap} ms selected=${s.sel ? 'yes' : 'no'} banner=${s.banner ? 'yes' : 'no'} at-release ${JSON.stringify(s.sp)} tapCalls=${s.taps} ${stallOk ? 'PASS' : s.gap < 500 ? 'FAIL (probe did not stall the release)' : 'FAIL'}`);
  console.log(`${name} [${START}] RESULT ${bad ? 'FAIL' : 'PASS'}`);
  // shot.mjs exits 1 when the page logs an error, so a failed check fails the run.
  if (bad) await page.evaluate((n) => console.error(`select-panel FAIL: ${n} checks`), bad);
};
