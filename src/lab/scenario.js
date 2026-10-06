// The lab as plain data and back: the arena, obstacles, animals with their drives, dots, the clock and the camera. One format for
// everything that needs it: a bug report carries it, the session survives a page reload, a link opens the same situation again, and
// the random scenarios (sim/labrandom.js) are written in it. Small enough to paste.
//
// { v: 1, tank, ground, depth, rate, paused?, view?: { p, t }, obstacles: [{ kind, x, z, w, d, h, rot } | { kind, x, z, size, rot }],
//   animals: [{ sp, x, y?, z, yaw, wall?, drive }], dots: [{ id, kind, x, z, speed, … }] }
// Animals the game itself would breed or feed are not part of it: the lab holds the world still (World.labFreeze).

import * as THREE from 'three/webgpu';
import { SPECIES } from '../sim/animals.js';
import { L } from './state.js';
import { buildArena } from './arena.js';
import { spawn } from './spawn.js';

const r1 = (v) => Math.round(v * 10) / 10;

export function driveSpec(a) {
  const D = a.lab;
  return D?.drive ? { ...D.desc, pace: D.pace, gait: D.gait } : null;
}

export function snapshot(game, driver, obstacles) {
  const W = game.world, v = new THREE.Vector3(), t = new THREE.Vector3();
  game.rig.controls.getPosition(v); game.rig.controls.getTarget(t);
  return {
    v: 1, tank: game.tankId, ground: L.ground.value, depth: L.depth.value, rate: L.rate.value, paused: L.paused.value,
    view: { p: [r1(v.x), r1(v.y), r1(v.z)], t: [r1(t.x), r1(t.y), r1(t.z)] },
    obstacles: obstacles ? obstacles.snapshot() : [],
    animals: W.animals.all.filter((a) => !a.dead).map((a) => ({ sp: a.sp, x: r1(a.pos.x), y: r1(a.pos.y), z: r1(a.pos.z), yaw: Math.round((a.yaw ?? 0) * 100) / 100, ...(a.onWall || a.wallMode ? { wall: true } : {}), drive: driveSpec(a) })),
    dots: [...driver.dots.values()].map((d) => ({ id: d.id, kind: d.kind, x: r1(d.x), z: r1(d.z), speed: d.speed, cx: r1(d.cx), cz: r1(d.cz), r: d.r, ang: Math.round(d.ang * 100) / 100, seed: d.seed0 ?? 1 })),
  };
}

// Make the lab what the scenario says. The arena is rebuilt (everything in it goes), then obstacles, dots and animals are put in,
// and only then the drives given (a follower needs its dot, a random path needs the obstacles it aims at).
export async function applyScenario(lab, spec, { view = false } = {}) {
  const { game, driver, obstacles } = lab;
  await lab.arena({ tank: spec.tank ?? 'standard', ground: spec.ground ?? 'flat', depth: spec.depth ?? 0 });
  for (const o of spec.obstacles ?? []) obstacles.add(o, o.x, o.z);
  for (const d of spec.dots ?? []) driver.addDot(d);
  const A = game.world.animals, made = [];
  for (const an of spec.animals ?? []) {
    if (!SPECIES[an.sp]) continue;
    let a = null;
    if (an.y != null) {
      a = A.add(an.sp, new THREE.Vector3(an.x, an.y, an.z), { morph: null });
      if (a && an.wall) { a.onWall = true; a.wallMode = true; a.normal = new THREE.Vector3(0, 0, 1); }
    } else {
      const W = game.world, g = W.terrain.heightAt(an.x, an.z), s = W.water.surfaceAt(an.x, an.z, 0.2), water = s > g + 0.2;
      a = spawn(game, an.sp, 1, { point: new THREE.Vector3(an.x, water ? s : g, an.z), surface: water ? 'water' : 'terrain' }).added[0] ?? null;
    }
    if (a) { if (an.yaw != null) a.yaw = an.yaw; made.push([a, an.drive]); }
  }
  for (const [a, d] of made) if (d) driver.assign(a, d);
  L.sel.value = made[0]?.[0] ?? null;
  lab.rate(spec.rate ?? 4);
  lab.pause(!!spec.paused);
  if (view && spec.view) game.rig.controls.setLookAt(...spec.view.p, ...spec.view.t, false);
  return made.map(([a]) => a);
}

// --- Links -------------------------------------------------------------------------------------------------------------------
// A scenario in a web address: .../lab.html#s=<base64url of the JSON>. Short ones only (an address has a limit).
const b64 = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export function linkFor(spec) {
  const { view, paused, ...rest } = spec;
  return `${location.origin}${location.pathname}#s=${b64(JSON.stringify(rest))}`;
}
export function specFromHash(hash = location.hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try { const s = JSON.parse(unb64(m[1])); return s?.v === 1 ? s : null; } catch { return null; }
}

// --- The session -------------------------------------------------------------------------------------------------------------
// Saved to this tab's session storage every few seconds and when the page is hidden or leaves, and put back when the page loads again:
// a page that was reloaded under a tab (the browser dropped it to free memory, the graphics card was reset) comes back as it was.
const KEY = 'paludarium.lab.session';
export function createSession(lab) {
  const save = () => {
    if (!lab.game.world || !L.ready.value) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), s: snapshot(lab.game, lab.driver, lab.obstacles) })); } catch { /* private window, or full */ }
  };
  const timer = setInterval(() => { if (!document.hidden) save(); }, 3000);
  const hide = () => save();
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  addEventListener('pagehide', hide);
  return {
    save,
    load() { try { const o = JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); return o?.s?.v === 1 ? o : null; } catch { return null; } },
    forget() { try { sessionStorage.removeItem(KEY); } catch { /* nothing to do */ } },
    stop() { clearInterval(timer); },
  };
}
