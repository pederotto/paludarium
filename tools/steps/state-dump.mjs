// State dump: the REAL world (src/sim) built by the generator for a preset, seeded, stepped as the game loop does (app/game.js:206-208:
// sim.step(game minutes) then animals.move(animal seconds)), with one JSON row per animal per sample (docs/agents/lizards/CONTRACTS.md,
// "State dump row"). tools/steps/state-counters.mjs turns a dump into numbers. Run it with tools/steps/state-dump-run.mjs, or as a
// tools/shot.mjs step (STATE_ARGS="--preset=karst --days=1").
//   --preset=karst --tier=standard --seed=1 --mix='gecko:3,skink:2' (added to the preset's own animals; --clear=1 removes those first)
//   --days=<game days> | --hours=<animal-time hours> | --seconds=<animal seconds>   (default --days=1)
//   --speed=1|5|20|60 (game speed: game minutes per animal second = speed / min(speed, 4)), --dt=0.1 (animal s per move()),
//   --every=10 (animal s between samples), --start=6 (game hour to start at), --care=1 (prey topped up and health >= 0.8 each game
//   hour, as amph-life-day does; 0 = bare), --only=gecko,skink / --all=1 (which species get rows), --out=test-output/state/
import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv = process.argv.slice(2)) {
  const o = {};
  for (const a of argv) { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); if (m) o[m[1]] = m[2] ?? '1'; }
  const num = (k, d) => (o[k] != null ? +o[k] : d);
  const mix = {};
  for (const part of (o.mix ?? '').split(',').filter(Boolean)) { const [id, n] = part.split(':'); mix[id.trim()] = (mix[id.trim()] ?? 0) + (n == null ? 1 : +n); }
  const speed = num('speed', 1), dt = num('dt', 0.1), warp = speed / Math.min(speed, 4);
  const seconds = o.seconds != null ? +o.seconds : o.hours != null ? +o.hours * 3600 : num('days', 1) * 1440 / warp;
  return {
    preset: o.preset ?? 'karst', tier: o.tier ?? 'standard', seed: num('seed', 1), speed, dt, warp, every: num('every', 10), mix,
    care: num('care', 1), clear: num('clear', 0), start: num('start', 6), seconds, all: num('all', 0), only: o.only ? o.only.split(',') : null,
    out: o.out ?? 'test-output/state/', url: o.url ?? 'http://127.0.0.1:4630/', chunk: num('chunk', 3000),
  };
}

