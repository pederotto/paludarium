// Giving animals drives (sim/labdrive.js) and drawing what they are doing on the floor: the path, the dots, the goal and a trail.
// The lab only names goals. Moving is the animal's own business (Animals.labDrive and the species' minds).

import * as THREE from 'three/webgpu';
import { SPECIES } from '../sim/animals.js';
import { TANK } from '../sim/tank.js';
import { clamp } from '../util/math.js';
import { figure8, circle, square, zigzag, line, resample, clampTo, makeDrive, makeDot, dotStep } from '../sim/labdrive.js';
import { L } from './state.js';

// The movement kinds the lab can drive so far (the rest keep their own minds, the panel says so).
export const DRIVABLE = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink', 'crab', 'swim']);
export const SHAPES = { figure8: 'Figure 8', circle: 'Circle', square: 'Square', zigzag: 'Zig-zag', line: 'Back and forth' };
const MARGIN = 3;

export const floor = () => ({ x0: -TANK.w / 2, x1: TANK.w / 2, z0: -TANK.d / 2, z1: TANK.d / 2 });

// How close counts as "there" for a body of this size: a wider circle for a bigger animal, so it is not asked for the impossible.
export const tolFor = (sp) => clamp(sp.size * 0.8, 1.5, 4);

// The waypoints of a shape about (cx, cz), `size` cm across, kept inside the floor. Open shapes are one pass.
export function shapePoints(shape, cx, cz, size) {
  const b = floor(), w = size, h = Math.max(6, size * 0.5);
  const fit = (hx, hz) => [clamp(cx, b.x0 + MARGIN + hx, b.x1 - MARGIN - hx), clamp(cz, b.z0 + MARGIN + hz, b.z1 - MARGIN - hz)];
  let pts, closed = true;
  switch (shape) {
    case 'circle': { const r = Math.min(w / 2, (b.z1 - b.z0) / 2 - MARGIN); [cx, cz] = fit(r, r); pts = circle(cx, cz, r, r, 48); break; }
    case 'square': { const s = Math.min(w, (b.z1 - b.z0) - 2 * MARGIN); [cx, cz] = fit(s / 2, s / 2); pts = square(cx, cz, s, s); break; }
    case 'zigzag': { const d = Math.min(h * 1.6, (b.z1 - b.z0) - 2 * MARGIN); [cx, cz] = fit(w / 2, d / 2); pts = zigzag(cx, cz, w, d, 5); closed = false; break; }
    case 'line': { [cx, cz] = fit(w / 2, 0); pts = line(cx - w / 2, cz, cx + w / 2, cz); closed = false; break; }
    default: { const rz = Math.min(h, (b.z1 - b.z0) / 2 - MARGIN); [cx, cz] = fit(w / 2, rz); pts = figure8(cx, cz, w / 2, rz, 72); }
  }
  return { pts: clampTo(pts, b, MARGIN), closed };
}

// A shape and a mode (loop, once, ping-pong) as the drive wants them. A closed shape looped goes round; done once it goes round once
// and ends where it began; an open shape looped goes back and forth.
export function asDrive(pts, closed, mode, spacing) {
  if (closed && mode === 'loop') return { pts: resample(pts, spacing, true), closed: true, mode: 'loop' };
  if (closed && mode === 'once') return { pts: resample([...pts, pts[0]], spacing, false), closed: false, mode: 'once' };
  return { pts: resample(pts, spacing, false), closed: false, mode: mode === 'once' ? 'once' : 'pingpong' };
}

