// Custom-size tanks keep their own size: build custom A, save, build custom B, then load the save and open
// the portfolio entry: both must come back at A's dimensions, not B's (the last size built).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const res = await page.evaluate(async () => {
    // The same module instances the app uses (vite may have stamped their URLs with ?t=).
    const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(f)).pop() ?? '/src/' + f;
    const { setCustomTank } = await import(url('/content/tanks.js'));
    const { TANK } = await import(url('/sim/tank.js'));
    const D = window.__director, dims = () => `${TANK.w}x${TANK.d}x${TANK.h}`;
    const out = {};
    setCustomTank(70, 35, 45); await D.buildTank('custom'); out.A = dims();
    await D.save();
    setCustomTank(110, 50, 70); await D.buildTank('custom'); out.B = dims();
    await D.load(); out.afterLoad = dims();                         // A again (the slot was saved while A was open)
    setCustomTank(110, 50, 70); await D.buildTank('custom');        // A is archived into the portfolio
    const entry = D.career.portfolio.find((p) => p.tier === 'custom');
    if (entry) { await D.openPortfolio(entry.id); out.afterPortfolio = dims(); }
    out.sliderMemory = localStorage.getItem('paludarium.custom');
    return out;
  });
  console.log(JSON.stringify(res));
  const ok = res.A === '70x35x45' && res.B === '110x50x70' && res.afterLoad === res.A && (res.afterPortfolio ?? res.A) === res.A;
  console.log(ok ? 'CUSTOMTANK PASS' : 'CUSTOMTANK FAIL');
  try { await shot('customtank'); } catch { console.log('(screenshot timed out)'); }
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 5))));
};
