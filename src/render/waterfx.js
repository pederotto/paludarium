// Water that moves and focuses light, ported from CAUSTIC//VOLUME
// (https://github.com/scottiefox/caustic-volume, MIT) to three.js WebGPU/TSL:
//
//  - Ripples: a height field on the GPU. Each cell moves toward the average
//    of its neighbours and overshoots (the wave equation), stepped by
//    ping-ponging two render targets. The glass walls reflect the waves
//    (clamp-to-edge sampling). It covers the main pool and every still pond
//    outside it (their banks hold the waves as the shore does); streams are
//    left out, the current sweeps ripples away. Drops come from the
//    waterfalls and clicks.
//  - Bodies: an animal in or at the water is a few spheres (its hull, a
//    swimming frog's feet). Each step the water a sphere pushes aside where it
//    is now, less what it pushed aside where it was, goes into the height
//    field (the sandbox's coupling of its floating bodies: SH.ripple `column`),
//    so a wake, the ring behind a kick and the splash of a body dropping in
//    come from the motion itself. A body deep under the surface moves none.
//  - Surface: a grid moved by the ripples plus a few small travelling waves.
//  - Floating bodies ride that surface: each frame the water's height under
//    each of them (averaged over its footprint, with the slope) is worked out
//    in a tiny pass and read back to the CPU, a frame or two late (probe).
//  - Caustics: every vertex of a fine grid on the surface (the main pool's, or
//    a still pond's) sends a ray of the LED's light, refracted by the surface
//    normal, down to the substrate;
//    the grid is drawn where the rays land. A patch of surface that lands on
//    a smaller patch of floor concentrates its light, so each fragment gets
//    the ratio of the two areas (screen-space derivatives), and overlapping
//    patches add up into the bright net on the bottom.
//
// The ripple step follows the structure of three.js's webgpu_compute_water
// example, but uses render targets so it also runs on the WebGL 2 back end.

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, texture, uv, vec2, vec3, vec4, float, exp, clamp, max, abs, dot, normalize, refract,
  sin, cos, time, varying, positionLocal, dFdx, dFdy, mix, smoothstep, pow, cameraPosition, positionWorld,
  transformNormalToView, min, viewportSharedTexture, viewportSafeUV, screenUV, reflect, int, step, If,
  cameraViewMatrix, cameraProjectionMatrix, getScreenPosition,
} from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from './uniforms.js';

export const SIM = [256, 128];     // ripple grid (x, z)
const CAUS = [512, 256];           // caustics texture
const RIPPLE_MM = 0.02;            // ripple units → cm of height
const DROPS = 16;                  // drops taken per frame (falls, animals, clicks)
export const HULLS = 48;           // spheres of bodies in or at the water coupled to the ripples at once (a swimming frog is 17)
const COUPLE = 0.3;                // how much of the water a hull pushes aside goes into the ripple field
const HULL_CAP = 9;                // the most a cell's height changes by it in a step (ripple units)
const DAMP = 0.992, WAVE = 0.44, VISC = 0.025;   // the ripple solver: speed kept a step, pull toward the neighbours, viscosity on the speed
const HULL_MIN = 0.5;              // the smallest footprint a hull is given (cm: about two cells of the grid)
export const PROBES = 64;          // floating bodies whose water height is read back at once
const IOR = 1.333;

// Shared ripple / caustics texture nodes for every material in the scene.
export const FX = {
  ripple: texture(new THREE.Texture()),
  caustics: texture(new THREE.Texture()),
  terrainH: texture(new THREE.Texture()),
  lightDir: uniform(new THREE.Vector3(0.18, -1, 0.12).normalize()),
  on: uniform(0),
  lamp: uniform(1),                // the LED strip is in view (not in the overhead look, engine/stage.js setOverhead): mirrored in the water
};

// World (x, z) → tank uv (0..1).
export const tankUV = (xz) => vec2(xz.x.div(TANK.w).add(0.5), xz.y.div(TANK.d).add(0.5));

