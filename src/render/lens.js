// Lens overlays: the climate maps (sim/climate.js) painted over the substrate
// and the background wall, so you can see where the air is damp, where the
// lamp warms, where the ferns shade the floor, how wet the soil is and where
// water is moving. They are how a keeper learns to read microclimates.
//
// The overlay shares the terrain's and wall's geometry (lifted a hair) and
// samples a small texture by world position; palettes are three-stop gradients.

import * as THREE from 'three/webgpu';
import { texture, float, vec2, vec3, vec4, mix, smoothstep, positionWorld, positionLocal, normalLocal, uniform } from 'three/tsl';
import { TANK } from '../sim/tank.js';

export const LENS_INFO = {
  humidity: { name: 'Humidity', unit: '%', lo: 45, hi: 100, stops: ['#8a6a32', '#4aa08a', '#2a6ee0'], blurb: 'Waterfalls, pools, moss and plants raise it; a fan and the lamp lower it.' },
  temperature: { name: 'Temperature', unit: '°C', lo: 18, hi: 30, stops: ['#3868e0', '#e6d24a', '#e0402a'], blurb: 'The lamp warms the top; a basking lamp makes a hot spot; water cools its surroundings.' },
  light: { name: 'Light', unit: '', lo: 0, hi: 1.1, stops: ['#0a0c18', '#5a6ab0', '#ffe28a'], blurb: 'The LED, less what leaves and floating plants shade.' },
  soil: { name: 'Soil moisture', unit: '%', lo: 0, hi: 100, stops: ['#8a6a3a', '#6a9a6a', '#2a6ad0'], blurb: 'Wetted by rain, mist, spray and nearby water; dried by drainage, heat and airflow.' },
  flow: { name: 'Water flow', unit: '', lo: 0, hi: 1, stops: ['#10202e', '#3a8ac0', '#e8f6ff'], blurb: 'Where water is moving over the ground.' },
};

export class Lens {
  constructor(scene, world) {
    this.world = world;
    this.name = 'off';
    const C = world.climate;
    this.nx = C.nx; this.nz = C.nz;
    this.data = new Uint8Array(this.nx * this.nz * 4);
    this.tex = new THREE.DataTexture(this.data, this.nx, this.nz, THREE.RGBAFormat);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    this.stops = [uniform(new THREE.Color()), uniform(new THREE.Color()), uniform(new THREE.Color())];
    this.alpha = uniform(0.62);
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const build = (geometry, wall) => {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const uvw = wall ? vec2(positionWorld.x.div(TANK.w).add(0.5), positionWorld.y.div(TANK.h)) : vec2(positionWorld.x.div(TANK.w).add(0.5), positionWorld.z.div(TANK.d).add(0.5));
      const v = texture(this.tex, uvw).r;
      const col = mix(mix(this.stops[0], this.stops[1], smoothstep(0.0, 0.5, v)), this.stops[2], smoothstep(0.5, 1.0, v));
      m.colorNode = col;
      m.opacityNode = this.alpha;
      m.positionNode = positionLocal.add(normalLocal.mul(wall ? 0.05 : 0.07));
      const mesh = new THREE.Mesh(geometry, m);
      mesh.renderOrder = 6; mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.terrainMesh = build(world.terrain.geo, false);
    this.wallMesh = build(world.wall.geo, true);
    this.t = 0;
  }

  set(name) {
    this.name = name;
    this.group.visible = name !== 'off';
    const info = LENS_INFO[name];
    if (info) info.stops.forEach((c, i) => this.stops[i].value.set(c));
    this.wallMesh.visible = name !== 'flow';
    this.t = 1e9;
  }

  update(dt) {
    if (this.name === 'off') return;
    this.t += dt;
    if (this.t < 0.4) return;
    this.t = 0;
    const W = this.world, C = W.climate, info = LENS_INFO[this.name];
    const r = info.hi - info.lo;
    let src = null, scale = 1;
    if (this.name === 'humidity') src = C.hum;
    else if (this.name === 'temperature') src = C.temp;
    else if (this.name === 'light') src = C.light;
    else if (this.name === 'soil') { src = C.soil; scale = 100; }
    const d = this.data;
    if (src) {
      for (let i = 0; i < this.nx * this.nz; i++) {
        const v = Math.max(0, Math.min(1, (src[i] * scale - info.lo) / r));
        d[i * 4] = v * 255; d[i * 4 + 3] = 255;
      }
    } else {
      // Flow: speed of the shallow water on the substrate grid, resampled to the coarse grid.
      const H = W.water.hydro, f = H.f;
      d.fill(0);
      for (let n = 0; n < H.N; n++) {
        if (H.res[n] || H.d[n] < 0.05) continue;
        const [x, z] = H.cellXZ(n);
        const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x + TANK.w / 2) / C.cs))), j = Math.max(0, Math.min(this.nz - 1, Math.floor((z + TANK.d / 2) / C.cs)));
        const sp = Math.min(1, Math.hypot(H.vx[n], H.vz[n]) / 30 + 0.2);
        const q = (j * this.nx + i) * 4;
        d[q] = Math.max(d[q], sp * 255); d[q + 3] = 255;
      }
      void f;
    }
    this.tex.needsUpdate = true;
  }

  dispose() { this.tex.dispose(); this.group.removeFromParent(); }
}
