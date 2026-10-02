// The link to the game. Everything the recorder knows about frames, resizes, quality changes and tank loads comes from here:
// the game's own methods are wrapped on the instance while recording (so a build that was not made for it, such as the
// original one, can be measured too, and a build that is not being measured pays nothing), and window.game is read once a
// second for gauges. A wrapper that cannot be installed is skipped; the recorder falls back to display ticks for frames.
import { FLAG } from './recorder.js';
import { createGpuProbe } from './gpu.js';

const r1 = (v) => Math.round(v * 10) / 10;
const guard = (f) => { try { return f(); } catch { return undefined; } };
const now = () => performance.now();

// Which adapter and context the renderer got, as far as the browser tells.
export function gpuInfo(r) {
  const b = r.backend, out = { api: b?.isWebGPUBackend ? 'webgpu' : 'webgl2' };
  guard(() => {
    const gl = b.gl;
    if (!gl) return;
    const x = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    out.vendor = x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    out.version = gl.getParameter(gl.VERSION); out.glsl = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
    out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); out.maxSamples = gl.getParameter(gl.MAX_SAMPLES); out.maxUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    out.exts = gl.getSupportedExtensions()?.length; out.timer = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const a = gl.getContextAttributes();
    if (a) out.attrs = { aa: a.antialias, power: a.powerPreference, depth: a.depth, stencil: a.stencil, alpha: a.alpha, caveat: a.failIfMajorPerformanceCaveat };
    out.buf = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  });
  guard(() => {
    const ad = b.adapter;
    if (!ad) return;
    const i = ad.info ?? {};
    out.adapter = { vendor: i.vendor, arch: i.architecture, device: i.device, desc: i.description, fallback: ad.isFallbackAdapter };
    out.features = [...ad.features].slice(0, 40);
    const L = ad.limits; out.limits = { tex2d: L.maxTextureDimension2D, buf: L.maxBufferSize, storage: L.maxStorageBufferBindingSize, invocations: L.maxComputeInvocationsPerWorkgroup };
    out.timestamps = ad.features.has('timestamp-query');
  });
  return out;
}

