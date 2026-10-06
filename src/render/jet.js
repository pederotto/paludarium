// Spray and bubbles where water leaves a nozzle or lands in a pool (numbers from sim/jets.js):
//
//   spray    drops shed along a jet thrown through the air (a spout over the pool), on its ballistic path, gone where it lands
//   sub      a nozzle under the water (a filter's return): fine bubbles and specks carried out on the jet, which slows as 1/x
//            past six bores and widens at about 12 degrees, then drift up
//   bubbles  the plume under a plunge (a fall, a spout landing): air driven down to the penetration depth, then rising at
//            the speed of its size, popping at the surface
//   splash   the crown where a jet or a fall lands: drops thrown up and out at a quarter of the impact speed, falling back
//
// Stateless GPU particles, as the repos doc chose (no compute pass, so the WebGL 2 fallback runs the same and the CPU does
// nothing per particle): each instance works out its own emitter, age and path in the vertex stage from its index, a hash
// and the time, and is drawn as a small quad facing the camera, stretched along its motion over about a frame (a fast drop
// reads as a streak, as the eye sees it). Up to SLOTS emitters of PER particles, packed into four uniform arrays each
// frame. Two meshes: what is under the water and what is in the air, so each kind can be drawn where the water's own
// see-through surfaces leave it visible. On the Low preset half the particles.

import * as THREE from 'three/webgpu';
import { float, int, vec2, vec3, vec4, uv, time, floor, fract, sin, cos, max, min, abs, sqrt, exp, step, smoothstep, length, normalize, cross, positionGeometry, instanceIndex, uniformArray, uniform, cameraViewMatrix, cameraProjectionMatrix, varying } from 'three/tsl';
import { U } from './uniforms.js';
import { FX, tankUV } from './waterfx.js';
import { G, SPLASH, jetSpeed, landOn, penetration, bubbleRise } from '../sim/jets.js';
import { pumpHose } from '../sim/filterflow.js';

export const SLOTS = 28, PER = 64;
export const KIND = { spray: 0, sub: 1, bubbles: 2, splash: 3 };
const EXPO = 1 / 70;     // s of motion a particle is stretched over (about a frame)

const hash = (x) => fract(sin(x.mul(12.9898).add(78.233)).mul(43758.5453));

