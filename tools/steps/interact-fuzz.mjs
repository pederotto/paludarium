// Interaction stress harness: fast-forwards stocked tanks with many species and checks every animal after every move step for
// NaN/Infinity in its state, teleports, leaving the tank, falling through the drawn ground, tunnelling through solids, getting
// stuck, duplicate or orphaned animals, and records every death with the tank state around it. Targeted modes add save/load and
// Game.restartTank mid-action, a piece / plant / kit placed on top of an animal, and the same seed at 1x, 60x and time-lapse.
//
//   node tools/shot.mjs --only=desktop --wait=2500 --steps=tools/steps/interact-fuzz.mjs --url=http://127.0.0.1:4542/
//   FUZZ_MODES=ff,save,restart,place,lapse   which parts (default all)
//   FUZZ_PRESETS=starter,karst,suriname,blackwater,swamp    tanks: 'starter' or a generator preset (game start: stocked as a player gets it)
//   FUZZ_SECONDS=300     animal seconds per fast-forward run (60x: move(0.2) per frame, 3 game minutes a frame)
//   FUZZ_SEEDS=1,2,3     Math.random seeds (one run per seed and tank)
//   FUZZ_SPECIES=all     extra stock added on top (comma ids, or 'all'), FUZZ_N=2 of each
//   FUZZ_LOG=<file>      JSON lines (default test-output/interact-fuzz.jsonl)
// Every anomaly line carries species, tank, seed, animal time and position, so a run can be repeated.
import fs from 'node:fs';
import path from 'node:path';

const E = process.env;
const MODES = (E.FUZZ_MODES ?? 'ff,save,restart,place,lapse').split(',');
const PRESETS = (E.FUZZ_PRESETS ?? 'starter,karst,suriname,blackwater,swamp').split(',');
const SEEDS = (E.FUZZ_SEEDS ?? '1,2,3').split(',').map(Number);
const CFG = { seconds: +(E.FUZZ_SECONDS ?? 300), species: E.FUZZ_SPECIES ?? 'all', n: +(E.FUZZ_N ?? 2), tp: +(E.FUZZ_TP ?? 8) };
const LOG = E.FUZZ_LOG ?? 'test-output/interact-fuzz.jsonl';

