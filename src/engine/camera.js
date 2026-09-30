// The camera: yomotsu's camera-controls (eased orbit, pan and zoom toward the
// pointer, animated moves) framed for whatever tank is loaded.

import * as THREE from 'three/webgpu';
import CameraControls from 'camera-controls';
import { TANK } from '../sim/tank.js';

let installed = false;

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
    c.addEventListener('controlstart', () => { this.moved = true; });
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
    const D = this.fitDistance() + d * 0.5;
    const aspect = this.camera.aspect;
    return {
      front: [0, h * 0.62, D, 0, h * 0.44, 0],
      top: [0, h * 2.7 + w * 0.15, d * 0.3, 0, h * 0.13, 0],
      left: [-w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      right: [w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      close: [-w * 0.09, h * 0.5, w * 0.7, -w * 0.045, h * 0.3, -d * 0.18],
      hero: [-w * 0.3 * Math.min(1.5, D / w) * 0.62 - w * 0.18, h * 0.5, D * 0.86, aspect > 1.2 ? -w * 0.2 : 0, h * 0.42, -d * 0.1],
    };
  }

  // Set limits for the current tank and snap to the front view.
  fit() {
    const { w, d, h } = TANK;
    const c = this.controls;
    c.minDistance = 3;
    c.maxDistance = Math.max(w * 3, this.fitDistance(1.3, 1.3) * 1.5);
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-w * 0.7, -4, -d * 0.8), new THREE.Vector3(w * 0.7, h * 1.25, d * 1.05)));
    this.moved = false;
    this.view('front', false);
  }

  view(id, animate = true) {
    const v = this.views()[id] ?? this.views().front;
    this.controls.setLookAt(...v, animate);
  }

  // A slow orbit for the title screen and time-lapse.
  startOrbit(speed = 0.05) { this.orbit = speed; }
  stopOrbit() { this.orbit = null; }

  // Tell the rig how many pixels of the view the interface covers, so the
  // tank is centred (and sized) in the free area. Called when panels change.
  setInset(l, r, t, b, W, H) {
    this.inset = { l, r, t, b };
    this.size = { w: W, h: H };
    this.free = { w: Math.max(0.72, (W - l - r) / W), h: Math.max(0.72, (H - t - b) / H) };
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
    return this.controls.update(dt);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (!this.moved && TANK.w) this.view('front', false);
  }
}
