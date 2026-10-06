// The side glass as a mirror. Seen through the front of a full tank, the side panes mirror the inside of the tank: the view ray,
// bent into the water at the front glass, meets the side glass so obliquely that it cannot leave (water to glass to air: past
// the critical angle, cos 0.66, total internal reflection), and the side pane shows the plants, rocks and background again, the
// look every planted tank has at its sides. Only where water stands against the glass: under the water line and above the soil
// line (the substrate lies against the glass under it, and wet soil on glass mirrors nothing).
//
// Screen-space: the reflected ray is followed to where it meets the tank's walls (the back, the other side, the front, the floor,
// the surface), that point is found on the rendered picture and its colour shown, as the water's surface finds the back wall it
// mirrors (render/waterfx.js). One more copy of the rendered picture each frame it is drawn, so it is drawn only on the High and
// Ultra presets (`allowed`, set by the game) and only while the camera looks in through the front glass.

import * as THREE from 'three/webgpu';
import { uniform, float, vec2, vec3, vec4, abs, sign, dot, max, min, step, smoothstep, clamp, normalize, refract, reflect, positionWorld, normalWorld, cameraPosition, cameraViewMatrix, cameraProjectionMatrix, getScreenPosition, viewportSharedTexture } from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from './uniforms.js';
import { FX, tankUV } from './waterfx.js';

const IOR = 1.333, INSET = 0.03;

export class GlassMirror {
  constructor(parent, world) {
    this.world = world;
    this.allowed = () => true;
    const { w, d, h } = TANK;
    const g = new THREE.PlaneGeometry(d, h);
    g.translate(0, h / 2, 0);
    const mat = this.material();
    this.meshes = [-1, 1].map((sx) => {
      const m = new THREE.Mesh(g, mat);
      m.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;   // faces into the tank
      m.position.set(sx * (w / 2 - INSET), 0, 0);
      m.renderOrder = 9.5;                                   // after the water and its spray, before the glass (10)
      m.name = 'glass-mirror';
      parent.add(m);
      return m;
    });
  }

  material() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const P = positionWorld, n = normalWorld, hw = TANK.w / 2, hd = TANK.d / 2;
    const V = normalize(P.sub(cameraPosition));
    const Vw = refract(V, vec3(0, 0, 1), 1 / IOR);              // into the water through the front glass
    const cosI = abs(dot(Vw, n));
    const tir = smoothstep(0.7, 0.6, cosI);                     // fades in just before the critical angle
    // under the water line and above the soil line at this point of the glass
    const ground = FX.terrainH.sample(tankUV(vec2(P.x.mul(0.985), P.z))).r;
    const wet = smoothstep(0.05, -0.15, P.y.sub(U.waterLevel)).mul(smoothstep(ground.add(0.1), ground.add(0.6), P.y));
    // the mirrored ray, to the nearest wall of the tank's water
    const R = reflect(Vw, n);
    const far = float(1e4);
    const tBack = R.z.lessThan(-0.01).select(P.z.sub(-hd + 2.5).div(R.z.negate()), far);
    const tFront = R.z.greaterThan(0.01).select(float(hd).sub(P.z).div(R.z), far);
    const tSide = abs(R.x).greaterThan(0.01).select(float(hw).add(P.x.mul(sign(R.x))).div(abs(R.x)), far);
    const tDown = R.y.lessThan(-0.01).select(P.y.sub(ground).div(R.y.negate()), far);
    const tUp = R.y.greaterThan(0.01).select(U.waterLevel.sub(P.y).div(R.y), far);
    const t = clamp(min(min(min(tBack, tFront), min(tSide, tDown)), tUp), 0.5, 200);
    const Q = P.add(R.mul(t));
    const qv = cameraViewMatrix.mul(vec4(Q, 1)).xyz;
    const quv = getScreenPosition(qv, cameraProjectionMatrix);
    // (soft at the picture's edges: where the mirrored point leaves the picture the mirror fades instead of cutting off)
    const onScreen = smoothstep(0, 0.04, quv.x).mul(smoothstep(1, 0.96, quv.x)).mul(smoothstep(0, 0.04, quv.y)).mul(smoothstep(1, 0.96, quv.y)).mul(step(qv.z, -1));
    const seen = viewportSharedTexture(clamp(quv, vec2(0.002), vec2(0.998))).rgb;
    // a mirror inside water loses a little light to the glass and is seen through the water's tint
    // (`debug` 1: magenta wherever the glass may mirror, 2: magenta wherever the mesh is drawn; for checks)
    const dbg = this.debug = uniform(0);
    m.colorNode = dbg.greaterThan(0.5).select(vec3(1, 0, 1).mul(tir.add(0.2)), seen.mul(vec3(0.86, 0.93, 0.93)));
    m.opacityNode = dbg.greaterThan(1.5).select(float(0.6), tir.mul(wet).mul(onScreen).mul(dbg.greaterThan(0.5).select(float(1), float(0.85))).mul(step(hd, cameraPosition.z)));
    return m;
  }

  update() {
    const W = this.world, cam = W.animals?.camera;
    const on = this.allowed() && W.water.level > 1 && !!cam && cam.position.z > TANK.d / 2;
    for (const m of this.meshes) m.visible = on;
  }

  dispose() {
    for (const m of this.meshes) m.removeFromParent();
    this.meshes[0].geometry.dispose();
    this.meshes[0].material.dispose();
  }
}
