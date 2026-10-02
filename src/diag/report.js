// Turns the records of one session into numbers and findings. Runs in Node (tools/metrics-report.mjs) and in the page (the
// result card), on exactly the same records, so what the player sees on screen is what the report says.
import { FrameHist, round, refreshRate } from './stats.js';
import { fromB64 } from './codec.js';
import { FLAG } from './recorder.js';

const OVER = [25, 33.4, 50, 100, 250, 500, 1000];
const num = (v, d = 1) => (v == null || Number.isNaN(v) ? '–' : (+v).toFixed(d));
const pct = (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%');
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function parseNdjson(text) {
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* a torn last line */ } }
  return out;
}

// All the frames of a session as flat arrays on one clock. Chunks are sorted by time and a repeated chunk (a retried POST) is dropped.
export function decodeFrames(records) {
  const seen = new Set(), chunks = [];
  for (const r of records) { if (r.k !== 'fr') continue; const key = r.t0 + ':' + r.n; if (!seen.has(key)) { seen.add(key); chunks.push(r); } }
  chunks.sort((a, b) => a.t0 - b.t0);
  const n = chunks.reduce((s, c) => s + c.n, 0);
  const F = { n, t: new Float64Array(n), gap: new Float32Array(n), sim: new Float32Array(n), rnd: new Float32Array(n), tck: new Float32Array(n), flg: new Uint8Array(n) };
  let o = 0;
  for (const c of chunks) {
    const g = fromB64(c.gap, Uint16Array), s = fromB64(c.sim, Uint16Array), r = fromB64(c.rnd, Uint16Array), k = fromB64(c.tck, Uint16Array), f = fromB64(c.flg);
    let t = c.t0;
    for (let i = 0; i < c.n; i++) {
      if (i) t += g[i] / 10;
      F.t[o + i] = t; F.gap[o + i] = g[i] / 10; F.sim[o + i] = s[i] / 10; F.rnd[o + i] = r[i] / 10; F.tck[o + i] = k[i] / 10; F.flg[o + i] = f[i];
    }
    o += c.n;
  }
  return F;
}

const newAgg = () => ({ gap: new FrameHist(), rnd: new FrameHist(), frames: 0, warm: 0, hidden: 0, secs: 0, over: OVER.map(() => 0), slowT: 0, sim: 0, rndSum: 0, tck: 0, tckN: 0, worstWarm: 0, blankRisk: 0 });

function addFrame(a, F, i) {
  const fl = F.flg[i];
  if (fl & FLAG.HIDDEN) { a.hidden++; return; }
  if (fl & FLAG.WARM) { a.warm++; if (F.gap[i] > a.worstWarm) a.worstWarm = F.gap[i]; return; }
  a.frames++;
  const g = F.gap[i];
  if (fl & FLAG.BLANK_RISK) a.blankRisk++;
  a.sim += F.sim[i]; a.rndSum += F.rnd[i]; a.rnd.add(F.rnd[i]);
  if (fl & FLAG.TICK) { a.tck += F.tck[i]; a.tckN++; }
  if (g > 0) {
    a.gap.add(g); a.secs += g / 1000;
    for (let k = 0; k < OVER.length; k++) if (g > OVER[k]) a.over[k]++;
    if (g > 33.4) a.slowT += g;
  }
}

function finishAgg(a) {
  const g = a.gap, nz = a.frames || 1;
  return {
    frames: a.frames, warm: a.warm, hidden: a.hidden, secs: round(a.secs, 1), worstWarm: round(a.worstWarm, 0),
    fps: a.secs ? round(g.n / a.secs, 1) : 0,
    p50: round(g.percentile(0.5), 1), p95: round(g.percentile(0.95), 1), p99: round(g.percentile(0.99), 1), max: round(g.max, 1),
    low1: g.percentile(0.99) ? round(1000 / g.percentile(0.99), 1) : 0,
    over: Object.fromEntries(OVER.map((t, i) => [t, a.over[i]])),
    slowTime: a.secs ? a.slowT / 1000 / a.secs : 0,
    sim: round(a.sim / nz, 1), rnd: round(a.rndSum / nz, 1), rndP95: round(a.rnd.percentile(0.95), 1), tck: a.tckN ? round(a.tck / a.tckN, 1) : 0,
    blankRisk: a.blankRisk,
  };
}