// ---- in-page library (window.__fz) -------------------------------------------------------------------------------------------
function lib() {
  const fz = (window.__fz = {});
  const realNow = performance.now.bind(performance);
  fz.seed = (seed) => {
    let rs = (0x9e3779b9 ^ Math.imul(seed, 7919)) | 0;
    Math.random = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  // A virtual clock: Animals.trackTime reads performance.now to know the real frame time (tf: hops and strikes play in real time),
  // so a tight loop would otherwise run with tf = 1 and vary with the machine's speed. The harness advances it by the frame's dt.
  fz.vt = 0;
  fz.clockOn = () => { fz.vt = realNow(); performance.now = () => fz.vt; };
  fz.clockOff = () => { performance.now = realNow; };
  fz.mods = async () => {
    if (fz.M) return fz.M;
    const [an, tk, gen, dec, pl, kits, tanks, ckits] = await Promise.all(['/src/sim/animals.js', '/src/sim/tank.js', '/src/sim/generator.js', '/src/sim/decor.js', '/src/sim/plants.js', '/src/sim/kits.js', '/src/content/tanks.js', '/src/content/kits.js'].map((p) => import(p)));
    return (fz.M = { SPECIES: an.SPECIES, TANK: tk.TANK, TANKS: tanks.TANKS, gen, PIECES: dec.PIECES, PLANTS: pl.PLANTS, kits, KITS: ckits.KITS });
  };
  fz.wait = () => new Promise((r) => setTimeout(r, 0));
  // Start a tank as the player gets it.
  fz.start = async (preset) => {
    const g = window.game;
    if (preset === 'starter') await g.loadTank('standard', { layout: 'starter' });
    else {
      await window.__ctx.start.preset(preset, 4766, 'standard');
      for (let i = 0; i < 600 && !(window.__S?.screen?.value === 'play' && !window.__S?.busy?.value); i++) await new Promise((r) => setTimeout(r, 100));
    }
    g.setSpeed(0); g.frozen = true;
    const w = g.world;
    w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 9 * 60;   // morning: active animals
    return w;
  };
  fz.stock = (w, spec, n, rnd = Math.random) => {
    const { SPECIES, TANK } = fz.M, A = w.animals;
    const ids = spec === 'all' ? Object.keys(SPECIES).filter((id) => !['egg'].includes(SPECIES[id].kind) && !SPECIES[id].sessile && id !== 'tadpole' && id !== 'flylarva' && id !== 'flypupa') : spec === 'none' ? [] : spec.split(',');
    const added = {};
    for (const id of ids) for (let i = 0; i < n; i++) for (let k = 0; k < 120; k++) {
      const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
      const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
      if (r.pos) { if (A.add(id, r.pos)) added[id] = (added[id] ?? 0) + 1; break; }
    }
    return added;
  };
  // What an animal is doing, for the reports.
  fz.doing = (a, sp) => {
    if (a.hop) return 'hop'; if (a.perch) return 'perch'; if (a.st) return 'strike';
    if (a.onWall || a.wallMode) return 'wall';
    if (a.swimming && sp.kind !== 'swim') return 'swim';
    if (a.sunk) return 'sunk';
    for (const v of Object.values(a)) if (v && typeof v === 'object' && typeof v.mode === 'string') return 'm:' + v.mode;
    return a.fs ?? a.state ?? '?';
  };
  const isAnimal = (v) => v && typeof v === 'object' && typeof v.sp === 'string' && v.pos && typeof v.pos.x === 'number';
  // Run state for one tank.
  fz.begin = (w, tag) => {
    const A = w.animals, S = (fz.S = { tag, w, t: 0, steps: 0, prev: new Map(), still: new Map(), deaths: [], an: {}, cnt: {}, maxV: {}, moved: 0 });
    // Deaths and removals, with the tank around them.
    if (!A.__fzRemove) {
      A.__fzRemove = A.remove;
      A.remove = function (a, cause = null) {
        const s = fz.S;
        if (s && s.w === w) {
          const W = w, Wt = W.water, sp = fz.M.SPECIES[a.sp];
          s.deaths.push({ sp: a.sp, cause, t: +s.t.toFixed(1), min: Math.round(W.env.minute), why: a.why?.slice(0, 3), hp: +(+a.health).toFixed(2), hunger: +(+a.hunger).toFixed(2), age: Math.round(a.age / 1440), doing: fz.doing(a, sp),
            Ta: a.T != null ? +(+a.T).toFixed(1) : null, range: sp.temp, odd: (/too hot/.test(cause) && sp.temp && (a.T ?? W.env.temp) <= sp.temp[1]) || (/too cold/.test(cause) && sp.temp && (a.T ?? W.env.temp) >= sp.temp[0]) || (/drown/.test(cause) && !(Wt.surfaceAt(a.pos.x, a.pos.z) > a.pos.y)) || (/out of water/.test(cause) && Wt.surfaceAt(a.pos.x, a.pos.z) > a.pos.y + 0.3) ? 1 : 0,
            pos: [a.pos.x, a.pos.y, a.pos.z].map((v) => +(+v).toFixed(1)), ground: +W.terrain.heightAt(a.pos.x, a.pos.z).toFixed(1), surf: +(+Wt.surfaceAt(a.pos.x, a.pos.z)).toFixed(1), T: +W.env.temp.toFixed(1), RH: Math.round(W.env.humidity) });
        }
        return A.__fzRemove.call(this, a, cause);
      };
      A.__fzReloc = A.relocate;
      A.relocate = function (a, sp, far, inside) { a.__rl = (a.__rl ?? 0) + 1; if (fz.S) { const T = w.terrain, by = this.bodyY(a, sp); fz.hit(fz.S, inside ? 'relocInside' : 'relocStuck', a, { y: +a.pos.y.toFixed(2), g: +T.heightAt(a.pos.x, a.pos.z).toFixed(2), gv: +T.field.sample(a.pos.x, a.pos.z, T.field.hv).toFixed(2), swim: !!a.swimming, wl: +w.water.level.toFixed(1), below: this.occ.solidAt(a.pos.x, by - 0.5, a.pos.z) ? 1 : 0, above: this.occ.solidAt(a.pos.x, by + 1, a.pos.z) ? 1 : 0, goal: a.hm?.goal ? [a.hm.goal.x, a.hm.goal.z].map((v) => +(+v).toFixed(1)) : null }); } return A.__fzReloc.call(this, a, sp, far, inside); };
    }
    fz.wrapPushes(A);
    for (const a of A.all) S.prev.set(a, { x: a.pos.x, y: a.pos.y, z: a.pos.z, rl: a.__rl ?? 0 });
    return S;
  };
  fz.hit = (S, kind, a, extra = {}) => {
    const c = (S.cnt[kind] ??= {});
    c[a ? a.sp : '-'] = (c[a ? a.sp : '-'] ?? 0) + 1;
    const list = (S.an[kind] ??= []);
    if (list.length < 40 && list.filter((h) => h.sp === a?.sp).length < 3) list.push({ sp: a?.sp, id: a?.id, t: +S.t.toFixed(2), pos: a ? [a.pos.x, a.pos.y, a.pos.z].map((v) => Number.isFinite(v) ? +v.toFixed(1) : String(v)) : null, doing: a ? fz.doing(a, fz.M.SPECIES[a.sp]) : null, ...extra });
  };
  // Checks after one Animals.move(dtA).
  fz.check = (dtA) => {
    const S = fz.S, w = S.w, A = w.animals, T = w.terrain, F = T.field, { TANK, SPECIES } = fz.M;
    S.t += dtA; S.steps++;
    const ids = new Map(), seen = new Set();
    for (const [key, arr] of Object.entries(A.by)) for (const a of arr) {
      const sp = SPECIES[a.sp];
      if (seen.has(a)) fz.hit(S, 'dupObject', a); seen.add(a);
      if (a.sp !== key) fz.hit(S, 'wrongList', a, { key });
      if (a.dead) fz.hit(S, 'deadInList', a);
      if (ids.has(a.id)) fz.hit(S, 'dupId', a, { other: ids.get(a.id).sp }); else ids.set(a.id, a);
      // NaN / Infinity anywhere in the state (numbers, vectors, one level of nested objects).
      let bad = null;
      for (const [k, v] of Object.entries(a)) {
        if (typeof v === 'number') { if (Number.isNaN(v) || (!Number.isFinite(v) && CORE.has(k))) { bad = k; break; } }
        else if (v && typeof v === 'object' && !Array.isArray(v) && !isAnimal(v)) {
          for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number' && (Number.isNaN(v2) || (!Number.isFinite(v2) && CORE.has(k)))) { bad = k + '.' + k2; break; }
          if (bad) break;
        }
      }
      if (bad) fz.hit(S, 'nan', a, { field: bad });
      // References to animals no longer in the tank.
      for (const [k, v] of Object.entries(a)) {
        // (hPrey is checked again before it is used; a strike that has its prey is swallowing it)
        if (isAnimal(v) && v.dead) fz.hit(S, 'orphanRef', a, { field: k, to: v.sp });
        else if (v && typeof v === 'object' && !isAnimal(v) && k !== 'hPrey' && !(k === 'st' && v.got)) for (const [k2, v2] of Object.entries(v)) if (isAnimal(v2) && v2.dead) fz.hit(S, 'orphanRef', a, { field: k + '.' + k2, to: v2.sp });
      }
      if (a.perch?.piece && !w.decor.pieces.includes(a.perch.piece)) fz.hit(S, 'orphanPerch', a);
      if (a.perch?.plant && !w.plants.list.includes(a.perch.plant)) fz.hit(S, 'orphanPerch', a, { plant: true });
      if (a.mate != null && typeof a.mate !== 'object' && !A.all.some((b) => b.id === a.mate)) fz.hit(S, 'orphanMate', a);
      const p = a.pos;
      if (!Number.isFinite(p.x + p.y + p.z)) continue;
      // Out of the tank: beyond the glass, under the floor or above the lid.
      if (Math.abs(p.x) > TANK.w / 2 + 0.01 || Math.abs(p.z) > TANK.d / 2 + 0.01 || p.y < -0.01 || p.y > TANK.h + 0.01) fz.hit(S, 'outOfTank', a);
      const pv = S.prev.get(a);
      if (pv) {
        const d = Math.hypot(p.x - pv.x, p.y - pv.y, p.z - pv.z), rl = (a.__rl ?? 0) !== pv.rl;
        S.moved += d;
        const v = d / dtA;
        if (!rl && v > (S.maxV[a.sp] ?? 0)) S.maxV[a.sp] = +v.toFixed(1);
        if (d > CFGtp()) fz.hit(S, rl ? 'relocJump' : a.__push ? 'pushJump' : 'teleport', a, { d: +d.toFixed(1), from: [pv.x, pv.y, pv.z].map((u) => +u.toFixed(1)), by: a.__push?.trim() });
        if (a.__push) { for (const t of a.__push.trim().split(' ')) { const k = t.split(':')[0]; const c = (S.cnt.push ??= {}); c[k] = (c[k] ?? 0) + 1; } }
        // Tunnelling: both ends free, a solid cell between them.
        if (A.occ && d > 0.5 && sp.kind !== 'egg' && !rl) {
          const lift = sp.kind === 'swim' || a.swimming ? 0 : 0.5;
          if (!A.occ.solidAt(pv.x, pv.y + lift, pv.z) && !A.occ.solidAt(p.x, p.y + lift, p.z)) {
            const n = Math.ceil(d / 0.4);
            for (let i = 1; i < n; i++) { const f = i / n; if (A.occ.solidAt(pv.x + (p.x - pv.x) * f, pv.y + (p.y - pv.y) * f + lift, pv.z + (p.z - pv.z) * f)) {
              // (B4b: who moved it. A deliberate push-out or relocation (wrapped above, d > 1) is listed apart as tunnelReloc.)
              const by = (a.__push ?? '').trim(), reloc = /\b(relocate|keepFree|inGlass|clearOfWall|outOfStems|outOfBank|offCliff)\b/.test(by);
              fz.hit(S, reloc ? 'tunnelReloc' : 'tunnel', a, { d: +d.toFixed(1), by: by || undefined, doing: fz.doing(a, sp), hop: a.hop?.kind, kind: sp.kind }); break;
            } }
          }
        }
      }
      S.prev.set(a, { x: p.x, y: p.y, z: p.z, rl: a.__rl ?? 0 }); a.__push = '';
      if (sp.kind === 'egg') continue;
      // Under the drawn ground (stamped pieces are ground), unless it is on the background wall.
      const wall = a.onWall || a.wallMode;
      const gv = F.sample(p.x, p.z, F.hv), gh = T.heightAt(p.x, p.z);
      if (!wall && p.y < Math.min(gv, gh) - 0.6) fz.hit(S, 'underGround', a, { by: +(Math.min(gv, gh) - p.y).toFixed(1) });
      // Inside a solid piece after the move (the second look should have moved it): perching/hopping animals included.
      if (A.occ && !wall && A.occ.solidAt(p.x, p.y + (sp.kind === 'swim' || a.swimming ? 0 : 0.5), p.z)) fz.hit(S, 'inSolid', a, { doing: fz.doing(a, sp) });
      // Fish out of water.
      if (sp.kind === 'swim') { const top = A.waterTop(p.x, p.z); if (!(p.y <= top + 0.3)) fz.hit(S, 'fishOut', a, { top: +(+top).toFixed(1) }); }
      // Walkers floating: well above the ground with nothing to stand on (no hop, perch, swim, wall, climb).
      if ((sp.kind === 'frog' || sp.kind === 'toad' || sp.kind === 'newt' || sp.kind === 'crab' || sp.kind === 'crawlLand' || sp.kind === 'skink') && !wall && !a.hop && !a.perch && !a.swimming && !a.st && !a.climb && !a.onPiece) {
        const up = p.y - gh, wet = p.y <= A.waterTop(p.x, p.z) + 0.3;   // (in the water or on its surface: seashore springtails)
        if (up > 2.5 && !wet && !A.occ?.solidAt(p.x, p.y - 0.6, p.z)) {
          const fl = (a.__fl = (a.__fl ?? 0) + dtA);
          if (fl > 3 && fl - dtA <= 3) fz.hit(S, 'floating', a, { up: +up.toFixed(1) });
        } else a.__fl = 0;
      }
      // Stuck: wants to move, has not moved 0.3 cm in 60 animal seconds.
      if (A.wantsMove(a, sp) && sp.kind !== 'swim') {
        let st = S.still.get(a);
        if (!st) S.still.set(a, (st = { x: p.x, y: p.y, z: p.z, t: 0 }));
        if (Math.hypot(p.x - st.x, p.y - st.y, p.z - st.z) > 0.3) { st.x = p.x; st.y = p.y; st.z = p.z; st.t = 0; }
        else { st.t += dtA; if (st.t > 60 && st.t - dtA <= 60) fz.hit(S, 'stuck60', a, { doing: fz.doing(a, sp) }); }
      } else S.still.delete(a);
    }
  };
  const CFGtp = () => fz.tp ?? 8;
  const CORE = new Set(['pos', 'vel', 'yaw', 'pitch', 'hunger', 'health', 'age']);   // Infinity elsewhere is a sentinel (perch.near)
  // Which correction moved an animal this step (teleport attribution): the per-animal pushes of Animals.move and separate().
  fz.wrapPushes = (A) => {
    if (A.__fzPush) return; A.__fzPush = true;
    for (const m of ['inGlass', 'clearOfWall', 'outOfStems', 'outOfBank', 'offCliff', 'keepFree', 'relocate', 'nudge']) {
      const f = A[m]; if (typeof f !== 'function') continue;
      A[m] = function (a, ...r) { const x = a.pos.x, y = a.pos.y, z = a.pos.z; const out = f.call(this, a, ...r); const d = Math.hypot(a.pos.x - x, a.pos.y - y, a.pos.z - z); if (d > 1) { a.__push = (a.__push ?? '') + m + ':' + d.toFixed(1) + ' '; } return out; };
    }
  };
  // One frame as Game.frame steps the world: dtR real seconds at a speed multiplier, or a time-lapse (game minutes per second).
  fz.frame = (dtR, speed, lapse = 0) => {
    const W = fz.S.w;
    fz.vt += dtR * 1000;
    if (lapse) {
      for (let m = dtR * lapse; m > 0; m -= 10) { const d = Math.min(10, m); W.sim.step(d); for (let k = 0; k < 5; k++) { W.animals.move(0.1 * d / 10); fz.check(0.1 * d / 10); } }
    } else {
      W.sim.step(dtR * speed);
      const dA = dtR * Math.min(speed, 4);
      W.animals.move(dA); fz.check(dA);
    }
    W.water.animate(dtR, lapse || speed, 1.2);
  };
  fz.run = async (seconds, dtR = 0.05, speed = 60, lapse = 0) => {
    const per = lapse ? 0.5 * dtR * lapse / 10 : dtR * Math.min(speed, 4);
    const frames = Math.ceil(seconds / per);
    for (let f = 0; f < frames; f++) { fz.frame(dtR, speed, lapse); if (f % 200 === 199) await fz.wait(); }
  };
  fz.summary = () => {
    const S = fz.S, w = S.w;
    const n = Object.fromEntries(Object.entries(w.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
    const dc = {};
    for (const d of S.deaths) { const k = d.sp + ':' + d.cause; dc[k] = (dc[k] ?? 0) + 1; }
    return { tag: S.tag, t: +S.t.toFixed(0), steps: S.steps, cnt: S.cnt, an: S.an, deaths: dc, deathSamples: S.deaths.filter((d) => !['eaten', 'hatched', 'metamorphosed', 'pupated', 'emerged', 'moved'].includes(d.cause) && !/^eaten/.test(d.cause ?? '')).slice(0, 8), n, maxV: S.maxV };
  };
}

// ---- modes ------------------------------------------------------------------------------------------------------------------
async function ff(page, preset, seed) {
  return page.evaluate(async ({ preset, seed, CFG }) => {
    const fz = window.__fz; await fz.mods(); fz.tp = CFG.tp;
    fz.seed(seed);
    const w = await fz.start(preset);
    fz.seed(seed);
    const added = fz.stock(w, CFG.species, CFG.n);
    w.animals.syncOccupancy(true);
    fz.clockOn();
    try { fz.begin(w, `ff ${preset} s${seed}`); await fz.run(CFG.seconds); }
    finally { fz.clockOff(); }
    return { mode: 'ff', preset, seed, added: Object.values(added).reduce((s, v) => s + v, 0), ...fz.summary() };
  }, { preset, seed, CFG });
}

// Save and load, and Game.restartTank, with animals caught mid-action.
async function saveload(page, preset, seed, restart) {
  return page.evaluate(async ({ preset, seed, CFG, restart }) => {
    const fz = window.__fz; await fz.mods(); fz.tp = CFG.tp;
    const { SPECIES, TANKS } = fz.M;
    fz.seed(seed);
    const w = await fz.start(preset);
    fz.seed(seed);
    fz.stock(w, CFG.species, CFG.n);
    w.animals.syncOccupancy(true);
    fz.clockOn();
    const out = { mode: restart ? 'restart' : 'save', preset, seed };
    try {
      fz.begin(w, 'warm');
      // Run until animals are caught in the actions we want (or 120 s).
      const want = ['hop', 'perch', 'swim', 'wall', 'strike', 'm:dig', 'sunk'];
      const caught = {};
      for (let k = 0; k < 600; k++) {
        fz.frame(0.05, 60);
        for (const a of w.animals.all) { const d = fz.doing(a, SPECIES[a.sp]); if (want.includes(d)) caught[d] = (caught[d] ?? 0) + 1; }
        if (want.filter((d) => caught[d]).length >= 5 && k > 100) break;
        if (k % 100 === 99) await fz.wait();
      }
      const A = w.animals, snap = A.all.map((a) => ({ a, id: a.id, sp: a.sp, d: fz.doing(a, SPECIES[a.sp]), p: a.pos.clone() }));
      out.caught = Object.fromEntries(Object.entries(snap.reduce((m, s) => ((m[s.d] = (m[s.d] ?? 0) + 1), m), {})).filter(([d]) => want.includes(d)));
      const count = (W) => Object.fromEntries(Object.entries(W.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
      const before = count(w);
      if (restart) {
        // A fresh starter's numbers, then restart this world in place (as starting a game from the title does).
        const ref = JSON.parse(JSON.stringify(count(w)));
        window.game.showcase = true;
        const stale = { food: A.food.length, tails: A.tails?.length, shells: A.shells?.length, calls: A.shrimpCalls?.length };
        window.game.restartTank(TANKS.standard, 'starter');
        const W2 = window.game.world;
        out.same = W2 === w;
        out.after = count(W2);
        out.stale = { before: stale, after: { food: A.food.length, tails: A.tails?.length, shells: A.shells?.length, calls: A.shrimpCalls?.length } };
        out.oldObjectsKept = A.all.filter((a) => snap.some((s) => s.a === a)).length;
        out.refBefore = Object.values(ref).reduce((s, v) => s + v, 0);
      } else {
        const save = JSON.parse(JSON.stringify(w.serialize()));
        w.load(save);
        out.after = count(w);
        // Each animal by id: where it came back and what it lost.
        const byId = new Map(A.all.map((a) => [a.id, a]));
        const lost = {}, moved = {};
        for (const s of snap) {
          const b = byId.get(s.id);
          if (!b) { lost[s.sp] = (lost[s.sp] ?? 0) + 1; continue; }
          const dd = b.pos.distanceTo(s.p);
          if (dd > 0.05) moved[s.d] = (moved[s.d] ?? 0) + 1;
        }
        out.lostById = lost; out.movedOnLoad = moved;
        out.ids = { n: A.all.length, unique: new Set(A.all.map((a) => a.id)).size };
        // Animals saved mid-action: where are they one frame and 5 s after the load?
        out.states = {};
        const track = snap.filter((s) => want.includes(s.d)).map((s) => ({ s, b: byId.get(s.id) })).filter((x) => x.b);
        fz.begin(w, 'after-load');
        fz.frame(1 / 30, 1);
        for (let k = 0; k < 150; k++) fz.frame(1 / 30, 1);
        for (const { s, b } of track) {
          const T = w.terrain, gh = T.heightAt(b.pos.x, b.pos.z), sp = SPECIES[b.sp];
          const o = (out.states[s.d] ??= { n: 0, inSolid: 0, floating: 0, under: 0, dead: 0, sp: {} });
          o.n++; o.sp[b.sp] = (o.sp[b.sp] ?? 0) + 1;
          if (b.dead) { o.dead++; continue; }
          if (A.occ.solidAt(b.pos.x, b.pos.y + 0.5, b.pos.z) && !b.onWall && !b.wallMode) o.inSolid++;
          if (b.pos.y < gh - 0.6) o.under++;
          if (b.pos.y > gh + 2.5 && !b.perch && !b.hop && !b.swimming && !b.onWall && !b.wallMode && sp.kind !== 'swim' && !A.occ.solidAt(b.pos.x, b.pos.y - 0.6, b.pos.z)) o.floating++;
        }
      }
      fz.begin(window.game.world, 'post');
      await fz.run(60, 0.05, 60);
      out.post = fz.summary();
      out.before = Object.values(before).reduce((s, v) => s + v, 0);
    } finally { fz.clockOff(); }
    return out;
  }, { preset, seed, CFG, restart });
}

// A piece, a plant or a kit placed on top of an animal (as the editor does: addPiece + groundChanged), then 4 s at 1x.
async function place(page, preset, seed) {
  return page.evaluate(async ({ preset, seed, CFG }) => {
    const fz = window.__fz; await fz.mods(); fz.tp = CFG.tp;
    const { SPECIES, PIECES, PLANTS, kits, KITS } = fz.M;
    fz.seed(seed);
    const w = await fz.start(preset);
    fz.seed(seed);
    fz.stock(w, CFG.species, CFG.n);
    w.animals.syncOccupancy(true);
    fz.clockOn();
    const res = [];
    try {
      fz.begin(w, 'warm');
      await fz.run(20, 0.05, 60);
      const A = w.animals, T = w.terrain;
      const kinds = ['frog', 'toad', 'newt', 'gecko', 'crab', 'crawlLand', 'skink', 'crawlWater', 'swim'];
      const things = [['piece', 'boulder'], ['piece', 'wood'], ['piece', 'stump'], ['piece', 'roots'], ['plant', 'bromeliad'], ['plant', 'fern'], ['kit', 0]];
      for (const [what, type] of things) for (const kind of kinds) {
        const cand = A.all.filter((a) => SPECIES[a.sp].kind === kind && !a.onWall && !a.wallMode && !a.hop);
        if (!cand.length) continue;
        const a = cand[Math.floor(Math.random() * cand.length)];
        const x = a.pos.x, z = a.pos.z, p0 = a.pos.clone();
        let ok = true;
        if (what === 'piece') ok = !!w.decor.addPiece(type, x, z, { size: PIECES[type].size, rot: Math.random() * 6.28 });
        else if (what === 'plant') ok = !!w.plants.add(type, a.pos.clone().setY(T.heightAt(x, z)), { grown: 1 });
        else { const kit = KITS[0]; ok = kit ? !!kits.buildKit(w, kit, { x, z, seed: 7 }).pieces.length : false; }
        if (!ok) continue;
        w.groundChanged();
        const r = { what: type === 0 ? 'kit' : type, kind, sp: a.sp, doing: fz.doing(a, SPECIES[a.sp]) };
        const at = (k) => {
          const gv = T.field.sample(a.pos.x, a.pos.z, T.field.hv);
          return { k, dead: !!a.dead, solid: A.occ.solidAt(a.pos.x, a.pos.y + (kind === 'swim' ? 0 : 0.5), a.pos.z) ? 1 : 0, guard: A.insideSolid(a, SPECIES[a.sp]) ? 1 : 0, under: +(gv - a.pos.y).toFixed(1), moved: +a.pos.distanceTo(p0).toFixed(1) };
        };
        r.t0 = at(0);
        fz.begin(w, 'place');
        for (let k = 1; k <= 120; k++) { fz.frame(1 / 30, 1); if (k === 1) r.t1 = at(1); if (k === 15) r.t15 = at(15); }
        r.t120 = at(120);
        res.push(r);
      }
    } finally { fz.clockOff(); }
    return { mode: 'place', preset, seed, res };
  }, { preset, seed, CFG });
}

// The same seed and the same start at 1x (move 1/30 s), 60x (move 0.2 s) and a time-lapse (600 game min/s: move 0.1 s),
// for the same animal time: per-step anomalies and contacts (catches, eaten) per 1000 animal seconds.
async function lapse(page, preset, seed) {
  const out = { mode: 'lapse', preset, seed, cfg: {} };
  const want = (E.FUZZ_CFGS ?? '1x,60x,lapse').split(',');     // FUZZ_CFGS=1x,60x: only those speeds
  for (const [name, dtR, speed, lap] of [['1x', 1 / 30, 1, 0], ['60x', 0.05, 60, 0], ['lapse', 0.05, 0, 600]].filter(([n]) => want.includes(n))) {
    out.cfg[name] = await page.evaluate(async ({ preset, seed, CFG, dtR, speed, lap }) => {
      const fz = window.__fz; await fz.mods(); fz.tp = CFG.tp;
      fz.seed(seed);
      const w = await fz.start(preset);
      fz.seed(seed);
      fz.stock(w, CFG.species, CFG.n);
      w.animals.syncOccupancy(true);
      fz.clockOn();
      let r;
      const catches = () => w.animals.all.reduce((s, a) => s + (a.caught ?? 0), 0);
      try { fz.begin(w, 'lapse'); const m0 = w.env.minute; await fz.run(Math.min(CFG.seconds, 240), dtR, speed, lap); r = fz.summary(); r.gameMin = Math.round(w.env.minute - m0); }
      finally { fz.clockOff(); }
      return r;
    }, { preset, seed, CFG, dtR, speed, lap });
  }
  return out;
}

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game && window.__ctx, null, { timeout: 90000 });
  page.setDefaultTimeout(3600000);
  await page.evaluate(lib);
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const put = (o) => { fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); };
  const short = (o) => {
    const c = o.cnt ?? o.post?.cnt ?? {};
    return Object.entries(c).map(([k, v]) => `${k}=${typeof v === 'object' ? Object.entries(v).map(([s, n]) => `${s}:${n}`).join('/') : v}`).join(' ');
  };
  for (const mode of MODES) for (const preset of PRESETS) for (const seed of SEEDS) {
    if ((mode === 'restart') && preset !== 'starter') continue;
    const t0 = Date.now();
    let r;
    try {
      r = mode === 'ff' ? await ff(page, preset, seed) : mode === 'save' ? await saveload(page, preset, seed, false) : mode === 'restart' ? await saveload(page, preset, seed, true)
        : mode === 'place' ? await place(page, preset, seed) : mode === 'lapse' ? await lapse(page, preset, seed) : null;
    } catch (e) { r = { mode, preset, seed, error: String(e.message ?? e).slice(0, 400) }; }
    if (!r) continue;
    r.sec = Math.round((Date.now() - t0) / 1000);
    put(r);
    if (mode === 'lapse') for (const [k, v] of Object.entries(r.cfg)) console.log(`lapse ${preset} s${seed} ${k} t=${v.t} min=${v.gameMin} ${short(v)} deaths=${JSON.stringify(v.deaths)}`);
    else if (mode === 'place') console.log(`place ${preset} s${seed}`, r.res?.map((x) => `${x.what}/${x.sp}: t0 s${x.t0.solid}g${x.t0.guard} t1 s${x.t1?.solid} t120 s${x.t120.solid}g${x.t120.guard} u${x.t120.under} m${x.t120.moved}${x.t120.dead ? ' DEAD' : ''}`).join(' | ') ?? r.error);
    else console.log(`${mode} ${preset} s${seed} ${r.sec}s`, r.error ?? `${short(r)} deaths=${JSON.stringify(r.deaths ?? r.post?.deaths)}`, mode !== 'ff' ? JSON.stringify({ caught: r.caught, before: r.before, after: r.after, lost: r.lostById, moved: r.movedOnLoad, ids: r.ids, states: r.states, same: r.same, stale: r.stale, kept: r.oldObjectsKept }) : '');
  }
  const errs = await page.evaluate(() => (window.__errs ?? []).slice(0, 5));
  if (errs.length) console.log('page errors', JSON.stringify(errs));
};
