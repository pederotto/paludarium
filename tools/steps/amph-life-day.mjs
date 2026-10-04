// Day in the life of every amphibian (wk-amph-life). Two generated tanks (warm: the dart frogs, bumblebee toad, reed and red-eyed
// frogs, tadpoles, eggs; cool, held at 18 °C: newts, marbled newt, fire salamander, axolotl, fire-bellied toad, salamander larvae),
// Math.random seeded per run, the game loop emulated frame by frame at a fixed speed (sim.step and animals.move as app/game.js does,
// with a virtual clock so `tf` and `warp` come out as in the game) from 06:00 for AMPH_HOURS game hours. Per species it reports
// activity by hour (cm walked/swum per animal-hour, share of time out), time per state, hunting (orders, strikes, catches, meals eaten
// without a strike), resting spots, calls and courtship by hour, sleep poses, stuck time and purposeless loops.
//   node tools/shot.mjs --url=http://127.0.0.1:4502/ --only=desktop --wait=2500 --steps=tools/steps/amph-life-day.mjs
//   env: AMPH_SEEDS=1,2,3  AMPH_HOURS=24  AMPH_SPEED=20  AMPH_SCENES=warm,cool  AMPH_OUT=<dir>  AMPH_LABEL=before
import fs from 'node:fs';
import path from 'node:path';

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(3600000);
  const cfg = {
    seeds: (process.env.AMPH_SEEDS ?? '1,2,3').split(',').map(Number), hours: +(process.env.AMPH_HOURS ?? 24),
    speed: +(process.env.AMPH_SPEED ?? 20), scenes: (process.env.AMPH_SCENES ?? 'warm,cool').split(','),
  };
  const out = process.env.AMPH_OUT ?? 'test-output/amph-life', label = process.env.AMPH_LABEL ?? 'run';
  fs.mkdirSync(out, { recursive: true });
  const runs = [];
  for (const scene of cfg.scenes) for (const seed of cfg.seeds) {
    const t0 = Date.now();
    const r = await page.evaluate(runOne, { scene, seed, hours: cfg.hours, speed: cfg.speed, DEBUG: !!process.env.AMPH_DEBUG });
    if (r.debug?.length) fs.writeFileSync(path.join(out, `debug-${label}-${scene}-${seed}.json`), JSON.stringify(r.debug, null, 1));
    r.sec = Math.round((Date.now() - t0) / 1000);
    console.log(`amph-life ${scene} seed ${seed}: ${r.sec}s, frames thrown ${r.thrown ?? '?'}, errors ${r.errors.length}`, r.errors.slice(0, 2).join(' | '));
    runs.push(r);
  }
  fs.writeFileSync(path.join(out, `day-${label}.json`), JSON.stringify({ cfg, runs }, null, 1));
  fs.writeFileSync(path.join(out, `day-${label}.md`), report(cfg, runs, label));
  console.log('wrote', path.join(out, `day-${label}.md`));
};

