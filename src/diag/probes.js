// What the browser itself can tell us, game or no game: the device, the long tasks, the slow input, errors, visibility, power,
// the load timeline, and a watch on the canvas size. Everything is defensive: a missing API is skipped, nothing here may throw
// into the game.

const r1 = (v) => Math.round(v * 10) / 10;
const shortUrl = (u) => { try { return String(u).replace(/[?#].*$/, '').replace(/^.*\//, '').slice(0, 60); } catch { return ''; } };
const guard = (f) => { try { return f(); } catch { return undefined; } };

// ---- the device ---------------------------------------------------------------------------------------------------------
// What is known at once.
export function collectEnv(win) {
  const nav = win.navigator, scr = win.screen, mq = (q) => guard(() => win.matchMedia(q).matches);
  const uad = nav.userAgentData;
  const c = nav.connection;
  return {
    ua: nav.userAgent, platform: nav.platform, lang: nav.language,
    cores: nav.hardwareConcurrency, memGB: nav.deviceMemory, touch: nav.maxTouchPoints,
    uaData: uad ? { brands: uad.brands, mobile: uad.mobile, platform: uad.platform } : null,
    screen: { w: scr.width, h: scr.height, aw: scr.availWidth, ah: scr.availHeight, depth: scr.colorDepth, dpr: win.devicePixelRatio, orient: guard(() => scr.orientation.type) },
    win: { iw: win.innerWidth, ih: win.innerHeight, ow: win.outerWidth, oh: win.outerHeight, vv: guard(() => win.visualViewport.scale) },
    display: { hdr: mq('(dynamic-range: high)'), p3: mq('(color-gamut: p3)'), coarse: mq('(pointer: coarse)'), hover: mq('(hover: hover)'), reduced: mq('(prefers-reduced-motion: reduce)'), standalone: mq('(display-mode: standalone)') },
    secure: win.isSecureContext, coi: win.crossOriginIsolated, webgpu: !!nav.gpu,
    conn: c ? { type: c.effectiveType, down: c.downlink, rtt: c.rtt, save: c.saveData } : null,
    url: win.location.href.replace(/#.*/, ''),
  };
}

// What takes a moment: the real browser build and CPU architecture (a Windows-on-ARM laptop running an x64 browser says so here).
export async function collectEnvLate(win) {
  const nav = win.navigator, out = {};
  try {
    if (nav.userAgentData?.getHighEntropyValues) out.uaHigh = await nav.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64']);
  } catch { /* blocked */ }
  return out;
}

// Plugged in or on battery matters a great deal to a laptop's speed: logged now and whenever it changes.
export function watchBattery(rec, win) {
  let undo = () => {};
  guard(() => win.navigator.getBattery?.().then((b) => {
    const log = () => rec.event('battery', { charging: b.charging, level: r1(b.level * 100) });
    log();
    b.addEventListener('chargingchange', log); b.addEventListener('levelchange', log);
    undo = () => { b.removeEventListener('chargingchange', log); b.removeEventListener('levelchange', log); };
  }).catch(() => {}));
  return () => undo();
}

// ---- observers ----------------------------------------------------------------------------------------------------------
export function installObservers(rec, win) {
  const undo = [];
  const PO = win.PerformanceObserver, ok = PO?.supportedEntryTypes ?? [];
  const observe = (type, cb, extra = {}) => {
    if (!ok.includes(type)) return;
    guard(() => { const po = new PO((l) => { for (const e of l.getEntries()) guard(() => cb(e)); }); po.observe({ type, buffered: true, ...extra }); undo.push(() => po.disconnect()); });
  };
  // A task that held the main thread for 50 ms or more. Entries from before the recorder started only join the event list.
  observe('longtask', (e) => { if (e.startTime >= rec.t0) rec.longTask(e.duration); rec.event('longtask', { d: r1(e.duration) }, e.startTime); });
  // A frame that took 50 ms or more, with the scripts that ran in it: which function, how long, and whether the time went to
  // script, to style and layout, or to the browser's render step.
  observe('long-animation-frame', (e) => {
    const sc = (e.scripts ?? []).slice(0, 3).map((s) => ({ i: String(s.invoker ?? s.invokerType ?? '').slice(0, 70), d: r1(s.duration), f: String(s.sourceFunctionName ?? '').slice(0, 40), u: shortUrl(s.sourceURL), c: s.sourceCharPosition }));
    rec.event('loaf', { d: r1(e.duration), b: r1(e.blockingDuration ?? 0), rs: r1(e.renderStart ? e.renderStart - e.startTime : 0), sl: r1(e.styleAndLayoutStart ? e.styleAndLayoutStart - e.startTime : 0), sc }, e.startTime);
  });
  // An input that took 40 ms or more from the touch or key to the next picture: how long it waited for the main thread,
  // how long its handlers ran, and (d minus both) how long the picture took to appear.
  observe('event', (e) => { rec.event('inp', { type: e.name, d: r1(e.duration), wait: r1(e.processingStart - e.startTime), run: r1(e.processingEnd - e.processingStart), id: e.interactionId || 0 }, e.startTime); }, { durationThreshold: 40 });
  observe('paint', (e) => rec.event('paint', { name: e.name }, e.startTime));

  const doc = win.document, on = (t, f, tgt = win, o) => { tgt.addEventListener(t, f, o); undo.push(() => tgt.removeEventListener(t, f, o)); };
  on('visibilitychange', () => { rec.setHidden(doc.hidden); rec.event('visibility', { hidden: doc.hidden }); }, doc);
  on('pagehide', () => rec.event('pagehide', {}));
  on('pageshow', () => rec.event('pageshow', {}));
  on('freeze', () => rec.event('freeze', {}), doc);
  on('resume', () => rec.event('resume', {}), doc);
  on('focus', () => rec.event('focus', { on: true })); on('blur', () => rec.event('focus', { on: false }));
  on('online', () => rec.event('net', { online: true })); on('offline', () => rec.event('net', { online: false }));
  on('fullscreenchange', () => rec.event('fullscreen', { on: !!doc.fullscreenElement }), doc);
  on('orientationchange', () => rec.event('orientation', {}));
  on('resize', () => rec.event('window-resize', { iw: win.innerWidth, ih: win.innerHeight, dpr: win.devicePixelRatio, vv: guard(() => r1(win.visualViewport.scale)) }));
  on('error', (e) => rec.event('error', { m: String(e.message ?? e).slice(0, 240), src: shortUrl(e.filename), l: e.lineno }));
  on('unhandledrejection', (e) => rec.event('error', { m: ('rejection: ' + (e.reason?.message ?? e.reason)).slice(0, 240) }));
  // The game's own console.warn/error (shader errors on a weak GPU show up here); the original still runs.
  const c = win.console;
  for (const k of ['warn', 'error']) {
    const orig = c[k];
    if (typeof orig !== 'function') continue;
    c[k] = function (...a) {
      guard(() => rec.event('console', { l: k, m: a.map((x) => (typeof x === 'string' ? x : x?.message ?? String(x))).join(' ').slice(0, 300) }));
      return orig.apply(this, a);
    };
    undo.push(() => { c[k] = orig; });
  }
  return () => undo.splice(0).forEach((f) => guard(f));
}

// ---- the canvas -----------------------------------------------------------------------------------------------------------
// Assigning canvas.width or canvas.height clears the canvas, and a cleared canvas that is presented is a black flash. This
// patches the two setters (only while recording) and reports every real change of an attached canvas to the recorder.
export function installCanvasHook(rec, win) {
  const proto = win.HTMLCanvasElement?.prototype;
  if (!proto) return () => {};
  const saved = [];
  let lastEl = null, lastT = -1;
  for (const prop of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d?.get || !d.set || !d.configurable) continue;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(v) {
        const before = d.get.call(this);
        d.set.call(this, v);
        if (this.isConnected && before !== d.get.call(this)) {
          const t = performance.now();
          if (this !== lastEl || t - lastT > 0.25) guard(() => rec.canvasChange(t, this.width, this.height));   // width then height is one resize
          lastEl = this; lastT = t;
        }
      },
    });
    saved.push([prop, d]);
  }
  return () => { for (const [prop, d] of saved) guard(() => Object.defineProperty(proto, prop, d)); };
}

// ---- the load timeline ------------------------------------------------------------------------------------------------------
// Navigation, paint, the game's own marks (src/util/trace.js) and the downloads, from the Performance timeline.
export function loadTimeline(win) {
  const p = win.performance;
  const nav = guard(() => p.getEntriesByType('navigation')[0]);
  const paint = {};
  for (const e of guard(() => p.getEntriesByType('paint')) ?? []) paint[e.name] = Math.round(e.startTime);
  const marks = (guard(() => p.getEntriesByType('mark')) ?? []).filter((m) => m.name.startsWith('pal:')).map((m) => [m.name.slice(4), Math.round(m.startTime)]);
  const res = (guard(() => p.getEntriesByType('resource')) ?? []).filter((r) => !r.name.includes('/__metrics'));
  const size = (r) => r.transferSize || r.encodedBodySize || 0;
  const slow = res.slice().sort((a, b) => (b.responseEnd - b.startTime) - (a.responseEnd - a.startTime)).slice(0, 6)
    .map((r) => ({ n: shortUrl(r.name), kb: Math.round(size(r) / 1024), ms: Math.round(r.responseEnd - r.startTime), at: Math.round(r.startTime) }));
  const lastEnd = res.reduce((m, r) => Math.max(m, r.responseEnd), 0);
  return {
    nav: nav ? { type: nav.type, ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), proto: nav.nextHopProtocol } : null,
    paint, marks,
    res: { n: res.length, kb: Math.round(res.reduce((s, r) => s + size(r), 0) / 1024), lastEnd: Math.round(lastEnd), slow },
  };
}