// A few small travelling waves so the surface is never glassy-flat and the
// floor always has some caustics. Returns (height, d/dx, d/dz) in cm.
const WAVES = [
  [0.9, 0.2, 1.1, 0.0], [-0.4, 0.95, 1.6, 1.7], [0.3, -0.8, 2.3, 4.1], [-0.85, -0.35, 3.1, 2.2], [0.55, 0.6, 4.2, 5.3], [-0.2, 0.7, 5.5, 0.9],
];
export const wavesAt = Fn(([p]) => {
  const t = time;
  let h = float(0), dx = float(0), dz = float(0);
  for (const [a, b, k, ph] of WAVES) {
    const d = vec2(a, b).normalize();
    const kk = k * 0.35;                          // wavenumber (1/cm)
    const amp = 0.018 / k;                        // equal slope per wave
    const w = Math.sqrt(9.81 * 100 * kk) * 0.12;  // slowed deep-water dispersion
    const phase = dot(d, p).mul(kk).sub(t.mul(w)).add(ph);
    h = h.add(sin(phase).mul(amp));
    const c = cos(phase).mul(amp * kk);
    dx = dx.add(c.mul(d.x));
    dz = dz.add(c.mul(d.y));
  }
  return vec3(h, dx, dz);
});

// Height and slope of the ripples at world (x, z), in cm.
export const rippleAt = Fn(([p]) => {
  const q = tankUV(p);
  const e = vec2(1 / SIM[0], 1 / SIM[1]);
  const h = FX.ripple.sample(q).r;
  const hx = FX.ripple.sample(q.add(vec2(e.x, 0))).r.sub(FX.ripple.sample(q.sub(vec2(e.x, 0))).r);
  const hz = FX.ripple.sample(q.add(vec2(0, e.y))).r.sub(FX.ripple.sample(q.sub(vec2(0, e.y))).r);
  const cellX = TANK.w / SIM[0], cellZ = TANK.d / SIM[1];
  return vec3(h, hx.div(2 * cellX), hz.div(2 * cellZ)).mul(RIPPLE_MM);
});

export const surfaceAt = Fn(([p]) => wavesAt(p).add(rippleAt(p).mul(FX.on)));

// The surface's height alone at world (x, z), cm (no slope: one sample of the ripples, the waves without their derivatives), for
// shading that only needs to know where the water is (an animal's waterline: render/shaders.js waterAt).
export const surfaceHeight = Fn(([p]) => {
  let h = FX.ripple.sample(tankUV(p)).r.mul(RIPPLE_MM).mul(FX.on);
  for (const [a, b, k, ph] of WAVES) {
    const d = vec2(a, b).normalize(), kk = k * 0.35, w = Math.sqrt(9.81 * 100 * kk) * 0.12;
    h = h.add(sin(dot(d, p).mul(kk).sub(time.mul(w)).add(ph)).mul(0.018 / k));
  }
  return h;
});
export const normalFrom = (s) => normalize(vec3(s.y.negate(), 1, s.z.negate()));