export function createDriver(game) {
  const dots = new Map();      // id -> runtime dot (sim/labdrive.js makeDot)
  let nextDot = 1;
  const scene = game.scene;

  // --- overlays ---------------------------------------------------------------------------------------------------------------
  const lineMat = (color, opacity = 0.95) => new THREE.LineBasicNodeMaterial({ color, depthTest: false, transparent: true, opacity });
  const mkLine = (color, max) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setDrawRange(0, 0);
    const l = new THREE.Line(g, lineMat(color));
    l.renderOrder = 25; l.frustumCulled = false; l.visible = false;
    scene.add(l);
    return l;
  };
  const MAXP = 1200;
  const pathLine = mkLine(0xffe08a, MAXP), draftLine = mkLine(0xffffff, 200), trail = mkLine(0x4fd6ff, 600);
  const goalRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 32), new THREE.MeshBasicNodeMaterial({ color: 0xff7a59, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  goalRing.rotation.x = -Math.PI / 2; goalRing.renderOrder = 26; goalRing.visible = false; goalRing.frustumCulled = false;
  scene.add(goalRing);
  const dotGeo = new THREE.SphereGeometry(0.9, 16, 12), dotMat = new THREE.MeshBasicNodeMaterial({ color: 0xff3d6e, depthTest: false });
  const dotMeshes = new Map();

  const yAt = (x, z) => game.world.terrain.heightAt(x, z) + 0.45;
  const setPoly = (l, pts, closed = false) => {
    if (!pts?.length) { l.visible = false; return; }
    const arr = l.geometry.attributes.position.array;
    let n = 0;
    const put = (x, z) => { if (n < arr.length / 3) { arr[n * 3] = x; arr[n * 3 + 1] = yAt(x, z); arr[n * 3 + 2] = z; n++; } };
    const seq = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < seq.length; i++) {
      put(seq[i].x, seq[i].z);
      const nx = seq[i + 1];
      if (nx) { const k = Math.min(20, Math.floor(Math.hypot(nx.x - seq[i].x, nx.z - seq[i].z) / 2.5)); for (let j = 1; j <= k; j++) put(seq[i].x + ((nx.x - seq[i].x) * j) / (k + 1), seq[i].z + ((nx.z - seq[i].z) * j) / (k + 1)); }
    }
    l.geometry.setDrawRange(0, n);
    l.geometry.attributes.position.needsUpdate = true;
    l.visible = n > 1;
  };

  // --- trail of the selected animal (every 0.1 s of animal time, the last 600 points) --------------------------------------------
  let trailFor = null, trailPts = [], trailT = 0;
  const resetTrail = (a) => { trailFor = a; trailPts = []; trailT = 0; setPoly(trail, []); };

  // --- giving drives ------------------------------------------------------------------------------------------------------------
  // The animals a command goes to: the selected one, or every animal of its species.
  const targets = () => {
    const a = L.sel.value;
    if (!a || a.dead) return [];
    return L.all.value ? game.world.animals.by[a.sp].filter((b) => !b.dead) : [a];
  };
  const give = (list, make) => {
    for (const a of list) {
      const sp = SPECIES[a.sp];
      a.lab = { drive: makeDrive(make(a, sp)), pace: L.pace.value, gait: L.gait.value, goal: null, kicked: false, stats: null };
      a.perch = null;
    }
    resetTrail(L.sel.value);
  };

  const api = {
    dots,
    setPace(p) { L.pace.value = p; for (const a of targets()) if (a.lab) a.lab.pace = p; },
    setGait(g) { L.gait.value = g; for (const a of targets()) if (a.lab) a.lab.gait = g; },
    free() { for (const a of targets()) a.lab = null; L.draft.value = []; L.pick.value = null; resetTrail(L.sel.value); },
    goto(x, z) { give(targets(), (a, sp) => ({ type: 'goto', x, z, tol: tolFor(sp), d0: Math.hypot(x - a.pos.x, z - a.pos.z) })); },
    path(shape = 'figure8', { size = L.size.value, mode = L.pathMode.value } = {}) {
      give(targets(), (a, sp) => {
        const { pts, closed } = shapePoints(shape, a.pos.x, a.pos.z, size), tol = tolFor(sp);
        return { type: 'path', shape, size, ...asDrive(pts, closed, mode, Math.max(3, tol * 2)), tol };
      });
    },
    // The waypoints tapped in draw mode.
    drawn(mode = L.pathMode.value) {
      const pts = L.draft.value;
      if (pts.length < 2) return;
      give(targets(), (a, sp) => { const tol = tolFor(sp); return { type: 'path', shape: 'drawn', src: pts, ...asDrive(pts, false, mode, Math.max(3, tol * 2)), tol }; });
      L.draft.value = []; L.pick.value = null;
    },
    follow(kind = L.dotKind.value, { speed = L.dotSpeed.value, keep = L.keep.value } = {}) {
      const a = L.sel.value;
      if (!a) return null;
      const id = `d${nextDot++}`;
      const b = floor(), ang = (nextDot * 2.4) % (Math.PI * 2);
      const x = clamp(a.pos.x + Math.cos(ang) * 14, b.x0 + 4, b.x1 - 4), z = clamp(a.pos.z + Math.sin(ang) * 14, b.z0 + 4, b.z1 - 4);
      dots.set(id, makeDot({ id, kind, x, z, speed, cx: a.pos.x, cz: a.pos.z, r: 14, ang, seed: nextDot * 977 }));
      give(targets(), () => ({ type: 'follow', dot: id, keep, tol: 1.5 }));
      sync();
      return id;
    },
    removeDot(id) {
      dots.delete(id);
      for (const a of game.world.animals.all) if (a.lab?.drive?.dot === id) a.lab = null;
      sync();
    },
    clear() { dots.clear(); L.draft.value = []; for (const m of dotMeshes.values()) m.removeFromParent(); dotMeshes.clear(); sync(); resetTrail(null); },
  };

  // Publish the dots to the animals, and the list to the panel.
  function sync() {
    const A = game.world?.animals;
    if (A) { A.labDots = Object.fromEntries([...dots].map(([id, d]) => [id, { x: d.x, z: d.z }])); }
    L.dots.value = [...dots.values()].map((d) => ({ id: d.id, kind: d.kind, x: d.x, z: d.z }));
  }

  // Each frame, after the animals have moved: dots move, overlays follow.
  game.frameHooks.push((dt) => {
    const W = game.world;
    if (!W) return;
    const k = Math.min(game.rate, 4);
    if (k > 0) { const b = floor(); for (const d of dots.values()) dotStep(d, dt * k, b); sync(); }
    for (const [id, d] of dots) {
      let m = dotMeshes.get(id);
      if (!m) { m = new THREE.Mesh(dotGeo, dotMat); m.renderOrder = 27; m.frustumCulled = false; scene.add(m); dotMeshes.set(id, m); }
      m.position.set(d.x, yAt(d.x, d.z) + 0.6, d.z);
    }
    for (const [id, m] of dotMeshes) if (!dots.has(id)) { m.removeFromParent(); dotMeshes.delete(id); }
    const a = L.sel.value;
    if (a !== trailFor) resetTrail(a && !a.dead ? a : null);
    const D = a?.lab?.drive;
    if (D?.type === 'path') { if (pathLine.userData.drive !== D) { setPoly(pathLine, D.pts, D.closed); pathLine.userData.drive = D; } } else { pathLine.visible = false; pathLine.userData.drive = null; }
    const g = a?.lab?.goal;
    goalRing.visible = !!g;
    if (g) { goalRing.position.set(g.x, yAt(g.x, g.z), g.z); goalRing.scale.setScalar(Math.max(1.2, tolFor(SPECIES[a.sp]))); }
    if (L.draft.value.length) setPoly(draftLine, L.draft.value); else draftLine.visible = false;
    if (a && !a.dead && k > 0) {
      trailT += dt * k;
      if (trailT >= 0.1) {
        trailT = 0;
        trailPts.push({ x: a.pos.x, z: a.pos.z });
        if (trailPts.length > 600) trailPts.shift();
        setPoly(trail, trailPts);
      }
    }
  });

  game.events.on('unload', () => { api.clear(); });
  return api;
}
