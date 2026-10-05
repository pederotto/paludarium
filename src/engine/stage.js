// Everything around the living tank that depends on its size: glass, frame,
// lid, LED bar, cabinet, the room, and the lights. Rebuilt whenever the tank
// changes (see Game.loadTank).
//
// The glass is more than a transparent box: humid air in a tank that is
// cooler outside than inside fogs up its glass with dew (the dew point rises
// above the glass temperature), and the droplets are drawn here, driven by
// U.condense. Wiping the glass is a real thing keepers do.

import * as THREE from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, positionWorld, normalWorld, normalView, cameraPosition, normalize, dot, abs, pow, smoothstep, mix, clamp,
  texture, max,
} from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from '../render/uniforms.js';
import { DEW, dewTextures, bakeDew } from '../render/dew.js';
import { FX } from '../render/waterfx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lightBars, barSection, roomScene } from './fittings.js';

const COOL = new THREE.Color(0xf4f7ff), WARM = new THREE.Color(0xffd9a8), GLOW = new THREE.Color(1, 0.965, 0.9);
const DEW_MIN = 0.015;   // below this much dew the beads are smaller than a pixel: the glass is simply clear

export class Stage {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'stage';
    scene.add(this.root);
    this.lights = {};
    this.parts = {};
    this.build();
  }

  // Glass with fresnel edges and dew droplets.
  glassMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ color: 0xcfe8e4, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.04, metalness: 0 });
    const view = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(float(1).sub(clamp(abs(dot(view, normalWorld)), 0, 1)), 4);
    // The dew: sparse beads that grow and merge as U.condense rises, each a
    // clear centre with a bright rim (a lens catching the light), and a thin
    // haze of fog on the glass at the top of the range.
    // Evaluating the noise for every fragment (two Worley fields and a simplex, over the big panes, drawn for both faces)
    // cost about half of a frame on a retina screen. The pattern never changes, only how much of it shows, so it is baked
    // into tileable textures (render/dew.js) and the shader takes two samples; and most tanks start with no dew at all, so
    // the lot sits behind a branch on the uniform: clear glass pays for none of it.
    const c = U.condense, tex = dewTextures();
    const dew = Fn(() => {
      const out = vec3(0).toVar();   // x: the beads, y: their rims, z: the haze
      If(c.greaterThan(DEW_MIN), () => {
        const pp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y.mul(0.85));
        const ta = texture(tex.a, pp.div(DEW.periodA)).level(0), tb = texture(tex.b, pp.div(DEW.periodB)).level(0);
        const w = ta.x, w2 = tb.x;
        const R = c.mul(0.36), r2 = c.mul(0.3);
        const bodyV = max(smoothstep(R, R.mul(0.6), w), smoothstep(r2, r2.mul(0.6), w2).mul(0.8));
        const rimA = smoothstep(R.mul(0.62), R.mul(0.92), w).mul(smoothstep(R.mul(1.08), R.mul(0.9), w));
        const rimB = smoothstep(r2.mul(0.62), r2.mul(0.92), w2).mul(smoothstep(r2.mul(1.08), r2.mul(0.9), w2));
        const rimV = max(rimA, rimB.mul(0.8)).mul(smoothstep(0.03, 0.15, c));
        const hazeV = smoothstep(0.4, 1, c).mul(ta.y.mul(0.25).add(0.7)).mul(0.22);
        out.assign(vec3(bodyV, rimV, hazeV));
      });
      return out;
    })().toVar();
    const body = dew.x, rim = dew.y, haze = dew.z;
    m.opacityNode = float(0.035).add(fres.mul(0.12)).add(body.mul(0.09)).add(rim.mul(0.4)).add(haze);
    m.roughnessNode = mix(float(0.04), float(0.3), clamp(body.add(haze), 0, 1));
    m.colorNode = mix(vec3(0.8, 0.92, 0.9), vec3(0.96, 0.99, 1), clamp(rim.add(haze), 0, 1));
    return m;
  }

  build() {
    const { w, d, h, closed } = TANK;
    const root = this.root;
    const { g, trim: t, outW, outD, furn: f } = roomScene(TANK);
    const glass = this.glassMaterial();
    const panes = [
      [w + g * 2, h, g, 0, h / 2, d / 2 + g / 2],       // front
      [g, h, d, -w / 2 - g / 2, h / 2, 0],              // left
      [g, h, d, w / 2 + g / 2, h / 2, 0],               // right
    ];
    for (const [sx, sy, sz, x, y, z] of panes) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), glass);
      m.position.set(x, y, z);
      m.renderOrder = 10;
      root.add(m);
    }
    const black = new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.35 });
    const frame = (sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), black);
      m.position.set(x, y, z);
      m.castShadow = true;
      root.add(m);
    };
    // A sealed jar is one piece of glass: no trim on its edges.
    if (!closed) {
      for (const y of [-t / 2, h + t / 2]) {
        frame(w + t * 2 + g * 2, t, t, 0, y, d / 2 + g);
        frame(w + t * 2 + g * 2, t, t, 0, y, -d / 2 - t / 2);
        frame(t, t, d + t * 2, -w / 2 - t / 2 - g, y, 0);
        frame(t, t, d + t * 2, w / 2 + t / 2 + g, y, 0);
      }
      for (const x of [-w / 2 - g - t / 2, w / 2 + g + t / 2]) for (const z of [d / 2 + g, -d / 2 - t / 2]) frame(t, h, t, x, h / 2, z);
    }
    frame(w + g * 2, 0.8, d + 1, 0, -0.4, 0);
    frame(w + g * 2, h, 0.5, 0, h / 2, -d / 2 - 0.4);

    // Everything in the room is boxes and cylinders painted with vertex colours: one material for the lot.
    const paint = this.paint = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8 });

    // Lid (glass). The jar's is a thick glass stopper with a cork knob.
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w, closed ? 0.6 : 0.3, d), glass);
    lid.position.set(0, h + (closed ? 0.35 : 0.2), 0);
    lid.name = 'lid';
    if (closed) {
      const knob = new Kit();
      knob.cyl(2.4, 2.8, 2.2, 0, 1.4, 0, 0x8a6a48);
      lid.add(knob.mesh(paint));
    }
    root.add(lid);
    this.parts.lid = lid;

    // The lamp: stock-length LED bars side by side over an open tank (engine/fittings.js), a small clip-on lamp over the jar.
    const metal = new THREE.MeshStandardNodeMaterial({ color: 0x1b1d20, roughness: 0.4, metalness: 0.6 });
    const glowMat = this.glowMat = new THREE.MeshBasicNodeMaterial({ color: 0xfff6e5 });
    const housing = [], lit = [];
    const piece = (list, geo, x, y, z) => { geo.translate(x, y, z); list.push(geo); };
    if (closed) {
      const hx = w * 0.1, hz = -d * 0.08, hy = h + 9, px = w / 2 - 2, pz = -d / 2 - g - 0.6;
      piece(housing, new THREE.CylinderGeometry(5.5, 6, 2.2, 24), hx, hy, hz);
      piece(lit, new THREE.CylinderGeometry(4.8, 4.8, 0.2, 24), hx, hy - 1.15, hz);
      piece(housing, new THREE.BoxGeometry(1, hy - h + 2, 1), px, (h + hy) / 2, pz);   // the clamp's post on the back edge
      piece(housing, new THREE.BoxGeometry(2.4, 3, 2.4), px, h + 0.6, pz);
      const ax = px - hx, az = pz - hz, len = Math.hypot(ax, az);
      const arm = new THREE.BoxGeometry(len, 0.8, 0.8);
      arm.rotateY(-Math.atan2(az, ax));
      piece(housing, arm, (px + hx) / 2, hy + 0.6, (pz + hz) / 2);
    } else {
      for (const b of lightBars(w)) {
        const s = barSection(b.len);
        piece(housing, new THREE.BoxGeometry(b.len, s.h, s.d), b.x, h + 3.5, -d * 0.09);
        piece(lit, new THREE.BoxGeometry(b.len * 0.975, 0.2, s.d * 0.8), b.x, h + 3.45 - s.h / 2, -d * 0.09);
      }
    }
    const bar = new THREE.Mesh(merge(housing), metal);
    root.add(bar);
    this.parts.bar = bar;
    const glow = new THREE.Mesh(merge(lit), glowMat);
    glow.name = 'ledGlow';
    root.add(glow);
    this.parts.glow = glow;

    // What the tank stands on, and the room: a floor of boards, a wall with its skirting, a pot plant, and on a side table
    // a mug on two books. All of it has a real size, so it shows how big the tank is; it is drawn only on the title screen.
    this.furn = f;
    const cab = new THREE.Mesh(furnitureKit(f, outW).mergeTo(), paint);
    cab.receiveShadow = true;
    root.add(cab);
    this.parts.cab = cab;
    const room = new THREE.Mesh(roomKit(f, outW, outD).mergeTo(), paint);
    room.receiveShadow = true;
    root.add(room);
    this.parts.floor = room;
    this.fitScreen(this.aspect ?? 1.6);

    // Lights: an LED bar over the tank, room fill, and night moonlight.
    const L = this.lights;
    L.led = new THREE.DirectionalLight(0xf4f7ff, 3.2);
    L.led.position.set(w * 0.09, h * 2, d * 0.5);
    L.led.target.position.set(0, 0, 0);
    L.led.castShadow = true;
    L.led.shadow.mapSize.set(2048, 2048);
    const sc = L.led.shadow.camera;
    sc.left = -(w / 2 + 10); sc.right = w / 2 + 10; sc.top = d / 2 + 18; sc.bottom = -(d / 2 + 18);
    sc.near = h * 0.6; sc.far = h * 3.2;
    sc.updateProjectionMatrix();
    L.led.shadow.bias = -0.0005;
    L.led.shadow.normalBias = 0.05;
    L.hemi = new THREE.HemisphereLight(0xdfeeff, 0x1a1510, 0.35);
    L.moon = new THREE.DirectionalLight(0x5c7cff, 0);
    L.moon.position.set(-w / 3, h * 1.5, d);
    root.add(L.led, L.led.target, L.hemi, L.moon);
    this.lightDir = L.led.position.clone().negate().normalize();
  }

  // On a portrait screen the tall dark cabinet wastes the view: it shrinks to a thin plinth (and the floor rises to meet it).
  fitScreen(aspect) {
    this.aspect = aspect;
    const { cab, floor } = this.parts;
    if (!cab) return;
    const k = aspect < 0.8 ? 0.1 : 1;
    cab.scale.y = k;
    cab.position.y = -0.8;
    if (floor) floor.position.y = -0.8 - this.furn.h * k - (k < 1 ? 0.3 : 0.05);
  }

  setLid(on) { this.lidOn = on; if (this.parts.lid) this.parts.lid.visible = on && !this.overhead; }

  setRoom(on) { for (const k of ['cab', 'floor']) if (this.parts[k]) this.parts[k].visible = on; }

  // Seen from above in play: no lid, no lamp housing in the way (the lid's state lives in the world; setLid shows it again).
  setOverhead(on) {
    if (this.overhead === on) return;
    this.overhead = on;
    const { bar, glow, lid } = this.parts;
    if (bar) bar.visible = !on;
    if (glow) glow.visible = !on;
    if (lid) lid.visible = !on && this.lidOn !== false;
    FX.lamp.value = on ? 0 : 1;          // (nor its mirror image in the water: render/waterfx.js)
  }

  // Day and night: `light` is the schedule (0 … 1) times the lamp's power;
  // `warmth` (0 cool white … 1 warm) tints the LED; `moon` allows night light.
  setDaylight(light, warmth = 0.35, moon = true) {
    if (U.condense.value > 0.004) bakeDew();   // the first dew starts baking the pattern it needs (once)
    const L = this.lights;
    const lvl = Math.min(1.5, light);
    L.led.color.copy(COOL).lerp(WARM, warmth);
    L.led.intensity = 3.2 * lvl;
    L.hemi.intensity = 0.06 + 0.3 * Math.min(1, lvl);
    L.moon.intensity = moon ? (1 - Math.min(1, lvl)) * 0.35 : 0;
    this.glowMat.color.copy(GLOW).multiplyScalar(0.06 + 0.94 * Math.min(1, lvl)).lerp(WARM, warmth * 0.4);
    this.scene.environmentIntensity = 0.04 + 0.12 * Math.min(1, lvl);
  }

  dispose() {
    const lights = [];
    this.root.traverse((o) => {
      // A light with a shadow holds its shadow map (the LED's is 2048 x 2048, about 34 MB) until it is disposed.
      if (o.isLight) { lights.push(o); return; }
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose?.();
    });
    this.root.removeFromParent();
    disposeLightsLater(lights);
  }
}