// ---- the session ---------------------------------------------------------------------------------------------------------
export function summarize(records) {
  const by = (k) => records.filter((r) => r.k === k);
  const env = Object.assign({}, ...by('env'));
  const t0 = env.t0 ?? 0;
  const ev = by('ev').flatMap((r) => r.list).sort((a, b) => a.t - b.t);
  const sec = by('sec').flatMap((r) => r.list);
  const evs = (n) => ev.filter((e) => e.n === n);
  const F = decodeFrames(records);

  // phases
  const marks = [{ t: -Infinity, name: 'boot' }, ...evs('phase').map((e) => ({ t: e.t, name: e.to }))];
  const aggs = new Map(), order = [];
  const agg = (name) => { if (!aggs.has(name)) { aggs.set(name, { name, a: newAgg(), from: Infinity, to: -Infinity }); order.push(name); } return aggs.get(name); };
  const head = newAgg();
  const isHead = (n) => n === 'play' || (n.startsWith('bench:') && !['bench:title', 'bench:start', 'bench:settle'].includes(n));
  let pi = 0;
  for (let i = 0; i < F.n; i++) {
    while (pi + 1 < marks.length && marks[pi + 1].t <= F.t[i]) pi++;
    const name = marks[pi].name, g = agg(name);
    addFrame(g.a, F, i);
    g.from = Math.min(g.from, F.t[i]); g.to = Math.max(g.to, F.t[i]);
    if (isHead(name)) addFrame(head, F, i);
  }

  // per-second buckets: GPU latency, long tasks, gauges
  const at = (s) => t0 + s * 1000;
  const gv = {};
  const perPhase = new Map();
  const mem = { heapFirst: null, heapMax: 0, heapLast: null };
  for (const b of sec) {
    Object.assign(gv, b.g);
    const p = perPhase.get(b.ph) ?? { gpuN: 0, gpuSum: 0, gpuMax: 0, ltN: 0, ltMs: 0, level: {} };
    perPhase.set(b.ph, p);
    if (b.gpu) { p.gpuN += b.gpu[0]; p.gpuSum += b.gpu[0] * b.gpu[1]; p.gpuMax = Math.max(p.gpuMax, b.gpu[2]); }
    if (b.lt) { p.ltN += b.lt[0]; p.ltMs += b.lt[1]; }
    p.level = { q: gv.q, sc: gv.sc, cap: gv.cap, pr: gv.pr, cv: gv.cv, calls: gv.calls, tris: gv.tris, animals: gv.animals, plants: gv.plants };
    if (gv.heap != null) { mem.heapFirst ??= gv.heap; mem.heapMax = Math.max(mem.heapMax, gv.heap); mem.heapLast = gv.heap; }
  }
  const lastSec = sec.length ? at(sec[sec.length - 1].s + 1) : (F.n ? F.t[F.n - 1] : t0);
  const firstT = Math.min(F.n ? F.t[0] : Infinity, ev.length ? ev[0].t : Infinity, t0);
  const dur = Math.max(0, (Math.max(lastSec, F.n ? F.t[F.n - 1] : 0) - Math.min(t0, firstT)) / 1000);

  const phases = order.map((name) => {
    const g = aggs.get(name), p = perPhase.get(name);
    const s = finishAgg(g.a);
    return { name, from: round(g.from / 1000, 1), to: round(g.to / 1000, 1), ...s, gpuAvg: p?.gpuN ? round(p.gpuSum / p.gpuN, 1) : null, gpuMax: p?.gpuN ? round(p.gpuMax, 1) : null, gpuSamples: p?.gpuN ?? 0, lt: p ? { n: p.ltN, ms: round(p.ltMs, 0) } : { n: 0, ms: 0 }, level: p?.level ?? {} };
  }).filter((p) => p.frames + p.warm + p.hidden > 0);
  const headPhase = { name: 'headline', ...finishAgg(head) };
  const hpp = phases.filter((p) => isHead(p.name));
  headPhase.gpuAvg = (() => { let n = 0, s = 0; for (const p of hpp) if (p.gpuSamples) { n += p.gpuSamples; s += p.gpuAvg * p.gpuSamples; } return n ? round(s / n, 1) : null; })();
  headPhase.gpuMax = hpp.reduce((m, p) => Math.max(m, p.gpuMax ?? 0), 0) || null;
  headPhase.level = hpp.length ? hpp[hpp.length - 1].level : {};
  const headline = headPhase.frames >= 30 ? headPhase : phases.slice().sort((a, b) => b.frames - a.frames)[0] ?? headPhase;

  // device
  const uaH = env.uaHigh ?? {}, ua = env.ua ?? '';
  const brands = (uaH.fullVersionList ?? env.uaData?.brands ?? []).filter((b) => !/not.?a.?brand|chromium/i.test(b.brand));
  const fromUa = (/(Edg|OPR|Firefox)\/(\d+)/.exec(ua) ?? /(Chrome|Safari)\/(\d+)/.exec(ua)), uaName = fromUa ? `${{ Edg: 'Edge', OPR: 'Opera' }[fromUa[1]] ?? fromUa[1]} ${fromUa[2]}` : 'unknown';
  const browser = brands[0] ? `${brands[0].brand} ${String(brands[0].version).split('.')[0]}` : uaName;
  const plat = uaH.platform ?? env.uaData?.platform ?? (/Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '');
  const osv = uaH.platformVersion ? (plat === 'Windows' ? (parseInt(uaH.platformVersion, 10) >= 13 ? '11' : '10') : uaH.platformVersion) : (plat === 'Windows' ? '10 or 11' : '');
  const gi = evs('gpu-info')[0] ?? {}, game = evs('game')[0] ?? {};
  const gpuName = gi.renderer ?? [gi.adapter?.vendor, gi.adapter?.arch, gi.adapter?.desc].filter(Boolean).join(' ') ?? game.gpu ?? '';
  const display = evs('display').slice(-1)[0];
  const device = {
    os: `${plat} ${osv}`.trim(), browser, arch: uaH.architecture ? `${uaH.architecture}${uaH.bitness ? '-' + uaH.bitness : ''}` : '', cores: env.cores, memGB: env.memGB, touch: env.touch,
    screen: env.screen ? `${env.screen.w}x${env.screen.h} @${env.screen.dpr}` : '', window: env.win ? `${env.win.iw}x${env.win.ih}` : '', hz: display?.hz ?? 0, secure: env.secure, hdr: env.display?.hdr,
  };
  const gpu = { api: gi.api ?? '', name: gpuName || game.gpu || '', software: /swiftshader|llvmpipe|software|basic render/i.test(gpuName || game.gpu || ''), timer: gi.timer };
  const battery = evs('battery');

  // the load
  const load = (() => {
    const tl = evs('load').slice(-1)[0] ?? {};
    const mk = Object.fromEntries((tl.marks ?? []).map(([n, t]) => [n, t]));
    const veil = evs('veil')[0]?.t ?? null, firstFrame = F.n ? F.t[0] : null;
    const upto = veil ?? firstFrame ?? Infinity;
    const lts = evs('longtask').filter((e) => e.t < upto);
    const loafs = evs('loaf').filter((e) => e.t < upto).sort((a, b) => b.d - a.d).slice(0, 5);
    const tank = evs('tank-load').filter((e) => e.state === 'end').map((e) => ({ id: e.id, ms: e.ms, at: round(e.t, 0) }));
    const build = evs('pipeline-build').map((e) => ({ ms: e.ms, q: e.q, at: round(e.t, 0) }));
    const seg = (a, b) => (mk[a] != null && mk[b] != null ? mk[b] - mk[a] : null);
    const segments = { scripts: mk.main ?? null, renderer: seg('boot-start', 'boot-end'), showcase: seg('showcase-start', 'showcase-end'), ui: seg('showcase-end', 'ui'), startHandler: seg('start', 'started') };
    return {
      segments, fcp: tl.paint?.['first-contentful-paint'] ?? null, dcl: tl.nav?.dcl ?? null, ttfb: tl.nav?.ttfb ?? null, load: tl.nav?.load ?? null, marks: mk,
      veil: veil != null ? round(veil, 0) : null, firstFrame: firstFrame != null ? round(firstFrame, 0) : null,
      res: tl.res ?? null, longtasks: { n: lts.length, ms: round(lts.reduce((s, e) => s + e.d, 0), 0), worst: lts.length ? round(Math.max(...lts.map((e) => e.d)), 0) : 0 }, loafs, tank, build,
      bench: evs('bench-start')[0] ?? null,
    };
  })();

  // display, canvas, governor
  // A resize assigns canvas.width and canvas.height one after the other: events less than 5 ms apart are one change.
  const canvas = [];
  for (const e of evs('canvas')) { const p = canvas[canvas.length - 1]; if (p && e.t - p.t < 5) { p.h = e.h; p.afterRender ||= e.afterRender; } else canvas.push({ ...e }); }
  const gov = evs('gov');
  const blank = { risk: evs('blank-risk').length, presented: evs('blank-frame').length, outside: canvas.filter((e) => !e.inFrame).length, changes: canvas.length, afterRender: canvas.filter((e) => e.afterRender).length };
  const counts = {};
  for (const e of ev) counts[e.n] = (counts[e.n] ?? 0) + 1;
  const lost = evs('context-lost').length + evs('device-lost').length;
  const errors = [...evs('error'), ...evs('console'), ...evs('gpu-error'), ...evs('device-lost'), ...evs('context-error')].sort((a, b) => a.t - b.t);
  const uniq = []; const seenM = new Set();
  for (const e of errors) { const k = (e.n + (e.l ?? '') + (e.m ?? e.reason ?? '')).slice(0, 120); if (!seenM.has(k)) { seenM.add(k); uniq.push({ at: round(e.t / 1000, 1), n: e.n, l: e.l, m: e.m ?? e.reason }); } }
  // One tap or key press reports several events (pointerdown, pointerup, click...) that share an interaction id: count it once.
  const grouped = new Map();
  for (const e of evs('inp')) { const key = e.id ? 'i' + e.id : 't' + Math.round(e.t / 40); const g = grouped.get(key); if (!g || e.d > g.d) grouped.set(key, e); }
  const inp = [...grouped.values()], lt = evs('longtask');
  const probe = evs('probe').slice(-1)[0] ?? null;

  // marks, with what was going on around them
  const markCtx = evs('mark').map((m) => {
    const lo = m.t - 3000, hi = m.t + 500;
    let worst = 0, fr = 0;
    for (let i = 0; i < F.n; i++) { if (F.t[i] >= lo && F.t[i] <= hi) { fr++; if (F.gap[i] > worst) worst = F.gap[i]; } }
    const near = ev.filter((e) => e.t >= lo && e.t <= hi && !['mark', 'slow', 'phase', 'paint', 'canvas'].includes(e.n))
      .map((e) => `${e.n}${e.d != null ? ' ' + Math.round(e.d) + 'ms' : ''}${e.to?.q ? ' →' + e.to.q + '@' + e.to.sc + '/' + e.to.cap : ''}`);
    const canv = ev.filter((e) => e.t >= lo && e.t <= hi && e.n === 'canvas').length;
    const slow = ev.filter((e) => e.t >= lo && e.t <= hi && e.n === 'slow').length;
    return { at: round((m.t - t0) / 1000, 1), label: m.label, worstGap: round(worst, 0), canvas: canv, slow, near: near.slice(0, 8), frames: fr };
  });

  // Freezes: a frame that took 250 ms or more, or a wait that long between frames, warm-up frames included (the headline leaves
  // those out, and the biggest stalls are exactly there: the frame after a governor change or a tank load). A frame that
  // took D ms is followed by a wait of about D ms; that is one freeze, not two. The cause is what happened around its start.
  const slowEv = evs('slow'), freezes = [];
  const taken = slowEv.filter((e) => (e.dur ?? 0) >= 250), waited = slowEv.filter((e) => e.gap >= 250);
  for (const e of taken) freezes.push({ t: e.t, ms: e.dur, warm: !!(e.fl & 1) });
  for (const e of waited) if (!taken.some((d) => Math.abs(d.t + d.dur - e.t) < 400)) freezes.push({ t: e.t - e.gap, ms: e.gap, warm: !!(e.fl & 1) });
  const CAUSES = new Set(['gov', 'pipeline-build', 'tank-load', 'tank-restart', 'setting', 'bench', 'phase']);
  for (const f of freezes) {
    const c = ev.filter((e) => CAUSES.has(e.n) && e.t >= f.t - 300 && e.t <= f.t + 600 && !(e.n === 'tank-load' && e.state === 'end' && e.t > f.t + 50));
    f.cause = c.map((e) => (e.n === 'gov' ? `governor ${e.from.q}@${e.from.sc} → ${e.to.q}@${e.to.sc}` : e.n === 'pipeline-build' ? `pipeline rebuilt (${e.q})` : e.n === 'tank-load' ? `tank ${e.state}` : e.n === 'phase' ? `phase ${e.to}` : e.n)).filter((x, i, a) => a.indexOf(x) === i).join(', ');
    f.at = round((f.t - t0) / 1000, 1); f.ms = round(f.ms, 0);
  }
  freezes.sort((a, b) => b.ms - a.ms);

  const out = {
    sid: records.find((r) => r.sid)?.sid ?? '', label: env.label ?? '', wall: env.wall ? new Date(env.wall).toISOString() : '', durationS: round(dur, 1),
    device, gpu, battery: battery.length ? { first: battery[0], last: battery[battery.length - 1], changes: battery.length } : null,
    game: { backend: game.backend, quality0: game.quality, cap0: game.cap, governor: game.governor, params: game.params ?? [], url: env.url },
    load, phases, headline, display: { hz: device.hz, maxTickGap: round(evs('display')[0]?.maxGap ?? 0, 1) },
    blank, canvas: { changes: canvas.length, list: canvas.slice(0, 40).map((e) => ({ at: round((e.t - t0) / 1000, 1), w: e.w, h: e.h, inFrame: e.inFrame, afterRender: e.afterRender })) },
    gov: gov.map((e) => ({ at: round((e.t - t0) / 1000, 1), from: e.from, to: e.to, why: e.why })), settings: evs('setting').map((e) => ({ at: round((e.t - t0) / 1000, 1), what: e.what, v: e.v })),
    contextLost: lost, errors: uniq.slice(0, 20), errorCount: errors.length,
    inp: { n: inp.length, worst: inp.length ? round(Math.max(...inp.map((e) => e.d)), 0) : 0, over200: inp.filter((e) => e.d > 200).length },
    longtasks: { n: counts.longtask ?? lt.length, ms: round(lt.reduce((s, e) => s + e.d, 0), 0), worst: lt.length ? round(Math.max(...lt.map((e) => e.d)), 0) : 0 },
    freezes: freezes.slice(0, 12), freezeCount: freezes.length, freezeMs: round(freezes.reduce((a, f) => a + f.ms, 0), 0),
    memory: mem, marks: markCtx, probe, counts, hidden: evs('visibility').filter((e) => e.hidden).length,
    snaps: by('snap').map((s) => ({ t: s.t, why: s.why, w: s.w, h: s.h })),
  };
  out.findings = findings(out);
  return out;
}

