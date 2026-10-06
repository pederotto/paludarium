// The bug radar's wiring (sim/labradar.js has the checks): every frame each animal is sampled, the engine's own repairs are caught
// where they happen, and what is found goes into one log, newest first. The same fault on the same animal inside 6 s of animal
// time is counted on its row, not listed again. Read-only: the radar never moves anything.

import { SPECIES } from '../sim/animals.js';
import { TANK } from '../sim/tank.js';
import { check, newState, overlapping } from '../sim/labradar.js';
import { L } from './state.js';
import { tolFor } from './driver.js';
import { setPaused } from './arena.js';

const COOL = 6;      // s of animal time
const KEEP = 150;    // rows kept

export function createRadar(game) {
  const states = new WeakMap();
  const recent = new Map();     // 'id:kind' -> its row
  let rows = [];
  const wrapped = new WeakSet();
  const clock = () => game.world?.animals.t ?? 0;

  const publish = () => { L.log.value = rows.slice(0, 80); L.bugs.value = rows.length; };

  function flag(a, kind, msg, sev = 'warn') {
    const t = clock(), key = `${a.id}:${kind}`, e = recent.get(key);
    if (e && t - e.last < COOL) { e.n++; e.last = t; publish(); return; }
    const row = { key, n: 1, t, last: t, id: a.id, sp: a.sp, name: SPECIES[a.sp]?.name ?? a.sp, kind, msg, sev, pos: [a.pos.x, a.pos.y, a.pos.z], animal: a };
    rows.unshift(row);
    recent.set(key, row);
    if (rows.length > KEEP) { const old = rows.pop(); if (recent.get(old.key) === old) recent.delete(old.key); }
    publish();
    if (sev === 'bad' && L.pauseOnBug.value && !L.paused.value) { setPaused(game, true); L.note.value = `Paused: ${row.name} #${row.id} — ${msg}`; L.sel.value = a; }
  }

  // The engine's own repairs are bugs made visible: it moved an animal that was stuck or inside something.
  function wrap(A) {
    if (wrapped.has(A)) return;
    wrapped.add(A);
    const orig = A.relocate;
    A.relocate = function (a, ...rest) { flag(a, 'relocated', 'the engine moved it: it was stuck, or inside something', 'bad'); return orig.call(this, a, ...rest); };
  }

  // Each frame, after the animals have moved.
  game.frameHooks.push((dt) => {
    const W = game.world;
    if (!W) return;
    wrap(W.animals);
    const k = Math.min(game.rate, 4);
    if (!(k > 0)) return;
    const A = W.animals, T = W.terrain, dtA = dt * k, t = A.t ?? 0;
    const bounds = { hw: TANK.w / 2, hd: TANK.d / 2, h: TANK.h };
    for (const a of A.all) {
      const sp = SPECIES[a.sp];
      if (sp.kind === 'egg' || a.dead) continue;
      let s = states.get(a);
      if (!s) states.set(a, (s = newState()));
      const found = check(s, a, { dt: dtA, t, size: sp.size, swim: sp.kind === 'swim' || !!a.swimming, air: sp.kind === 'fly', ground: T.heightAt(a.pos.x, a.pos.z), bounds, tol: tolFor(sp), tableSpeed: sp.speed });
      for (const f of found) flag(a, f.kind, f.msg, f.sev);
      if (a.lastStuck != null && a.lastStuck !== s.lastStuck) { if (s.lastStuck !== undefined) flag(a, 'unstuck', 'the engine had to unstick it: no headway for 3.5 s', 'warn'); s.lastStuck = a.lastStuck; }
    }
  });

  // Bodies inside each other, four times a second (pairs: fine for the few dozen animals a lab holds).
  game.tickHooks.push(() => {
    const A = game.world?.animals;
    if (!A || game.rate <= 0) return;
    const list = A.all.filter((a) => !a.dead && SPECIES[a.sp].kind !== 'egg' && SPECIES[a.sp].kind !== 'fly').map((a) => ({ a, pos: a.pos, r: A.radiusOf(a, SPECIES[a.sp]) }));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j];
      if (Math.abs(p.pos.x - q.pos.x) > p.r + q.r) continue;
      if (overlapping(p, q) != null) flag(p.a, 'overlap', `inside ${SPECIES[q.a.sp].name} #${q.a.id}`, 'warn');
    }
  });

  game.events.on('unload', () => { rows = []; recent.clear(); publish(); });

  return {
    rows: () => rows,
    clear() { rows = []; recent.clear(); publish(); },
  };
}