// Freed a second later, not now (N20c): disposing a light frees its shadow resources, and a frame already encoded with the
// old tank's light can still be submitted after the swap: "Buffer used in submit while destroyed" on WebGPU (bisected to
// this dispose, 0 errors in 4 journeys with it off, 2-3 in every run with it on). Same delay as gfx.js disposePasses.
export function disposeLightsLater(lights, ms = 1000, later = setTimeout) {
  if (lights.length) later(() => { for (const l of lights) l.dispose?.(); }, ms);
  return lights.length;
}

const merge = (list) => { const geo = mergeGeometries(list); for (const p of list) p.dispose(); return geo; };

// Boxes and cylinders, each painted one colour (a vertex colour), merged into one geometry: one draw call for a room.
class Kit {
  constructor() { this.list = []; }
  add(geo, color, x = 0, y = 0, z = 0) {
    geo.translate(x, y, z);
    const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    this.list.push(geo);
    return geo;
  }
  box(sx, sy, sz, x, y, z, color, ry = 0) { const geo = new THREE.BoxGeometry(sx, sy, sz); if (ry) geo.rotateY(ry); return this.add(geo, color, x, y, z); }
  cyl(rt, rb, hh, x, y, z, color, seg = 18) { return this.add(new THREE.CylinderGeometry(rt, rb, hh, seg), color, x, y, z); }
  mergeTo() { return merge(this.list); }
  mesh(mat) { return new THREE.Mesh(this.mergeTo(), mat); }
}

