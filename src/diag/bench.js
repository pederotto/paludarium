// A hands-off test that plays the same minute every time, so two machines, or two builds, can be compared:
//   the title tank turning (6 s) -> Start pressed -> the new tank settling (8 s, warm-up) -> the hero view held (15 s)
//   -> the camera orbiting (15 s) -> the view from above (10 s).
// It drives the real page: the Start button is clicked like a person would, and the camera moves through the rig. Each stretch is
// a phase in the recording (`bench:*`), so the report can set them side by side. Pass `&quality=low&fixedres&fps=60` in the address
// to pin the graphics settings and compare builds rather than governors.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (win, n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : win.requestAnimationFrame(f)); win.requestAnimationFrame(f); });

async function until(cond, ms, step = 100) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { try { if (cond()) return true; } catch { /* not yet */ } await sleep(step); }
  return false;
}

export const STEPS = [['bench:title', 6000], ['bench:settle', 8000], ['bench:hero', 15000], ['bench:orbit', 15000], ['bench:top', 10000]];

export async function runBench({ rec, win, steps = STEPS, abort = () => false }) {
  const doc = win.document;
  rec.benchPhase = true;
  try {
    if (!(await until(() => doc.getElementById('loading')?.classList.contains('gone') && win.game?.world, 180000))) throw new Error('the game did not finish loading');
    const g = win.game;
    g.rig?.stopOrbit?.();
    rec.setPhase('bench:title'); rec.event('bench', { step: 'title' });
    await sleep(steps[0][1]);
    if (abort()) return { ok: false, error: 'stopped' };

    rec.setPhase('bench:start');
    const start = [...doc.querySelectorAll('button')].find((b) => /starter paludarium/i.test(b.textContent));
    if (!start) throw new Error('the Start button was not found (is the title screen showing?)');
    const t = performance.now();
    start.click();
    if (!(await until(() => win.__S?.screen?.value === 'play' && !win.__S?.busy?.value, 180000))) throw new Error('the tank did not start');
    await frames(win, 3);
    const ms = performance.now() - t;
    rec.event('bench-start', { ms: Math.round(ms) });

    for (const [name, len] of steps.slice(1)) {
      if (abort()) return { ok: false, error: 'stopped' };
      rec.setPhase(name); rec.event('bench', { step: name });
      if (name === 'bench:hero') { g.rig?.stopOrbit?.(); g.rig?.view?.('hero', false); }
      if (name === 'bench:orbit') g.rig?.startOrbit?.(0.4);
      if (name === 'bench:top') { g.rig?.stopOrbit?.(); g.rig?.view?.('top', false); }
      await sleep(len);
    }
    g.rig?.stopOrbit?.(); g.rig?.view?.('hero', true);
    rec.event('bench', { step: 'done' });
    return { ok: true, startMs: ms };
  } catch (e) {
    rec.event('bench-error', { m: String(e?.message ?? e) });
    return { ok: false, error: String(e?.message ?? e) };
  } finally {
    rec.benchPhase = false;
  }
}
