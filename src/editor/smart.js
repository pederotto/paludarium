// Smart placement (Explorer, and the optional "Smart place" toggle in Naturalist).
// One tap puts a rock, a plant or an animal where it belongs: snapped to the ground, water or wall, turned and
// sized by a seeded roll, embedded the way the Hardscape tool does it (cliffs use the face mode), kept clear of
// its neighbours (pieces and animals), then a floating bar (ui/hud/SmartBar.jsx) offers Another, a group of 3
// or 5, Undo, Done and Adjust. Touch: one finger taps to place, two fingers orbit and pinch; a long press on a
// piece adjusts it and a long press with plants selected paints a patch of them where they can grow.
// The pure maths (group layouts, free spots, scatter) lives in app/modes.js and has unit tests.

import * as THREE from 'three/webgpu';
import { S, toast, hint, modeId, morphChoice } from '../ui/store.js';
import { isSmart, mulberry, seedOf, groupLayout, freeSpot, scatterSpots } from '../app/modes.js';
import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';
import { PIECES } from '../sim/decor.js';
import { TANK } from '../sim/tank.js';
import { kitScale } from '../sim/kits.js';
import { hasGenetics } from '../sim/genetics.js';
import { morphName } from '../content/morphs.js';
import { BATCH } from './defs.js';

export const SMART_TOOLS = ['rock', 'plant', 'animal'];
const HOLD_MS = 380, MOVE_PX = 9;
const GOOD = 0x8fd6a4, BAD = 0xe8806a;

// "Will it thrive?" for a plant, from the tank's air: a tiny light for the options panel.
export function plantFit(id, live) {
  const p = PLANTS[id];
  if (!p || !live) return null;
  const hum = live.env.humidity, [lo, hi] = p.humidity ?? [0, 100];
  const aq = String(p.habitat).includes('aquatic') || String(p.habitat).includes('floating');
  if (aq) return { level: 'good', why: 'lives in the water' };
  if (hum < lo - 12) return { level: 'bad', why: 'air too dry' };
  if (hum < lo) return { level: 'warn', why: 'air a little dry' };
  if (hum > hi + 4) return { level: 'warn', why: 'air very damp' };
  return { level: 'good', why: 'conditions suit it' };
}