const WOOD = 0x3a2b20, CARCASS = 0x1c1612, PLINTH = 0x100d0b, HANDLE = 0x9a968e;

// The cabinet or side table under the tank (engine/fittings.js), its top at y = 0 (Stage.fitScreen puts it under the tank).
function furnitureKit(f, outW) {
  const k = new Kit(), H = f.h;
  if (f.kind === 'table') {
    k.box(f.w, 3, f.d, 0, -1.5, 0, 0x33261b);
    k.box(f.w - 7, 7, f.d - 7, 0, -6.5, 0, WOOD);                    // the apron under the top
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(3.5, H - 3, 3.5, sx * (f.w / 2 - 4), -3 - (H - 3) / 2, sz * (f.d / 2 - 4), WOOD);
    k.box(f.w - 9, 2, f.d - 9, 0, -H + 15, 0, 0x33261b);            // a shelf low down
    // Beside the tank on the top: two books and a mug (about 8 cm across and 9.5 cm tall: everyone knows that size).
    const bx = (outW / 2 + f.w / 2) / 2 + 1, bz = 2;
    k.box(13, 2.4, 19, bx, 1.2, bz, 0x5a2622, 0.12);
    k.box(12, 3, 17.5, bx - 0.4, 3.9, bz - 0.5, 0x22344a, -0.08);
    const my = 5.4 + 4.75;
    k.cyl(4.1, 3.9, 9.5, bx, my, bz, 0xcfc8bb, 20);
    k.cyl(3.6, 3.6, 0.2, bx, my + 4.7, bz, 0x2a1a10, 20);
    k.add(new THREE.TorusGeometry(2.3, 0.55, 6, 14), 0xcfc8bb, bx + 4.4, my + 0.3, bz);
    return k;
  }
  const top = 2.5, plinth = 8, body = H - top - plinth;
  k.box(f.w + 1.6, top, f.d + 1.6, 0, -top / 2, 0, WOOD);
  k.box(f.w, body, f.d, 0, -top - body / 2, 0, CARCASS);
  k.box(f.w - 6, plinth, f.d - 6, 0, -H + plinth / 2, 0, PLINTH);
  // Doors about half a metre wide, a dark gap between them, a handle on each by the gap (the single door's on its right).
  const n = f.doors, gap = 0.5, edge = 1.2, dw = (f.w - edge * 2 - gap * (n - 1)) / n, dh = body - edge * 2, z = f.d / 2 + 0.6;
  for (let i = 0; i < n; i++) {
    const x = -f.w / 2 + edge + dw / 2 + i * (dw + gap);
    k.box(dw, dh, 1.2, x, -top - edge - dh / 2, z, WOOD);
    const side = n === 1 ? 1 : x < 0 ? 1 : -1;
    k.box(0.9, 12, 1.4, x + side * (dw / 2 - 4), -top - edge - 13, z + 1, HANDLE);
  }
  return k;
}

