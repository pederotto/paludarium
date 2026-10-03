// The camera: yomotsu's camera-controls (eased orbit, pan and zoom toward the
// pointer, animated moves) framed for whatever tank is loaded.

import * as THREE from 'three/webgpu';
import CameraControls from 'camera-controls';
import { TANK } from '../sim/tank.js';

let installed = false;
const _ct = new THREE.Vector3(), _cp = new THREE.Vector3(), _cd = new THREE.Vector3();
const _et = new THREE.Vector3(), _ep = new THREE.Vector3(), _eq = new THREE.Vector3(), _ed = new THREE.Vector3(), _sph = new THREE.Spherical();

// What the camera may not pass through: the ground (hardscape stamped in), the background relief and the unstamped pieces
// (roots, wood: the animals' occupancy grid). Its raycast marches the height fields, which costs far less than testing the
// triangles of the terrain and rock meshes. Only a crossing from free space into solid counts, so a target that sits right on
// a surface (a frog on the moss, a double-click on a rock) does not pin the camera to it.
class TankSolid extends THREE.Object3D {
  constructor(worldOf) { super(); this.worldOf = worldOf; }
  solidAt(W, x, y, z) {
    const hx = TANK.w / 2, hz = TANK.d / 2;
    if (x < -hx || x > hx || z < -hz || z > hz || y > TANK.h) return false;       // outside the glass is open air
    if (y < W.terrain.heightAt(x, z) - 0.2) return true;
    if (z < W.wall.zAt(x, y) - 0.2) return true;
    return !!W.animals?.occ?.solidAt(x, y, z);
  }
  raycast(raycaster, hits) {
    const W = this.worldOf();
    if (!W?.terrain || !W.wall) return;
    const { origin: o, direction: d } = raycaster.ray, far = Math.min(raycaster.far, 400);
    const at = (t) => this.solidAt(W, o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    let free = false, prev = 0;
    for (let t = 0; t < far; t += 0.35 + t * 0.012) {
      const solid = at(t);
      if (!solid) { free = true; prev = t; continue; }
      if (!free) continue;
      // Narrow the crossing down between the last free sample and this one, so the distance glides as the ray sweeps over
      // a surface instead of stepping by the march's stride (which made the drawn-in camera jump while following).
      let a = prev, b = t;
      for (let i = 0; i < 7; i++) { const m = (a + b) / 2; if (at(m)) b = m; else a = m; }
      hits.push({ distance: Math.max(0, a - 0.6), point: new THREE.Vector3(o.x + d.x * a, o.y + d.y * a, o.z + d.z * a), object: this });
      return;
    }
  }

  // Room for the lens at a point: above the ground by `m`, in front of the background, not in a piece.
  roomAt(W, x, y, z, m = 0.7) {
    const hx = TANK.w / 2, hz = TANK.d / 2;
    if (x < -hx || x > hx || z < -hz || z > hz || y > TANK.h) return true;
    return y > W.terrain.heightAt(x, z) + m && z > W.wall.zAt(x, y) + m && !W.animals?.occ?.solidAt(x, y, z);
  }
}

export class CameraRig {
  constructor(renderer, aspect) {
    if (!installed) {
      CameraControls.install({ THREE: { Vector2: THREE.Vector2, Vector3: THREE.Vector3, Vector4: THREE.Vector4, Quaternion: THREE.Quaternion, Matrix4: THREE.Matrix4, Spherical: THREE.Spherical, Box3: THREE.Box3, Sphere: THREE.Sphere, Raycaster: THREE.Raycaster } });
      installed = true;
    }
    this.camera = new THREE.PerspectiveCamera(36, aspect, 1, 1500);
    this.controls = new CameraControls(this.camera, renderer.domElement);
    const c = this.controls;
    c.smoothTime = 0.2;
    c.draggingSmoothTime = 0.06;
    c.dollyToCursor = true;
    c.dollySpeed = 0.6;
    c.truckSpeed = 1.6;
    c.maxPolarAngle = Math.PI * 0.64;
    this.orbit = null;
    this.inset = { l: 0, r: 0, t: 0, b: 0 };     // pixels covered by panels
    this.shift = { x: 0, y: 0 };                  // smoothed view offset (pixels)
    this.free = { w: 1, h: 1 };                   // fraction of the view left free
    this.size = { w: 1, h: 1 };
    this.moved = false;   // the player has taken the camera: don't re-frame on resize
    c.addEventListener('controlstart', () => { this.moved = true; this.handling = true; });
    c.addEventListener('controlend', () => { this.handling = false; this.handledAt = performance.now(); });
    // The wheel is ours (camera-controls' own wheel is switched off in the editor's setButtons, see wheel()).
    this.dom = renderer.domElement;
    this.dom.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  // Wheel, two-finger trackpad scroll and trackpad pinch all dolly toward the pointer, by the size of each event.
  // camera-controls' own wheel handling does two things wrong on a Mac: a pinch (a wheel event with ctrlKey) becomes a lens
  // zoom (the field of view narrows, the camera never moves), and every event of a two-finger swipe and its momentum tail gets
  // nearly a mouse notch's step, so one swipe flies the camera 3.7x closer. Here a pinch that spreads the fingers to twice
  // their span (about -70 of deltaY) brings the camera about twice as close, a 400-pixel swipe about 1.8x, a mouse notch
  // (100) about 1.16x.
  wheel(e) {
    if (!this.wheelOn) return;
    e.preventDefault();
    const c = this.controls;
    const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);
    const lnScale = THREE.MathUtils.clamp(px, -120, 120) * (e.ctrlKey ? 0.0096 : 0.0015);
    if (!lnScale) return;
    // camera-controls scales the distance by 0.95^(-delta * dollySpeed): pick the delta that scales it by e^lnScale.
    const delta = lnScale / (-Math.log(0.95) * c.dollySpeed);
    const r = this.dom.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1;
    c._dollyInternal(delta, c.dollyToCursor ? x : 0, c.dollyToCursor ? y : 0);
    c.dispatchEvent({ type: 'control' });
    this.moved = true;
    this.handledAt = performance.now();
  }

