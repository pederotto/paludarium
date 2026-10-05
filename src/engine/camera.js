// The camera: yomotsu's camera-controls (eased orbit, pan and zoom toward the
// pointer, animated moves) framed for whatever tank is loaded.

import * as THREE from 'three/webgpu';
import CameraControls from 'camera-controls';
import { TANK } from '../sim/tank.js';
import { roomFrame } from './fittings.js';

let installed = false;
const _ct = new THREE.Vector3(), _cp = new THREE.Vector3(), _cd = new THREE.Vector3();
const _sph = new THREE.Spherical();

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
    this.room = true;     // the room round the tank is drawn (title screen): frame it at a physical scale (Game.setRoom)
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
  fitDistance(wide = 1.16, tall = 1.2, free = this.free) {
    const { w, h } = TANK;
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = Math.max(0.3, this.camera.aspect);
    // Panels cover part of the screen: fit the tank into what is left (but
    // never shrink it below 72% of the full view).
    const fw = free.w, fh = free.h;
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
    // A close look is as close in centimetres in every tank (the standard tank's 63 cm), not a fraction of the tank's width.
    const cw = Math.min(w, 90);
    const v = {
      front: portrait ? [0, ty + D * Math.sin(el), tz + D * Math.cos(el), 0, ty, tz] : [0, h * 0.62, D, 0, h * 0.44, 0],
      top: [0, h * 2.7 + w * 0.15, d * 0.3, 0, h * 0.13, 0],
      left: [-w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      right: [w * 1.65, h * 0.75, d * 0.9, 0, h * 0.37, -d * 0.09],
      close: [-cw * 0.09, Math.min(h * 0.5, 30), cw * 0.7, -cw * 0.045, Math.min(h * 0.3, 18), -Math.min(d * 0.18, 8.1)],
      hero: [-w * 0.3 * Math.min(1.5, D / w) * 0.62 - w * 0.18, h * 0.5, D * 0.86, aspect > 1.2 ? -w * 0.2 : 0, h * 0.42, -d * 0.1],
    };
    if (!this.physical()) return v;
    // The room (title screen): the whole scene from the lamp down to the floor (engine/fittings.js roomFrame), seen a little
    // from above like someone standing in the room, and the three-quarter view from the left a little further back. Both
    // look at the middle of the scene, so the slow orbit of the title screen turns round the tank and keeps it in place;
    // the menu's side of the screen is left out by shifting the picture, not the camera (setInset, ui/layout.js).
    const R = this.roomDistance(), fr = roomFrame(TANK), down = 0.14, a = -0.36, Rh = R * 1.05, hz = -d * 0.1;
    v.front = [0, fr.y + R * down, R, 0, fr.y, 0];
    v.hero = [Rh * Math.sin(a), fr.y + Rh * down, hz + Rh * Math.cos(a), 0, fr.y, hz];
    return v;
  }

  // The framing the camera returns to while the player has not taken it (a new tank, a resize, a panel opening).
  home() { return this.physical() ? 'hero' : 'front'; }

  // The room is framed at a physical scale on a landscape screen; a portrait one shrinks the cabinet to a plinth
  // (Stage.fitScreen) and frames the tank as in play.
  physical() { return this.room && this.camera.aspect >= 0.8; }

  // The room's distance: the frame of engine/fittings.js roomFrame, so a jar stands small on its table and the show tank
  // is the big piece of furniture it is.
  roomDistance() {
    const { w, h, d } = TANK, f = roomFrame(TANK);
    return this.fitDistance(f.w / w, f.h / h, { w: 1, h: 1 }) + d * 0.5;
  }

  // The camera goes where the player puts it, and nowhere else. The game never turns, tilts, pulls in or swings it on its
  // own: earlier versions did all four (a line-of-sight test drew the camera in front of any bank between it and the target,
  // a floor test tilted the orbit up, following swung round to a clear side, compartments clamped the turn) and the player
  // saw the view jump, zoom onto terrain by itself and refuse to turn round the tank. Measured with tools/steps/camjank.mjs.
  // What is left is a floor, not a spring: the lens cannot enter the ground, the background, a rock or root, or the stand
  // under the tank. When the player's own turn, tilt or zoom would take it there, it slides up over the surface (the orbit
  // tilts just as far as needed, current and end together, so there is no dead zone to drag back through); under an overhang
  // where sliding up is no way out, it stops on the line to the target. Things between the lens and what it looks at stay
  // where they are: plants dissolve near the lens and around a followed animal (plantMaterial), rocks and banks are for the
  // player to look round.
  collideWith(worldOf) {
    this.solid = new TankSolid(worldOf);
  }

  // Room for the lens at p.
  roomFor(W, p) {
    const { w, d } = TANK;
    if (Math.abs(p.x) < w / 2 + 6 && Math.abs(p.z) < d / 2 + 5 && p.y < 0.5) return false;   // the tank's bottom and its stand
    return this.solid.roomAt(W, p.x, p.y, p.z);
  }

  hold() {
    if (!this.solid) return;
    const W = this.solid.worldOf();
    if (!W?.terrain || !W.wall) return;
    const c = this.controls, cam = this.camera.position;
    // Zooming toward the pointer slides what the camera looks at along the view ray, which can take it under the ground:
    // ease it back onto the surface (where the orbit is heading, so the glide is the controls' own).
    const te = c.getTarget(_ct, true);
    if (Math.abs(te.x) < TANK.w / 2 && Math.abs(te.z) < TANK.d / 2) {
      const g = W.terrain.heightAt(te.x, te.z) + 0.3;
      if (te.y < g - 0.05) c.moveTo(te.x, g, te.z, true);
    }
    if (this.roomFor(W, cam)) return;
    const t = c.getTarget(_ct, false);
    _sph.setFromVector3(_cd.copy(cam).sub(t));
    const at = (phi) => _cp.setFromSphericalCoords(_sph.radius, phi, _sph.theta).add(t);
    // Slide up: the smallest tilt that frees the lens, up to straight above (steps of 1.4 degrees, then halved down to a few
    // hundredths of one).
    let lo = _sph.phi, hi = null;
    for (let k = 1; k <= 64; k++) {
      const phi = Math.max(0.02, _sph.phi - k * 0.025);
      if (this.roomFor(W, at(phi))) { hi = phi; break; }
      lo = phi;
      if (phi === 0.02) break;
    }
    if (hi != null) {
      for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (this.roomFor(W, at(m))) hi = m; else lo = m; }
      // Only the tilt, current and (if it is lower) where the drag is heading: rotatePolarTo would also snap the turn to
      // where the drag is heading, a jump sideways that can land the lens in the ground again.
      c._spherical.phi = hi;
      if (c._sphericalEnd.phi > hi) c._sphericalEnd.phi = hi;
      cam.copy(at(hi));
      this.camera.lookAt(t);
      return;
    }
    // Under an overhang: stop on the line to the target, in front of the surface (drawn only; the orbit is kept).
    const len = _sph.radius;
    _cd.divideScalar(len || 1);
    for (let s = len; s > 0.5; s -= 0.25) {
      _cp.copy(t).addScaledVector(_cd, s);
      if (this.roomFor(W, _cp)) { cam.copy(_cp); return; }
    }
    // Nothing on that line either (the target itself is in the ground for a moment): straight up out of the ground.
    if (Math.abs(cam.x) < TANK.w / 2 && Math.abs(cam.z) < TANK.d / 2) cam.y = Math.max(cam.y, W.terrain.heightAt(cam.x, cam.z) + 0.8);
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
    this.moved = false;
    if (this.zone && !this.orbit) { this.setZone(this.zone, false); return; }
    this.freeLimits();
    this.view(this.home(), false);
  }

  // The free camera of the title screen, the time-lapse and the kids' tanks: out into the room.
  freeLimits() {
    const { w, d, h } = TANK, c = this.controls;
    c.minPolarAngle = 0; c.maxPolarAngle = Math.PI * 0.64;
    c.minDistance = 3;
    // Far enough for the room's framing too, and the look-at point may sit off a small tank's side (roomViews' hero).
    const room = this.physical(), fr = room ? roomFrame(TANK) : null;
    c.maxDistance = Math.max(w * 3, this.fitDistance(1.3, 1.3) * 1.5, room ? this.roomDistance() * 1.6 : 0);
    const bx = w * 0.7, by = room ? Math.min(-4, fr.y - 10) : -4;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-bx, by, -d * 0.8), new THREE.Vector3(bx, h * 1.25, d * 1.05)));
  }

  // The player's camera: all the way round the tank, from straight above down to a little below level, from 3 cm to far
  // enough to see the whole tank from any side; what it looks at stays inside the tank.
  playLimits() {
    const { w, d, h } = TANK, c = this.controls;
    c.minPolarAngle = 0; c.maxPolarAngle = Math.PI * 0.56;
    c.minDistance = 3;
    c.maxDistance = this.fitDistance(1.3, 1.3) * 1.35 + d * 0.5;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-w * 0.48, 0.5, -d * 0.48), new THREE.Vector3(w * 0.48, h * 0.98, d * 0.48)));
  }

  // Framings of the tank the Camera menu offers (a starting point: the camera turns freely from each):
  //   tank    the whole tank, close enough that it fills the view
  //   bottom  level with the substrate and the water, where the soil layers show at the glass
  //   back    the background and what grows and climbs on it
  //   top     looking down into the tank
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
    return {
      tank: { at: [0, h * 0.45, 0], el: portrait ? 0.8 : 0.2, D: tankD },
      bottom: { at: bottom, el: 0.07, D: outside(bottom, 0.07, (h * 0.22) / tv / fh) },
      back: { at: back, el: 0.2, D: outside(back, 0.2, (h * 0.3) / tv / fh) },
      top: { at: [0, h * 0.2, 0], el: 1.3, D: topD },   // the lid and the lamp hide themselves (Stage.setOverhead)
    };
  }

  setZone(id, animate = true) {
    const all = this.zones(), z = all[id] ?? all.tank;
    this.zone = all[id] ? id : 'tank';
    this.orbit = null;
    const c = this.controls;
    c.normalizeRotations();
    this.playLimits();
    const [x, y, zz] = z.at;
    c.setLookAt(x, y + z.D * Math.sin(z.el), zz + z.D * Math.cos(z.el), x, y, zz, animate);
  }

  // Is the unit vector `dir` (from the target toward the camera) inside the tilt range?
  allows(dir) {
    const c = this.controls, polar = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
    return polar >= c.minPolarAngle - 1e-3 && polar <= c.maxPolarAngle + 1e-3;
  }

  view(id, animate = true) {
    if (this.zone && !this.orbit && (id === 'front' || this.zones()[id])) { this.setZone(id === 'front' ? this.zone : id, animate); return; }
    const v = this.views()[id] ?? this.views().front;
    this.controls.setLookAt(...v, animate);
  }

  // A slow orbit for the title screen and time-lapse: the free camera. Stopping it returns to the player's limits, if playing.
  startOrbit(speed = 0.05) { this.orbit = speed; this.freeLimits(); }
  stopOrbit() {
    if (this.orbit == null) return;
    this.orbit = null;
    if (this.zone) { this.controls.normalizeRotations(); this.playLimits(); }
  }

  // Leave play (back to the title screen).
  freeZone() { this.zone = null; this.freeLimits(); }

  // Tell the rig how many pixels of the view the interface covers, so the
  // tank is centred (and sized) in the free area. Called when panels change.
  setInset(l, r, t, b, W, H) {
    this.inset = { l, r, t, b };
    this.size = { w: W, h: H };
    // On a portrait phone the width is the limit and the thin right-hand rail may overlap the tank: do not shrink for it.
    const fw = W / H < 0.8 ? Math.max(0.94, (W - l - r * 0.3) / W) : Math.max(0.72, (W - l - r) / W);
    this.free = { w: fw, h: Math.max(0.72, (H - t - b) / H) };
    if (!this.moved && TANK.w) this.view(this.home(), true);
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
    this.hold();
    return changed;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (!this.moved && TANK.w) this.view(this.home(), false);
  }
}