// The room round the furniture, its floor at y = 0: boards about 18 cm wide, a wall behind with a skirting board (one-sided,
// so the camera circling the tank on the title screen sees through it from behind) and a snake plant in a pot on the floor.
function roomKit(f, outW, outD) {
  const k = new Kit();
  const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const bw = 18, span = 900;
  for (let c = 0, x = -span / 2; x < span / 2; c++, x += bw) {
    for (let z = -span / 2 - rnd(c) * 160, j = 0; z < span / 2; j++) {
      const len = 120 + rnd(c * 31 + j) * 140, z0 = Math.max(z, -span / 2), z1 = Math.min(z + len, span / 2);
      const tone = 0.8 + rnd(c * 7 + j * 13) * 0.4, col = new THREE.Color(0x231a12).multiplyScalar(tone);
      const p = new THREE.PlaneGeometry(bw - 0.25, z1 - z0 - 0.25);
      p.rotateX(-Math.PI / 2);
      k.add(p, col, x + bw / 2, 0, (z0 + z1) / 2);
      z += len;
    }
  }
  const zw = -(Math.max(f.d, outD) / 2 + 6);
  const wall = new THREE.PlaneGeometry(span, 260);
  k.add(wall, 0x262c30, 0, 130, zw);
  k.add(new THREE.PlaneGeometry(span, 9), 0x55585a, 0, 4.5, zw + 1.2);
  k.add(new THREE.PlaneGeometry(span, 0.8), 0x6a6d6c, 0, 9.2, zw + 1.6);
  // A light switch on the wall at the usual height (a metre up, 8.5 cm square), right of the furniture.
  k.box(8.5, 8.5, 0.8, f.w / 2 + 22, 100, zw + 0.4, 0xc9c5bc);
  k.box(5.2, 5.2, 1.1, f.w / 2 + 22, 100, zw + 0.6, 0xd8d4cc);
  // The snake plant: a terracotta pot 26 cm across and leaves up to about 85 cm, beside the furniture on the left.
  const px = -(f.w / 2 + 24), pz = zw + 22;
  k.cyl(13, 10, 24, px, 12, pz, 0x6e3c2a);
  k.cyl(14, 14, 3, px, 24.5, pz, 0x7a4430);
  k.cyl(12.6, 12.6, 0.4, px, 25.6, pz, 0x1d150f);
  for (let i = 0; i < 8; i++) {
    const hgt = 56 + rnd(i + 3) * 30, blade = new THREE.ConeGeometry(2.8, hgt, 4);
    blade.scale(1, 1, 0.3);
    blade.translate(0, hgt / 2, 0);
    blade.rotateZ((rnd(i + 11) - 0.5) * 0.45);
    blade.rotateY(i * 2.4);
    k.add(blade, new THREE.Color(0x284a24).multiplyScalar(0.75 + rnd(i + 5) * 0.4), px + (rnd(i + 17) - 0.5) * 8, 25.5, pz + (rnd(i + 23) - 0.5) * 8);
  }
  return k;
}
