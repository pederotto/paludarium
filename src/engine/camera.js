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
  }

  // Named camera positions [px, py, pz, tx, ty, tz] scaled to the tank.
  views() {
    const { w, d, h } = TANK;
    const big = Math.max(w, h * 1.4);
    const dist = big * 1.6;                  // roughly frames the tank at 36° vertical FOV
    return {
      front: [0, h * 0.66, dist * 0.95 + d * 0.4, 0, h * 0.42, -d * 0.04],
      top: [0, h * 2.7 + w * 0.15, d * 0.3, 0, h * 0.13, 0],
      left: [-w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      right: [w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      close: [-w * 0.09, h * 0.5, w * 0.7, -w * 0.045, h * 0.3, -d * 0.18],
      hero: [-w * 0.42, h * 0.5, w * 0.95, w * 0.05, h * 0.36, -d * 0.1],
    };
  }

  // Set limits for the current tank and snap to the front view.
  fit() {
    const { w, d, h } = TANK;
    const c = this.controls;
    c.minDistance = Math.max(5, w * 0.09);
    c.maxDistance = w * 3;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-w * 0.7, -4, -d * 0.8), new THREE.Vector3(w * 0.7, h * 1.25, d * 1.05)));
    this.view('front', false);
  }

  view(id, animate = true) {
    const v = this.views()[id] ?? this.views().front;
    this.controls.setLookAt(...v, animate);
  }

  // A slow orbit for the title screen and time-lapse.
  startOrbit(speed = 0.05) { this.orbit = speed; }
  stopOrbit() { this.orbit = null; }

  update(dt) {
    if (this.orbit) this.controls.rotate(this.orbit * dt, 0, false);
    return this.controls.update(dt);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
