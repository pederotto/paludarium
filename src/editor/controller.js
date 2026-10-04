// Turns pointer and keyboard input on the canvas into edits of the tank:
// sculpting, painting, placing hardscape, waterworks, plants, animals and
// equipment, plus inspecting and removing. It owns the 3D helpers (brush ring,
// selection marker, path line, move/turn/scale handles). The panels in the UI
// only choose the tool and its options (signals in ui/store.js).

import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import CameraControls from 'camera-controls';
import { TOOLS, WATER_TOOLS, BATCH } from './defs.js';
import { S, toast, hint, morphChoice } from '../ui/store.js';
import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';
import { PIECES } from '../sim/decor.js';
import { hasGenetics } from '../sim/genetics.js';
import { morphName } from '../content/morphs.js';
import { TANK } from '../sim/tank.js';
import { clamp } from '../util/math.js';
import { U } from '../render/uniforms.js';
import { nextLayer } from '../render/layers.js';
import { kitById, kitCounts, kitReach } from '../content/kits.js';
import { buildKit, kitReady, kitScale, kitSeed, mirrorSpec, placeSpec } from '../sim/kits.js';
import { SmartPlacer } from './smart.js';
import { EXPLORER_HINTS, freeSpot } from '../app/modes.js';

const UP = new THREE.Vector3(0, 1, 0);
const BRUSH_TOOLS = ['sculpt', 'paint'];
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class ToolController {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.camera = game.camera;
    this.controls = game.controls;
    this.dom = game.renderer.domElement;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.down = false;
    this.keys = new Set();
    this.path = null;
    this.flatTarget = null;
    this.strokeChanged = false;

    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }));
    this.cursor.renderOrder = 20; this.cursor.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicNodeMaterial({ color: 0xffd34d, depthTest: false, side: THREE.DoubleSide }));
    this.marker.renderOrder = 21; this.marker.visible = false;
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: 0xffe08a, depthTest: false }));
    this.pathLine.renderOrder = 22; this.pathLine.frustumCulled = false; this.pathLine.visible = false;
    // The mirror image of the brush ring and of the path being drawn (symmetry on).
    this.cursor2 = new THREE.Mesh(this.cursor.geometry, this.cursor.material);
    this.cursor2.renderOrder = 20; this.cursor2.visible = false;
    this.pathLine2 = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: 0xffe08a, depthTest: false, transparent: true, opacity: 0.6 }));
    this.pathLine2.renderOrder = 22; this.pathLine2.frustumCulled = false; this.pathLine2.visible = false;
    this.scene.add(this.cursor, this.cursor2, this.marker, this.pathLine, this.pathLine2);

    // Handles for moving, turning and scaling hardscape.
    this.tc = new TransformControls(this.camera, this.dom);
    this.tc.setSize(0.85);
    this.tcHelper = this.tc.getHelper();
    this.scene.add(this.tcHelper);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) this.pushUndo();
      else this.pieceMoved(true);
    });
    this.tc.addEventListener('objectChange', () => this.pieceMoved(false));
    this.box = new THREE.BoxHelper(new THREE.Object3D(), 0xffd34d);
    this.box.visible = false;
    this.scene.add(this.box);

    this.bindPointer();
    this.bindKeys();
    this.smart = new SmartPlacer(this);     // one-tap placement for Explorer (tools/smart.js)
    this.setTool('view');
    game.frameHooks.push((dt) => this.frame(dt));
    game.events.on('tank', () => this.onTank());
  }

  get W() { return this.game.world; }
  get tool() { return S.tool.value; }
  get sub() { return S.sub.value; }
  get brush() { return S.brush.value; }
  get mirror() { return S.mirror.value; }

  // --- Symmetry ------------------------------------------------------------------
  // With Mirror on, every edit is repeated across the tank's centre plane (x -> -x; the
  // tank sits on the origin). `gap` is how close to the plane an edit may be before its
  // mirror image would land on top of it, so we skip the copy.
  mirrored(x, gap = 0.6) { return this.mirror && Math.abs(x) > gap; }
  usedMirror() { this.game.career?.stat('mirrorUsed'); }
  toggleMirror(v = !S.mirror.value) {
    S.mirror.value = v;
    if (!v) { this.cursor2.visible = false; this.pathLine2.visible = false; }
    toast(v ? 'Mirror on: what you build is copied across the middle of the tank.' : 'Mirror off.');
  }

  onTank() {
    this.selectPiece(null);
    this.smart?.reset();
    S.selection.value = null;
    S.undoDepth.value = 0;
    this.setTool(this.tool);
  }

  // --- Tool selection ------------------------------------------------------
  setTool(id) {
    if (!TOOLS.find((t) => t.id === id)) id = 'view';
    S.tool.value = id;
    this.smart?.cancel();
    if (this.smart) { this.smart.last = null; S.smartBar.value = null; }
    this.setButtons();
    if (id !== 'rock') this.selectPiece(null);
    if (id !== 'rock' && S.sub.value.kit) S.sub.value = { ...S.sub.value, kit: null };
    const W = this.W;
    if (id !== 'water') W?.water.hideTrace();
    hint(this.smart?.on && EXPLORER_HINTS[id] ? EXPLORER_HINTS[id] : TOOLS.find((t) => t.id === id).hint);
    this.cursor.visible = false;
    if (W) {
      W.water.showMarkers(id === 'water' || id === 'erase', id === 'water');
    }
  }

  setSub(key, val, h) {
    const next = { ...S.sub.value, [key]: val };
    if (key === 'rock') next.kit = null;     // picking a single piece puts the kit away
    S.sub.value = next;
    if (h) hint(h);
  }

  // Arms a kit (Hardscape tool): the next click on the tank drops the whole composition.
  setKit(id) {
    const kit = id ? kitById(id) : null;
    if (kit) { this.setTool('rock'); this.selectPiece(null); }
    S.sub.value = { ...S.sub.value, kit: kit?.id ?? null };
    if (kit) hint(`${kit.name}: click the tank to place it. Each placement varies a little. Esc puts it away.`);
    else if (this.tool === 'rock') hint(TOOLS.find((t) => t.id === 'rock').hint);
  }

  // Look: left orbits, right pans. Editing tools: left edits, right orbits,
  // middle (or Shift + right) pans. The wheel always zooms toward the pointer.
  setButtons() {
    const A = CameraControls.ACTION, c = this.controls;
    const editing = !['view', 'inspect'].includes(this.tool);
    const pan = this.keys.has('shift');
    c.mouseButtons.left = editing ? A.NONE : A.ROTATE;
    c.mouseButtons.right = editing ? (pan ? A.TRUCK : A.ROTATE) : A.TRUCK;
    c.mouseButtons.middle = A.TRUCK;
    c.mouseButtons.wheel = A.NONE;            // the rig's own wheel (CameraRig.wheel): trackpad pinch and swipe done right
    this.game.rig.wheelOn = true;
    c.touches.one = editing ? A.NONE : A.TOUCH_ROTATE;
    // Smart placement: one finger places, two fingers pinch and orbit, three pan.
    const smart = editing && this.smart?.on;
    c.touches.two = smart ? A.TOUCH_DOLLY_ROTATE : A.TOUCH_DOLLY_TRUCK;
    c.touches.three = smart ? A.TOUCH_TRUCK : A.TOUCH_ROTATE;
  }

  pushUndo() {
    this.W.pushUndo();
    S.undoDepth.value = this.W.undoStack.length;
  }
  // Undo from the keyboard or a button: the smart bar's own steps first (plants, animals, groups), else the world's.
  undoAny() { return this.smart?.stack.length && this.smart.on ? this.smart.undo() : this.undo(); }
  undo() {
    if (this.W.undo()) { this.selectPiece(null); toast('Undone.'); S.undoDepth.value = this.W.undoStack.length; return true; }
    toast('Nothing to undo.');
    return false;
  }

  // --- Picking ----------------------------------------------------------------
  setMouse(e) {
    const r = this.dom.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  // Ray against the ground, hardscape and background; with 'water', a hit
  // on any water surface in front of that counts first.
  pick(kinds) {
    const W = this.W;
    this.ray.setFromCamera(this.mouse, this.camera);
    const objs = [];
    const rocks = S.layer.value === 'bottom' ? [] : W.decor.meshes;   // the Bottom layer leaves the hardscape out
    if (kinds.includes('terrain')) objs.push(W.terrain.mesh, ...rocks);
    if (kinds.includes('wall')) objs.push(W.wall.mesh);
    if (kinds.includes('water') && !kinds.includes('terrain')) objs.push(W.terrain.mesh, ...rocks);
    const hits = this.ray.intersectObjects(objs, false);
    if (!hits.length) return null;
    const hit = hits[0];
    let surface = hit.object.userData.surface ?? 'terrain';
    if (hit.object.name === 'piece') surface = 'terrain';
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const res = { point: hit.point.clone(), surface, normal, object: hit.object };
    if (kinds.includes('water') && surface !== 'wall') {
      const s = W.water.surfaceAt(hit.point.x, hit.point.z, 0.2);
      const r = this.ray.ray;
      if (s > hit.point.y + 0.05 && r.direction.y < -0.01) {
        const t = (s - r.origin.y) / r.direction.y;
        const q = r.at(t, new THREE.Vector3());
        if (t > 0 && t < hit.distance) return { point: q, surface: W.water.inMainPool(q.x, q.z) ? 'water' : 'pond', normal: new THREE.Vector3(0, 1, 0), object: null, ground: res };
      }
    }
    return res;
  }

  // --- Pointer -------------------------------------------------------------
  bindPointer() {
    const el = this.dom;
    el.addEventListener('pointermove', (e) => { this.setMouse(e); this.hover(); if (this.down) this.drag(); });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.W) return;
      if (this.tc.dragging || this.tc.axis) return;
      this.setMouse(e);
      if (this.smart.on) return;      // smart placement listens for taps itself (tools/smart.js)
      if (this.tool === 'view' || this.tool === 'inspect') {
        // A tap (not a drag) selects whatever is under the pointer; on water it also ripples.
        this._tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        return;
      }
      this.down = true;
      this.strokeChanged = false;
      this.path = null;
      el.setPointerCapture(e.pointerId);
      this.click();
    });
    const up = () => {
      if (!this.down) return;
      this.down = false;
      if (this.path) this.finishPath();
      if (this.strokeChanged) { this.W.groundChanged(); this.strokeChanged = false; this.game.events.emit('edit', this.tool); }
    };
    el.addEventListener('pointerup', (e) => {
      const t = this._tap;
      this._tap = null;
      if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 6 && performance.now() - t.t < 500 && this.W) {
        this.setMouse(e);
        this.tap();
        this._taps = [...(this._taps ?? []).slice(-1), performance.now()];
      } else this._taps = [];
      up();
    });
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      // Only two real clicks fly the camera: the browser also reports two quick drags (turning the view twice) or a trackpad
      // double tap ending a drag as a double click, and the camera flew off to the ground by itself.
      const [t1, t2] = this._taps ?? [];
      if (!(t1 && t2 && t2 - t1 < 500 && performance.now() - t2 < 300)) return;
      this._taps = [];
      this.setMouse(e);
      const hit = this.pick(['terrain', 'wall', 'water']);
      if (!hit) return;
      this.controls.moveTo(hit.point.x, hit.point.y, hit.point.z, true);
      if (this.controls.distance > 70) this.controls.dollyTo(Math.max(30, TANK.w * 0.65), true);
    });
  }

  // --- Selecting things: animals, plants, stones and pools ------------------------
  tap() {
    const W = this.W;
    this.ray.setFromCamera(this.mouse, this.camera);
    const bare = S.layer.value === 'bottom';   // nothing living is drawn in the Bottom layer
    const a = bare ? null : W.animals.pick(this.ray.ray, 2.2);
    const hit = this.pick(['terrain', 'wall', 'water']);
    if (hit?.surface === 'water' && !a) W.fx?.addDrop(hit.point.x, hit.point.z, -9, 1.1);
    if (a && S.pairing.value) { this.finishPairing(a); return; }
    if (a) { this.select({ kind: 'animal', obj: a }); return; }
    if (hit) {
      const plant = bare ? null : W.plants.near(hit.point, 4);
      if (plant) { this.select({ kind: 'plant', obj: plant }); return; }
      const piece = hit.object && W.decor.pieceAt(hit.object);
      if (piece) { this.select({ kind: 'piece', obj: piece }); return; }
      const pool = W.water.pondAt(hit.point.x, hit.point.z);
      if (pool) { this.select({ kind: 'pool', obj: pool }); return; }
    }
    this.select(null);
  }

  select(sel) {
    S.selection.value = sel;
    if (!sel) { this.follow(null); S.pairing.value = null; }
  }

  // "Pair up" was pressed on an animal; `b` is the one tapped next. A pair is marked as each other's mate.
  finishPairing(b) {
    const a = S.pairing.value;
    S.pairing.value = null;
    if (!a || a.dead) return;
    if (b === a) { toast('Pairing cancelled.'); return; }
    if (!this.W.animals.pairUp(a, b)) { toast(`A pair must be two ${SPECIES[a.sp].name.toLowerCase()}. Try again.`, 'bad'); return; }
    toast('A pair! Marked pairs breed with each other.');
    this.select({ kind: 'animal', obj: a });
  }

  // The world position of a selection, and a sensible distance to look at it from.
  focusOf(sel) {
    const o = sel.obj;
    if (sel.kind === 'animal') return { p: o.pos.clone(), d: Math.max(9, SPECIES[o.sp].size * 7 + 4) };
    if (sel.kind === 'plant') return { p: o.pos.clone().add(new THREE.Vector3(0, 3, 0)), d: 20 };
    if (sel.kind === 'piece') {
      const b = new THREE.Box3().setFromObject(o.mesh), c = b.getCenter(new THREE.Vector3());
      return { p: c, d: Math.max(20, b.getSize(new THREE.Vector3()).length() * 1.4) };
    }
    return { p: new THREE.Vector3(o.x ?? 0, (o.level ?? 5), o.z ?? 0), d: 30 };
  }

  // Fly the camera close to the selection, keeping the direction we look from.
  zoomTo(sel = S.selection.value) {
    if (!sel) return;
    const { p, d } = this.focusOf(sel);
    const dir = this.camera.position.clone().sub(p).normalize();
    if (dir.y < 0.05) dir.y = 0.05;
    dir.normalize();
    dir.copy(this.clearView(p, d, dir).dir);
    const c = this.controls;
    c.minDistance = 3;
    c.setLookAt(p.x + dir.x * d, p.y + dir.y * d, p.z + dir.z * d, p.x, p.y, p.z, true);
    this.game.rig.moved = true;
    // Animals move: keep the camera on them after zooming in (Follow toggles it off).
    if (sel.kind === 'animal') this.follow(sel.obj);
  }

  // Seen from `dir` (unit, from p toward the camera) at distance d, is p hidden? A bank, a rock or the background may stand in
  // between, or leaves may cover it. Returns the first direction (swinging round sideways, then higher or lower) with a clear
  // view of the ground and the fewest plants in the way, or the clearest one: { dir, cost } (cost 0: a clear view). A plant
  // is a column of half its reach round its stem, as tall as it stands: rough, but leaves and blades are what hide an animal.
  clearView(p, d, dir) {
    const rig = this.game.rig, Y = new THREE.Vector3(0, 1, 0), P = this.W?.plants;
    const cols = (P?.list ?? []).filter((q) => q.surface !== 'wall' && Math.hypot(q.pos.x - p.x, q.pos.z - p.z) < d + q.reach)
      .map((q) => ({ x: q.pos.x, z: q.pos.z, y0: q.pos.y, y1: q.pos.y + P.heightOf(q), r: q.reach * (0.3 + 0.7 * q.grown) * 0.5 }));
    const leafy = (t) => {
      let n = 0;
      for (const c of cols) {
        for (let s = 1.5; s < d; s += 0.8) {
          const x = p.x + t.x * s, y = p.y + t.y * s, z = p.z + t.z * s;
          if (y > c.y0 && y < c.y1 && (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) { n++; break; }
        }
      }
      return n;
    };
    // Only directions inside the compartment's turn and tilt range (CameraRig.zones): the camera never swings behind the tank.
    const cost = (t) => { if (rig.allows && !rig.allows(t)) return Infinity; const cl = rig.clearance(p, t, d); return (cl >= d * 0.95 ? 0 : 100 + (d - cl)) + leafy(t); };
    let best = dir.clone(), bestC = cost(dir);
    if (bestC > 0) {
      search: for (const up of [0, 0.35, 0.7, -0.15]) for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 2, -2]) {
        const t = dir.clone().applyAxisAngle(Y, turn);
        t.y = clamp(t.y + up, 0.05, 0.95);
        t.normalize();
        const c = cost(t);
        if (c < bestC) { best = t; bestC = c; }
        if (c === 0) break search;
      }
    }
    return { dir: best, cost: bestC };
  }

  // Keep the camera on a moving animal.
  follow(obj) {
    S.following.value = obj ?? null;
  }

  // One frame of following: the target slides after the animal; the camera keeps the distance and angle the player chose
  // (it used to swing round to a clear side by itself when a bank or leaves hid the animal: the player saw the angle jump).
  // Leaves between the lens and the animal dissolve instead; for a bank or a rock the player turns the camera.
  followFrame(a) {
    const p = new THREE.Vector3(a.pos.x, a.pos.y + Math.min(1.5, (SPECIES[a.sp]?.size ?? 1) * 0.25), a.pos.z);
    this.controls.moveTo(p.x, p.y, p.z, true);
    // Leaves between the lens and the animal dissolve (plantMaterial): a tube a little wider than the animal.
    U.focus.value.set(p.x, p.y, p.z, Math.max(2.5, (SPECIES[a.sp]?.size ?? 2) * 0.9));
  }

  hover() {
    const W = this.W;
    if (!W) return;
    if (this.smart.hover()) return;
    const kit = this.tool === 'rock' ? kitById(this.sub.kit) : null;
    const brushTools = BRUSH_TOOLS.includes(this.tool) || (this.tool === 'water' && ['channel', 'bank', 'basin'].includes(this.sub.water)) || !!kit;
    if (this.tool === 'water' && ['outlet', 'fill'].includes(this.sub.water) && !this.down) {
      const now = performance.now();
      if (now - (this._traceT ?? 0) > 90) {
        this._traceT = now;
        const hit = this.pick(['terrain', 'wall']);
        if (hit) {
          const x = hit.point.x;
          let z = hit.point.z;
          if (hit.surface === 'wall') z = W.wall.zAt(x, hit.point.y) + 1.2;
          hint(traceText(W.water.showTrace(x, z), this.sub.water));
        } else W.water.hideTrace();
      }
    }
    if (!brushTools) { this.cursor.visible = false; this.cursor2.visible = false; return; }
    const hit = this.pick(this.tool === 'water' || kit ? ['terrain'] : ['terrain', 'wall']);
    if (!hit) { this.cursor.visible = false; this.cursor2.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.point).addScaledVector(hit.normal, 0.15);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.surface === 'wall' ? new THREE.Vector3(0, 0, 1) : UP);
    let s = kit ? kitReach(kit) * kitScale() : this.brush.size;
    // A cliff snaps to a wall or slope: show where its back will be anchored (the ring lies on that surface).
    const fp = this.tool === 'rock' && !kit ? PIECES[this.sub.rock] : null;
    if (fp?.face && !(hit.object && W.decor.pieceAt(hit.object))) {
      const sf = W.decor.faceSurface(hit.point.x, hit.point.z);
      if (sf.kind !== 'free') {
        const n = new THREE.Vector3(...sf.n);
        this.cursor.position.set(...sf.anchor).addScaledVector(n, 0.2);
        this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        s = fp.size * (this.brush.size / 6) * 0.6;
        if (this._faceHint !== sf.kind) { this._faceHint = sf.kind; hint(sf.kind === 'slope' ? 'The cliff lies along the slope.' : `The cliff stands against the ${sf.kind === 'back' ? 'back' : sf.kind} wall.`); }
      }
    }
    this.cursor.scale.set(s, s, s);
    this.hoverMirror(hit, s);
  }

  // The mirror image of the brush ring, sitting on the ground (or the background) over there.
  hoverMirror(hit, s) {
    const c = this.cursor2, W = this.W, x = -hit.point.x;
    if (!this.mirrored(hit.point.x) || !W) { c.visible = false; return; }
    const wall = hit.surface === 'wall';
    if (wall) c.position.set(x, hit.point.y, W.wall.zAt(x, hit.point.y)).addScaledVector(Z_AXIS, 0.15);
    else c.position.set(x, W.terrain.heightAt(x, hit.point.z) + 0.15, hit.point.z);
    c.quaternion.copy(this.cursor.quaternion);
    c.scale.set(s, s, s);
    c.visible = true;
  }

  // Paths for channels and banks.
  drag() {
    if (!this.path) return;
    const hit = this.pick(['terrain']);
    if (!hit) return;
    const last = this.path[this.path.length - 1];
    if (last && Math.hypot(hit.point.x - last.x, hit.point.z - last.z) < 0.7) return;
    this.path.push(hit.point.clone());
    const pts = this.path.map((p) => p.clone().setY(p.y + 0.4));
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.pathLine.visible = pts.length > 1;
    this.pathLine2.geometry.dispose();
    this.pathLine2.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setX(-p.x)));
    this.pathLine2.visible = this.mirror && pts.length > 1;
  }

  finishPath() {
    const W = this.W, pts = this.path;
    this.path = null;
    this.pathLine.visible = false;
    this.pathLine2.visible = false;
    if (pts.length < 2) return;
    this.pushUndo();
    // With Mirror on the same path is drawn again on the other side (one undo step for both).
    const paths = [pts];
    if (this.mirror && pts.some((p) => Math.abs(p.x) > 0.6)) { paths.push(pts.map((p) => new THREE.Vector3(-p.x, p.y, p.z))); this.usedMirror(); }
    for (const P of paths) {
      if (this.sub.water === 'channel') W.terrain.carveChannel(P, this.brush.size * 0.5, this.brush.strength);
      else W.terrain.raiseBank(P, this.brush.size * 0.5, this.brush.strength * 1.5);
    }
    W.groundChanged();
    this.game.events.emit('edit');
    const both = paths.length > 1 ? ' and its mirror' : '';
    toast(this.sub.water === 'channel' ? `Channel${both} dug. Water will run along it from where you started.` : `Bank${both} raised.`);
  }

  // Continuous brush while the button is held.
  frame(dt) {
    const fol = S.following.value;
    if (fol && !fol.dead && fol.pos) this.followFrame(fol);
    else if (fol) S.following.value = null;
    // The animal being watched does not take the lens for a predator (Animals.camThreat), even as the camera flies in to it.
    if (this.W?.animals) this.W.animals.watched = S.following.value ?? null;
    if (!S.following.value && U.focus.value.w) U.focus.value.w = 0;
    this.frameMarker();
    this.frameKeys(dt);
    if (S.piece.value) this.box.update();
    if (!this.down || !BRUSH_TOOLS.includes(this.tool) || !this.W) return;
    const hit = this.pick(['terrain', 'wall']);
    if (!hit) return;
    const W = this.W;
    const onWall = hit.surface === 'wall';
    const f = onWall ? W.wall.field : W.terrain.field;
    const [a, b] = onWall ? [hit.point.x, hit.point.y] : [hit.point.x, hit.point.z];
    const st = this.brush.strength * dt * 12;
    // With Mirror on every dab is repeated at (-a, b) as well: the same stroke, mirrored.
    const dabs = this.mirrored(a) ? [a, -a] : [a];
    for (const x of dabs) {
      if (this.tool === 'paint') f.brush(x, b, this.brush.size, 'paint', st, { mat: this.sub.paint });
      else {
        const op = this.sub.sculpt;
        if (this.flatTarget == null) this.flatTarget = onWall ? f.sample(a, b) : W.terrain.baseAt(a, b);
        f.brush(x, b, this.brush.size, op, st * (op === 'raise' || op === 'lower' ? 0.5 : 1), { target: this.flatTarget });
      }
    }
    this.strokeChanged = true;
    if (!onWall) W.terrain.compose();
    W.terrain.update();
    W.wall.update();
    // Let the water follow the new shape while you sculpt.
    this._liveT = (this._liveT ?? 0) - dt;
    if (this._liveT <= 0 && this.tool === 'sculpt') { this._liveT = 0.25; W.water.groundChanged(); W.fx?.updateTerrain(); }
  }

  // Spend funds in career mode. Returns an error string, or null when the
  // purchase went through (sandbox: always null).
  charge(kind, id, n = 1, morph = null) {
    return this.game.career?.buy(kind, id, n, morph) ?? null;
  }

  click() {
    const W = this.W;
    this.flatTarget = null;
    switch (this.tool) {
      case 'sculpt':
      case 'paint':
        this.pushUndo();
        if (this.mirror) this.usedMirror();
        break;
      case 'rock': this.clickRock(); break;
      case 'water': this.clickWater(); break;
      case 'plant': {
        const id = this.sub.plant;
        const floating = PLANTS[id].habitat === 'floating';
        let hit = this.pick(floating ? ['terrain', 'wall', 'water'] : ['terrain', 'wall']);
        if (!hit) return;
        // Clicked into another plant: plant it beside that one instead (on the ground), or say there is no room (on the wall).
        const surf = hit.surface === 'wall' ? 'wall' : 'terrain';
        if (W.plants.crowdingAt(id, hit.point, { surface: surf })) {
          const spot = surf === 'wall' ? null : freeSpot(hit.point.x, hit.point.z, (x, z) => {
            const q = this.smart.hitFor(id, x, z);
            return !W.plants.crowdingAt(id, q.point) && !W.plants.canPlace(id, q, W);
          }, { seed: Math.round(hit.point.x * 31 + hit.point.z * 17), step: 1.6, tries: 40 });
          if (!spot) { toast('Too close to another plant: give it some room.', 'bad'); return; }
          hit = this.smart.hitFor(id, spot.x, spot.z);
        }
        const err = W.plants.canPlace(id, hit, W);
        if (err) { toast(err, 'bad'); return; }
        const buyErr = this.charge('plant', id);
        if (buyErr) { toast(buyErr, 'bad'); return; }
        const pos = hit.point.clone();
        if (floating) pos.y = W.water.surfaceAt(pos.x, pos.z, 0.2);
        const p = W.plants.add(id, pos, { normal: hit.normal, surface: hit.surface === 'wall' ? 'wall' : 'terrain' });
        if (!p) { toast('Too many of this plant.', 'bad'); this.game.career?.refund('plant', id); } else {
          this.game.events.emit('placed', 'plant', id);
          if (this.mirrored(pos.x, 1.5)) this.mirrorPlant(id, p, floating);
        }
        break;
      }
      case 'animal': this.clickAnimal(); break;
      case 'gear': this.clickGear(); break;
      case 'inspect': break;   // handled by tap(): a click selects in Look and Inspect alike
      case 'erase': this.clickErase(); break;
    }
  }

  clickRock() {
    const W = this.W;
    const hit = this.pick(['terrain']);
    if (!hit) return;
    if (this.sub.kit) { this.clickKit(hit); return; }
    const piece = hit.object && W.decor.pieceAt(hit.object);
    const cur = S.piece.value;
    // Click a piece to select it; Shift+click (or click with one selected) places a new one on top.
    if (piece && !this.keys.has('shift') && piece !== cur) { this.selectPiece(piece); return; }
    if (cur && piece === cur) return;
    if (cur && !piece) { this.selectPiece(null); return; }
    const type = this.sub.rock;
    const size = PIECES[type].size * (this.brush.size / 6);
    const err = this.charge('piece', type);
    if (err) { toast(err, 'bad'); return; }
    this.pushUndo();
    const onTop = !!piece;      // Shift+click on a piece: the new one rests on it (Decor.settle `rest`)
    // The variant and yaw are chosen here so that the mirror copy can match them.
    // One seeded roll (variant, little scale differences, flip, tint, yaw) so no two rocks match;
    // the mirror copy uses the same roll, drawn flipped. Cliffs snap to a wall or slope (face mode).
    const look = W.decor.look(type, Math.floor(Math.random() * 2 ** 31)), face = !!PIECES[type].face && !piece;
    const { variant, rot } = look;
    const p = W.decor.addPiece(type, hit.point.x, hit.point.z, { size, variant, rot, scale: look.scale, flip: look.flip, tint: look.tint, face, rest: onTop && !face });
    if (!p) { toast('Still loading models…', 'bad'); this.game.career?.refund('piece', type); return; }
    if (this.mirrored(hit.point.x, 1)) this.mirrorPiece({ type, size, variant, rot, onTop, x: hit.point.x, z: hit.point.z, look });
    W.groundChanged();
    this.selectPiece(p);
    this.game.events.emit('placed', 'piece', type);
  }

  // The mirror image of a piece just placed (flipped model, reversed yaw); paid for like the first.
  mirrorPiece({ type, size, variant, rot, onTop, x, z, look }) {
    const err = this.charge('piece', type);
    if (err) { toast(`Mirror copy skipped: ${err}`, 'bad'); return; }
    const q = placeSpec(this.W, mirrorSpec({ type, x, z, size, variant, rot, stack: onTop, flip: look.flip, tint: look.tint, scale: look.scale, exact: true }));
    if (!q) { this.game.career?.refund('piece', type); return; }
    this.usedMirror();
  }

  // The same plant on the mirrored spot, if it can grow there.
  mirrorPlant(id, p, floating) {
    const W = this.W, x = -p.pos.x, wall = p.surface === 'wall';
    const pos = new THREE.Vector3(x, p.pos.y, p.pos.z);
    let normal = new THREE.Vector3(0, 1, 0);
    if (wall) {
      pos.z = W.wall.zAt(x, p.pos.y);
      const [gx, gy] = W.wall.field.gradient(x, p.pos.y);
      normal = new THREE.Vector3(-gx, -gy, 1).normalize();
    } else {
      pos.y = floating ? W.water.surfaceAt(x, pos.z, 0.2) : W.terrain.heightAt(x, pos.z);
      normal = W.terrain.normalAt(x, pos.z);
      if (floating && W.water.surfaceAt(x, pos.z, 0.2) - W.terrain.heightAt(x, pos.z) < 1.5) return;
    }
    if (W.plants.canPlace(id, { point: pos, surface: floating ? 'water' : wall ? 'wall' : 'terrain', normal }, W)) return;
    if (this.charge('plant', id)) return;
    const q = W.plants.add(id, pos, { normal, surface: wall ? 'wall' : 'terrain', variant: p.variant, scale: p.scale, rot: -p.rot });
    if (q) this.usedMirror(); else this.game.career?.refund('plant', id);
  }

  // --- Kits ----------------------------------------------------------------------------
  // Buys a kit's pieces (one purchase per piece type, like the Hardscape tool). Checks the
  // rank and the total first so it never half-buys. Returns an error message, or null.
  chargeKit(kit) {
    const c = this.game.career;
    if (!c) return null;
    const counts = Object.entries(kitCounts(kit));
    let total = 0;
    for (const [type, n] of counts) {
      const info = c.info('piece', type);
      if (info?.locked) return `${kit.name} needs the ${PIECES[type].name.toLowerCase()}, unlocked at rank ${info.level}.`;
      total += c.cost('piece', type, n);
    }
    if (!c.has(total)) return `Not enough funds: this kit costs ¤${total} and you have ¤${Math.floor(c.funds)}.`;
    const bought = [];
    for (const [type, n] of counts) {
      const err = c.buy('piece', type, n);
      if (err) { for (const [t, m] of bought) c.refund('piece', t, m); return err; }
      bought.push([type, n]);
    }
    return null;
  }
  refundKit(kit) { for (const [type, n] of Object.entries(kitCounts(kit))) this.game.career?.refund('piece', type, n); }

  // One click drops the whole composition (and its mirror image, with Mirror on) as one undo step.
  clickKit(hit) {
    const W = this.W, kit = kitById(this.sub.kit);
    if (!kit) return;
    if (!kitReady(W, kit)) { toast('Still loading models…', 'bad'); return; }
    const x = hit.point.x, z = hit.point.z;
    let mirror = this.mirrored(x, kitReach(kit) * kitScale() * 0.35);
    const err = this.chargeKit(kit);
    if (err) { toast(err, 'bad'); return; }
    let paid = 1;
    if (mirror) {
      const err2 = this.chargeKit(kit);
      if (err2) { toast(`Mirror copy skipped: ${err2}`, 'bad'); mirror = false; } else paid = 2;
    }
    this.pushUndo();
    const res = buildKit(W, kit, { x, z, seed: kitSeed(x, z, W.decor.pieces.length), mirror });
    if (!res.pieces.length) {
      W.undoStack.pop(); S.undoDepth.value = W.undoStack.length;
      for (let k = 0; k < paid; k++) this.refundKit(kit);
      toast('Still loading models…', 'bad');
      return;
    }
    W.groundChanged();
    W.log(`Placed a kit: ${kit.name}${mirror ? ' and its mirror image' : ''}.`);
    const c = this.game.career;
    c?.stat('kitsPlaced');
    if (mirror) this.usedMirror();
    this.game.events.emit('placed', 'piece', kit.pieces[0].type);
    this.game.events.emit('edit', 'rock');
    toast(`${kit.name} placed${res.outlets.length ? ', with an outlet on top: it pours once the main pool has water' : ''}.`, 'good', 3500);
    hint(kit.teaches);
  }

  clickWater() {
    const W = this.W, mode = this.sub.water;
    if (mode === 'channel' || mode === 'bank') {
      const hit = this.pick(['terrain']);
      if (hit) this.path = [hit.point.clone()];
      return;
    }
    if (mode === 'basin') {
      const hit = this.pick(['terrain']);
      if (!hit) return;
      this.pushUndo();
      W.terrain.digBasin(hit.point.x, hit.point.z, this.brush.size, this.brush.strength * 2);
      if (this.mirrored(hit.point.x, this.brush.size * 0.5)) { W.terrain.digBasin(-hit.point.x, hit.point.z, this.brush.size, this.brush.strength * 2); this.usedMirror(); }
      W.groundChanged();
      this.game.events.emit('edit');
      toast('Pool dug. Fill it, or lead a stream into it.');
      return;
    }
    if (mode === 'outlet') {
      const hit = this.pick(['terrain', 'wall']);
      if (!hit) return;
      this.pushUndo();
      const wall = hit.surface === 'wall';
      const pos = hit.point.clone();
      if (wall) pos.z += 0.6; else pos.y += 0.2;
      W.water.addOutlet(pos, wall);
      if (this.mirrored(pos.x, 1.5)) {
        const mx = -pos.x;
        W.water.addOutlet(wall ? new THREE.Vector3(mx, pos.y, W.wall.zAt(mx, pos.y) + 0.6) : new THREE.Vector3(mx, W.terrain.heightAt(mx, pos.z) + 0.2, pos.z), wall);
        this.usedMirror();
      }
      W.log(wall ? 'Added a spring on the background.' : 'Added a pump outlet.');
      toast(W.water.hydro.pump.running || W.water.level > 3 ? 'Outlet placed: water is flowing.' : 'Outlet placed. The main pool needs water for the pump to run.');
      this.game.events.emit('edit');
      return;
    }
    if (mode === 'fill') {
      const hit = this.pick(['terrain']);
      if (!hit) return;
      const r = W.water.fillAt(hit.point.x, hit.point.z);
      if (r.error) toast(r.error, 'bad'); else { toast(`Filled with ${r.litres.toFixed(2)} L from the main pool.`); W.plants.onWaterChanged(W); this.game.events.emit('edit'); }
      return;
    }
    if (mode === 'pump') {
      const hit = this.pick(['terrain', 'water']);
      if (!hit) return;
      const p = hit.ground?.point ?? hit.point;
      if (!W.water.inMainPool(p.x, p.z) && W.water.level > 0.5) { toast('Put the pump in the main pool.', 'bad'); return; }
      this.pushUndo();
      W.water.setPump(p.x, p.z);
      toast('Pump moved.');
    }
  }

  clickAnimal() {
    const W = this.W, id = this.sub.animal;
    const hit = this.pick(SPECIES[id].kind === 'gecko' ? ['terrain', 'wall', 'water'] : ['terrain', 'water']);
    if (!hit) return;
    if (hit.ground) hit.point = hit.ground.point.clone();
    const pl = W.animals.placement(id, hit);
    if (pl.error) { toast(pl.error, 'bad'); return; }
    const n = BATCH[id] ?? 1;
    const morph = hasGenetics(id) ? morphChoice(id) : null;       // null: random wild genes (also for species without genes)
    const err = this.charge('animal', id, n, morph);
    if (err) { toast(err, 'bad'); return; }
    let added = 0;
    for (let k = 0; k < n; k++) {
      const jitter = n > 1 ? new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4) : new THREE.Vector3();
      const p2 = pl.pos.clone().add(jitter);
      const again = pl.wall ? pl : W.animals.placement(id, { point: p2 });
      const a = again.pos && W.animals.add(id, again.pos, { ...(this.game.career?.newcomer(id) ?? {}), morph });
      if (a) { added++; if (pl.wall) { a.onWall = true; a.wallMode = true; a.normal = new THREE.Vector3(0, 0, 1); } }
    }
    if (added) { W.log(`Released ${added} ${SPECIES[id].name.toLowerCase()}${morph ? ` (${morphName(id, morph).toLowerCase()})` : ''}.`); this.game.events.emit('placed', 'animal', id, added); }
    else this.game.career?.refund('animal', id, n, morph);
  }

  clickGear() {
    const W = this.W, id = this.sub.gear;
    const hit = this.pick(['terrain', 'water']);
    if (!hit) return;
    const p = hit.ground?.point ?? hit.point;
    if (!W.equipment.has(id)) { toast('You have not bought that yet. Open the Studio shop.', 'bad'); return; }
    if (id === 'fogger') {
      W.equipment.pos.fogger = { x: p.x, z: p.z };
      W.climate.scanAcc = 1e9;
      toast('Fogger placed. Its fog spreads humidity around it.');
    } else if (id === 'basking') {
      W.equipment.pos.basking = { x: p.x, z: p.z };
      W.climate.scanAcc = 1e9;
      toast('Basking lamp moved. Look at the temperature lens to see the warm patch.');
    }
    this.game.events.emit('edit');
  }

  clickErase() {
    const W = this.W;
    this.ray.setFromCamera(this.mouse, this.camera);
    const a = W.animals.pick(this.ray.ray, 2);
    if (a) { W.animals.remove(a, 'removed'); toast(`Removed a ${SPECIES[a.sp].name.toLowerCase()}.`); return; }
    const hit = this.pick(['terrain', 'wall', 'water']);
    if (!hit) return;
    const p = W.plants.near(hit.point, 3);
    if (p) { W.plants.remove(p); toast('Plant removed.'); return; }
    const o = W.water.hydro.nearestOutlet(hit.point, 3);
    if (o) { this.pushUndo(); W.water.removeOutlet(o); toast('Outlet removed.'); return; }
    const piece = hit.object && W.decor.pieceAt(hit.object);
    if (piece) { this.pushUndo(); W.decor.removePiece(piece); W.groundChanged(); toast(`${PIECES[piece.type].name} removed.`); return; }
    const pool = W.water.pondAt(hit.point.x, hit.point.z);
    if (pool) { W.water.drainPool(pool); toast('Pool drained into the main pool.'); }
  }

  // --- Hardscape editing ---------------------------------------------------
  selectPiece(p) {
    S.piece.value = p;
    if (p) { this.tc.attach(p.mesh); this.box.setFromObject(p.mesh); this.box.visible = true; }
    else { this.tc.detach(); this.box.visible = false; }
  }

  setPieceMode(m) { this.tc.setMode(m); S.pieceMode.value = m; }

  // While a piece is dragged its stamp follows (a few times a second), so
  // water and animals see it move; the full update runs when you let go.
  pieceMoved(final) {
    const p = S.piece.value;
    if (!p) return;
    const D = this.W.decor;
    // Cliffs snap back to the nearest wall or slope while moved; everything else stays in the glass.
    if (PIECES[p.type].face && S.pieceMode.value === 'translate') D.snapFace(p); else D.clampPiece(p);
    const now = performance.now();
    if (!final && now - (this._moveT ?? 0) < 120) return;
    this._moveT = now;
    D.restamp(p);
    this.W.groundChanged({ quick: !final });
    if (final) this.game.events.emit('edit');
  }

  duplicatePiece() {
    const p = S.piece.value;
    if (!p) return;
    const err = this.charge('piece', p.type);
    if (err) { toast(err, 'bad'); return; }
    this.pushUndo();
    const np = this.W.decor.duplicate(p);
    this.W.groundChanged();
    this.selectPiece(np);
  }
  dropPiece() {
    const p = S.piece.value;
    if (!p) return;
    this.pushUndo();
    this.W.decor.settle(p, 0.08);
    this.pieceMoved(true);
  }
  levelPiece() {
    const p = S.piece.value;
    if (!p) return;
    this.pushUndo();
    const e = new THREE.Euler().setFromQuaternion(p.mesh.quaternion, 'YXZ');
    p.mesh.rotation.set(0, e.y, 0, 'YXZ');
    this.pieceMoved(true);
  }
  deletePiece() {
    const p = S.piece.value;
    if (!p) return;
    this.pushUndo();
    this.selectPiece(null);
    this.W.decor.removePiece(p);
    this.W.groundChanged();
  }

  frameMarker() {
    const s = S.selection.value;
    if (!s || s.obj?.dead || !s.obj || s.kind === 'pool' || s.kind === 'piece') { this.marker.visible = false; return; }
    this.marker.visible = true;
    this.marker.position.copy(s.obj.pos).add(new THREE.Vector3(0, 0.3, 0));
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP);
  }

  // --- Keys ------------------------------------------------------------------
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || S.modal.value) return;
      const k = e.key.toLowerCase();
      if (k === 'shift') { this.keys.add('shift'); this.setButtons(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'z') { this.undoAny(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'd') { this.duplicatePiece(); e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const piece = S.piece.value;
      if (e.code === 'Space') { this.game.setSpeed(this.game.speed === 0 ? 1 : 0); e.preventDefault(); }
      else if (k === 'escape') { if (this.sub.kit) this.setKit(null); else if (piece) this.selectPiece(null); else if (S.selection.value) this.select(null); else this.setTool('view'); }
      else if (k === 'delete' || k === 'backspace') this.deletePiece();
      else if (piece && k === 'g') this.setPieceMode('translate');
      else if (piece && k === 'r') this.setPieceMode('rotate');
      else if (piece && k === 't') this.setPieceMode('scale');
      else if (k === 'm') this.toggleMirror();
      else if (k === 'f') this.focus();
      else if (k === 'h') { S.left.value = !S.left.value; S.right.value = !S.right.value; }
      else if (k === 'l') S.lens.value = nextLens(S.lens.value);
      else if (k === 'v') S.layer.value = nextLayer(S.layer.value);
      else if (/^[0-9]$/.test(k)) { const t = TOOLS.find((t) => t.key === k); if (t) this.setTool(t.id); }
      else this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'shift') { this.keys.delete('shift'); this.setButtons(); return; }
      this.keys.delete(k);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  // WASD pans over the tank, Q/E turn around it, Z/X zoom, arrows tilt.
  frameKeys(dt) {
    const c = this.controls, k = this.keys;
    if (!k.size || S.modal.value) return;
    const s = Math.max(20, c.distance) * dt * 0.9;
    if (k.has('a')) c.truck(-s, 0, true);
    if (k.has('d')) c.truck(s, 0, true);
    if (k.has('w')) c.forward(s, true);
    if (k.has('s')) c.forward(-s, true);
    if (k.has('q')) c.rotate(dt * 1.2, 0, true);
    if (k.has('e')) c.rotate(-dt * 1.2, 0, true);
    if (k.has('arrowup')) c.rotate(0, -dt * 0.8, true);
    if (k.has('arrowdown')) c.rotate(0, dt * 0.8, true);
    if (k.has('arrowleft')) c.rotate(dt * 1.2, 0, true);
    if (k.has('arrowright')) c.rotate(-dt * 1.2, 0, true);
    if (k.has('z')) c.dolly(s, true);
    if (k.has('x')) c.dolly(-s, true);
  }

  focus() {
    const t = S.piece.value?.mesh.position ?? S.selection.value?.obj?.pos;
    if (t) { this.controls.moveTo(t.x, t.y, t.z, true); this.controls.dollyTo(Math.min(this.controls.distance, 50), true); } else this.game.rig.view('front');
  }
}

export const LENSES = ['off', 'humidity', 'temperature', 'light', 'soil', 'fertility', 'flow', 'quality', 'stability', 'sediment'];
export const nextLens = (l) => LENSES[(LENSES.indexOf(l) + 1) % LENSES.length];

function traceText(t, mode) {
  const pools = t.pits.length;
  const lit = t.pits.reduce((s, p) => s + p.litres, 0);
  const end = t.end === 'pool' ? 'then into the main pool' : t.end === 'open' ? 'and spreads out over a wide hollow' : 'and ends in a hollow';
  if (mode === 'fill') return pools ? `Fills a hollow of ${t.pits[0].litres.toFixed(2)} L here.` : 'Water here runs away: no hollow to fill.';
  return pools ? `Water from here fills ${pools} pool${pools > 1 ? 's' : ''} (${lit.toFixed(2)} L) on the way, ${end}.` : `Water from here runs straight downhill, ${end}.`;
}

export { WATER_TOOLS };