// ---- in page (self-contained: Playwright sends the source) ---------------------------------------------------------------------
async function init(cfg) {
  const game = window.game;
  const { SPECIES } = await import('/src/sim/animals.js');
  // Species data that boot-time loaders fill in later (SPECIES.gecko.anim.rig2.len: the header said 9.5 or 7.05 depending on whether
  // the model had arrived, and generation then drew 956 or 940 numbers) must settle first: wait until it has not changed for 5 s.
  const spSnap = () => { try { return JSON.stringify(Object.values(SPECIES).map((s) => [s.size, s.anim ?? null])); } catch { return String(Object.values(SPECIES).map((s) => s.anim?.rig2?.len)); } };
  let prevSnap = spSnap(), stable0 = performance.now();
  const wait0 = stable0;
  while (performance.now() - stable0 < 5000 && performance.now() - wait0 < 90000) {
    await new Promise((r) => setTimeout(r, 250));
    const s2 = spSnap(); if (s2 !== prevSnap) { prevSnap = s2; stable0 = performance.now(); }
  }
  const settleS = Math.round(performance.now() - wait0) / 1000;
  game.frozen = true;
  const gen = await import('/src/sim/generator.js');
  const { TANK } = await import('/src/sim/tank.js');
  const w = await game.loadTank(cfg.tier, { layout: 'empty' });
  // No render loop, and nothing a stray game frame could do to the sim: a frame that is still queued or looping calls sim.step(0),
  // animals.move(0) and draw with the REAL Math.random, which re-rolls animal modes and timers at wall-clock moments (the first
  // determinism check failed that way: every animal differed by t = 10 s). The gate lets those calls through only inside our own
  // synchronous blocks (enter/leave below); how many it stopped is in <dump>.meta.json (blocked).
  try { game.renderer?.setAnimationLoop?.(null); } catch (e) { /* not three's loop */ }
  window.requestAnimationFrame = () => 0;
  const G = (window.__sdGate = { inChunk: false, blocked: 0 });
  for (const [obj, name] of [[w.sim, 'step'], [w.animals, 'move'], [w.animals, 'draw'], [w.water, 'animate']]) {
    const f = obj && obj[name];
    if (typeof f === 'function') obj[name] = function (...args) { if (!G.inChunk) { G.blocked++; return undefined; } return f.apply(this, args); };
  }
  await new Promise((r) => setTimeout(r, 400));                  // (a frame already queued runs out)
  // ---- synchronous from here to the end: nothing else can run between these lines ----
  const realRandom = Math.random, realNow = performance.now.bind(performance);
  // Same animal ids on every page load. The id counter (src/sim/animals.js:558, module-private) is wherever the title tank left it
  // (107 or 108), and behaviour is keyed on a.id (animals.js:3531, 3552, 3655, 3670: side and push direction). One throwaway add
  // sees fake ids 1..K-1, so the game's own skip loop (animals.js:846, for loaded saves) moves the counter to K; then it is removed.
  const ID_K = 4096, fakes = Array.from({ length: ID_K - 1 }, (_, i) => ({ id: i + 1 }));
  let idChecks = 0;
  fakes.some = function (fn) { idChecks++; return Array.prototype.some.call(this, fn); };
  const allDesc = Object.getOwnPropertyDescriptor(w.animals, 'all');
  const dummySp = Object.keys(w.animals.by).find((k) => SPECIES[k] && w.animals.by[k].length < SPECIES[k].cap + 20);
  let dummy;
  Object.defineProperty(w.animals, 'all', { value: fakes, configurable: true, writable: true });
  try { dummy = w.animals.add(dummySp, { x: 0, y: 0, z: 0, clone() { return { x: 0, y: 0, z: 0 }; } }); }
  finally { if (allDesc) Object.defineProperty(w.animals, 'all', allDesc); else delete w.animals.all; }
  if (!dummy || dummy.id !== ID_K) throw new Error(`state-dump: id reset failed (got ${dummy?.id}, want ${ID_K}: counter already above it?)`);
  w.animals.remove(dummy);
  const idRaw = ID_K - idChecks + 1;                            // where the page's counter stood before the reset
  let s = (cfg.seed * 9973 + 17) >>> 0;
  const rnd = () => { rnd.n++; s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  rnd.n = 0;
  const S = (window.__sd = { cfg, w, A: w.animals, E: w.env, SPECIES, rnd, vnow: 1e7, f: 0, thrown: 0, errors: [], meta: new WeakMap(), nid: {}, prey: {}, lastHr: null });
  S.enter = () => { G.inChunk = true; Math.random = rnd; performance.now = () => S.vnow; };
  S.leave = () => { G.inChunk = false; Math.random = realRandom; performance.now = realNow; };
  const A = S.A, E = S.E;
  S.place = (id, n, extra = {}) => {
    let made = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < 200; k++) {
      const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
      const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
      if (r.pos) { if (A.add(id, r.pos, extra)) made++; break; }
    }
    return made;
  };
  S.enter();
  let rep;
  try {
    rep = gen.generateTerrarium(w, { preset: cfg.preset, seed: cfg.seed, tier: cfg.tier });
    A.syncOccupancy(true);
    if (cfg.clear) for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    const missed = {};
    for (const [id, n] of Object.entries(cfg.mix)) {
      if (!SPECIES[id]) throw new Error(`unknown species "${id}" in --mix`);
      const made = S.place(id, n, { hunger: 0.4, age: (SPECIES[id].adultDays ?? 10) * 1440 * 1.5 });
      if (made < n) missed[id] = n - made;
    }
    S.missed = missed;
    E.minute = Math.floor(E.minute / 1440) * 1440 + cfg.start * 60;
    S.day0 = Math.floor(E.minute / 1440); S.m0 = E.minute;
    const preyIds = new Set();
    for (const a of A.all) for (const e of SPECIES[a.sp].eats ?? []) preyIds.add(e);
    for (const id of Object.keys(cfg.mix)) preyIds.delete(id);
    for (const id of preyIds) if (SPECIES[id] && (A.by[id] ?? []).length) S.prey[id] = A.by[id].length;
    S.skip = (id) => (cfg.only ? !cfg.only.includes(id) : !cfg.all && (preyIds.has(id) || SPECIES[id].kind === 'egg' || !!SPECIES[id].sessile));
  } finally { S.leave(); }
  S.frames = Math.round(cfg.seconds / cfg.dt);
  S.sampleFrames = Math.max(1, Math.round(cfg.every / cfg.dt));
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  // Fingerprint (meta.json and the log, not the dump): the page's raw id counter, ids now, each lizard's state, seeded draws so far.
  S.fp = () => ({
    idRaw, settleS, f: S.f, draws: rnd.n, minute: E.minute, n: A.all.length, env: [r2(E.temp), r2(E.humidity)],
    sum: r2(A.all.reduce((t, a) => t + a.pos.x + 3 * a.pos.y + 7 * a.pos.z + (a.timer ?? 0), 0)),
    liz: A.all.filter((a) => !S.skip(a.sp)).map((a) => [a.id, a.sp, r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), a.hm?.mode ?? a.sk?.mode ?? a.state ?? null]),
  });
  S.reg = (a) => {
    let o = S.meta.get(a);
    if (!o) { const k = S.nid[a.sp] ?? 0; S.nid[a.sp] = k + 1; o = { id: `${a.sp}-${k}`, tun: 0, px: a.pos.x, py: a.pos.y, pz: a.pos.z }; S.meta.set(a, o); }
    return o;
  };
  S.rows = (out) => {
    const T = w.terrain, t = Math.round(S.f * cfg.dt * 1000) / 1000;
    for (const a of A.all) {
      if (a.dead || S.skip(a.sp)) continue;
      const sp = SPECIES[a.sp], o = S.reg(a), p = a.pos;
      const mode = a.hm?.mode ?? a.sk?.mode ?? a.state ?? null;
      const hit = a.hm ? a.hit?.goal : a.target;                  // the goal in the mind's plane (x, z; z = -y on the wall) / the target on the ground
      const wall = !!a.onWall;
      const g = hit ? { x: hit.x, z: hit.z } : null;
      const gd = g ? Math.hypot(g.x - p.x, g.z - (wall ? -p.y : p.z)) : null;
      const top = A.waterTop(p.x, p.z), swim = sp.kind === 'swim' || !!a.swimming, h = Math.max(0.2, a.bh ?? 0.5);
      const solid = !(a.onWall || a.hop || a.wallMode) && !!A.occ.count && (swim ? A.occ.inside(p.x, p.y, p.z) : A.occ.insideBody(p.x, p.y, p.z, h));
      const asleep = !!a.hit?.tuck || (mode === 'hide' && !g);
      const o2 = {
        t, day: Math.floor(E.minute / 1440) - S.day0, hour: Math.round(((E.minute % 1440) / 60) * 1000) / 1000, id: o.id, uid: a.id, sp: a.sp,
        x: r2(p.x), y: r2(p.y), z: r2(p.z), speed: r2(a.speedNow ?? 0), mode, doing: a.doing ?? null, awake: asleep ? 0 : 1,
        onWall: wall ? 1 : 0, wallMode: a.wallMode ? 1 : 0, perch: a.perch?.ph ?? null, swim: a.swimming ? 1 : 0,
        inWater: top > -Infinity && p.y < top ? 1 : 0, inSolid: solid ? 1 : 0, gx: g ? r2(g.x) : null, gz: g ? r2(g.z) : null, gd: g ? r2(gd) : null, tun: o.tun,
      };
      o.tun = 0;
      out.push(o2);
    }
  };
  // Steps whose segment crossed a solid between two free ends (checked every 0.5 cm along it; moves over 3 cm are relocations).
  S.tunnels = () => {
    const occ = A.occ;
    for (const a of A.all) {
      if (a.dead || S.skip(a.sp)) continue;
      const o = S.reg(a), p = a.pos, sp = SPECIES[a.sp];
      const dx = p.x - o.px, dy = p.y - o.py, dz = p.z - o.pz, L = Math.hypot(dx, dy, dz);
      if (L > 0.05 && L < 3 && occ.count && !(a.onWall || a.hop || a.wallMode)) {
        const swim = sp.kind === 'swim' || !!a.swimming, h = Math.max(0.2, a.bh ?? 0.5);
        const raw = (x, y, z) => occ.solidAt(x, y + (swim ? 0 : Math.min(0.5, h * 0.5)), z);
        const into = (x, y, z) => (swim ? occ.inside(x, y, z) : occ.insideBody(x, y, z, h));
        const n = Math.ceil(L / 0.5);
        for (let k = 1; k < n; k++) {
          const u = k / n, x = o.px + dx * u, y = o.py + dy * u, z = o.pz + dz * u;
          if (raw(x, y, z) && into(x, y, z)) { if (!into(o.px, o.py, o.pz) && !into(p.x, p.y, p.z)) o.tun++; break; }
        }
      }
      o.px = p.x; o.py = p.y; o.pz = p.z;
    }
  };
  S.carePass = () => {
    for (const a of A.all) if (S.prey[a.sp] == null && a.health < 0.8) a.health = 0.8;
    for (const [id, n] of Object.entries(S.prey)) { const have = (A.by[id] ?? []).length; if (have < n) S.place(id, n - have, { hunger: 0.2, age: undefined }); }
  };
  S.footer = () => {
    const alive = [], counts = {};
    for (const a of A.all) { if (a.dead || S.skip(a.sp)) continue; alive.push(S.reg(a).id); counts[a.sp] = (counts[a.sp] ?? 0) + 1; }
    return { end: 1, frames: S.f, gameMinutes: Math.round((E.minute - S.m0) * 100) / 100, thrown: S.thrown, errors: S.errors, alive, counts, stuckStats: JSON.parse(JSON.stringify(A.stuckStats ?? {})) };
  };
  S.enter(); try { for (const a of A.all) if (!S.skip(a.sp)) S.reg(a); } finally { S.leave(); }
  const species = [...new Set(A.all.filter((a) => !S.skip(a.sp)).map((a) => a.sp))];
  const sizes = {};
  for (const id of Object.keys(SPECIES)) sizes[id] = SPECIES[id].anim?.rig2?.len ?? Math.round(SPECIES[id].size * 4 * 100) / 100;   // body length, cm
  S.fp0 = S.fp();
  return {
    hdr: 1, preset: cfg.preset, tier: cfg.tier, seed: cfg.seed, every: cfg.every, dt: cfg.dt, speed: cfg.speed, warp: cfg.warp, mix: cfg.mix, care: cfg.care,
    startHour: cfg.start, frames: S.frames, seconds: cfg.seconds, lights: [8, 20], species, sizes: Object.fromEntries(species.map((id) => [id, sizes[id]])),
    animals: A.all.filter((a) => !S.skip(a.sp)).map((a) => S.reg(a).id), placeMissed: S.missed, gen: { name: rep?.name ?? null, litres: rep?.litres ?? null, error: rep?.error ?? null },
  };
}

