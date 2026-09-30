// Turns pointer and keyboard input on the canvas into edits of the tank:
// sculpting, painting, placing hardscape, waterworks, plants, animals and
// equipment, plus inspecting and removing. It owns the 3D helpers (brush ring,
// selection marker, path line, move/turn/scale handles). The panels in the UI
// only choose the tool and its options (signals in ui/store.js).

import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import CameraControls from 'camera-controls';
import { TOOLS, WATER_TOOLS, BATCH } from './defs.js';
import { S, toast, hint } from '../ui/store.js';
import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';
import { PIECES } from '../sim/decor.js';
import { TANK } from '../sim/tank.js';

const UP = new THREE.Vector3(0, 1, 0);
const BRUSH_TOOLS = ['sculpt', 'paint'];

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
    this.scene.add(this.cursor, this.marker, this.pathLine);

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
    this.setTool('view');
    game.frameHooks.push((dt) => this.frame(dt));
    game.events.on('tank', () => this.onTank());
  }

  get W() { return this.game.world; }
  get tool() { return S.tool.value; }
  get sub() { return S.sub.value; }
  get brush() { return S.brush.value; }

  onTank() {
    this.selectPiece(null);
    S.selection.value = null;
    S.undoDepth.value = 0;
    this.setTool(this.tool);
  }

  // --- Tool selection ------------------------------------------------------
  setTool(id) {
    if (!TOOLS.find((t) => t.id === id)) id = 'view';
    S.tool.value = id;
    this.setButtons();
    if (id !== 'rock') this.selectPiece(null);
    const W = this.W;
    if (id !== 'water') W?.water.hideTrace();
    hint(TOOLS.find((t) => t.id === id).hint);
    this.cursor.visible = false;
    if (W) {
      W.water.outletMeshes.forEach((m) => { m.visible = id === 'water' || id === 'erase'; });
      W.water.pumpMesh.visible = id === 'water';
    }
    if (id !== 'inspect') S.selection.value = null;
  }

  setSub(key, val, h) {
    S.sub.value = { ...S.sub.value, [key]: val };
    if (h) hint(h);
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
    c.mouseButtons.wheel = A.DOLLY;
    c.touches.one = editing ? A.NONE : A.TOUCH_ROTATE;
    c.touches.two = A.TOUCH_DOLLY_TRUCK;
    c.touches.three = A.TOUCH_ROTATE;
  }

  pushUndo() {
    this.W.pushUndo();
    S.undoDepth.value = this.W.undoStack.length;
  }
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
    if (kinds.includes('terrain')) objs.push(W.terrain.mesh, ...W.decor.meshes);
    if (kinds.includes('wall')) objs.push(W.wall.mesh);
    if (kinds.includes('water') && !kinds.includes('terrain')) objs.push(W.terrain.mesh, ...W.decor.meshes);
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
      if (this.tool === 'view') {
        const hit = this.pick(['terrain', 'water']);
        if (hit?.surface === 'water') this.W.fx?.addDrop(hit.point.x, hit.point.z, -9, 1.1);
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
      if (this.strokeChanged) { this.W.groundChanged(); this.strokeChanged = false; this.game.events.emit('edit'); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      this.setMouse(e);
      const hit = this.pick(['terrain', 'wall', 'water']);
      if (!hit) return;
      this.controls.moveTo(hit.point.x, hit.point.y, hit.point.z, true);
      if (this.controls.distance > 70) this.controls.dollyTo(Math.max(30, TANK.w * 0.65), true);
    });
  }

  hover() {
    const W = this.W;
    if (!W) return;
    const brushTools = BRUSH_TOOLS.includes(this.tool) || (this.tool === 'water' && ['channel', 'bank', 'basin'].includes(this.sub.water));
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
    if (!brushTools) { this.cursor.visible = false; return; }
    const hit = this.pick(this.tool === 'water' ? ['terrain'] : ['terrain', 'wall']);
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.point).addScaledVector(hit.normal, 0.15);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.surface === 'wall' ? new THREE.Vector3(0, 0, 1) : UP);
    const s = this.brush.size;
    this.cursor.scale.set(s, s, s);
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
  }

  finishPath() {
    const W = this.W, pts = this.path;
    this.path = null;
    this.pathLine.visible = false;
    if (pts.length < 2) return;
    this.pushUndo();
    if (this.sub.water === 'channel') W.terrain.carveChannel(pts, this.brush.size * 0.5, this.brush.strength);
    else W.terrain.raiseBank(pts, this.brush.size * 0.5, this.brush.strength * 1.5);
    W.groundChanged();
    this.game.events.emit('edit');
    toast(this.sub.water === 'channel' ? 'Channel dug. Water will run along it from where you started.' : 'Bank raised.');
  }

  // Continuous brush while the button is held.
  frame(dt) {
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
    if (this.tool === 'paint') f.brush(a, b, this.brush.size, 'paint', st, { mat: this.sub.paint });
    else {
      const op = this.sub.sculpt;
      if (this.flatTarget == null) this.flatTarget = onWall ? f.sample(a, b) : W.terrain.baseAt(a, b);
      f.brush(a, b, this.brush.size, op, st * (op === 'raise' || op === 'lower' ? 0.5 : 1), { target: this.flatTarget });
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
  charge(kind, id, n = 1) {
    return this.game.career?.buy(kind, id, n) ?? null;
  }

  click() {
    const W = this.W;
    this.flatTarget = null;
    switch (this.tool) {
      case 'sculpt':
      case 'paint':
        this.pushUndo();
        break;
      case 'rock': this.clickRock(); break;
      case 'water': this.clickWater(); break;
      case 'plant': {
        const id = this.sub.plant;
        const floating = PLANTS[id].habitat === 'floating';
        const hit = this.pick(floating ? ['terrain', 'wall', 'water'] : ['terrain', 'wall']);
        if (!hit) return;
        const err = W.plants.canPlace(id, hit, W);
        if (err) { toast(err, 'bad'); return; }
        const buyErr = this.charge('plant', id);
        if (buyErr) { toast(buyErr, 'bad'); return; }
        const pos = hit.point.clone();
        if (floating) pos.y = W.water.surfaceAt(pos.x, pos.z, 0.2);
        const p = W.plants.add(id, pos, { normal: hit.normal, surface: hit.surface === 'wall' ? 'wall' : 'terrain' });
        if (!p) { toast('Too many of this plant.', 'bad'); this.game.career?.refund('plant', id); } else this.game.events.emit('placed', 'plant', id);
        break;
      }
      case 'animal': this.clickAnimal(); break;
      case 'gear': this.clickGear(); break;
      case 'inspect': {
        this.ray.setFromCamera(this.mouse, this.camera);
        const a = W.animals.pick(this.ray.ray, 2.5);
        if (a) { S.selection.value = { kind: 'animal', obj: a }; break; }
        const hit = this.pick(['terrain', 'wall', 'water']);
        const p = hit && W.plants.near(hit.point, 5);
        const pool = hit && !p && W.water.pondAt(hit.point.x, hit.point.z);
        S.selection.value = p ? { kind: 'plant', obj: p } : pool ? { kind: 'pool', obj: pool } : null;
        break;
      }
      case 'erase': this.clickErase(); break;
    }
  }

  clickRock() {
    const W = this.W;
    const hit = this.pick(['terrain']);
    if (!hit) return;
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
    const onTop = piece || !PIECES[type].stamp;
    const p = W.decor.addPiece(type, hit.point.x, hit.point.z, { size, y: onTop ? hit.point.y - size * 0.08 : undefined });
    if (!p) { toast('Still loading models…', 'bad'); this.game.career?.refund('piece', type); return; }
    W.groundChanged();
    this.selectPiece(p);
    this.game.events.emit('placed', 'piece', type);
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
    const err = this.charge('animal', id, n);
    if (err) { toast(err, 'bad'); return; }
    let added = 0;
    for (let k = 0; k < n; k++) {
      const jitter = n > 1 ? new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4) : new THREE.Vector3();
      const p2 = pl.pos.clone().add(jitter);
      const again = pl.wall ? pl : W.animals.placement(id, { point: p2 });
      const a = again.pos && W.animals.add(id, again.pos, this.game.career?.newcomer(id) ?? {});
      if (a) { added++; if (pl.wall) { a.onWall = true; a.wallMode = true; a.normal = new THREE.Vector3(0, 0, 1); } }
    }
    if (added) { W.log(`Released ${added} ${SPECIES[id].name.toLowerCase()}.`); this.game.events.emit('placed', 'animal', id, added); }
    else this.game.career?.refund('animal', id, n);
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
    D.clampPiece(p);
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
    if (!s || s.obj?.dead || !s.obj || s.kind === 'pool') { this.marker.visible = false; return; }
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
      if ((e.ctrlKey || e.metaKey) && k === 'z') { this.undo(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'd') { this.duplicatePiece(); e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const piece = S.piece.value;
      if (e.code === 'Space') { this.game.setSpeed(this.game.speed === 0 ? 1 : 0); e.preventDefault(); }
      else if (k === 'escape') { if (piece) this.selectPiece(null); else if (S.selection.value) S.selection.value = null; else this.setTool('view'); }
      else if (k === 'delete' || k === 'backspace') this.deletePiece();
      else if (piece && k === 'g') this.setPieceMode('translate');
      else if (piece && k === 'r') this.setPieceMode('rotate');
      else if (piece && k === 't') this.setPieceMode('scale');
      else if (k === 'f') this.focus();
      else if (k === 'h') { S.left.value = !S.left.value; S.right.value = !S.right.value; }
      else if (k === 'l') S.lens.value = nextLens(S.lens.value);
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

export const LENSES = ['off', 'humidity', 'temperature', 'light', 'soil', 'flow'];
export const nextLens = (l) => LENSES[(LENSES.indexOf(l) + 1) % LENSES.length];

function traceText(t, mode) {
  const pools = t.pits.length;
  const lit = t.pits.reduce((s, p) => s + p.litres, 0);
  const end = t.end === 'pool' ? 'then into the main pool' : t.end === 'open' ? 'and spreads out over a wide hollow' : 'and ends in a hollow';
  if (mode === 'fill') return pools ? `Fills a hollow of ${t.pits[0].litres.toFixed(2)} L here.` : 'Water here runs away: no hollow to fill.';
  return pools ? `Water from here fills ${pools} pool${pools > 1 ? 's' : ''} (${lit.toFixed(2)} L) on the way, ${end}.` : `Water from here runs straight downhill, ${end}.`;
}

export { WATER_TOOLS };
