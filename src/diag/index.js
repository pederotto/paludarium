// The metrics recorder, assembled: records what a page does on a real screen (frames, GPU latency, long tasks, resizes, load
// phases, errors, the device) and sends it to the machine serving the game, or keeps it for Copy/Save. Opt-in: nothing here is
// loaded unless the address has `?metrics`, and the preview server (tools/metrics-collector.mjs) can inject it into any build.
//
//   ?metrics            record, with the chip and its buttons       ?metrics=snapdragon   the same, naming the recording
//   &bench              also run the hands-off test (a minute)      &nooverlay            record without the chip
//   &metricsurl=off     do not look for a collector                  Backquote key: ⚡ flash · Shift+Backquote: 🐢 stutter
//   &nogpu              no GPU-latency probe (to check what the probe itself costs)
//
// window.__metrics is the handle for tools: { rec, sink, state, mark(), snapshot(), stop(), bench(), summary(), text(), ndjson() }.
// docs/METRICS.md describes the data.
import { Recorder } from './recorder.js';
import { Sink } from './sink.js';
import { collectEnv, collectEnvLate, installObservers, installCanvasHook, watchBattery, loadTimeline } from './probes.js';
import { attachGame } from './adapter.js';
import { createOverlay } from './overlay.js';
import { refreshRate } from './stats.js';

const MAX_SNAPS = 8;

export function start({ win = window, params = new URLSearchParams(win.location.search) } = {}) {
  if (win.__metrics) return win.__metrics;
  try { return begin(win, params); } catch (e) { console.warn('metrics: could not start', e); return null; }
}