async function runOne({ scene, seed, hours, speed, DEBUG }) {
  const game = window.game;
  game.frozen = true;
  const gen = await import('/src/sim/generator.js');
  const { TANK } = await import('/src/sim/tank.js');
  const { SPECIES } = await import('/src/sim/animals.js');
  const { MAT } = await import('/src/sim/tank.js');
  const errors = [];
  const SC = scene === 'warm'
    ? { preset: 'suriname', tier: 'standard', gseed: 5, temp: null, mix: { dartfrog: 3, strawberry: 3, leucomelas: 3, auratus: 3, bumblebee: 4, reedfrog: 3, redeye: 3, tadpole: 6, eggs: 2 } }
    : { preset: 'cascade', tier: 'standard', gseed: 7, temp: 18, mix: { newt: 3, marbled: 3, firesal: 3, axolotl: 2, toad: 3, tadpole: 4 } };
  const food = { springtail: 30, fly: 14, isopod: 10, flylarva: 6 };
  const w = await game.loadTank(SC.tier, { layout: 'empty' });
  gen.generateTerrarium(w, { preset: SC.preset, seed: SC.gseed, tier: SC.tier });
  const A = w.animals, E = w.env, T = w.terrain;
  A.syncOccupancy(true);
  // Seeded from here on (the layout comes from the generator's own seed).
  let s = (seed * 9973 + (scene === 'warm' ? 17 : 29)) >>> 0;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const realRandom = Math.random, realNow = performance.now.bind(performance);
  Math.random = rnd;
  let vnow = realNow();
  performance.now = () => vnow;
  const hold = () => {
    if (SC.temp == null) return;
    E.temp = SC.temp;
    for (const b of w.water.bodies?.list ?? w.water.bodies?.all ?? []) if (b && 'temp' in b) b.temp = SC.temp;
  };
  if (SC.temp != null) { const t = SC.temp; w.climate.tempAt = () => t; }
  try {
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    const place = (id, n, extra = {}) => {
      for (let i = 0; i < n; i++) for (let k = 0; k < 120; k++) {
        const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
        const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
        if (r.pos) { const a = A.add(id, r.pos, { hunger: 0.62, age: 99999 * 10, ...extra }); if (a && extra.parent) a.parent = extra.parent; break; }
      }
    };
    for (const [id, n] of Object.entries(SC.mix)) place(id, n, id === 'tadpole' ? { age: 3 * 1440, ...(scene === 'cool' ? { parent: 'firesal' } : {}) } : id === 'eggs' ? { age: 0 } : {});
    for (const [id, n] of Object.entries(food)) place(id, n, { hunger: 0.2, age: undefined });
    // Sexes: alternate, so every species has males and females.
    let alt = 0;
    for (const id of Object.keys(SC.mix)) for (const a of A.by[id] ?? []) a.male = (alt++ % 2) === 0;
    E.minute = Math.floor(E.minute / 1440) * 1440 + 6 * 60;
    hold();
    const AMPH = Object.keys(SC.mix);
    const AQ = new Set(['newt', 'marbled', 'firesal', 'axolotl', 'tadpole']);
    const all = () => AMPH.flatMap((id) => A.by[id] ?? []);
    // --- Counters ---------------------------------------------------------------------------------------------------------
    const S = {};
    const spS = (id) => (S[id] ??= {
      n: 0, animalMin: 0, distH: Array(24).fill(0), outH: Array(24).fill(0), minH: Array(24).fill(0), state: {}, rest: {}, sleep: {},
      orders: 0, strikes: 0, catches: 0, eatNow: 0, calls: Array(24).fill(0), callers: new Set(), court: Array(24).fill(0), mated: 0,
      plans: 0, planFail: 0, hopFail: 0, perchQuit: 0, turnIdle: 0, modeSw: 0, flipBack: 0, stuckMin: 0, maxStillS: 0, wantMin: 0,
      perchLeft: {}, why: {}, wetMin: 0, layer: { bottom: 0, mid: 0, surface: 0 }, layerAir: { bottom: 0, mid: 0, surface: 0 }, airN: 0, bankMin: 0, circWin: 0, swimWin: 0, swimMin: 0, restN: {}, tempD: [0, 0], tempN: [0, 0],
    });
    for (const id of AMPH) spS(id).n = (A.by[id] ?? []).length;
    const hourNow = () => Math.floor(((E.minute % 1440) + 1440) % 1440 / 60);
    const wrap = (fn, cb) => { const f = A[fn].bind(A); A[fn] = (...args) => { const pre = cb.pre?.(...args); const r = f(...args); cb.post?.(r, pre, ...args); return r; }; };
    window.__oc = { call: 0, ok: 0, gone: {} };
    wrap('remove', { pre: (a, cause) => { if (food[a.sp] != null) { const k = a.sp + ':' + String(cause).slice(0, 40); window.__oc.gone[k] = (window.__oc.gone[k] ?? 0) + 1; } } });
    wrap('order', { post: (r) => { window.__oc.call++; if (r) window.__oc.ok++; } });
    wrap('beginStrike', { pre: (a) => { if (S[a.sp]) S[a.sp].strikes++; } });
    wrap('consume', { pre: (a) => { if (S[a.sp]) S[a.sp].catches++; } });
    wrap('eatNow', { pre: (a) => { if (S[a.sp]) S[a.sp].eatNow++; } });
    wrap('perchQuit', { pre: (a) => { if (S[a.sp]) S[a.sp].perchQuit++; } });
    wrap('frogPlan', { pre: (a) => a.hopFail ?? 0, post: (r, hf0, a) => { const q = S[a.sp]; if (!q) return; q.plans++; if ((a.hopFail ?? 0) > hf0) q.planFail++; } });
    wrap('frogCall', { pre: (a) => !!a.v?.call, post: (r, had, a) => { const q = S[a.sp]; if (q && !had && a.v?.call) { q.calls[hourNow()]++; q.callers.add(a.id); } } });
    const prev = new Map();
    const dtR = 1 / 60, dtA = dtR * Math.min(speed, 4), dMin = dtR * speed;
    const frames = Math.round(hours * 60 / dMin);
    const restSpot = (a, sp) => {
      const P = a.perch;
      if (P && P.ph === 'sit') return P.glassN ? 'perch:glass' : P.plant ? 'perch:plant' : 'perch:wood';
      const g = T.heightAt(a.pos.x, a.pos.z), top = A.waterTop(a.pos.x, a.pos.z);
      if (a.swimming || (top > -Infinity && top - g > 0.3)) return 'water';
      if (a.hh && Math.hypot(a.hh.x - a.pos.x, a.hh.z - a.pos.z) < 2) return 'home';
      if (A.occ.count && A.occ.solidAt(a.pos.x, g + 3, a.pos.z)) return 'cover';
      if (MAT && T.field.matAt(a.pos.x, a.pos.z, MAT.moss) > 0.5) return 'moss';
      return 'open';
    };
    let thrown = 0;
    const debug = [];
    for (let f = 0; f < frames; f++) {
      vnow += dtR * 1000;
      try { w.sim.step(dMin); hold(); A.move(dtA); }
      catch (e) { thrown++; if (errors.length < 3) errors.push(`frame ${f} (${(E.minute % 1440 / 60).toFixed(1)}h): ` + String(e?.stack ?? e).slice(0, 500)); }
      const h = hourNow();
      for (const a of all()) {
        const sp = SPECIES[a.sp], q = spS(a.sp);
        let p = prev.get(a);
        if (!p) { p = { x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: a.yaw ?? 0, mode: null, modes: [], still: 0, wx: a.pos.x, wz: a.pos.z, wy: a.pos.y, order: false, court: null }; prev.set(a, p); }
        const mv = Math.hypot(a.pos.x - p.x, a.pos.y - p.y, a.pos.z - p.z);
        const dyaw = Math.abs(Math.atan2(Math.sin((a.yaw ?? 0) - p.yaw), Math.cos((a.yaw ?? 0) - p.yaw)));
        q.animalMin += dMin; q.minH[h] += dMin;
        if (mv < 3) q.distH[h] += mv;                                    // (a relocation is not a walk)
        // State label.
        const frog = sp.kind === 'frog' || sp.kind === 'toad';
        let st, resting = false, want = false;
        if (a.st) st = 'strike';
        else if (frog) {
          if (a.perch) { st = 'perch-' + a.perch.ph; resting = a.perch.ph === 'sit'; want = a.perch.ph !== 'sit'; }
          else if (a.hop) st = 'hop';
          else if (a.swimming) st = 'swim';
          else { st = a.fs ?? 'sit'; resting = st === 'sit'; want = st === 'walk' || st === 'turn' || st === 'crouch'; }
          if (a.order && st === 'sit') st = 'sit(hunting)';
        } else if (a.hm) {
          st = a.hm.mode ?? 'rest';
          if (a.hit?.tuck) st += '(tucked)';
          if (a.swimming) st += '/swim';
          resting = /^(rest|hide)/.test(a.hm.mode ?? 'rest');
          want = !!a.wantMove;
          if (a.hm.mode !== p.mode) {
            if (p.mode) { q.modeSw++; p.modes.push({ m: a.hm.mode, t: A.t }); p.modes = p.modes.filter((o) => A.t - o.t < 60); if (p.modes.length >= 2 && p.modes[p.modes.length - 2].m !== a.hm.mode && p.modes.slice(0, -1).some((o) => o.m === a.hm.mode)) q.flipBack++; }
            p.mode = a.hm.mode;
          }
          if (['court', 'receive', 'follow'].includes(a.hm.mode)) q.court[h] += dMin;
          if (a.courtedUntil && a.courtedUntil !== p.court) { if (p.court != null || a.courtedUntil > E.minute) q.mated++; p.court = a.courtedUntil; }
        } else { st = a.swimming === false ? 'out' : (a.state ?? 'idle'); resting = !(a.speedNow > 0.05); }
        q.state[st] = (q.state[st] ?? 0) + dMin;
        if (!resting) q.outH[h] += dMin;
        const isDay = h >= 8 && h < 20;
        if (resting) { const r = restSpot(a, sp); q.rest[r] = (q.rest[r] ?? 0) + dMin; if (!isDay) q.restN[r] = (q.restN[r] ?? 0) + dMin; }
        for (const y of a.why ?? []) { const k = y + (isDay ? ' (day)' : ' (night)'); q.why[k] = (q.why[k] ?? 0) + dMin; }
        if (a.T != null) { const tt = isDay ? q.tempD : q.tempN; tt[0] += a.T * dMin; tt[1] += dMin; }
        if (frog && a.perch?.ph === 'sit' && A.meshFor && sp.id !== null) q.sleep['perch-sit'] = (q.sleep['perch-sit'] ?? 0) + dMin;
        if (a.hit?.tuck) q.sleep.tucked = (q.sleep.tucked ?? 0) + dMin;
        if (!!a.order && !p.order) q.orders++;
        p.order = !!a.order;
        if (a.perch?.left && a.perch.left !== p.left) { q.perchLeft[a.perch.left] = (q.perchLeft[a.perch.left] ?? 0) + 1; }
        p.left = a.perch?.left;
        if (a.hopFail > (p.hopFail ?? 0)) q.hopFail++;
        p.hopFail = a.hopFail ?? 0;
        if (mv < 0.002 && dyaw > 0) q.turnIdle += dyaw;
        // Stuck: wants to move but has not got 0.3 cm from where it was for a while (animal seconds).
        if (want) {
          q.wantMin += dMin;
          if (Math.hypot(a.pos.x - p.wx, a.pos.y - p.wy, a.pos.z - p.wz) > 0.3) { p.wx = a.pos.x; p.wy = a.pos.y; p.wz = a.pos.z; p.still = 0; }
          else {
            p.still += frog ? dtA / (A.tf || 1) : dtA; if (p.still > 3) q.stuckMin += dMin; if (p.still > q.maxStillS) q.maxStillS = p.still;      // (a frog moves in real time: tf)
            if (DEBUG && p.still > 3.5 && !p.dumped && debug.length < 40) {
              p.dumped = true; if (debug.length < 6) p.trace = 30;
              const P = a.plan, fd = (v) => v == null ? v : +(+v).toFixed(2);
              debug.push({ sp: a.sp, id: a.id, h: +(E.minute % 1440 / 60).toFixed(2), st, fs: a.fs, walkT: fd(a.walkT), fsT: fd(a.fsT), yaw: fd(a.yaw), faceTo: fd(a.faceTo), after: a.afterTurn, plan: P && { type: P.type, d: fd(Math.hypot(P.to.x - a.pos.x, P.to.z - a.pos.z)), water: P.water }, crouch: fd(a.crouch), hopFail: a.hopFail, look: fd(a.lookTo), order: !!a.order, swim: a.swimming, perch: a.perch && { ph: a.perch.ph, i: a.perch.i, n: a.perch.path?.length, stuck: fd(a.perch.stuck) }, mode: a.hm?.mode, goal: a.hm?.goal && { x: fd(a.hm.goal.x), z: fd(a.hm.goal.z) }, pos: [fd(a.pos.x), fd(a.pos.y), fd(a.pos.z)], wantMove: a.wantMove, stuckLevel: a.stuckLevel, hStuck: fd(a.hStuck), turnMix: fd(a.turnMix), stepping: fd(a.stepping) });
            }
          }
        } else { p.still = 0; p.wx = a.pos.x; p.wy = a.pos.y; p.wz = a.pos.z; }
        // Swimming (caudates, larvae, tadpoles): which layer of the water, surfacing, circling, inside a bank.
        if (AQ.has(a.sp)) {
          const gg = T.heightAt(a.pos.x, a.pos.z), tp = A.waterTop(a.pos.x, a.pos.z);
          if (tp > -Infinity && tp - gg > 0.5 && a.pos.y <= tp + 0.1) {
            q.wetMin += dMin;
            const air = /^air/.test(st);
            const ly = a.pos.y - gg < 0.9 ? 'bottom' : tp - a.pos.y < 0.9 ? 'surface' : 'mid';
            (air ? q.layerAir : q.layer)[ly] += dMin;
            if (air && !/^air/.test(p.st ?? '')) q.airN++;
            if (a.pos.y < gg - 0.25 || (A.occ.count && A.occ.solidAt(a.pos.x, a.pos.y + 0.3, a.pos.z))) q.bankMin += dMin;
            if (mv > 1e-4) q.swimMin += dMin;
            const sw = (p.sw ??= { L: 0, x: a.pos.x, z: a.pos.z, t: 0 });
            sw.L += Math.hypot(a.pos.x - p.x, a.pos.z - p.z); sw.t += dtA;
            if (sw.t >= 6) { if (sw.L > 2) { q.swimWin++; if (Math.hypot(a.pos.x - sw.x, a.pos.z - sw.z) < 0.25 * sw.L) q.circWin++; } p.sw = null; }
          } else p.sw = null;
        }
        p.st = st;
        if (p.trace > 0) { p.trace--; const fd = (v) => v == null ? v : +(+v).toFixed(3); debug.push({ tr: a.id, f, fs: a.fs, st, yaw: fd(a.yaw), face: fd(a.faceTo), x: fd(a.pos.x), z: fd(a.pos.z), mvx: fd(a.pos.x - p.x), mvz: fd(a.pos.z - p.z), walkT: fd(a.walkT), fsT: fd(a.fsT), tf: fd(A.tf), stepping: fd(a.stepping), plan: a.plan && fd(Math.hypot(a.plan.to.x - a.pos.x, a.plan.to.z - a.pos.z)) }); }
        p.x = a.pos.x; p.y = a.pos.y; p.z = a.pos.z; p.yaw = a.yaw ?? 0;
      }
      // Prey topped up every game hour (frogs eat it; the crew breeds slowly).
      if (f % Math.round(60 / dMin) === 0) {
        for (const [id, n] of Object.entries(food)) { const have = (A.by[id] ?? []).length; if (have < n) place(id, n - have, { hunger: 0.2, age: undefined }); }
        for (const a of all()) a.health = Math.max(a.health, 0.8);
      }
    }
    const res = { scene, seed, hours, speed, frames, sp: {} };
    for (const [id, q] of Object.entries(S)) res.sp[id] = { ...q, callers: q.callers.size, nEnd: (A.by[id] ?? []).length };
    res.notes = { moss: +w.mossFraction().toFixed(2), prey: Object.fromEntries(Object.keys(food).map((id) => [id, (A.by[id] ?? []).length])), orderCalls: window.__oc, temp: E.temp, lights: [E.lightsOn, E.lightsOff], humidity: E.humidity };
    res.errors = errors; res.thrown = thrown; res.debug = debug;
    return res;
  } catch (e) {
    errors.push(String(e?.stack ?? e).slice(0, 600));
    return { scene, seed, sp: {}, errors };
  } finally { Math.random = realRandom; performance.now = realNow; }
}

