// Water that moves and focuses light, ported from CAUSTIC//VOLUME
// (https://github.com/scottiefox/caustic-volume, MIT) to three.js WebGPU/TSL:
//
//  - Ripples: a height field on the GPU. Each cell moves toward the average
//    of its neighbours and overshoots (the wave equation), stepped by
//    ping-ponging two render targets. The glass walls reflect the waves
//    (clamp-to-edge sampling). It covers the main pool and every still pond
//    outside it (their banks hold the waves as the shore does); streams are
//    left out, the current sweeps ripples away. Drops come from the
//    waterfalls, animals and clicks.
//  - Surface: a grid moved by the ripples plus a few small travelling waves.
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
  transformNormalToView, min, viewportSharedTexture, viewportSafeUV, screenUV, reflect,
} from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from './uniforms.js';

export const SIM = [256, 128];     // ripple grid (x, z)
const CAUS = [512, 256];           // caustics texture
const RIPPLE_MM = 0.02;            // ripple units → cm of height
const DROPS = 16;                  // drops taken per frame (falls, animals, clicks)
const IOR = 1.333;

// Shared ripple / caustics texture nodes for every material in the scene.
export const FX = {
  ripple: texture(new THREE.Texture()),
  caustics: texture(new THREE.Texture()),
  terrainH: texture(new THREE.Texture()),
  lightDir: uniform(new THREE.Vector3(0.18, -1, 0.12).normalize()),
  on: uniform(0),
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
    this.buildSim();
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
    const drops = this.dropU;
    const m = new THREE.MeshBasicNodeMaterial();
    // fragmentNode writes the raw (signed) heights, skipping colour output.
    m.fragmentNode = Fn(() => {
      const q = uv();
      const e = vec2(1 / SIM[0], 1 / SIM[1]);
      const c = prev.sample(q);
      const nb = prev.sample(q.add(vec2(0, e.y))).r.add(prev.sample(q.sub(vec2(0, e.y))).r)
        .add(prev.sample(q.add(vec2(e.x, 0))).r).add(prev.sample(q.sub(vec2(e.x, 0))).r);
      let h = nb.mul(0.5).sub(c.g).mul(0.992);
      if (withDrops) {
        const p = q.sub(0.5).mul(vec2(TANK.w, TANK.d));
        for (let i = 0; i < DROPS; i++) {
          const d = drops.element(i);
          const r = p.sub(d.xy).div(d.z);
          h = h.add(d.w.mul(exp(dot(r, r).negate())));
        }
      }
      // Dry cells hold no waves: the substrate above the main pool's line, unless a still pond lies on it (its surface
      // is in the terrain texture's green channel, see setStill).
      const t = FX.terrainH.sample(q);
      const wet = max(smoothstep(0.0, 0.6, U.waterLevel.sub(t.r)), smoothstep(0.0, 0.6, t.g.sub(t.r)));
      return vec4(h.mul(wet), c.r, 0, 1);
    })();
    return m;
  }

  addDrop(x, z, strength = 6, radius = 0.8) {
    if (this.drops.length < DROPS) this.drops.push([x, z, radius, strength]);
  }

  step() {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const arr = this.dropU.array;
    for (let i = 0; i < DROPS; i++) {
      const d = this.drops[i];
      if (d) arr[i].set(d[0], d[1], d[2], d[3]); else arr[i].set(0, 0, 1, 0);
    }
    this.drops.length = 0;
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
    r.setRenderTarget(prevRT);
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
    for (const t of [...this.rt, this.causRT]) t.dispose();
    this.hTex?.dispose();
    for (const q of this.simQuads) q.material.dispose();
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
// refraction (the rendered scene behind the surface, sampled with an offset
// that follows the ripples, as in three.js's Water2Mesh), and a Fresnel
// reflection that takes over at grazing angles. The LED's glints come from
// the standard specular lighting.
//
// The room is dark, so the surface reflects almost nothing but the LED bar
// overhead: the reflection is a dim constant plus the lamp's glint, worked
// out here rather than by the standard lighting (whose bright environment
// map turned the surface milky at low angles).
export function waterSurfaceMaterial({ ripples = true, opacity = 0.12, refract = true } = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const p = positionLocal.xz;
  const sN = ripples ? surfaceAt(p) : wavesAt(p);
  m.positionNode = vec3(positionLocal.x, positionLocal.y.add(sN.x), positionLocal.z);
  const sF = ripples ? surfaceAt(positionWorld.xz) : wavesAt(positionWorld.xz);
  const n = normalFrom(sF);
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(clamp(abs(dot(view, n)), 0, 1)), 5).mul(0.95).add(0.03);
  const room = vec3(0.025, 0.03, 0.034).mul(U.daylight.mul(0.6).add(0.4));
  // Glint of the LED: a sharp highlight plus a softer sheen around it.
  const r = reflect(view.negate(), n);
  const toLamp = FX.lightDir.negate();
  const rl = max(dot(r, toLamp), 0);
  const glint = pow(rl, 900).mul(6).add(pow(rl, 60).mul(0.25)).mul(U.daylight);
  const refl = room.add(glint);
  if (refract) {
    const bent = viewportSafeUV(screenUV.add(n.xz.mul(0.035)));
    const below = viewportSharedTexture(bent).rgb;
    m.colorNode = mix(below.mul(vec3(0.94, 0.98, 0.98)), refl, fres).add(glint.mul(float(1).sub(fres)));
    m.opacityNode = float(1);
  } else {
    m.colorNode = mix(U.tint.mul(0.08), refl, fres).add(glint);
    m.opacityNode = clamp(float(opacity * 0.6).add(fres.mul(0.45)), 0, 0.8);
  }
  return m;
}