function begin(win, params) {
  const doc = win.document;
  const raw = params.get('metrics');
  const label = (raw && !/^(1|true|on)$/i.test(raw) ? raw : '').replace(/[^\w.-]/g, '').slice(0, 24);
  const sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rec = new Recorder({ sid, label });
  const sink = new Sink({ sid, win, url: params.get('metricsurl') ?? '/__metrics' });
  const M = win.__metrics = { sid, label, rec, sink, state: 'recording', snaps: 0, started: Date.now() };

  sink.push([{ k: 'env', ver: 1, label, t0: rec.t0, wall: Date.now(), params: [...params].map(([k, v]) => (v ? k + '=' + v : k)), ...collectEnv(win) }]);
  collectEnvLate(win).then((late) => sink.push([{ k: 'env', late: true, ...late }])).catch(() => {});
  sink.probe().then(() => sink.flush()).catch(() => {});

  const undo = [installObservers(rec, win), installCanvasHook(rec, win), watchBattery(rec, win)];
  const adapter = M.adapter = attachGame(rec, win, { gpuProbe: !params.has('nogpu') });

  // Display frames: the cadence of the screen itself, and the check that a resized canvas gets redrawn before it is painted.
  // If no game ever shows up (a build that is not this one), display frames stand in for game frames.
  let raf = 0, useTicks = false;
  const tick = (ts) => {
    raf = win.requestAnimationFrame(tick);
    rec.displayTick(ts);
    if (useTicks) rec.push(ts, 0, 0, 0, rec.hidden ? 16 : 0);
  };
  raf = win.requestAnimationFrame(tick);
  const t0 = performance.now();

  // The loading veil of the page lifting is the moment a player sees the game; recorded in any build that has one.
  const veil = doc.getElementById('loading');
  if (veil) {
    const done = () => { if (veil.classList.contains('gone')) { rec.event('veil', {}); rec.event('load', loadTimeline(win)); mo.disconnect(); } };
    const mo = new win.MutationObserver(done);
    mo.observe(veil, { attributes: true, attributeFilter: ['class'] });
    undo.push(() => mo.disconnect());
    done();
  }

  const overlay = params.has('nooverlay') ? null : createOverlay({ win, onMark: (l) => mark(l), onSnap: () => snapshot('button'), onBench: () => bench(), onStop: () => stop('user') });

  // ---- actions --------------------------------------------------------------------------------------------------------------
  function mark(label) {
    if (M.state !== 'recording') return;
    M.marks = (M.marks ?? 0) + 1;
    rec.event('mark', { label });
    if (M.snaps < MAX_SNAPS) { M.snaps++; adapter.snap('mark:' + label); }
  }
  function snapshot(why = 'manual') { if (M.snaps < MAX_SNAPS) { M.snaps++; adapter.snap(why); } }
  const onKey = (e) => {
    if (e.code !== 'Backquote' || e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
    mark(e.shiftKey ? 'stutter' : 'flash');
  };
  win.addEventListener('keydown', onKey); undo.push(() => win.removeEventListener('keydown', onKey));

  let last = null, secs = 0, lastPhase = '', autoSnap = null;
  function pushDrain(final = false) { const r = rec.drain(final); if (r.length) sink.push(r); return r; }
  function sample() {
    adapter.sample();
    rec.roll();
    if (!rec.display.hz && rec.display.ticks > 150) {
      const hz = refreshRate(rec.tickGaps());
      if (hz) { rec.display.hz = hz; rec.event('display', { hz, maxGap: Math.round(rec.display.maxGap) }); }
    }
    if (!adapter.game && !useTicks && performance.now() - t0 > 20000) { useTicks = true; rec.mode = 'ticks'; rec.event('no-game', {}); }
    // The first seconds of a phase that is worth a picture of the screen.
    if (rec.phase !== lastPhase) {
      lastPhase = rec.phase;
      if ((rec.phase === 'play' || rec.phase === 'bench:hero') && M.snaps < MAX_SNAPS) { clearTimeout(autoSnap); autoSnap = setTimeout(() => snapshot('auto:' + rec.phase), 3000); }
    }
    secs++;
    const r = pushDrain();
    const b = r.find((x) => x.k === 'sec')?.list.slice(-1)[0];
    if (b) last = b;
    if (secs % 2 === 0) sink.flush();
    overlay?.update({
      secs: (performance.now() - rec.t0) / 1000, fps: last?.n ?? 0, p95: last?.g95 ?? 0, worst: Math.round(last?.gx ?? 0), marks: M.marks ?? 0, sink: sink.state,
      line: `${adapter.game ? rec.gv.q ?? '' : 'no game yet'} ${rec.gv.sc ? rec.gv.sc + '×' : ''} ${rec.gv.cap ? 'cap ' + rec.gv.cap : ''} ${adapter.gpuKind}`.trim(),
    });
  }
  const iv = setInterval(sample, 1000);

  const onHide = () => { if (M.state === 'recording' && doc.hidden) { pushDrain(); sink.flush(); } };
  const onPageHide = () => { if (M.state === 'recording') { rec.event('end', { reason: 'pagehide' }); pushDrain(true); sink.beacon(); } };
  doc.addEventListener('visibilitychange', onHide); win.addEventListener('pagehide', onPageHide);
  undo.push(() => { doc.removeEventListener('visibilitychange', onHide); win.removeEventListener('pagehide', onPageHide); });

  async function stop(reason = 'user') {
    if (M.state !== 'recording') return M.done;
    M.state = 'stopping';
    return (M.done = (async () => {
      clearInterval(iv); clearTimeout(autoSnap);
      if (M.snaps < MAX_SNAPS) { adapter.snap('end'); await new Promise((r) => setTimeout(r, 300)); }   // a picture needs one more frame
      rec.event('probe', { selfUs: Math.round((rec.selfMs / Math.max(1, rec.selfN)) * 1000), gpuSkipped: rec.gpuSkipped ?? 0, frames: rec.frames, dropped: rec.dropped });
      rec.event('load', loadTimeline(win));
      rec.event('end', { reason });
      win.cancelAnimationFrame(raf);
      pushDrain(true);
      await sink.flush();
      adapter.stop(); undo.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } });
      M.state = 'stopped';
      if (overlay) await showCard();
      return M.state;
    })());
  }

  async function showCard() {
    const R = await import('./report.js');
    const S = R.summarize(sink.records());
    overlay.update({ done: true, secs: S.durationS, fps: Math.round(S.headline.fps), p95: S.headline.p95, worst: Math.round(S.headline.max), marks: M.marks ?? 0, sink: sink.state, line: '' });
    overlay.card({
      title: `Recording ${sid}${label ? ' (' + label + ')' : ''}`, lines: S.findings, summary: R.renderText(S, { card: true }), text: R.renderText(S), sink: sink.state,
      onSave: () => sink.save(), onAgain: () => again(),
    });
  }

  // Records the same page again as a new session.
  function again() { overlay?.remove(); delete win.__metrics; start({ win, params }); }

  async function bench() {
    if (M.state !== 'recording') return null;
    const { runBench } = await import('./bench.js');
    const r = await runBench({ rec, win, abort: () => M.state !== 'recording' });
    if (M.state === 'recording') await stop('bench');
    return r;
  }

  Object.assign(M, {
    mark, snapshot, stop, bench, again,
    summary: async () => (await import('./report.js')).summarize(sink.records()),
    text: async () => { const R = await import('./report.js'); return R.renderText(R.summarize(sink.records())); },
    ndjson: () => sink.ndjson(),
  });
  if (params.has('bench')) bench();
  return M;
}