  // Distance that frames the tank: the vertical field of view fits its
  // height, the horizontal one (which depends on the aspect ratio, so a phone
  // in portrait gets a different answer than a 16:9 monitor) fits its width.
  fitDistance(wide = 1.16, tall = 1.2) {
    const { w, h } = TANK;
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = Math.max(0.3, this.camera.aspect);
    // Panels cover part of the screen: fit the tank into what is left (but
    // never shrink it below 72% of the full view).
    const fw = this.free.w, fh = this.free.h;
    const dv = ((h * tall) / 2 / tv) / fh;
    const dh = ((w * wide) / 2 / (tv * aspect)) / fw;
    return Math.max(dv, dh);
  }

  // Named camera positions [px, py, pz, tx, ty, tz] scaled to the tank.
  views() {
    const { w, d, h } = TANK;
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.8;
    // A portrait screen is tall and narrow: the width is what limits the size, so the front glass is fitted to nearly the full
    // width (the little rail on the right floats over the tank's edge) and the view is tilted down into the tank, which uses
    // the spare height to show the floor and the ponds.
    const D = this.fitDistance(portrait ? 1.22 : 1.16) + d * 0.5;
    const el = THREE.MathUtils.degToRad(46), ty = h * 0.34, tz = d * 0.05;
    return {
      front: portrait ? [0, ty + D * Math.sin(el), tz + D * Math.cos(el), 0, ty, tz] : [0, h * 0.62, D, 0, h * 0.44, 0],
      top: [0, h * 2.7 + w * 0.15, d * 0.3, 0, h * 0.13, 0],
      left: [-w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      right: [w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      close: [-w * 0.09, h * 0.5, w * 0.7, -w * 0.045, h * 0.3, -d * 0.18],
      hero: [-w * 0.3 * Math.min(1.5, D / w) * 0.62 - w * 0.18, h * 0.5, D * 0.86, aspect > 1.2 ? -w * 0.2 : 0, h * 0.42, -d * 0.1],
    };
  }

  // Keep the camera out of the ground, the background and the hardscape of this world (see TankSolid and clip). Not
  // camera-controls' own colliderMeshes: those refuse to dolly out while the camera touches a surface, so a camera pushed
  // against a bank could not be zoomed back out.
  collideWith(worldOf) {
    this.solid = new TankSolid(worldOf);
    this.clipD = null;
  }

  // After the controls have placed the camera: if a solid surface lies between the target and the camera, draw the camera in
  // front of it, on the same line (the orbit itself is untouched, so it eases back out when the view clears or the player
  // zooms out). Comes in fast, goes back out slowly.
  //
  // floor() runs first, because the line test cannot fix two things: zooming toward the pointer slides the target along the
  // view ray, which can carry it into the ground or the background, and orbiting low (down to 115 degrees from straight
  // down) can put the whole line below the ground with the target on it. (Before: 5 of 12 wheel zooms toward the floor and
  // every low orbit ended under it.)
  clip(dt) {
    if (!this.solid) return;
    const W = this.solid.worldOf();
    if (!W?.terrain || !W.wall) return;
    this.floor(W);
    // The line from where the target is now to where the camera is now (not to where they are heading: during a glide the
    // camera used to be drawn onto the end line, a jump of several cm).
    const c = this.controls, t = c.getTarget(_ct, false), p = c.getPosition(_cp, false);
    const dir = _cd.copy(p).sub(t), len = dir.length();
    if (len < 1e-3) return;
    dir.divideScalar(len);
    const free = Math.max(1.5, this.clearance(t, dir, len + 1) - 0.6);
    const want = Math.min(len, free);
    // In fast (a third of the way per frame at 60 fps: the wood and roots are a grid of 1 cm cells, and snapping onto each
    // cell edge jerked the camera while following a gecko up a branch), out slowly.
    this.clipD = this.clipD == null ? want : this.clipD + (want - this.clipD) * Math.min(1, dt * (want < this.clipD ? 24 : 5));
    if (this.clipD < len - 0.01) this.camera.position.copy(t).addScaledVector(dir, this.clipD);
  }

  // Where the orbit is heading (its end values) must leave room for the lens: the target is lifted out of the ground or the
  // background, the orbit is tilted up until the camera is above the ground with a clear line to the target. Both with a
  // transition, so the camera glides along the floor instead of jumping.
  floor(W) {
    const c = this.controls, t = c.getTarget(_et, true);
    if (Math.abs(t.x) < TANK.w / 2 && Math.abs(t.z) < TANK.d / 2) {
      const g = W.terrain.heightAt(t.x, t.z) + 0.3, wz = W.wall.zAt(t.x, Math.max(t.y, g)) + 0.3;
      if (t.y < g - 0.01 || t.z < wz - 0.01) { c.moveTo(t.x, Math.max(t.y, g), Math.max(t.z, wz), true); t.set(t.x, Math.max(t.y, g), Math.max(t.z, wz)); }
    }
    const p = c.getPosition(_ep, true), dir = p.sub(t), len = dir.length();
    if (len < 1e-3) return;
    dir.divideScalar(len);
    const q = _eq, ok = (d) => { q.copy(t).addScaledVector(d, len); return this.solid.roomAt(W, q.x, q.y, q.z) && this.clearance(t, d, len) >= Math.min(len, 2.5); };
    if (ok(dir)) return;
    _sph.setFromVector3(dir);
    const d = _ed;
    for (let k = 1; k <= 30; k++) {
      const phi = _sph.phi - k * 0.035;
      if (phi < 0.05) return;
      d.setFromSphericalCoords(1, phi, _sph.theta);
      if (ok(d)) { c.rotatePolarTo(phi, true); return; }
    }
  }

  // How far one can see from `from` along the unit vector `dir` before a solid surface, up to `max`.
  clearance(from, dir, max) {
    if (!this.solid) return max;
    const hits = [];
    this.solid.raycast({ ray: { origin: from, direction: dir }, far: max }, hits);
    return hits.length ? hits[0].distance : max;
  }

  // Set limits for the current tank and snap to the front view.
  fit() {
    const c = this.controls;
    this.moved = false;
    if (this.zone && !this.orbit) { this.setZone(this.zone, false); return; }
    this.freeLimits();
    c.minDistance = 3;
    this.view('front', false);
  }

  // The free camera of the title screen, the time-lapse and the kids' tanks: all the way round, out into the room.
  freeLimits() {
    const { w, d, h } = TANK, c = this.controls;
    c.minAzimuthAngle = -Infinity; c.maxAzimuthAngle = Infinity;
    c.minPolarAngle = 0; c.maxPolarAngle = Math.PI * 0.64;
    c.maxDistance = Math.max(w * 3, this.fitDistance(1.3, 1.3) * 1.5);
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-w * 0.7, -4, -d * 0.8), new THREE.Vector3(w * 0.7, h * 1.25, d * 1.05)));
  }