// Starts looking for window.game; wires it up when it appears. Returns the adapter: { sample(), snap(why), stop(), game }.
export function attachGame(rec, win, { onWire, gpuProbe = true } = {}) {
  const patched = [], undo = [];
  let game = null, gpu = null, snapWhy = null, warmFrames = 0, screenSub = false;
  const A = { get game() { return game; }, get gpuKind() { return gpu?.kind ?? ''; }, sample, snap(why) { snapWhy = why; }, stop };

  const wrap = (obj, key, make) => {
    const o = obj?.[key];
    if (typeof o !== 'function' || o.__pm) return;
    const w = make(o); w.__pm = true; obj[key] = w;
    patched.push(() => { obj[key] = o; });
  };
  const on = (el, type, fn) => { el.addEventListener(type, fn); undo.push(() => el.removeEventListener(type, fn)); };

  function wire(g) {
    game = g;
    const gfx = g.gfx, r = gfx.renderer, gov = gfx.governor, canvas = r.domElement, back = r.backend;
    rec.mode = 'game';
    rec.event('game', { backend: gfx.backend, gpu: gfx.gpu, quality: gfx.quality, adapt: gfx.adapt, cap: gfx.maxFps, auto: gfx.auto, governor: !!gov, params: [...(g.params?.keys?.() ?? [])] });
    rec.event('gpu-info', gpuInfo(r));
    gpu = gpuProbe ? createGpuProbe(rec, r) : null;

    // A lost GPU or context is the likeliest cause of a screen that goes black and comes back.
    on(canvas, 'webglcontextlost', (e) => rec.event('context-lost', { prevented: e.defaultPrevented }));
    on(canvas, 'webglcontextrestored', () => rec.event('context-restored', {}));
    on(canvas, 'webglcontextcreationerror', (e) => rec.event('context-error', { m: String(e.statusMessage ?? '').slice(0, 200) }));
    guard(() => back.device?.lost?.then((i) => rec.event('device-lost', { reason: i.reason, m: String(i.message).slice(0, 200) })));
    guard(() => { const d = back.device; if (d?.addEventListener) { const f = (e) => rec.event('gpu-error', { kind: e.error?.constructor?.name, m: String(e.error?.message).slice(0, 300) }); d.addEventListener('uncapturederror', f); undo.push(() => d.removeEventListener('uncapturederror', f)); } });

    // The frame: its start and end, the render call inside it, and whether the 4 Hz tick hooks ran after it.
    wrap(g, 'frame', (orig) => function (dt) {
      let fl = 0;
      if ((gov && gov.skip > 0) || warmFrames > 0 || this.lapse) fl |= FLAG.WARM;
      if (warmFrames > 0) warmFrames--;
      if (rec.phase === 'boot') rec.setPhase(win.__S?.screen?.value === 'play' ? 'play' : 'title');
      rec.frameBegin(now(), fl);
      try { return orig.call(this, dt); } finally { rec.frameEnd(now(), this._tickT === 0); }
    });
    wrap(gfx, 'render', (orig) => function () {
      rec.renderBegin(now());
      try { return orig.call(this); } finally {
        rec.renderEnd(now());
        if (snapWhy) { const w = snapWhy; snapWhy = null; snapshot(w); }
        gpu?.after();
      }
    });
    // What changes the picture's cost: pipeline rebuilds, resolution, the governor, the player's choices.
    wrap(gfx, 'build', (orig) => function (...a) {
      const t = now();
      try { return orig.apply(this, a); } finally { rec.flag(FLAG.REBUILT); warmFrames = Math.max(warmFrames, 120); rec.event('pipeline-build', { ms: r1(now() - t), q: this.quality, photo: !!this.photo }); }
    });
    wrap(gfx, 'resize', (orig) => function (...a) {
      const out = orig.apply(this, a);
      rec.event('gfx-resize', { pr: r1(r.getPixelRatio() * 100) / 100, adapt: this.adapt, q: this.quality });
      return out;
    });
    wrap(gfx, 'apply', (orig) => function (ch) {
      const from = { q: this.quality, sc: this.adapt, cap: this.maxFps };
      const out = orig.call(this, ch);
      rec.event('gov', { from, to: { q: this.quality, sc: this.adapt, cap: this.maxFps }, why: ch?.reason });
      return out;
    });
    for (const k of ['setQuality', 'setAuto', 'setCap']) wrap(gfx, k, (orig) => function (...a) { rec.event('setting', { what: k, v: typeof a[0] === 'function' ? '' : a[0] }); return orig.apply(this, a); });
    wrap(g, 'loadTank', (orig) => async function (id, o) {
      const t = now(); rec.event('tank-load', { id, state: 'start', showcase: !!o?.showcase });
      try { return await orig.call(this, id, o); } finally { warmFrames = Math.max(warmFrames, 240); rec.event('tank-load', { id, state: 'end', ms: r1(now() - t) }); }
    });
    wrap(g, 'restartTank', (orig) => function (...a) { const t = now(); try { return orig.apply(this, a); } finally { warmFrames = Math.max(warmFrames, 120); rec.event('tank-restart', { ms: r1(now() - t) }); } });
    onWire?.(g);
  }

  // The screen the player is on (title or play) names the phase, unless a benchmark is naming phases itself.
  function watchScreen() {
    const sig = win.__S?.screen;
    if (screenSub || !sig?.subscribe) return;
    screenSub = true;
    const off = guard(() => sig.subscribe((v) => { if (!rec.benchPhase && game) rec.setPhase(v === 'play' ? 'play' : 'title'); }));
    if (typeof off === 'function') undo.push(off);
  }

  const t0 = now();
  const find = () => {
    const g = win.game;
    // gfx.backend is set once the renderer has finished initialising (its context or device exists from then on).
    if (!game && g?.gfx?.renderer && g.gfx.backend && typeof g.frame === 'function') guard(() => wire(g));
    if (game) watchScreen();
    if (game && screenSub || now() - t0 > 600000) clearInterval(iv);
  };
  const iv = setInterval(find, 100);
  undo.push(() => clearInterval(iv));
  guard(find);

  // The once-a-second readings.
  function sample() {
    if (!game) return;
    guard(() => {
      watchScreen();
      const gfx = game.gfx, r = gfx.renderer, info = r.info, W = game.world;
      rec.gauge('q', gfx.quality); rec.gauge('sc', +gfx.adapt.toFixed(2)); rec.gauge('cap', gfx.maxFps); rec.gauge('pr', +r.getPixelRatio().toFixed(2));
      rec.gauge('cv', r.domElement.width + 'x' + r.domElement.height);
      rec.gauge('calls', info.render.drawCalls ?? info.render.calls); rec.gauge('tris', info.render.triangles);
      rec.gauge('geo', info.memory.geometries); rec.gauge('tex', info.memory.textures);
      if (gfx.stats?.gpuMs != null) rec.gauge('gpuMs', gfx.stats.gpuMs);
      const m = performance.memory; if (m) rec.gauge('heap', Math.round(m.usedJSHeapSize / 1048576));
      if (W) {
        rec.gauge('animals', Object.values(W.animals?.by ?? {}).reduce((s, a) => s + a.length, 0));
        rec.gauge('plants', W.plants?.list?.length ?? 0);
      }
      rec.gauge('speed', game.rate);
    });
  }

  // A small picture of what the canvas holds, taken inside the frame that was just rendered (the only moment it is readable).
  function snapshot(why) {
    guard(() => {
      const c = game.gfx.renderer.domElement, w = 640, h = Math.max(1, Math.round(w * c.height / c.width));
      const t = win.document.createElement('canvas'); t.width = w; t.height = h;
      t.getContext('2d').drawImage(c, 0, 0, w, h);
      const url = t.toDataURL('image/jpeg', 0.6);
      rec.snapshot(why, w, h, url.slice(url.indexOf(',') + 1));
    });
  }

  function stop() { patched.splice(0).forEach((f) => guard(f)); undo.splice(0).forEach((f) => guard(f)); gpu?.dispose(); }
  return A;
}