function chunk(n) {
  const S = window.__sd, W = S.w, A = S.A, E = S.E, cfg = S.cfg, out = [];
  S.enter();
  try {
    for (let i = 0; i < n && S.f < S.frames; i++) {
      if (S.f % S.sampleFrames === 0) S.rows(out);
      S.vnow += (cfg.dt / Math.min(cfg.speed, 4)) * 1000;
      try { W.sim.step(cfg.dt * cfg.warp); A.move(cfg.dt); } catch (e) { S.thrown++; if (S.errors.length < 3) S.errors.push(`frame ${S.f}: ` + String(e?.stack ?? e).slice(0, 400)); }
      S.tunnels();
      S.f++;
      if (S.f === 1) S.fp1 = S.fp();
      if (cfg.care) { const hr = Math.floor(E.minute / 60); if (hr !== S.lastHr) { S.lastHr = hr; S.carePass(); } }
    }
    if (S.f >= S.frames && !S.finalDone) { S.rows(out); S.finalDone = true; }
  } finally { S.leave(); }
  return { rows: out, f: S.f, done: !!S.finalDone, thrown: S.thrown };
}

// ---- driver -------------------------------------------------------------------------------------------------------------------
export async function runDump(page, cfg, log = console.log) {
  fs.mkdirSync(cfg.out, { recursive: true });
  const tag = [cfg.preset, cfg.tier, 's' + cfg.seed, ...Object.entries(cfg.mix).map(([k, v]) => `${k}${v}`)].join('-');
  const file = path.join(cfg.out, `state-${tag}.jsonl`);
  page.setDefaultTimeout(3600000);
  await page.waitForFunction(() => window.game, null, { timeout: 300000 });
  const t0 = Date.now();
  const hdr = await page.evaluate(init, cfg);
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, JSON.stringify(hdr) + '\n');
  log(`state-dump: ${hdr.preset}/${hdr.tier} seed ${hdr.seed}: ${hdr.animals.length} animals (${hdr.species.join(', ')}), ${hdr.frames} frames of ${hdr.dt} s, a sample every ${hdr.every} s${Object.keys(hdr.placeMissed).length ? ', could not place ' + JSON.stringify(hdr.placeMissed) : ''}`);
  let nRows = 0, nextLog = 0, lastLog = Date.now();
  for (;;) {
    const r = await page.evaluate(chunk, cfg.chunk);
    if (r.rows.length) { fs.writeSync(fd, r.rows.map((x) => JSON.stringify(x)).join('\n') + '\n'); nRows += r.rows.length; }
    if (r.f >= nextLog || Date.now() - lastLog > 20000) { lastLog = Date.now(); log(`  ${Math.round((100 * r.f) / hdr.frames)}%  ${nRows} rows  ${((Date.now() - t0) / 1000).toFixed(0)} s  thrown ${r.thrown}`); nextLog = r.f + Math.ceil(hdr.frames / 5); }
    if (r.done) break;
  }
  const end = await page.evaluate(() => window.__sd.footer());
  fs.writeSync(fd, JSON.stringify(end) + '\n');
  fs.closeSync(fd);
  const wallS = (Date.now() - t0) / 1000, gameDays = end.gameMinutes / 1440, blocked = await page.evaluate(() => window.__sdGate?.blocked ?? null);
  const fp = await page.evaluate(() => ({ fp0: window.__sd.fp0, fp1: window.__sd.fp1 ?? null }));
  fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ wallS, gameDays, blocked, fp, wallPerGameDay: gameDays ? wallS / gameDays : null, cfg }, null, 1));
  log(`fingerprint: page id counter was ${fp.fp0.idRaw}, ids now ${fp.fp0.liz.map((l) => l[0]).join(',')}, seeded draws ${fp.fp0.draws} after setup, ${fp.fp1?.draws} after frame 1`);
  return { file, hdr, end, rows: nRows, wallS, gameDays, fp };
}

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await runDump(page, parseArgs((process.env.STATE_ARGS ?? '').split(/\s+/).filter(Boolean)));
};