// ---- what the numbers mean ----------------------------------------------------------------------------------------------------
function findings(S) {
  const f = [], add = (sev, text) => f.push({ sev, text });
  const H = S.headline, hz = S.device.hz || 0, cap = +H.level?.cap || 60, target = 1000 / Math.min(cap, hz || 60);
  const b = S.blank;
  if (b.risk) add('bad', `The canvas was resized after a frame had been drawn ${b.risk} time${b.risk > 1 ? 's' : ''}: each one presents an empty frame, a black flash.`);
  if (b.presented) add('bad', `${b.presented} display frame${b.presented > 1 ? 's were' : ' was'} presented with a cleared canvas after a resize outside the frame loop (a window resize while the frame-rate cap skipped the next frame, for one).`);
  const loadEnd = (S.load.veil ?? 0) / 1000 + 12;   // the first seconds after the screen lifts are the tank's warm-up
  const play = S.freezes.filter((f) => f.ms >= 1000 && f.at > loadEnd);
  if (play.length) add('bad', `The page froze ${play.length} time${play.length > 1 ? 's' : ''} for a second or more while playing (longest ${num(play[0].ms / 1000)} s at ${num(play[0].at)} s${play[0].cause ? ', right after: ' + play[0].cause : ''}). A frozen page is a frozen screen, and on a weak GPU a busy driver can stall the whole desktop.`);
  else if (S.freezes.some((f) => f.ms >= 500 && f.at > loadEnd)) add('warn', `The page froze for half a second or more ${S.freezes.filter((f) => f.ms >= 500 && f.at > loadEnd).length} time(s) while playing (see Freezes).`);
  if (S.contextLost) add('bad', `The GPU or its context was lost ${S.contextLost} time${S.contextLost > 1 ? 's' : ''}: the screen goes black until it is restored.`);
  if (S.gpu.software) add('bad', `Rendering is in software (${S.gpu.name}): the graphics card is not being used. Check the browser's hardware acceleration setting.`);
  if (S.counts['gpu-error']) add('warn', `${S.counts['gpu-error']} GPU validation error(s) were reported (see Errors).`);
  if (S.errorCount && !S.counts['gpu-error']) add('warn', `${S.errorCount} error or warning message(s) in the console (see Errors).`);
  if (H.frames >= 30) {
    if (H.p95 > target * 2.5) add('bad', `Frame time is poor: p95 ${num(H.p95)} ms against a target of ${num(target)} ms; the picture is visibly choppy.`);
    else if (H.p95 > target * 1.5) add('warn', `Frame time is uneven: p95 ${num(H.p95)} ms against a target of ${num(target)} ms.`);
    if (H.fps && H.fps < 0.9 * Math.min(cap, hz || 60)) add(H.fps < 0.6 * Math.min(cap, hz || 60) ? 'bad' : 'warn', `Averages ${num(H.fps)} fps where the frame limit is ${cap}.`);
    if (H.over[100] >= 5) add('bad', `${H.over[100]} frames took over 100 ms (worst ${num(H.max, 0)} ms): the picture freezes for visible moments.`);
    else if (H.over[100] >= 1) add('warn', `${H.over[100]} frame(s) took over 100 ms (worst ${num(H.max, 0)} ms).`);
    if (H.gpuAvg != null && H.gpuAvg > 0.8 * target) add(H.gpuAvg > 1.5 * target ? 'bad' : 'warn', `The GPU is the limit: a frame takes ${num(H.gpuAvg)} ms to finish after it is submitted (a frame is ${num(target)} ms). Lower the resolution or preset.`);
    else if (H.gpuMax != null && H.gpuMax > 100) add('warn', `GPU latency reached ${num(H.gpuMax, 0)} ms at times: a saturated GPU can freeze the whole desktop.`);
    if (H.rnd > 0.5 * target) add('warn', `The render call alone takes ${num(H.rnd)} ms on the main thread (${num(H.rndP95)} ms at p95): the CPU side of drawing is a bottleneck (or it is waiting for a busy GPU).`);
  } else if (!S.phases.length) add('warn', 'No game frames were recorded.');
  const L = S.load;
  if (L.veil != null && L.veil > 8000) add('warn', `The loading screen lifted after ${num(L.veil / 1000)} s${L.longtasks.n ? `, with ${L.longtasks.n} long tasks adding up to ${num(L.longtasks.ms / 1000)} s of frozen page` : ''}.`);
  if (L.bench?.ms > 3000) add('warn', `Pressing Start took ${num(L.bench.ms / 1000)} s to show the tank.`);
  if (S.gov.length > 8) add('warn', `The graphics governor changed settings ${S.gov.length} times: it keeps hunting for a level, and every change is a canvas resize.`);
  if (S.battery && S.battery.last.charging === false && (hz === 30 || S.display.hz === 30)) add('bad', `The screen is refreshing at 30 Hz while on battery (${S.battery.last.level}%): the browser's energy saver is capping the frame rate, so these numbers are not what the machine can do. Plug it in and record again.`);
  else if (S.battery && S.battery.last.charging === false) add('warn', `The laptop is running on battery (${S.battery.last.level}%): many laptops slow the CPU and GPU unplugged.`);
  if (S.device.arch.startsWith('x86') && /qualcomm|adreno/i.test(S.gpu.name)) add('warn', 'An x64 browser is running on an ARM (Qualcomm) laptop through emulation: a native ARM64 build of Chrome or Edge is much faster.');
  if (!S.device.arch && S.device.secure === false) add('info', 'Over plain http the browser hides its CPU architecture, memory size and battery state: serve with --https to see whether it is a native ARM build and whether the laptop is on battery.');
  if (S.inp.over200) add('warn', `${S.inp.over200} input(s) took over 200 ms to show a result (worst ${S.inp.worst} ms): the game feels laggy to touch.`);
  if (S.memory.heapLast != null && S.memory.heapFirst != null && S.memory.heapLast - S.memory.heapFirst > 200) add('warn', `JavaScript memory grew by ${S.memory.heapLast - S.memory.heapFirst} MB during the session.`);
  if (S.device.secure === false && S.gpu.api === 'webgl2') add('info', 'The page is not a secure context (plain http), so there is no WebGPU: this is the WebGL 2 path.');
  if (S.probe && S.probe.selfUs > 100) add('info', `The recorder itself costs ${S.probe.selfUs} µs a frame.`);
  if (!f.some((x) => x.sev === 'bad' || x.sev === 'warn')) add('ok', 'Nothing wrong was seen.');
  return f;
}