export class Jets {
  constructor(parent, world) {
    this.world = world;
    const V4 = () => Array.from({ length: SLOTS }, () => new THREE.Vector4());
    // A: position, kind. B: direction, speed (cm/s). C: spread (share of the speed thrown sideways), the water's surface y,
    // life (s), share of the slot's particles in use. D: radius of the source (cm), size (cm), depth or start distance, rise (cm/s).
    this.u = { A: uniformArray(V4(), 'vec4'), B: uniformArray(V4(), 'vec4'), C: uniformArray(V4(), 'vec4'), D: uniformArray(V4(), 'vec4'), share: uniform(1), grow: uniform(1) };   // grow: a size factor for checks
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = () => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
      g.instanceCount = 0;
      return g;
    };
    this.under = new THREE.Mesh(geo(), this.material(true));
    this.over = new THREE.Mesh(geo(), this.material(false));
    // (under the water: drawn just after the pool's surface, as a plume seen through it; drawn before it, the surface's own
    // look through the water and the plunge's foam covered them)
    this.under.renderOrder = 5.5; this.over.renderOrder = 9;
    for (const [m, n] of [[this.under, 'jets-under'], [this.over, 'jets-over']]) { m.frustumCulled = false; m.name = n; parent.add(m); }
    this.list = [];
    this.count = 0;
  }

  material(underWater) {
    const { A, B, C, D, share, grow } = this.u;
    const fi = float(instanceIndex), e = floor(fi.div(PER)), k = fi.sub(e.mul(PER)), ei = int(e);
    const a = A.element(ei), b = B.element(ei), c = C.element(ei), d = D.element(ei);
    const kind = a.w, p0 = a.xyz, dir = b.xyz, sp = b.w, spread = c.x, surf = c.y, life0 = c.z, frac = c.w;
    const rad0 = d.x, size0 = d.y, depth = d.z, rise = d.w;
    const life = life0.mul(hash(k.mul(3.17).add(e.mul(1.3))).mul(0.6).add(0.7));
    const cyc = time.div(life).add(hash(k.mul(1.731).add(e.mul(7.13))));
    const n = floor(cyc), tau = fract(cyc).mul(life);
    const r1 = hash(k.add(n.mul(13.7)).add(e.mul(3.1))), r2 = hash(k.mul(2.3).add(n.mul(7.9)).add(0.7));
    const r3 = hash(k.mul(5.1).add(n.mul(3.3)).add(2.9)), r4 = hash(k.mul(7.7).add(n.mul(1.9)).add(5.3));
    const on = step(hash(k.mul(9.7).add(e.mul(0.37))), frac.mul(share));
    // a frame across the direction
    const ref = abs(dir.y).greaterThan(0.9).select(vec3(1, 0, 0), vec3(0, 1, 0));
    const sx = normalize(cross(dir, ref)), sy = cross(sx, dir);
    const ang = r2.mul(Math.PI * 2), rr = sqrt(r3);
    const across = sx.mul(cos(ang)).add(sy.mul(sin(ang))).mul(rr);
    const gv = vec3(0, -G, 0);
    // spray: from the nozzle (or a few cm on, `depth`) along the thrown path
    const t0 = tau.add(depth.div(max(sp, 1)).mul(r1));
    const v0 = dir.mul(sp.mul(r4.mul(0.2).add(0.9))).add(across.mul(sp.mul(spread)));
    const sprayP = p0.add(v0.mul(t0)).add(gv.mul(t0.mul(t0).mul(0.5)));
    const sprayV = v0.add(gv.mul(t0));
    // sub: out along the slowing jet, widening, drifting up
    const cc = max(rad0.mul(2 * 6.2), 0.1);
    const xs = cc.mul(sqrt(float(1).add(sp.mul(tau).mul(2).div(cc))).sub(1));
    const subP = p0.add(dir.mul(xs)).add(across.mul(xs.mul(0.21).add(rad0))).add(vec3(0, rise.mul(tau), 0));
    const subV = dir.mul(sp.div(sqrt(float(1).add(sp.mul(tau).mul(2).div(cc))))).add(vec3(0, rise, 0));
    // bubbles: driven down by the plunging water (over about 0.12 s) to a share of the penetration depth, held there while the
    // jet keeps pushing (a quarter of a second, spreading), then rising at their own speed with a little wobble
    const bub = r4.mul(0.8).add(0.6);                                  // this bubble's rise relative to the emitter's
    const down = depth.mul(r1.mul(0.7).add(0.3));
    const hold = r2.mul(0.2).add(0.15);
    const sink = down.mul(float(1).sub(exp(tau.div(-0.12))));
    const up = rise.mul(bub).mul(max(tau.sub(hold), 0));
    const wob = vec3(sin(tau.mul(31).add(r2.mul(6.3))), 0, cos(tau.mul(27).add(r3.mul(6.3)))).mul(0.06);
    const spreadOut = rr.mul(rad0).mul(smoothstep(0, 0.4, tau).mul(0.6).add(0.7));
    const bubP = p0.add(vec3(cos(ang), 0, sin(ang)).mul(spreadOut)).add(vec3(0, up.sub(sink).sub(0.12), 0)).add(wob);
    const bubV = vec3(0, step(hold, tau).mul(rise.mul(bub)).sub(down.div(0.12).mul(exp(tau.div(-0.12)))), 0);
    // splash: thrown up and out from the ring where the jet lands
    const out = vec3(cos(ang), 0, sin(ang));
    const sv = vec3(0, 1, 0).mul(r1.mul(0.6).add(0.6)).add(out.mul(r3.mul(0.8).add(0.3))).mul(sp.mul(r4.mul(0.5).add(0.6)));
    const splP = p0.add(out.mul(rad0.mul(rr.mul(0.6).add(0.4)))).add(sv.mul(tau)).add(gv.mul(tau.mul(tau).mul(0.5)));
    const splV = sv.add(gv.mul(tau));
    const is = (kk) => abs(kind.sub(kk)).lessThan(0.5);
    const P = is(KIND.spray).select(sprayP, is(KIND.sub).select(subP, is(KIND.bubbles).select(bubP, splP)));
    const Vv = is(KIND.spray).select(sprayV, is(KIND.sub).select(subV, is(KIND.bubbles).select(bubV, splV)));
    // where each kind lives: drops over the surface, bubbles under it; outside, the particle is gone (a quad of no size)
    const air = is(KIND.spray).or(is(KIND.splash));
    const mine = underWater ? air.select(float(0), float(1)) : air.select(float(1), float(0));
    // A drop in the air is gone where it comes down: on the water, or on the ground or a rock's top where that is higher (the
    // tank's height texture, render/waterfx.js: ground in r, a still pond's surface in g), never falling on through a rock.
    const gt = FX.terrainH.sample(tankUV(P.xz));
    const floorAir = max(max(surf, gt.r.add(0.1)), gt.g);
    const alive = air.select(step(floorAir, P.y), step(P.y, surf.sub(0.04))).mul(on).mul(mine);
    const age = tau.div(life);
    const fade = smoothstep(0, 0.08, age).mul(smoothstep(1, 0.75, age));
    const size = size0.mul(r3.mul(0.7).add(0.5)).mul(alive).mul(grow);
    // the quad: facing the camera, stretched along the motion over EXPO s
    const vc = cameraViewMatrix.mul(vec4(P, 1)).xyz;
    // (a bubble is round: what blur its rise gives it is at most about its size; a drop is a streak)
    const vm = cameraViewMatrix.mul(vec4(Vv, 0)).xy.mul(EXPO);
    const sl0 = length(vm), ax = sl0.greaterThan(1e-4).select(vm.div(sl0), vec2(1, 0)), px = vec2(ax.y.negate(), ax.x);
    const sl = underWater ? min(sl0, size.mul(0.8)) : sl0;
    const q = positionGeometry.xy;
    const off = ax.mul(q.x.mul(sl.add(size))).add(px.mul(q.y.mul(size)));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vc.xy.add(off), vc.z, 1));
    const vFade = varying(fade.mul(alive));
    const r = length(uv().sub(0.5)).mul(2);
    const lit = U.daylight.mul(0.75).add(0.2);
    if (underWater) {
      // a bubble: a bright rim round a clear middle
      const ring = smoothstep(0.45, 0.8, r).mul(smoothstep(1.0, 0.82, r));
      m.colorNode = vec3(0.88, 0.96, 1.0).mul(lit.add(0.15));
      m.opacityNode = ring.mul(0.75).add(smoothstep(1.0, 0.6, r).mul(0.12)).mul(vFade);
    } else {
      // a drop: bright, softer at its edge
      m.colorNode = vec3(0.86, 0.93, 0.97).mul(lit.add(0.2));
      m.opacityNode = smoothstep(1.0, 0.35, r).mul(0.7).mul(vFade);
    }
    return m;
  }

  // The emitters for this frame: the filter's nozzles and spouts (render/plumbing.js `nozzles`, only while the plumbing is shown)
  // and every fall that lands in water (render/water.js ribbons). Falls first, the strongest first.
  gather() {
    const W = this.world, Wt = W.water, H = Wt.hydro, T = W.terrain, L = [];
    const depthAt = (x, z, s) => Math.max(0, s - T.heightAt(x, z));
    const falls = [...Wt.ribbons.values()].filter((r) => r.wet).sort((a, b) => b.q - a.q);
    for (const r of falls) {
      const s = H.surfaceAt(r.end.x, r.end.z, 0.2);
      if (!(s > -Infinity)) continue;
      const hgt = Math.max(0.5, (r.pts[0]?.y ?? r.end.y) - r.end.y), v = Math.sqrt(2 * G * hgt);
      const dep = depthAt(r.end.x, r.end.z, s), k = Math.min(1, 0.25 + r.q / 40);
      const at = { x: r.end.x, y: s, z: r.end.z };
      L.push({ kind: KIND.bubbles, p: at, dir: { x: 0, y: 1, z: 0 }, v: 0, spread: 0, surf: s, life: 0.9, share: Math.min(1, k * 1.4), r: Math.min(2.2, r.R * 0.55), size: 0.13, depth: Math.max(0.6, penetration(0.35, v, dep)), rise: bubbleRise(0.8) });
      if (hgt > 2) L.push({ kind: KIND.splash, p: at, dir: { x: 0, y: 1, z: 0 }, v: Math.min(90, SPLASH * v), spread: 0, surf: s, life: 0.35, share: Math.min(1, 0.15 + r.q / 60), r: Math.min(1.6, r.R * 0.4), size: 0.07, depth: 0, rise: 0 });
    }
    // Water thrown through the air: drops shed off the column, then where it comes down (sim/jets.js landOn: on the water, or
    // on the ground or a rock's top where that is higher) the crown, and in water the plume and a few ripples a second.
    const floorAt = (x, z) => { const w = H.surfaceAt(x, z, 0.2), g = T.heightAt(x, z) + 0.1; return w > g ? { y: w, water: true } : { y: g, water: false }; };
    const thrown = (p, dir, v, r, share, spread = 0.05, start = 1.5) => {
      L.push({ kind: KIND.spray, p, dir, v, spread, surf: H.level, life: 0.25, share, r, size: 0.06, depth: start, rise: 0 });
      const hit = landOn(p, dir, v, floorAt);
      if (!hit) return;
      const at = { x: hit.x, y: hit.y, z: hit.z };
      if (hit.water) {
        L.push({ kind: KIND.bubbles, p: at, dir: { x: 0, y: 1, z: 0 }, v: 0, spread: 0, surf: hit.y, life: 0.8, share: Math.min(1, 0.3 + v / 250), r: r * 1.4 + 0.3, size: 0.09, depth: penetration(r * 2, hit.v, depthAt(hit.x, hit.z, hit.y)), rise: bubbleRise(0.8) });
        L.push({ kind: KIND.splash, p: at, dir: { x: 0, y: 1, z: 0 }, v: Math.min(80, SPLASH * hit.v), spread: 0, surf: hit.y, life: 0.3, share: Math.min(1, 0.2 + v / 300), r: r + 0.2, size: 0.055, depth: 0, rise: 0 });
        this.impacts.push({ x: hit.x, z: hit.z, k: Math.min(1.5, 0.4 + hit.v / 200) });
      } else {
        // on ground or rock: a small, low splash where it hits (most of the water runs off)
        L.push({ kind: KIND.splash, p: at, dir: { x: 0, y: 1, z: 0 }, v: Math.min(40, 0.15 * hit.v), spread: 0, surf: hit.y, life: 0.22, share: Math.min(0.6, 0.15 + v / 400), r: r + 0.1, size: 0.045, depth: 0, rise: 0 });
      }
    };
    this.impacts = [];
    // The pump's outlets on the background: the water leaves the hose's mouth out from the wall and a little down, at its speed in
    // the hose (sim/jets.js jetSpeed), before it runs down the wall (render/water.js outletRibbon).
    if (H.pump.running) {
      const id = pumpHose(H.pump.rate)[0];
      for (const o of H.outlets) {
        if (!o.wall || !(o.q > 0.5)) continue;
        const p0 = o.pts?.[0] ?? o.pos;
        thrown({ x: p0.x, y: p0.y, z: p0.z + 0.3 }, { x: 0, y: -0.35, z: 1 }, Math.max(10, jetSpeed(o.q * 3.6, id)), id / 20, Math.min(0.6, 0.2 + o.q / 60), 0.15, 0.3);
      }
    }
    const P = W.plumbing;
    if (P?.group.visible && P.nozzles) for (const z of P.nozzles) {
      const lvl = H.level;
      if (z.p.y < lvl - 0.2) {
        L.push({ kind: KIND.sub, p: z.p, dir: z.dir, v: z.v, spread: 0, surf: lvl, life: 0.7, share: Math.min(1, 0.3 + z.v / 250), r: z.r, size: 0.12, depth: 0, rise: bubbleRise(0.4) });
        continue;
      }
      thrown(z.p, z.dir, z.v, z.r, 0.35);
    }
    return L.slice(0, SLOTS);
  }

  update(dt) {
    const { A, B, C, D, share } = this.u;
    const L = this.gather();
    this.list = L;
    // a few ripples a second where thrown water comes down in a pool (render/waterfx.js addDrop)
    const fx = this.world.fx;
    if (fx && dt > 0) for (const h of this.impacts ?? []) if (Math.random() < Math.min(1, dt * 12)) fx.addDrop(h.x + (Math.random() - 0.5) * 0.8, h.z + (Math.random() - 0.5) * 0.8, -(0.5 + Math.random()) * h.k, 0.35 + Math.random() * 0.3);
    L.forEach((m, i) => {
      A.array[i].set(m.p.x, m.p.y, m.p.z, m.kind);
      const l = Math.hypot(m.dir.x, m.dir.y, m.dir.z) || 1;
      B.array[i].set(m.dir.x / l, m.dir.y / l, m.dir.z / l, m.v);
      C.array[i].set(m.spread, m.surf, m.life, m.share);
      D.array[i].set(m.r, m.size, m.depth, m.rise);
    });
    share.value = U.surfaceDetail.value > 0.5 ? 1 : 0.5;
    this.count = L.length * PER;
    this.under.geometry.instanceCount = this.over.geometry.instanceCount = this.count;
    this.under.visible = this.over.visible = this.count > 0;
  }

  dispose() {
    for (const m of [this.under, this.over]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
  }
}