function report(cfg, runs, label) {
  const L = [`# Amphibian day in the life — ${label}`, '', `Seeds ${cfg.seeds.join(', ')}; ${cfg.hours} game hours from 06:00 at ${cfg.speed}x (game loop emulated frame by frame); lights 08:00–20:00. Warm tank: suriname standard (as generated); cool tank: cascade standard held at 18 °C.`, ''];
  const ids = [...new Set(runs.flatMap((r) => Object.keys(r.sp)))];
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  const per = (id) => runs.filter((r) => r.sp[id]).map((r) => ({ seed: r.seed, ...r.sp[id] }));
  L.push('## Activity by hour (cm moved per animal per game hour; mean of runs)', '', '| species | ' + Array.from({ length: 24 }, (_, h) => String(h)).join(' | ') + ' | day/night |', '|---|' + '---|'.repeat(25));
  for (const id of ids) {
    const P = per(id);
    const cells = Array.from({ length: 24 }, (_, h) => { const v = P.map((q) => q.distH[h] / Math.max(1e-9, q.minH[h] / 60) ); return v.length && P[0].minH[h] > 0 ? f1(v.reduce((x, y) => x + y, 0) / v.length) : '-'; });
    const sum = (q, hs) => hs.reduce((s, h) => s + q.distH[h], 0) / Math.max(1e-9, hs.reduce((s, h) => s + q.minH[h], 0) / 60);
    const day = [...Array(12)].map((_, i) => 8 + i), night = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];
    const dn = P.map((q) => `${f1(sum(q, day))}/${f1(sum(q, night))}`).join(' ');
    L.push(`| ${id} | ${cells.join(' | ')} | ${dn} |`);
  }
  L.push('', '## Share of time out (not resting/hiding/sitting), day 08–20 vs night 20–08, per run', '', '| species | day % | night % |', '|---|---|---|');
  for (const id of ids) {
    const P = per(id), day = [...Array(12)].map((_, i) => 8 + i), night = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];
    const sh = (q, hs) => Math.round(100 * hs.reduce((s, h) => s + q.outH[h], 0) / Math.max(1e-9, hs.reduce((s, h) => s + q.minH[h], 0)));
    L.push(`| ${id} | ${P.map((q) => sh(q, day)).join(' / ')} | ${P.map((q) => sh(q, night)).join(' / ')} |`);
  }
  L.push('', '## Time per state (% of animal time, per run)', '');
  for (const id of ids) {
    const P = per(id), keys = [...new Set(P.flatMap((q) => Object.keys(q.state)))].sort((x, y) => (P[0].state[y] ?? 0) - (P[0].state[x] ?? 0));
    L.push(`- **${id}** (${P[0].n} animals): ` + keys.map((k) => `${k} ${P.map((q) => Math.round(100 * (q.state[k] ?? 0) / Math.max(1e-9, q.animalMin))).join('/')}`).join(', '));
  }
  L.push('', '## Hunting, resting spots, calls, courtship, sleep (per run; counts per species over the run)', '', '| species | orders | strikes | catches | meals without strike | rest spots (% of resting) | calls (callers) | call hours | courting min | matings | sleep pose min |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const id of ids) {
    const P = per(id);
    const rest = P.map((q) => { const tot = Object.values(q.rest).reduce((x, y) => x + y, 0) || 1; return Object.entries(q.rest).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(100 * v / tot)}`).join(', '); }).join(' ‖ ');
    const ch = P.map((q) => q.calls.map((c, h) => c ? `${h}h:${c}` : '').filter(Boolean).join(' ') || '-').join(' ‖ ');
    L.push(`| ${id} | ${P.map((q) => q.orders).join('/')} | ${P.map((q) => q.strikes).join('/')} | ${P.map((q) => q.catches).join('/')} | ${P.map((q) => q.eatNow).join('/')} | ${rest} | ${P.map((q) => `${q.calls.reduce((x, y) => x + y, 0)} (${q.callers})`).join('/')} | ${ch} | ${P.map((q) => Math.round(q.court.reduce((x, y) => x + y, 0))).join('/')} | ${P.map((q) => q.mated).join('/')} | ${P.map((q) => Object.entries(q.sleep).map(([k, v]) => `${k} ${Math.round(v)}`).join(' ') || '-').join(' ‖ ')} |`);
  }
  L.push('', '## Night resting spots, discomfort (a.why, % of animal time) and mean felt temperature day/night (per run)', '');
  for (const id of ids) {
    const P = per(id);
    const rn = P.map((q) => { const tot = Object.values(q.restN).reduce((x, y) => x + y, 0) || 1; return Object.entries(q.restN).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(100 * v / tot)}`).join(', ') || '-'; }).join(' ‖ ');
    const wy = P.map((q) => Object.entries(q.why).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(100 * v / q.animalMin)}`).join(', ') || '-').join(' ‖ ');
    const tp = P.map((q) => `${f1(q.tempD[0] / (q.tempD[1] || 1))}/${f1(q.tempN[0] / (q.tempN[1] || 1))}`).join(' ‖ ');
    L.push(`- **${id}**: night rest ${rn}; why: ${wy}; °C day/night ${tp}`);
  }
  L.push('', '## Swimming: caudates, larvae, tadpoles (per run; % of time in water deeper than 0.5 cm)', '', '| species | min in water | bottom / mid / surface % (not gulping air) | gulping air: bottom / mid / surface % | air trips/animal-h in water | moving % | circling (net < 25% of path over 6 s) / swim windows | min inside a bank or piece |', '|---|---|---|---|---|---|---|---|');
  for (const id of ids) {
    const P = per(id).filter((q) => q.wetMin > 0);
    if (!P.length) continue;
    const pc = (q, o) => ['bottom', 'mid', 'surface'].map((k) => Math.round(100 * o[k] / q.wetMin)).join('/');
    L.push(`| ${id} | ${P.map((q) => Math.round(q.wetMin)).join('/')} | ${P.map((q) => pc(q, q.layer)).join(' ‖ ')} | ${P.map((q) => pc(q, q.layerAir)).join(' ‖ ')} | ${P.map((q) => f1(q.airN / (q.wetMin / 60))).join('/')} | ${P.map((q) => Math.round(100 * q.swimMin / q.wetMin)).join('/')} | ${P.map((q) => `${q.circWin}/${q.swimWin}`).join(' ')} | ${P.map((q) => Math.round(q.bankMin)).join('/')} |`);
  }
  L.push('', '## Stuck and purposeless loops (per run)', '', '| species | stuck min (wanting to move, no headway > 3 s; frogs in their own real-time seconds) | max still s | plans/animal-h | failed plans | hop fails | perch quits | perch left (why) | idle turning rad/animal-h | mode switches/animal-h | flip-backs |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const id of ids) {
    const P = per(id), ah = (q) => q.animalMin / 60;
    L.push(`| ${id} | ${P.map((q) => Math.round(q.stuckMin)).join('/')} | ${P.map((q) => f1(q.maxStillS)).join('/')} | ${P.map((q) => f1(q.plans / ah(q))).join('/')} | ${P.map((q) => q.planFail).join('/')} | ${P.map((q) => q.hopFail).join('/')} | ${P.map((q) => q.perchQuit).join('/')} | ${P.map((q) => Object.entries(q.perchLeft).map(([k, v]) => `${k} ${v}`).join(' ') || '-').join(' ‖ ')} | ${P.map((q) => f1(q.turnIdle / ah(q))).join('/')} | ${P.map((q) => f1(q.modeSw / ah(q))).join('/')} | ${P.map((q) => q.flipBack).join('/')} |`);
  }
  L.push('', 'Run times: ' + runs.map((r) => `${r.scene}#${r.seed} ${r.sec}s`).join(', '), '', 'Frames that threw (the game would throw every frame from then on): ' + runs.map((r) => `${r.scene}#${r.seed} ${r.thrown ?? '?'}`).join(', '));
  const errs = runs.flatMap((r) => r.errors ?? []);
  if (errs.length) L.push('', 'Errors:', ...errs.map((e) => '    ' + e));
  return L.join('\n') + '\n';
}