// ---- text ---------------------------------------------------------------------------------------------------------------------------
const ICON = { bad: '✗', warn: '!', ok: '✓', info: '·' };

// The few lines that say how it ran.
function headlineLines(S) {
  const H = S.headline, lv = H.level ?? {}, L = [];
  L.push(`${num(H.fps)} fps · frame p50 ${num(H.p50)} ms · p95 ${num(H.p95)} ms · p99 ${num(H.p99)} ms · worst ${num(H.max, 0)} ms · 1% low ${num(H.low1)} fps`);
  L.push(`over 33 ms: ${H.over?.[33.4] ?? 0} frames (${pct(H.slowTime)} of the time) · over 100 ms: ${H.over?.[100] ?? 0} · ${H.frames} frames measured (${H.warm} warm-up frames left out)`);
  L.push(`per frame: before render ${num(H.sim)} ms · render call ${num(H.rnd)} ms · tick hooks ${num(H.tck)} ms${H.gpuAvg != null ? ` · GPU latency ${num(H.gpuAvg)} ms avg, ${num(H.gpuMax, 0)} max` : ''}`);
  L.push(`settings at the end: ${lv.q ?? '?'} · scale ${lv.sc ?? '?'} · cap ${lv.cap ?? '?'} · pixel ratio ${lv.pr ?? '?'} · canvas ${lv.cv ?? '?'}${lv.animals != null ? ` · ${lv.animals} animals, ${lv.plants} plants · ${lv.calls ?? '?'} draw calls, ${lv.tris != null ? Math.round(lv.tris / 1000) + 'k' : '?'} triangles` : ''}`);
  return L;
}