export class SmartPlacer {
  constructor(T) {
    this.T = T;
    this.stack = [];          // undo entries: { world, len, refunds } or { plants, animals }
    this.last = null;         // what the bar acts on: { kind, id, x, z, size, hit, n }
    this.pts = new Map();
    this.g = null;
    this.n = 1;
    const el = T.dom;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => { this.pts.delete(e.pointerId); this.cancel(); });
    for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, (e) => this.pts.delete(e.pointerId));   // a release outside the canvas
  }

  get W() { return this.T.W; }
  get on() { return !!this.T.W && SMART_TOOLS.includes(this.T.tool) && isSmart(modeId(), S.smart.value); }
  get count() { return S.sub.value.smartN ?? 1; }

  reset() { this.stack = []; this.last = null; S.smartBar.value = null; this.cancel(); }
  setBar(extra = {}) {
    const l = this.last;
    S.smartBar.value = l ? { kind: l.kind, id: l.id, undo: this.stack.length, adjustable: l.kind === 'piece', ...extra } : { kind: null, undo: this.stack.length, ...extra };
  }
  push(entry) { this.stack.push(entry); if (this.stack.length > 40) this.stack.shift(); }

  // --- Pointer -------------------------------------------------------------------------------------------
  down(e) {
    this.pts.set(e.pointerId, true);
    if (!this.on) return;
    const T = this.T;
    if (T.tc.dragging || T.tc.axis) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.pts.size > 1) { if (this.g) this.g.multi = true; this.stopHold(); return; }
    T.setMouse(e);
    this.g = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, multi: false, held: false, moved: false };
    this.holdT = setTimeout(() => this.hold(), HOLD_MS);
  }
  move(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    this.T.setMouse(e);
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > MOVE_PX) { g.moved = true; if (!g.held) this.stopHold(); }
  }
  up(e) {
    this.pts.delete(e.pointerId);
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    this.stopHold();
    this.g = null;
    if (g.held) { this.endScatter(); return; }
    if (!this.on || g.multi || g.moved || performance.now() - g.t > 700) return;
    this.T.setMouse(e);
    this.tap();
  }
  cancel() { this.stopHold(); if (this.g?.scatter) this.endScatter(); this.g = null; }
  stopHold() { clearTimeout(this.holdT); this.holdT = null; if (this.si) { clearInterval(this.si); this.si = null; } }

  hold() {
    const g = this.g, T = this.T;
    if (!g || g.multi || g.moved || !this.on) return;
    g.held = true;
    if (T.tool === 'plant') {
      g.scatter = true;
      this.sc = { plants: [], err: null };
      try { T.dom.setPointerCapture(g.id); } catch { /* pointer already gone */ }
      this.scatter();
      this.si = setInterval(() => this.scatter(), 110);
    } else if (T.tool === 'rock') {
      const hit = T.pick(['terrain']);
      const piece = hit?.object && this.W.decor.pieceAt(hit.object);
      if (piece) { T.selectPiece(piece); this.setBar({ adjusting: true }); }
    }
  }

  // --- Taps ------------------------------------------------------------------------------------------------
  tap() {
    const tool = this.T.tool;
    if (tool === 'rock') this.tapRock();
    else if (tool === 'plant') this.tapPlant();
    else if (tool === 'animal') this.tapAnimal();
  }

  tapRock() {
    const T = this.T, W = this.W;
    const hit = T.pick(['terrain']);
    if (!hit) return;
    const piece = hit.object && W.decor.pieceAt(hit.object);
    if (S.piece.value) { if (piece !== S.piece.value) { T.selectPiece(null); this.setBar(); } return; }   // finishing an adjustment
    if (S.sub.value.kit) { this.kit(hit); return; }
    const type = S.sub.value.rock, def = PIECES[type];
    const stackY = piece || !def.stamp ? hit.point.y : null;
    this.pieces(type, hit.point.x, hit.point.z, this.count, { stackY, onPiece: !!piece });
  }

  kit(hit) {
    const T = this.T, W = this.W;
    const before = W.decor.pieces.length;
    T.clickKit(hit);
    if (W.decor.pieces.length === before) return;
    this.push({ world: true, len: W.undoStack.length });
    this.last = { kind: 'kit', id: S.sub.value.kit };
    this.setBar({ adjustable: false });
  }

  // --- Hardscape ---------------------------------------------------------------------------------------------
  // Is a rock of footprint radius r free to stand at (x, z)? (not on another piece, not on an animal)
  free(x, z, r, ignore = null) {
    const W = this.W;
    for (const p of W.decor.pieces) {
      if (p === ignore) continue;
      const b = new THREE.Box3().setFromObject(p.mesh);
      const pr = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5, cx = (b.max.x + b.min.x) / 2, cz = (b.max.z + b.min.z) / 2;
      if (Math.hypot(cx - x, cz - z) < (pr + r) * 0.62) return false;
    }
    for (const a of W.animals.all) if (a.pos && Math.hypot(a.pos.x - x, a.pos.z - z) < r * 0.5 + 0.8) return false;
    const hw = TANK.w / 2 - r * 0.5, hd = TANK.d / 2 - r * 0.5;
    return Math.abs(x) <= hw && Math.abs(z) <= hd;
  }

  // Places `n` pieces: one, or a graded cluster (odd: 3 or 5) around (cx, cz). `around`: an existing focal piece
  // (the cluster grows around it instead of starting a new one).
  pieces(type, cx, cz, n, { stackY = null, onPiece = false, around = null, rest = onPiece } = {}) {
    const T = this.T, W = this.W, def = PIECES[type];
    const seed = seedOf(cx, cz, this.n++), rnd = mulberry(seed), ks = kitScale();
    const base = (around ? around.size / 1.15 : def.size * ks) * (onPiece ? 0.7 : 1);
    let layout = n > 1
      ? groupLayout(n, cx, cz, base, { seed, tank: TANK, thirds: !around && !onPiece, fill: 0.78, margin: base * 0.35 })
      : [{ x: cx, z: cz, size: base * (0.9 + rnd() * 0.3) }];
    if (around) layout = layout.slice(1);
    const made = [], refunds = [];
    T.pushUndo();
    const len = W.undoStack.length;
    for (let i = 0; i < layout.length; i++) {
      const L = layout[i];
      let x = L.x, z = L.z;
      if (stackY == null && !def.face) {
        const spot = freeSpot(x, z, (px, pz) => this.free(px, pz, L.size * 0.5), { seed: seed + i, step: Math.max(1, L.size * 0.35) });
        if (!spot) { if (!made.length && i === layout.length - 1) toast('No room there. Try another spot.', 'bad'); continue; }
        x = spot.x; z = spot.z;
      }
      const err = T.charge('piece', type);
      if (err) { toast(err, 'bad'); break; }
      const look = W.decor.look(type, seed + i * 977);
      const face = !!def.face && !onPiece;
      const p = W.decor.addPiece(type, x, z, { size: L.size, variant: look.variant, rot: look.rot, scale: look.scale, flip: look.flip, tint: look.tint, face, rest: rest && !face });
      if (!p) { T.game.career?.refund('piece', type); toast('Still loading models…', 'bad'); break; }
      made.push(p); refunds.push(type);
      if (T.mirrored(x, 1)) T.mirrorPiece({ type, size: L.size, variant: look.variant, rot: look.rot, onTop: rest, x, z, look });
      this.last = { kind: 'piece', id: type, x: p.mesh.position.x, z: p.mesh.position.z, size: L.size, piece: p, stackY, rest };
    }
    if (!made.length) { if (W.undoStack.length === len) { W.undoStack.pop(); S.undoDepth.value = W.undoStack.length; } this.setBar(); return; }
    W.groundChanged();
    T.game.events.emit('placed', 'piece', type);
    this.push({ world: true, len, refunds: refunds.map((t) => ['piece', t, 1]) });
    S.undoDepth.value = W.undoStack.length;
    this.setBar();
    hint(made.length > 1 ? `A group of ${made.length}: odd numbers and graded sizes look natural.` : `${def.name} placed.`);
  }

  // --- Plants -------------------------------------------------------------------------------------------------------
  hitFor(id, x, z) {
    const W = this.W, floating = PLANTS[id].habitat === 'floating';
    if (floating) return { point: new THREE.Vector3(x, W.water.surfaceAt(x, z, 0.2), z), surface: 'water', normal: new THREE.Vector3(0, 1, 0) };
    return { point: new THREE.Vector3(x, W.terrain.heightAt(x, z), z), surface: 'terrain', normal: W.terrain.normalAt(x, z) };
  }
  spacing() { return 2.6 * kitScale(); }

  // Tries to plant `id` at a hit. Returns the plant, or a string with the (friendly) reason it was refused.
  plantAt(id, hit, { nudge = true } = {}) {
    const T = this.T, W = this.W, sp = this.spacing();
    const floating = PLANTS[id].habitat === 'floating';
    let h = hit;
    const crowded = (q) => W.plants.near(q.point, sp) || W.plants.crowdingAt(id, q.point, { surface: q.surface === 'wall' ? 'wall' : 'terrain' });
    if (crowded(h)) {
      if (!nudge || h.surface === 'wall') return 'Too close to another plant: give it some room.';
      const spot = freeSpot(h.point.x, h.point.z, (x, z) => { const q = this.hitFor(id, x, z); return !crowded(q) && !W.plants.canPlace(id, q, W); }, { seed: seedOf(h.point.x, h.point.z, this.n++), step: sp });
      if (!spot) return 'Too crowded here: try another spot.';
      h = this.hitFor(id, spot.x, spot.z);
    }
    const err = W.plants.canPlace(id, h, W);
    if (err) return err;
    const buy = T.charge('plant', id);
    if (buy) return buy;
    const pos = h.point.clone();
    if (floating) pos.y = W.water.surfaceAt(pos.x, pos.z, 0.2);
    const p = W.plants.add(id, pos, { normal: h.normal, surface: h.surface === 'wall' ? 'wall' : 'terrain' });
    if (!p) { T.game.career?.refund('plant', id); return 'Too many of this plant.'; }
    T.game.events.emit('placed', 'plant', id);
    return p;
  }

  tapPlant() {
    const T = this.T, id = S.sub.value.plant, floating = PLANTS[id].habitat === 'floating';
    const hit = T.pick(floating ? ['terrain', 'wall', 'water'] : ['terrain', 'wall']);
    if (!hit) return;
    this.plants(id, hit, this.count);
  }

  plants(id, hit, n, around = null) {
    const T = this.T, made = [];
    let err = null;
    const c = around ?? hit.point;
    if (n > 1 && hit.surface !== 'wall') {
      const lay = groupLayout(n, c.x, c.z, this.spacing() * 1.1, { seed: seedOf(c.x, c.z, this.n++), tank: TANK, thirds: !around, fill: 0.9 });
      lay.forEach((L, i) => {
        if (around && i === 0) return;
        const r = this.plantAt(id, this.hitFor(id, L.x, L.z), { nudge: true });
        if (typeof r === 'string') err ??= r; else made.push(r);
      });
    } else {
      const r = this.plantAt(id, hit);
      if (typeof r === 'string') err = r; else { made.push(r); if (T.mirrored(r.pos.x, 1.5)) T.mirrorPlant(id, r, PLANTS[id].habitat === 'floating'); }
    }
    if (!made.length) { toast(err ?? 'It cannot grow there.', 'bad'); this.setBar(); return; }
    this.last = { kind: 'plant', id, x: made[0].pos.x, z: made[0].pos.z, hit };
    this.push({ plants: made });
    this.setBar();
    hint(`${PLANTS[id].name}${made.length > 1 ? ` x${made.length}` : ''} planted.`);
  }

  // Tap and hold: paints plants within the brush radius, spaced out, only where they can grow.
  scatter() {
    const T = this.T, W = this.W, id = S.sub.value.plant, sc = this.sc;
    if (!sc || !W) return;
    const floating = PLANTS[id].habitat === 'floating';
    const hit = T.pick(floating ? ['terrain', 'water'] : ['terrain']);
    if (!hit || sc.plants.length >= 40) return;
    const c = hit.ground?.point ?? hit.point, radius = Math.max(2.5, S.brush.value.size * 0.9);
    T.cursor.visible = true; T.cursor.position.set(c.x, c.y + 0.2, c.z); T.cursor.scale.set(radius, radius, radius);
    T.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
    const near = W.plants.list.filter((p) => Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < radius + this.spacing()).map((p) => ({ x: p.pos.x, z: p.pos.z }));
    for (const s of scatterSpots(c.x, c.z, radius, this.spacing(), near, { seed: seedOf(c.x, c.z, this.n++), max: 3 })) {
      const q = this.hitFor(id, s.x, s.z);
      if (W.plants.near(q.point, this.spacing())) continue;
      const r = this.plantAt(id, q, { nudge: false });
      if (typeof r === 'string') { sc.err ??= r; if (/funds|afford/i.test(r)) { this.endScatter(); return; } } else sc.plants.push(r);
    }
  }
  endScatter() {
    const sc = this.sc;
    this.sc = null;
    this.stopHold();
    if (!sc) return;
    if (sc.plants.length) {
      const id = S.sub.value.plant;
      this.last = { kind: 'plant', id, x: sc.plants[0].pos.x, z: sc.plants[0].pos.z };
      this.push({ plants: sc.plants });
      this.setBar();
      toast(`Planted ${sc.plants.length} ${PLANTS[id].name.toLowerCase()}. Tap Undo if that is too many.`, 'good');
    } else if (sc.err) toast(sc.err, 'bad');
  }

  // --- Animals --------------------------------------------------------------------------------------------------
  tapAnimal() {
    const T = this.T, id = S.sub.value.animal;
    const hit = T.pick(SPECIES[id].kind === 'gecko' ? ['terrain', 'wall', 'water'] : ['terrain', 'water']);
    if (!hit) return;
    if (hit.ground) hit.point = hit.ground.point.clone();
    const n = this.count > 1 ? this.count : (BATCH[id] ?? 1);
    this.animals(id, hit, n);
  }

  animals(id, hit, n, add = false) {
    const T = this.T, W = this.W, sp = SPECIES[id];
    const pl = W.animals.placement(id, hit);
    if (pl.error) { toast(pl.error, 'bad'); return false; }
    const morph = hasGenetics(id) ? morphChoice(id) : null;
    const err = T.charge('animal', id, n, morph);
    if (err) { toast(err, 'bad'); return false; }
    const rnd = mulberry(seedOf(hit.point.x, hit.point.z, this.n++));
    const made = [];
    for (let k = 0; k < n; k++) {
      let again = pl;
      if (!pl.wall) {
        for (let t = 0; t < 5; t++) {            // a spot clear of the others
          const j = n > 1 ? 1.2 + Math.sqrt(n) * 1.1 : 0;
          const p2 = pl.pos.clone().add(new THREE.Vector3((rnd() - 0.5) * 2 * j, 0, (rnd() - 0.5) * 2 * j));
          const q = W.animals.placement(id, { point: p2 });
          if (!q.pos) continue;
          again = q;
          if (W.animals.all.every((o) => !o.pos || o.pos.distanceTo(q.pos) > Math.max(0.5, sp.size * 0.7))) break;
        }
      }
      const a = again.pos && W.animals.add(id, again.pos, { ...(T.game.career?.newcomer(id) ?? {}), morph });
      if (a) { made.push(a); if (pl.wall) { a.onWall = true; a.wallMode = true; a.normal = new THREE.Vector3(0, 0, 1); } }
    }
    if (!made.length) { T.game.career?.refund('animal', id, n, morph); toast('There is no room to release it there.', 'bad'); return false; }
    if (made.length < n) T.game.career?.refund('animal', id, n - made.length, morph);
    W.log(`Released ${made.length} ${sp.name.toLowerCase()}${morph ? ` (${morphName(id, morph).toLowerCase()})` : ''}.`);
    T.game.events.emit('placed', 'animal', id, made.length);
    this.last = { kind: 'animal', id, x: hit.point.x, z: hit.point.z, hit, n: made.length, morph };
    this.push({ animals: made, id, morph });
    this.setBar();
    return true;
  }

  // --- The bar ----------------------------------------------------------------------------------------------------------
  another() {
    const l = this.last, T = this.T;
    if (!l) return;
    if (l.kind === 'piece') {
      const a = (this.n * 2.399963) % (Math.PI * 2), r = Math.max(2, l.size * 0.7);
      this.pieces(l.id, l.x + Math.cos(a) * r, l.z + Math.sin(a) * r * 0.8, 1, { stackY: l.stackY, rest: l.rest });
    } else if (l.kind === 'plant') {
      const a = (this.n++ * 2.399963) % (Math.PI * 2), r = this.spacing() * 1.3;
      const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r;
      this.plants(l.id, l.hit?.surface === 'wall' ? l.hit : this.hitFor(l.id, x, z), 1);
    } else if (l.kind === 'animal') this.animals(l.id, l.hit, BATCH[l.id] ?? 1);
    else if (l.kind === 'kit') { const hit = T.pick(['terrain']); if (hit) this.kit(hit); else toast('Tap the tank to place another kit.'); }
  }
  group(n) {
    const l = this.last;
    if (!l) return;
    if (l.kind === 'piece') this.pieces(l.id, l.x, l.z, n, { around: l, stackY: l.stackY, rest: l.rest });
    else if (l.kind === 'plant') this.plants(l.id, l.hit ?? this.hitFor(l.id, l.x, l.z), n, { x: l.x, z: l.z });
    else if (l.kind === 'animal') this.animals(l.id, l.hit, n);
  }
  adjust() {
    const p = this.last?.piece;
    if (p && this.W.decor.pieces.includes(p)) { this.T.selectPiece(p); this.setBar({ adjusting: true }); }
  }
  done() { this.T.selectPiece(null); this.last = null; S.smartBar.value = null; this.T.setTool('view'); }
  put() { this.T.selectPiece(null); this.last = null; this.setBar(); }

  undo() {
    const T = this.T, W = this.W, e = this.stack[this.stack.length - 1];
    if (!e) { T.undo(); this.setBar(); return; }
    if (e.world) {
      if (W.undoStack.length !== e.len) { T.undo(); this.setBar(); return; }   // something else was edited since: undo that first
      this.stack.pop();
      T.undo();
      for (const [k, id, n] of e.refunds ?? []) T.game.career?.refund(k, id, n);
    } else {
      this.stack.pop();
      let refunded = 0;
      for (const p of e.plants ?? []) { if (!p.dead && W.plants.list.includes(p)) { W.plants.remove(p); refunded++; T.game.career?.refund('plant', p.id ?? S.sub.value.plant); } }
      for (const a of e.animals ?? []) { if (!a.dead) { W.animals.remove(a, 'removed'); refunded++; } }
      if (e.animals?.length) T.game.career?.refund('animal', e.id, e.animals.length, e.morph);
      toast(refunded ? 'Undone.' : 'Already gone.');
    }
    this.last = null;      // the bar offers Another only for what was just placed
    this.setBar();
  }

  // --- The cursor: a ring that is green where it will thrive and red where it will not -------------------------------
  hover() {
    const T = this.T, W = this.W;
    if (!this.on || !W || this.sc) { if (!this.sc) T.cursor.material.color.setHex(0xffffff); return !!this.sc; }
    const tool = T.tool, sub = S.sub.value;
    if (tool === 'rock') { T.cursor.material.color.setHex(0xffffff); return false; }
    let hit, id, why = null, size = 2;
    if (tool === 'plant') {
      id = sub.plant;
      const floating = PLANTS[id].habitat === 'floating';
      hit = T.pick(floating ? ['terrain', 'wall', 'water'] : ['terrain', 'wall']);
      if (hit) { why = W.plants.canPlace(id, hit, W); size = this.spacing() * 0.6; }
    } else {
      id = sub.animal;
      hit = T.pick(SPECIES[id].kind === 'gecko' ? ['terrain', 'wall', 'water'] : ['terrain', 'water']);
      if (hit) { if (hit.ground) hit = { ...hit, point: hit.ground.point }; why = W.animals.placement(id, hit).error ?? null; size = Math.max(1.5, SPECIES[id].size * 3); }
    }
    if (!hit) { T.cursor.visible = false; return true; }
    T.cursor.visible = true;
    T.cursor.material.color.setHex(why ? BAD : GOOD);
    T.cursor.position.copy(hit.point).addScaledVector(hit.normal ?? new THREE.Vector3(0, 1, 0), 0.15);
    T.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.surface === 'wall' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
    T.cursor.scale.set(size, size, size);
    T.cursor2.visible = false;
    if (why !== this._why) { this._why = why; if (why) hint(why); }
    return true;
  }
}
