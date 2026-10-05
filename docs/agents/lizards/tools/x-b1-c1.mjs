// X-B1 / C1: is everything inside .hud-stack still clickable, is the stack's empty box click-through, do clicks in the old dead zone select an animal.
import { start } from './x-b1-lib.mjs';
export default async (page, shot, name) => {
  await start(page, /new career/i);
  const hit = (tag) => page.evaluate((tag) => {
    const st = document.querySelector('.hud-stack'); if (!st) return tag + ' no .hud-stack';
    const desc = (e) => (e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') : 'null');
    const kids = []; for (const el of st.querySelectorAll('*')) { if (!(el.parentElement === st || el.matches('button,a,[role=button],input,select'))) continue; const rc = el.getBoundingClientRect(), cs = getComputedStyle(el); if (rc.width < 2 || rc.height < 2) continue; const top = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2); kids.push(`${desc(el)} pe=${cs.pointerEvents} op=${cs.opacity} ${el.contains(top) ? 'HIT' : 'not-hit:' + desc(top)}`); }
    const r = st.getBoundingClientRect(), hist = {}; for (let x = r.left + 4; x < r.right; x += 12) for (let y = r.top + 4; y < r.bottom; y += 8) { const t = document.elementFromPoint(x, y); const inKid = [...st.children].some((k) => k.contains(t) && getComputedStyle(k).pointerEvents !== 'none'); const key = inKid ? 'child' : desc(t); hist[key] = (hist[key] ?? 0) + 1; }
    const dz = {}; if (innerWidth === 1280) for (let x = 380; x <= 900; x += 20) for (let y = 559; y <= 653; y += 8) { const k = desc(document.elementFromPoint(x, y)); dz[k] = (dz[k] ?? 0) + 1; }
    const dock = [...document.querySelectorAll('.dockwrap button')].filter((b) => b.getBoundingClientRect().width > 2); let dok = 0; for (const b of dock) { const rc = b.getBoundingClientRect(); if (b.contains(document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2))) dok++; }
    return `${tag} stack pe=${getComputedStyle(st).pointerEvents} box=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} | kids: ${kids.join('; ') || 'none'} | box sweep: ${JSON.stringify(hist)} | deadzone: ${JSON.stringify(dz)} | dock buttons hit ${dok}/${dock.length}`;
  }, tag);
  console.log(name, await hit('surface'));
  await page.evaluate(() => window.game.layers.set('xray')); await page.waitForTimeout(800);
  console.log(name, await hit('xray'));
  const modal = () => page.evaluate(() => { try { return JSON.stringify(window.__S.modal.value)?.slice(0, 40) ?? 'none'; } catch { return '?'; } });
  for (const sel of ['[data-testid=commission-chip]', '[data-testid=layer-chip]', '.hud-stack button:not([data-testid])']) {
    const loc = page.locator(sel).first(); if (!(await loc.count())) { console.log(name, 'click', sel, 'absent'); continue; }
    const b = await modal(); let res; try { if (name === 'phone') await loc.tap({ timeout: 3000 }); else await loc.click({ timeout: 3000 }); res = 'clicked'; } catch (e) { res = 'FAILED ' + (e.message.split('\n').find((l) => /intercept|visible|stable|enabled/i.test(l)) ?? e.message.split('\n')[0]).slice(0, 140); }
    await page.waitForTimeout(600); const a = await modal(); console.log(name, 'click', sel, res, 'modal', b, '->', a);
    if (a !== b) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  }
  await page.evaluate(() => window.game.layers.set('surface')); await page.waitForTimeout(500);
  const zone = name === 'phone' ? await page.evaluate(() => { const r = document.querySelector('.hud-stack').getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }) : { x0: 380, x1: 900, y0: 559, y1: 653 };
  let ok = 0, tried = 0; const log = [];
  for (const [i, [fa, fb]] of [[0.1, 0.3], [0.3, 0.7], [0.5, 0.5], [0.7, 0.2], [0.9, 0.8], [0.5, 0.9], [0.2, 0.5], [0.8, 0.5]].entries()) {
    const sx = zone.x0 + fa * (zone.x1 - zone.x0), sy = zone.y0 + fb * (zone.y1 - zone.y0), sp = ['gecko', 'skink', 'dartfrog'][i % 3];
    const r1 = await page.evaluate(([sx, sy, sp]) => { const g = window.game, T = window.__tools; window.__S.selection.value = null; const R = T.dom.getBoundingClientRect(); T.mouse.set(((sx - R.left) / R.width) * 2 - 1, -((sy - R.top) / R.height) * 2 + 1); const h = T.pick(["terrain", "water"]); if (!h) return "no ground"; window.__za = g.world.animals.add(sp, (h.ground ?? h).point.clone()); return window.__za ? 'added' : 'add refused'; }, [sx, sy, sp]);
    if (r1 !== 'added') { log.push(`#${i} ${r1}`); continue; }
    await page.waitForTimeout(2500);
    const pt = await page.evaluate(() => { const g = window.game, v = window.__za.pos.clone(); v.y += 0.5; v.project(g.camera); const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight, t = document.elementFromPoint(x, y); return { x, y, top: (t?.tagName.toLowerCase() ?? 'null') + (typeof t?.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '') }; });
    const inZone = pt.x >= zone.x0 - 10 && pt.x <= zone.x1 + 10 && pt.y >= zone.y0 - 15 && pt.y <= zone.y1 + 15;
    if (name === 'phone') await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(450);
    const sel = await page.evaluate(() => { const s = window.__S.selection.value; return s ? (s.obj === window.__za ? 'yes' : 'other:' + (s.obj?.sp ?? s.kind)) : 'nothing'; });
    tried++; if (sel === 'yes') ok++;
    log.push(`#${i} ${sp}@${Math.round(pt.x)},${Math.round(pt.y)}${inZone ? '' : '(out of zone)'} top=${pt.top} sel=${sel}`);
    await page.evaluate(() => { window.__S.selection.value = null; });
  }
  console.log(name, `deadzone select ${ok}/${tried}:`, log.join('; '));
};