export function renderText(S, { card = false } = {}) {
  if (card) return headlineLines(S).join('\n');
  const L = [], d = S.device;
  L.push(`# Session ${S.sid}${S.label ? ' (' + S.label + ')' : ''}`);
  L.push(`${S.wall ? S.wall.replace('T', ' ').slice(0, 19) + ' UTC · ' : ''}${num(S.durationS, 0)} s recorded`);
  L.push('');
  L.push('## Findings');
  for (const x of S.findings) L.push(`- ${ICON[x.sev]} ${x.text}`);
  L.push('');
  L.push('## Headline (steady play, warm-up frames left out)');
  L.push(...headlineLines(S));
  L.push('');
  L.push('## Device');
  L.push(`${d.os} · ${d.browser}${d.arch ? ' (' + d.arch + ')' : ' (architecture hidden over http)'} · ${d.cores ?? '?'} cores · ${d.memGB != null ? d.memGB + ' GB reported' : 'memory hidden'} · touch ${d.touch ?? 0}`);
  L.push(`GPU: ${S.gpu.name || '?'} · ${S.gpu.api || '?'}${S.gpu.timer ? ' · timer queries' : ''}`);
  L.push(`screen ${d.screen} · window ${d.window} · ${d.hz ? d.hz + ' Hz' : 'refresh rate unknown'}${d.secure === false ? ' · plain http' : ''}${S.battery ? ` · battery ${S.battery.last.level}% ${S.battery.last.charging ? 'charging' : 'discharging'}` : ''}`);
  L.push(`build: ${S.game.backend ?? '?'}, started at ${S.game.quality0 ?? '?'}, governor ${S.game.governor ? 'on' : 'absent'}${S.game.params.length ? ', params ' + S.game.params.join(',') : ''}`);
  L.push('');
  L.push('## Load');
  const ld = S.load, sg = ld.segments ?? {}, sec = (v) => (v == null ? null : num(v / 1000, 2) + ' s');
  const parts = [['first paint', sec(ld.fcp)], ['DOM ready', sec(ld.dcl)], ['page load', sec(ld.load)]].filter((x) => x[1]);
  L.push(parts.map(([k, v]) => `${k} ${v}`).join(' · '));
  const chain = [['scripts fetched and evaluated by', sec(sg.scripts)], ['renderer ready in', sec(sg.renderer)], ['title tank built in', sec(sg.showcase)], ['UI mounted in', sec(sg.ui)], ['first game frame at', sec(ld.firstFrame)], ['loading screen gone at', sec(ld.veil)]].filter((x) => x[1]);
  if (chain.length) L.push(chain.map(([k, v]) => `${k} ${v}`).join(' · '));
  if (ld.bench) L.push(`Start pressed → tank on screen: ${num(ld.bench.ms / 1000, 2)} s`);
  else if (sg.startHandler != null) L.push(`Start pressed → start handler finished: ${num(sg.startHandler / 1000, 2)} s`);
  if (ld.res) L.push(`downloads: ${ld.res.n} files, ${ld.res.kb} kB, the last finished at ${num(ld.res.lastEnd / 1000, 2)} s; slowest: ${ld.res.slow.slice(0, 3).map((r) => `${r.n} ${r.ms} ms`).join(', ')}`);
  L.push(`main thread before the screen lifted: ${ld.longtasks.n} long tasks, ${num(ld.longtasks.ms / 1000)} s in all, worst ${ld.longtasks.worst} ms`);
  for (const x of ld.loafs.slice(0, 3)) L.push(`  a ${Math.round(x.d)} ms frame at ${num(x.t / 1000, 1)} s: ${(x.sc ?? []).map((s) => `${s.i || '?'} ${Math.round(s.d)} ms ${s.u}${s.f ? ':' + s.f : ''}`).join('; ') || 'no script attributed'} (render ${x.rs} ms, style+layout ${x.sl} ms)`);
  if (ld.tank.length) L.push(`tank builds: ${ld.tank.map((x) => `${x.id} ${num(x.ms / 1000, 2)} s`).join(', ')} · pipeline builds: ${ld.build.length ? ld.build.map((x) => num(x.ms, 0) + ' ms').join(', ') : 'none'}`);
  L.push('');
  L.push('## Frames by phase (warm-up frames excluded)');
  L.push('| phase | s | frames | fps | p50 | p95 | p99 | max | >33ms | >100ms | render | GPU lat | long tasks | q / scale / cap |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of [...S.phases, ...(S.headline.name === 'headline' ? [S.headline] : [])]) {
    const lv2 = p.level ?? {};
    L.push(`| ${p.name} | ${num(p.secs, 0)} | ${p.frames} (+${p.warm}w) | ${num(p.fps)} | ${num(p.p50)} | ${num(p.p95)} | ${num(p.p99)} | ${num(p.max, 0)} | ${p.over?.[33.4] ?? 0} | ${p.over?.[100] ?? 0} | ${num(p.rnd)} | ${p.gpuAvg != null ? num(p.gpuAvg) + '/' + num(p.gpuMax, 0) : '–'} | ${p.lt ? `${p.lt.n} / ${p.lt.ms} ms` : '–'} | ${lv2.q ?? ''} ${lv2.sc ?? ''} ${lv2.cap ?? ''} |`);
  }
  L.push('');
  L.push('## Freezes (a frame or a wait of 250 ms or more, warm-up included)');
  L.push(S.freezes.length ? `${S.freezeCount} in all, ${num(S.freezeMs / 1000)} s frozen:` : 'none');
  for (const f of S.freezes.slice(0, 8)) L.push(`- ${num(f.at)} s: ${num(f.ms / 1000, 2)} s${f.warm ? ' (warm-up frame)' : ''}${f.cause ? ' ← ' + f.cause : ''}`);
  L.push('');
  L.push('## Black flashes');
  L.push(`canvas size changes ${S.blank.changes} (after the frame was drawn: ${S.blank.afterRender}, outside the frame loop: ${S.blank.outside}); empty frames in the making: ${S.blank.risk}; display frames presented empty: ${S.blank.presented}; GPU/context losses: ${S.contextLost}`);
  if (S.canvas.list.length) L.push(`changes: ${S.canvas.list.slice(0, 12).map((c) => `${c.at}s ${c.w}x${c.h}${c.afterRender ? ' AFTER-RENDER' : c.inFrame ? '' : ' outside'}`).join(' · ')}${S.canvas.changes > 12 ? ' …' : ''}`);
  if (S.gov.length) L.push(`governor: ${S.gov.map((g) => `${g.at}s ${g.from.q}@${g.from.sc}/${g.from.cap} → ${g.to.q}@${g.to.sc}/${g.to.cap} (${g.why})`).join(' · ')}`);
  if (S.settings.length) L.push(`settings by hand: ${S.settings.map((s) => `${s.at}s ${s.what} ${s.v ?? ''}`).join(' · ')}`);
  L.push('');
  L.push('## Responsiveness');
  L.push(`long tasks (50 ms or more): ${S.longtasks.n}, ${num(S.longtasks.ms / 1000)} s in all, worst ${S.longtasks.worst} ms · slow inputs (40 ms or more to show): ${S.inp.n}, worst ${S.inp.worst} ms · page hidden ${S.hidden}×`);
  if (S.memory.heapFirst != null) L.push(`JS heap ${S.memory.heapFirst} → ${S.memory.heapLast} MB (max ${S.memory.heapMax})`);
  if (S.errors.length) { L.push(''); L.push('## Errors and warnings'); for (const e of S.errors.slice(0, 10)) L.push(`- ${e.at}s ${e.n}${e.l ? ' ' + e.l : ''}: ${String(e.m).slice(0, 200)}`); }
  if (S.marks.length) {
    L.push(''); L.push('## Marks (tapped by the player)');
    for (const k of S.marks) L.push(`- at ${clock(k.at * 1000)} "${k.label}": worst frame ${k.worstGap} ms in the 3 s before, ${k.slow} slow frames, ${k.canvas} canvas change(s); nearby: ${k.near.join(', ') || 'nothing logged'}`);
  }
  if (S.probe) { L.push(''); L.push(`recorder cost: ${S.probe.selfUs} µs a frame${S.probe.gpuSkipped ? `, ${S.probe.gpuSkipped} GPU samples skipped (GPU behind)` : ''}`); }
  return L.join('\n');
}