export class WaterFX {
  constructor(renderer, world) {
    this.renderer = renderer;
    this.world = world;
    const opt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
    this.rt = [new THREE.RenderTarget(SIM[0], SIM[1], opt), new THREE.RenderTarget(SIM[0], SIM[1], opt)];
    this.causRT = new THREE.RenderTarget(CAUS[0], CAUS[1], { ...opt });
    this.cur = 0;
    this.drops = [];
    this.dropU = uniformArray(Array.from({ length: DROPS }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4');
    // hulls: (x, y, z, radius) in cm, where each sphere was a step ago and where it is now (far above the water: none)
    this.hullOld = uniformArray(Array.from({ length: HULLS }, () => new THREE.Vector4(0, 1e4, 0, 1)), 'vec4');
    this.hullNew = uniformArray(Array.from({ length: HULLS }, () => new THREE.Vector4(0, 1e4, 0, 1)), 'vec4');
    this.hulls = new Map();          // key → { x, y, z, r, px, py, pz, seen }
    // probes: (x, z, footprint radius) in cm of each floating body whose water height is read back (probe, surface)
    this.probeU = uniformArray(Array.from({ length: PROBES }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
    this.probes = new Map();         // key → { x, z, r, seen }
    this.heights = new Map();        // key → { h, sx, sz, at } as last read back
    this.reading = false;
    this.buildSim();
    this.buildProbe();
    this.buildCaustics();
    this.buildTerrainTexture();
    FX.ripple.value = this.rt[0].texture;
    FX.caustics.value = this.causRT.texture;
    FX.on.value = 1;
  }

  // --- Ripple simulation --------------------------------------------------
  // Two fixed passes per frame, A: rt0 → rt1 (with the drops), B: rt1 → rt0,
  // so the result always ends in rt0 and no material ever swaps textures.
  buildSim() {
    this.simQuads = [this.simMaterial(this.rt[0].texture, true), this.simMaterial(this.rt[1].texture, false)]
      .map((m) => new THREE.QuadMesh(m));
  }

  simMaterial(prevTexture, withDrops) {
    const prev = texture(prevTexture);
    const drops = this.dropU, hullOld = this.hullOld, hullNew = this.hullNew;
    const m = new THREE.MeshBasicNodeMaterial();
    // fragmentNode writes the raw (signed) heights, skipping colour output.
    m.fragmentNode = Fn(() => {
      const q = uv();
      const e = vec2(1 / SIM[0], 1 / SIM[1]);
      const c = prev.sample(q);
      const nbs = prev.sample(q.add(vec2(0, e.y))).rg.add(prev.sample(q.sub(vec2(0, e.y))).rg)
        .add(prev.sample(q.add(vec2(e.x, 0))).rg).add(prev.sample(q.sub(vec2(e.x, 0))).rg);
      // The wave equation: the height keeps its vertical speed (a little damped) and is pulled toward its neighbours' mean. With
      // the pull just under the scheme's limit a cell also feels its own height, and a little viscosity on the vertical speed
      // (the speed here against its neighbours') takes out the cell-to-cell chop a small, quick body leaves, while the longer
      // waves run as before (the sandbox's solver does the same). Stable for (WAVE + 2 VISC) * 8 <= 2 * (1 + DAMP).
      const vel = c.r.sub(c.g);
      let h = c.r.add(vel.mul(DAMP)).add(nbs.x.sub(c.r.mul(4)).mul(WAVE)).add(nbs.x.sub(nbs.y).sub(vel.mul(4)).mul(VISC));
      if (withDrops) {
        const p = q.sub(0.5).mul(vec2(TANK.w, TANK.d));
        for (let i = 0; i < DROPS; i++) {
          const d = drops.element(i);
          const r = p.sub(d.xy).div(d.z);
          h = h.add(d.w.mul(exp(dot(r, r).negate())));
        }
      }
      const t = FX.terrainH.sample(q);
      if (withDrops) {
        // Bodies. The column of water a sphere takes up over this cell: its own height here (a rounded footprint, flat-topped
        // with a soft rim) as far as it lies under the water's level. What it took up before less what it takes up now is water
        // that has to go somewhere: the height here changes by it. A sphere whose top is well under the surface moves none.
        const p = q.sub(0.5).mul(vec2(TANK.w, TANK.d));
        const lvl = max(U.waterLevel, t.g);
        const column = (sph) => {
          const tt = p.sub(sph.xz).length().div(max(sph.w, HULL_MIN));     // (a footprint narrower than the grid can carry is spread)
          const hc = sph.w.mul(exp(pow(tt.mul(1.1), 6).negate()));
          return clamp(lvl.sub(sph.y.sub(hc)), 0, hc.mul(2));
        };
        let src = float(0);
        for (let i = 0; i < HULLS; i++) {
          const so = hullOld.element(i), sn = hullNew.element(i);
          const near = float(1).sub(smoothstep(sn.w, sn.w.mul(3), lvl.sub(sn.y.add(sn.w))));
          src = src.add(column(so).sub(column(sn)).mul(near));
        }
        h = h.add(clamp(src.mul(COUPLE / RIPPLE_MM), -HULL_CAP, HULL_CAP));
      }
      // Dry cells hold no waves: the substrate above the main pool's line, unless a still pond lies on it (its surface
      // is in the terrain texture's green channel, see setStill).
      const wet = max(smoothstep(0.0, 0.6, U.waterLevel.sub(t.r)), smoothstep(0.0, 0.6, t.g.sub(t.r)));
      return vec4(h.mul(wet), c.r, 0, 1);
    })();
    return m;
  }

  addDrop(x, z, strength = 6, radius = 0.8) {
    if (this.drops.length < DROPS) this.drops.push([x, z, radius, strength]);
  }

  // A body in or at the water this frame: a sphere (centre and radius, cm) under a key that stays the same from frame to frame
  // (the animal's id, and a number for each of its spheres). Its last position is remembered here; a body that is not named for a
  // frame is forgotten. A body that jumps further than it could have moved (put somewhere else) starts afresh.
  addHull(key, x, y, z, r) {
    const h = this.hulls.get(key);
    if (!h) { this.hulls.set(key, { x, y, z, r, px: x, py: y, pz: z, seen: true }); return; }
    if (Math.hypot(x - h.x, y - h.y, z - h.z) > 3 * r + 3) { h.px = x; h.py = y; h.pz = z; }
    h.x = x; h.y = y; h.z = z; h.r = r; h.seen = true;
  }

  // A body floating at the water this frame, under a key that stays the same from frame to frame: the height of the water under it
  // (the ripples and the small travelling waves, as the surface is drawn, averaged over a disc of radius r cm, and its slope) is read
  // back from the GPU. surface(key) gives the last reading, { h (cm above the still level), sx, sz (rise per cm along x and z), at
  // (when it was read, ms) }, or null before the first. A body not named for a while is forgotten.
  probe(key, x, z, r) {
    const p = this.probes.get(key);
    if (p) { p.x = x; p.z = z; p.r = r; p.seen = true; } else this.probes.set(key, { x, z, r, seen: true });
  }
  surface(key) { return this.heights.get(key) ?? null; }

  step() {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const arr = this.dropU.array;
    for (let i = 0; i < DROPS; i++) {
      const d = this.drops[i];
      if (d) arr[i].set(d[0], d[1], d[2], d[3]); else arr[i].set(0, 0, 1, 0);
    }
    this.drops.length = 0;
    // the hulls: where each was and is (those that moved first, if there are more than fit), then this frame becomes the last
    const ho = this.hullOld.array, hn = this.hullNew.array;
    let n = 0;
    for (const [key, h] of this.hulls) {
      if (!h.seen) { this.hulls.delete(key); continue; }
      if (n < HULLS && (h.x !== h.px || h.y !== h.py || h.z !== h.pz)) { ho[n].set(h.px, h.py, h.pz, h.r); hn[n].set(h.x, h.y, h.z, h.r); n++; }
      h.px = h.x; h.py = h.y; h.pz = h.z; h.seen = false;
    }
    for (; n < HULLS; n++) { ho[n].set(0, 1e4, 0, 1); hn[n].set(0, 1e4, 0, 1); }
    // Two sub-steps per frame keeps waves moving at a natural speed.
    r.setRenderTarget(this.rt[1]);
    this.simQuads[0].render(r);
    r.setRenderTarget(this.rt[0]);
    this.simQuads[1].render(r);
    // Caustics.
    r.setRenderTarget(this.causRT);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.causScene, this.causCam);
    this.readProbes();
    r.setRenderTarget(prevRT);
  }

  // --- Probes ---------------------------------------------------------------
  // One pixel a floating body: the surface's height over its footprint (five points: its middle counted twice and four round it at
  // its radius) and the slope across it, so ripples shorter than the body average out under it as they do under a real one.
  buildProbe() {
    this.probeRT = new THREE.RenderTarget(PROBES, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const P = this.probeU;
    const m = new THREE.MeshBasicNodeMaterial();
    m.blending = THREE.NoBlending;
    m.fragmentNode = Fn(() => {
      const pr = P.element(int(uv().x.mul(PROBES)));
      const c = pr.xy, r = max(pr.z, 0.05);
      const h0 = surfaceAt(c).x;
      const hx1 = surfaceAt(c.add(vec2(r, 0))).x, hx0 = surfaceAt(c.sub(vec2(r, 0))).x;
      const hz1 = surfaceAt(c.add(vec2(0, r))).x, hz0 = surfaceAt(c.sub(vec2(0, r))).x;
      const h = h0.mul(2).add(hx1).add(hx0).add(hz1).add(hz0).div(6);
      return vec4(h, hx1.sub(hx0).div(r.mul(2)), hz1.sub(hz0).div(r.mul(2)), 1);
    })();
    this.probeQuad = new THREE.QuadMesh(m);
  }

  // The bodies named since the last reading go into the probe pass and its pixels are read back (one reading in flight at a time:
  // it lands a frame or two later, without stalling the GPU). A platform that cannot read back gives no readings: bodies then ride a
  // still surface.
  readProbes() {
    if (this.reading || this.probeOff) return;
    const keys = [], arr = this.probeU.array;
    for (const [key, p] of this.probes) {
      if (!p.seen) { this.probes.delete(key); this.heights.delete(key); continue; }
      p.seen = false;
      if (keys.length < PROBES) { arr[keys.length].set(p.x, p.z, p.r, 1); keys.push(key); }
    }
    if (!keys.length) return;
    const r = this.renderer;
    r.setRenderTarget(this.probeRT);
    this.probeQuad.render(r);
    this.reading = true;
    r.readRenderTargetPixelsAsync(this.probeRT, 0, 0, keys.length, 1).then((d) => {
      if (this.disposed) return;
      const at = performance.now();
      for (let i = 0; i < keys.length; i++) {
        const o = i * 4, h = d[o], sx = d[o + 1], sz = d[o + 2];
        if (!(Number.isFinite(h) && Number.isFinite(sx) && Number.isFinite(sz))) continue;
        const v = this.heights.get(keys[i]);
        if (v) { v.h = h; v.sx = sx; v.sz = sz; v.at = at; } else this.heights.set(keys[i], { h, sx, sz, at });
      }
    }).catch((e) => { this.probeOff = true; console.warn('water probe read-back', e); }).finally(() => { this.reading = false; });
  }

  // --- Caustics -------------------------------------------------------------
  buildCaustics() {
    const grid = new THREE.PlaneGeometry(TANK.w, TANK.d, SIM[0], SIM[1]).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true });
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquation = THREE.AddEquation;
    const surf = positionLocal.xz;
    const s = surfaceAt(surf);
    const n = normalFrom(s);
    // The surface the light enters: the main pool's, or a still pond's where one lies higher (setStill), so the ripples
    // in a pond focus light on its own floor.
    const here = FX.terrainH.sample(tankUV(surf));
    const P = vec3(surf.x, max(U.waterLevel, here.g).add(s.x), surf.y);
    const L = FX.lightDir;
    const r = refract(L, n, 1 / IOR);
    const ry = min(r.y, -0.05);
    // Where does the refracted ray meet the substrate? One refinement step
    // against the terrain height map is plenty for gentle slopes.
    const g0 = here.r;
    const t0 = max(P.y.sub(g0), 0.1).div(ry.negate());
    const F0 = P.add(r.mul(t0));
    const g1 = FX.terrainH.sample(tankUV(F0.xz)).r;
    const t = max(P.y.sub(g1), 0.1).div(ry.negate());
    const F = P.add(r.mul(t));
    const fres = pow(float(1).sub(max(dot(L.negate(), n), 0)), 5).mul(0.98).add(0.02);
    // Water soaks up red light first (Beer–Lambert), so deep light is teal.
    const absorb = exp(vec3(0.045, 0.012, 0.009).mul(t).negate());
    const vI = varying(absorb.mul(float(1).sub(fres)).mul(max(L.y.negate(), 0)), 'vI');
    const vSurf = varying(surf, 'vSurf');
    m.vertexNode = vec4(F.x.div(TANK.w / 2), F.z.div(TANK.d / 2), 0, 1);
    const a = dFdx(vSurf), b = dFdy(vSurf);
    const pix = (TANK.w / CAUS[0]) * (TANK.d / CAUS[1]);
    const ratio = min(abs(a.x.mul(b.y).sub(a.y.mul(b.x))).div(pix), 30);
    m.colorNode = vI.mul(ratio);
    m.opacityNode = float(1);
    this.causMesh = new THREE.Mesh(grid, m);
    this.causMesh.frustumCulled = false;
    this.causScene = new THREE.Scene();
    this.causScene.add(this.causMesh);
    this.causCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // The substrate heightfield as a float texture (for ray landing and dry cells).
  buildTerrainTexture() {
    const f = this.world.terrain.field;
    // Half floats: linear filtering of 32-bit float textures is optional in WebGPU.
    this.hData = new Uint16Array(f.cols * f.rows * 4);
    this.hTex = new THREE.DataTexture(this.hData, f.cols, f.rows, THREE.RGBAFormat, THREE.HalfFloatType);
    this.hTex.minFilter = this.hTex.magFilter = THREE.LinearFilter;
    this.hTex.wrapS = this.hTex.wrapT = THREE.ClampToEdgeWrapping;
    FX.terrainH.value = this.hTex;
    this.updateTerrain();
  }

  dispose() {
    this.disposed = true;
    for (const t of [...this.rt, this.causRT, this.probeRT]) t.dispose();
    this.hTex?.dispose();
    for (const q of [...this.simQuads, this.probeQuad]) q.material.dispose();
    this.causMesh.geometry.dispose();
    this.causMesh.material.dispose();
  }

  updateTerrain() {
    const f = this.world.terrain.field;
    // Texture rows run with v, which maps to +z (front).
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < f.rows; j++) for (let i = 0; i < f.cols; i++) this.hData[(j * f.cols + i) * 4] = toHalf(f.h[f.idx(i, j)]);
    this.hTex.needsUpdate = true;
  }

  // The still ponds outside the main pool, so the ripples run in them too: the green channel holds the pond's surface
  // over each cell (far below the ground elsewhere). `surf(n)` gives it for grid cell n, or -Infinity: no still water.
  // Only uploaded when a cell changed.
  setStill(surf) {
    const f = this.world.terrain.field, toHalf = THREE.DataUtils.toHalfFloat, dry = toHalf(-100);
    let changed = false;
    for (let n = 0; n < f.cols * f.rows; n++) {
      const v = surf(n);
      const g = v > -Infinity ? toHalf(v) : dry;
      if (this.hData[n * 4 + 1] !== g) { this.hData[n * 4 + 1] = g; changed = true; }
    }
    if (changed) this.hTex.needsUpdate = true;
  }
}

// Caustic light at a world point (0 = none, ~1 = average, peaks higher).
export const causticLight = Fn(([pw]) => FX.caustics.sample(tankUV(pw.xz)).rgb);

// The main water surface: rippled normals, the view into the water bent by
// refraction, and a Fresnel reflection of what is round it.
//
// Refraction: the rendered scene behind the surface (as in three.js's
// Water2Mesh), looked up where the ripples bend the view: the ray into the
// water through the rippled surface and through a still one are followed down
// to the floor (the terrain under this point), and the floor point seen moves
// by the difference, projected to the screen. Deep water wobbles more than a
// shallow film and far water less on the screen, as in a real tank. (The
// scene is drawn as if through still water without bending, as the tank has
// always been shown; only the ripples' own bending is added.)
//
// Reflection: the room is dark, so the surface mirrors the tank itself: the
// LED strip over the lid, and the background with the land and plants on it
// (the rendered picture where the mirrored ray meets the back of the tank),
// the dark room through the lid and the side glass. Seen from above at a
// grazing angle the far water mirrors the lit background and the ripples
// break it up; looking down, Fresnel leaves almost nothing of it, as with
// real water. The LED's glint is the strip's mirror image (it used to be a
// sun-like spot of the directional light, where no lamp is), worked out here
// rather than by the standard lighting (whose bright environment map turned
// the surface milky at low angles).
const LAMP = 5;                    // the LED strip's brightness to a reflection, against the lit scene (bloom takes the excess)
// The most water a ripple's bending is followed down through (cm). What lies behind a pixel is not always the floor: an animal
// floating at the surface, a stem or a leaf just under it bend far less than the floor would, and bent as much they shattered
// into streaks. Without the scene's depth here (it cannot be read in every pass: multisampling), a few centimetres is the
// compromise: the floor of a deep pool wobbles less than it should, a body at the surface a little more.
const DEPTH_CAP = 3;
export function waterSurfaceMaterial({ ripples = true, opacity = 0.12, refract: bend = true } = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const p = positionLocal.xz;
  const sN = ripples ? surfaceAt(p) : wavesAt(p);
  m.positionNode = vec3(positionLocal.x, positionLocal.y.add(sN.x), positionLocal.z);
  const P = positionWorld;
  const sF = ripples ? surfaceAt(P.xz) : wavesAt(P.xz);
  const n = normalFrom(sF);
  const view = normalize(cameraPosition.sub(P));
  const fres = pow(float(1).sub(clamp(abs(dot(view, n)), 0, 1)), 5).mul(0.95).add(0.03);
  const room = vec3(0.025, 0.03, 0.034).mul(U.daylight.mul(0.6).add(0.4));
  const r = reflect(view.negate(), n);
  const rl = max(dot(r, FX.lightDir.negate()), 0);
  if (!bend) {
    const glint = pow(rl, 900).mul(6).add(pow(rl, 60).mul(0.25)).mul(U.daylight);
    m.colorNode = mix(U.tint.mul(0.08), room.add(glint), fres).add(glint);
    m.opacityNode = clamp(float(opacity * 0.6).add(fres.mul(0.45)), 0, 0.8);
    return m;
  }
  // The Low preset keeps the old surface (U.surfaceDetail: a branch on a uniform, so the reads and the projections are not made
  // there, and no shader is rebuilt when the preset changes): a dim constant for the room, the directional light's glint, the view
  // bent by a fixed share of the ripples' slope. It costs less on a weak GPU (the full surface measured about +0.85 ms a frame at
  // 1920 x 1200 on the M1, with the animals' waterline).
  m.colorNode = Fn(() => {
    const col = vec3(0).toVar();
    If(U.surfaceDetail.greaterThan(0.5), () => {
      // The lamp's own glint is its mirror image below (the strip, next); the light it casts adds a soft sheen on the wavelets.
      const glint = pow(rl, 60).mul(0.15).mul(U.daylight);
      // What the mirrored ray meets. The strip: where it crosses the strip's height, inside its footprint (soft edges).
      const lampY = TANK.h + 2.85, lampZ = -TANK.d * 0.09, lampX = TANK.w * 0.39;
      const L = P.add(r.mul(float(lampY).sub(P.y).div(max(r.y, 0.02))));
      const lamp = smoothstep(lampX + 0.3, lampX - 0.3, abs(L.x)).mul(smoothstep(0.9, 0.5, abs(L.z.sub(lampZ)))).mul(step(0.02, r.y)).mul(FX.lamp);
      // The back: where it meets the plane of the background (in front of the back glass by the relief), inside the tank, and
      // that point's picture on the screen (the lit wall, or whatever stands in front of it there); off the screen, the wall's
      // average colour.
      const B = P.add(r.mul(float(-TANK.d / 2 + 2.5).sub(P.z).div(min(r.z, -0.02))));
      const inTank = step(0.02, r.z.negate()).mul(step(B.y, TANK.h)).mul(step(abs(B.x), TANK.w / 2));
      const bv = cameraViewMatrix.mul(vec4(B, 1)).xyz;
      const buv = getScreenPosition(bv, cameraProjectionMatrix);
      const onScreen = step(0.003, buv.x).mul(step(buv.x, 0.997)).mul(step(0.003, buv.y)).mul(step(buv.y, 0.997)).mul(step(bv.z, -1));
      const wallAvg = vec3(0.05, 0.06, 0.045).mul(U.daylight.mul(0.8).add(0.2));
      const wall = mix(wallAvg, viewportSharedTexture(viewportSafeUV(buv)).rgb, onScreen);
      // (from under the surface, looking up through the front glass: the old dark room)
      const above = step(U.waterLevel, cameraPosition.y);
      const refl = mix(room, mix(room, wall, inTank).add(vec3(1, 0.97, 0.9).mul(lamp).mul(LAMP).mul(U.daylight)), above).add(glint);
      // The view ray into the water through this rippled surface and through a still one, followed down to the floor under this
      // point: the floor point seen moves by the difference.
      const D = clamp(P.y.sub(FX.terrainH.sample(tankUV(P.xz)).r), 0, DEPTH_CAP);
      const into = view.negate();
      const t1 = refract(into, n, 1 / IOR), t0 = refract(into, vec3(0, 1, 0), 1 / IOR);
      const dW = t1.mul(D.div(max(t1.y.negate(), 0.08))).sub(t0.mul(D.div(max(t0.y.negate(), 0.08))));
      const F = P.add(into.mul(D.div(max(into.y.negate(), 0.08))));               // the floor point behind this pixel (unbent)
      const fv = cameraViewMatrix.mul(vec4(F.add(vec3(dW.x, 0, dW.z)), 1)).xyz;
      const off = getScreenPosition(fv, cameraProjectionMatrix).sub(screenUV);
      const below = viewportSharedTexture(viewportSafeUV(screenUV.add(clamp(off, vec2(-0.06), vec2(0.06)).mul(step(fv.z, -1))))).rgb;
      col.assign(mix(below.mul(vec3(0.94, 0.98, 0.98)), refl, fres).add(glint.mul(float(1).sub(fres))));
    }).Else(() => {
      const glint = pow(rl, 900).mul(6).add(pow(rl, 60).mul(0.25)).mul(U.daylight);
      const below = viewportSharedTexture(viewportSafeUV(screenUV.add(n.xz.mul(0.035)))).rgb;
      col.assign(mix(below.mul(vec3(0.94, 0.98, 0.98)), room.add(glint), fres).add(glint.mul(float(1).sub(fres))));
    });
    return col;
  })();
  m.opacityNode = float(1);
  return m;
}