  // The player's camera works in compartments: each is a framing with its own range of turn, tilt and zoom, all of them in
  // front of the tank. Turning the camera round the whole tank took it behind the background, where the line test drew it
  // back inside the tank: the view jumped into fog and leaves and out again, and the room around was empty and dark.
  //   tank    the whole tank, close enough that it fills the view (no room); turn about 35 degrees either way
  //   bottom  level with the substrate and the water, where the soil layers show at the glass
  //   back    the background and what grows and climbs on it
  //   top     looking down into the tank
  // The target may go anywhere inside the tank (zoom toward the pointer, follow an animal), never outside it.
  zones() {
    const { w, d, h } = TANK;
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), fh = this.free.h;
    const aspect = Math.max(0.3, this.camera.aspect), portrait = aspect < 0.8;
    const W = this.solid?.worldOf?.();
    const outside = (at, el, D) => Math.max(D, (d / 2 + 3 - at[2]) / Math.cos(el));   // the lens stays in front of the glass
    const tankD = this.fitDistance(portrait ? 1.12 : 1.03, 1.06) + d * 0.5;
    const yb = h * 0.17, bottom = [0, yb, d * 0.15];
    const yk = h * 0.6, back = [0, yk, (W?.wall ? W.wall.zAt(0, yk) : -d * 0.3) + 3];
    const topD = Math.max((w * 1.06) / 2 / (tv * aspect * this.free.w), (d * 1.1) / 2 / tv / fh) + h * 0.9;
    const z = {
      tank: { at: [0, h * 0.45, 0], el: portrait ? 0.8 : 0.2, D: tankD, az: 0.62, polar: [0.2, 0.55], far: 1.06 },
      bottom: { at: bottom, el: 0.07, D: outside(bottom, 0.07, (h * 0.22) / tv / fh), az: 0.42, polar: [0.4, 0.56], far: 1.6 },
      back: { at: back, el: 0.2, D: outside(back, 0.2, (h * 0.3) / tv / fh), az: 0.5, polar: [0.3, 0.52], far: 1.3 },
      top: { at: [0, h * 0.2, 0], el: 1.3, D: topD, az: 0.62, polar: [0.02, 0.32], far: 1.1 },   // the lid and the lamp hide themselves (Stage.setOverhead)
    };
    return z;
  }

  setZone(id, animate = true) {
    const all = this.zones(), z = all[id] ?? all.tank;
    this.zone = all[id] ? id : 'tank';
    this.orbit = null;
    const c = this.controls;
    c.normalizeRotations();
    this.zoneLimits(z);
    const [x, y, zz] = z.at;
    c.setLookAt(x, y + z.D * Math.sin(z.el), zz + z.D * Math.cos(z.el), x, y, zz, animate);
  }

  zoneLimits(z) {
    const { w, d, h } = TANK, c = this.controls;
    c.minAzimuthAngle = -z.az; c.maxAzimuthAngle = z.az;
    c.minPolarAngle = Math.PI * z.polar[0]; c.maxPolarAngle = Math.PI * z.polar[1];
    c.minDistance = 3; c.maxDistance = z.D * z.far;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-w * 0.48, 0.5, -d * 0.48), new THREE.Vector3(w * 0.48, h * 0.98, d * 0.48)));
  }

  // Is the unit vector `dir` (from the target toward the camera) inside the current turn and tilt range?
  allows(dir) {
    const c = this.controls, az = Math.atan2(dir.x, dir.z), polar = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
    return az >= c.minAzimuthAngle - 1e-3 && az <= c.maxAzimuthAngle + 1e-3 && polar >= c.minPolarAngle - 1e-3 && polar <= c.maxPolarAngle + 1e-3;
  }

  view(id, animate = true) {
    if (this.zone && !this.orbit && (id === 'front' || this.zones()[id])) { this.setZone(id === 'front' ? this.zone : id, animate); return; }
    const v = this.views()[id] ?? this.views().front;
    this.controls.setLookAt(...v, animate);
  }

  // A slow orbit for the title screen and time-lapse: the free camera. Stopping it returns to the compartment, if any.
  startOrbit(speed = 0.05) { this.orbit = speed; this.freeLimits(); }
  stopOrbit() {
    if (this.orbit == null) return;
    this.orbit = null;
    if (this.zone) { this.controls.normalizeRotations(); this.zoneLimits(this.zones()[this.zone]); }
  }

  // Leave the compartments (back to the title screen).
  freeZone() { this.zone = null; this.freeLimits(); }

  // Tell the rig how many pixels of the view the interface covers, so the
  // tank is centred (and sized) in the free area. Called when panels change.
  setInset(l, r, t, b, W, H) {
    this.inset = { l, r, t, b };
    this.size = { w: W, h: H };
    // On a portrait phone the width is the limit and the thin right-hand rail may overlap the tank: do not shrink for it.
    const fw = W / H < 0.8 ? Math.max(0.94, (W - l - r * 0.3) / W) : Math.max(0.72, (W - l - r) / W);
    this.free = { w: fw, h: Math.max(0.72, (H - t - b) / H) };
    if (!this.moved && TANK.w) this.view('front', true);
  }

  update(dt) {
    if (this.orbit) this.controls.rotate(this.orbit * dt, 0, false);
    // Ease the projection centre toward the middle of the free area.
    const { l, r, t, b } = this.inset, { w, h } = this.size;
    const tx = (l - r) / 2, ty = (t - b) / 2;
    const k = 1 - Math.exp(-dt * 7);
    this.shift.x += (tx - this.shift.x) * k;
    this.shift.y += (ty - this.shift.y) * k;
    if (Math.abs(this.shift.x - (this._sx ?? 1e9)) > 0.4 || Math.abs(this.shift.y - (this._sy ?? 1e9)) > 0.4 || this._sw !== w) {
      this._sx = this.shift.x; this._sy = this.shift.y; this._sw = w;
      if (Math.abs(this.shift.x) < 0.4 && Math.abs(this.shift.y) < 0.4) this.camera.clearViewOffset();
      else this.camera.setViewOffset(w, h, -this.shift.x, -this.shift.y, w, h);
    }
    const changed = this.controls.update(dt);
    this.clip(dt);
    return changed;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (!this.moved && TANK.w) this.view('front', false);
  }
}