// Two sessions side by side on the numbers that matter. `a` is the baseline.
export function compareText(a, b) {
  const rows = [];
  const add = (name, f, d = 1, lowerBetter = true) => {
    const x = f(a), y = f(b);
    const delta = x != null && y != null && x !== 0 ? (y - x) / Math.abs(x) : null;
    rows.push(`| ${name} | ${x == null ? '–' : num(x, d)} | ${y == null ? '–' : num(y, d)} | ${delta == null ? '' : (delta > 0 ? '+' : '') + (delta * 100).toFixed(0) + '%'} |`);
  };
  const T = `${a.label || a.sid} vs ${b.label || b.sid}`;
  const out = [`# Compare: ${T}`, '', '| | A | B | change |', '|---|---|---|---|'];
  rows.length = 0;
  add('loading screen gone (s)', (s) => (s.load.veil != null ? s.load.veil / 1000 : null), 2);
  add('start → tank (s)', (s) => (s.load.bench ? s.load.bench.ms / 1000 : null), 2);
  add('long tasks before load ends (s)', (s) => s.load.longtasks.ms / 1000, 2);
  add('fps', (s) => s.headline.fps); add('frame p50 (ms)', (s) => s.headline.p50); add('frame p95 (ms)', (s) => s.headline.p95); add('frame p99 (ms)', (s) => s.headline.p99); add('worst frame (ms)', (s) => s.headline.max, 0);
  add('frames > 33 ms', (s) => s.headline.over?.[33.4] ?? 0, 0); add('frames > 100 ms', (s) => s.headline.over?.[100] ?? 0, 0);
  add('render call (ms)', (s) => s.headline.rnd); add('GPU latency (ms)', (s) => s.headline.gpuAvg);
  add('canvas size changes', (s) => s.blank.changes, 0); add('empty frames in the making', (s) => s.blank.risk, 0); add('GPU/context losses', (s) => s.contextLost, 0);
  add('long tasks (s)', (s) => s.longtasks.ms / 1000, 2);
  add('animals', (s) => s.headline.level?.animals ?? null, 0); add('plants', (s) => s.headline.level?.plants ?? null, 0); add('draw calls', (s) => s.headline.level?.calls ?? null, 0);
  out.push(...rows);
  out.push('', `A: ${a.device.os} ${a.device.browser} · ${a.gpu.name} · ${a.device.screen} · ${a.game.backend}`, `B: ${b.device.os} ${b.device.browser} · ${b.gpu.name} · ${b.device.screen} · ${b.game.backend}`);
  return out.join('\n');
}

export { refreshRate };
