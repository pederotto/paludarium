// How the Add menu's picture cards load: opens the animal tab, then the plant tab, and reports for each how long until every
// visible card shows its picture and the longest frame the page froze meanwhile. Prints numbers (no PASS/FAIL).
//   node tools/shot.mjs --steps=tools/steps/menu-open.mjs --only=desktop [--query="?webgl"]
import { pickTool } from './_tools.mjs';
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  for (const tab of ['animal', 'plant']) {
    await page.evaluate(() => {
      const w = window.__menuW = { gaps: [], t0: performance.now() };
      let last = performance.now();
      const f = () => { const n = performance.now(); w.gaps.push(n - last); last = n; if (!w.stop) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    await pickTool(page, tab, { wait: 50 });
    const r = await page.evaluate(async () => {
      const w = window.__menuW;
      const visible = () => [...document.querySelectorAll('.opts .pick .pic')].filter((e) => !e.querySelector('svg')).filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight && b.width > 0; });
      const until = performance.now() + 60000;
      while (performance.now() < until) {
        const v = visible();
        if (v.length && v.every((e) => e.querySelector('img'))) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      w.stop = true;
      const v = visible();
      return { ms: Math.round(performance.now() - w.t0), cards: v.length, withPicture: v.filter((e) => e.querySelector('img')).length, frozen: Math.round(Math.max(...w.gaps)), over100: w.gaps.filter((g) => g > 100).length };
    });
    console.log(`${tab} menu: all ${r.withPicture}/${r.cards} visible pictures in ${r.ms} ms · longest frozen frame ${r.frozen} ms · frames over 100 ms ${r.over100}`);
    await shot('menu-' + tab);
  }
};
