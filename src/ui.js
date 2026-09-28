// Tools (sculpt, paint, rocks, water, plants, animals, inspect, remove),
// pointer handling, and the side panels.

import * as THREE from 'three/webgpu';
import { MATERIALS, SPEEDS, TANK, MAT } from './config.js';
import { PLANTS } from './plants.js';
import { SPECIES } from './animals.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
};

const TOOLS = [
  { id: 'view', icon: '🖐', name: 'Look', hint: 'Drag to orbit, scroll to zoom, right-drag to pan.' },
  { id: 'sculpt', icon: '⛰', name: 'Sculpt', hint: 'Drag on the ground or the background to shape it. Right-drag orbits.' },
  { id: 'paint', icon: '🖌', name: 'Paint', hint: 'Paint soil, sand, gravel, rock, moss or cork on the ground and the background. Moss grows tufts.' },
  { id: 'rock', icon: '🪨', name: 'Rocks', hint: 'Click to place a rock. Animals can climb it.' },
  { id: 'water', icon: '💧', name: 'Water', hint: 'Pond: click a hollow to fill it. Waterfall: click the background or a high spot for the source.' },
  { id: 'plant', icon: '🌿', name: 'Plants', hint: 'Pick a plant, then click where it should grow.' },
  { id: 'animal', icon: '🐸', name: 'Animals', hint: 'Pick a species, then click to release it.' },
  { id: 'inspect', icon: '🔍', name: 'Inspect', hint: 'Click an animal or plant to see how it is doing.' },
  { id: 'erase', icon: '✖', name: 'Remove', hint: 'Click a plant, animal, rock, pond or waterfall to remove it.' },
];

const BATCH = { neon: 6, cory: 3, guppy: 3, shrimp: 5, isopod: 10, springtail: 20, fly: 10 };

export class UI {
  constructor({ world, camera, renderer, controls, scene }) {
    this.world = world; this.camera = camera; this.renderer = renderer; this.controls = controls; this.scene = scene;
    this.tool = 'view';
    this.sub = { sculpt: 'raise', paint: MAT.moss, water: 'pond', plant: 'fern', animal: 'neon' };
    this.brush = { size: 5, strength: 1 };
    this.speed = 1;
    this.selected = null;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.down = false;
    this.lastHit = null;

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }),
    );
    this.cursor.renderOrder = 20;
    this.cursor.visible = false;
    scene.add(this.cursor);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicNodeMaterial({ color: 0xffd34d, depthTest: false, side: THREE.DoubleSide }));
    this.marker.renderOrder = 21;
    this.marker.visible = false;
    scene.add(this.marker);

    this.buildToolbar();
    this.buildPanels();
    this.bindPointer();
    this.bindKeys();
    this.setTool('view');
    world.onLog = () => this.renderLog();
    this.renderLog();
    this.refresh();
  }

  // --- Toolbar & options -------------------------------------------------
  buildToolbar() {
    const bar = $('#tools');
    for (const t of TOOLS) {
      bar.append(h('button', { class: 'tool', 'data-tool': t.id, title: t.name, onclick: () => this.setTool(t.id) }, h('span', { class: 'ic' }, t.icon), h('span', { class: 'lb' }, t.name)));
    }
  }

  setTool(id) {
    this.tool = id;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    const editing = id !== 'view';
    // Left button edits; orbit moves to the right button.
    this.controls.mouseButtons = editing
      ? { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = editing ? { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.renderOptions();
    this.hint(TOOLS.find((t) => t.id === id).hint);
    this.cursor.visible = false;
  }

  renderOptions() {
    const o = $('#options');
    o.innerHTML = '';
    const chips = (items, key) => h('div', { class: 'chips' }, ...items.map(([val, label, title]) => {
      const b = h('button', { class: 'chip' + (this.sub[key] === val ? ' on' : ''), title: title ?? '', onclick: () => { this.sub[key] = val; this.renderOptions(); if (title) this.hint(title); } }, label);
      return b;
    }));
    const slider = (label, key, min, max, step) => h('label', { class: 'row' }, h('span', {}, label),
      h('input', { type: 'range', min, max, step, value: this.brush[key], oninput: (e) => { this.brush[key] = +e.target.value; } }));
    switch (this.tool) {
      case 'sculpt':
        o.append(chips([['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']], 'sculpt'));
        o.append(slider('Brush size', 'size', 1.5, 14, 0.5), slider('Strength', 'strength', 0.2, 3, 0.1));
        break;
      case 'paint':
        o.append(chips(MATERIALS.map((m, i) => [i, m.name]), 'paint'));
        o.append(slider('Brush size', 'size', 1.5, 14, 0.5), slider('Strength', 'strength', 0.2, 3, 0.1));
        break;
      case 'rock':
        o.append(slider('Rock size', 'size', 1.5, 10, 0.5));
        break;
      case 'water':
        o.append(chips([['pond', 'Pond'], ['fall', 'Waterfall']], 'water'));
        o.append(h('label', { class: 'row' }, h('span', {}, 'Water level'),
          h('input', { type: 'range', min: 0, max: TANK.h - 10, step: 0.5, value: this.world.water.level, id: 'wl',
            oninput: (e) => { this.world.setWaterLevel(+e.target.value); } })));
        o.append(h('p', { class: 'note' }, 'Everything below the water level is submerged. Ponds sit higher, in hollows you dig on land.'));
        break;
      case 'plant': {
        const groups = { land: 'Land', wall: 'Background', emergent: 'Waterline', aquatic: 'Underwater', floating: 'Floating' };
        const list = Object.entries(PLANTS).filter(([, p]) => !p.hidden);
        for (const [hab, label] of Object.entries(groups)) {
          const items = list.filter(([, p]) => p.habitat.split('|')[0] === hab);
          if (!items.length) continue;
          o.append(h('div', { class: 'grp' }, label));
          o.append(chips(items.map(([id, p]) => [id, p.name, p.note]), 'plant'));
        }
        break;
      }
      case 'animal': {
        const groups = {};
        for (const [id, s] of Object.entries(SPECIES)) (groups[s.group] ??= []).push([id, s.name, s.note]);
        for (const [g, items] of Object.entries(groups)) {
          o.append(h('div', { class: 'grp' }, g));
          o.append(chips(items, 'animal'));
        }
        break;
      }
      default:
        o.append(h('p', { class: 'note' }, TOOLS.find((t) => t.id === this.tool).hint));
    }
  }

  hint(s) { $('#hint').textContent = s; }
  toast(s, kind = 'info') {
    const t = $('#toast');
    t.textContent = s;
    t.className = 'show ' + kind;
    clearTimeout(this._toast);
    this._toast = setTimeout(() => { t.className = ''; }, 2600);
  }

  // --- Panels ------------------------------------------------------------
  buildPanels() {
    const W = this.world, E = W.env;
    const sp = $('#speed');
    SPEEDS.forEach((s, i) => sp.append(h('button', { class: 'chip', 'data-i': i, onclick: () => this.setSpeed(i) }, s === 0 ? '❚❚' : s + '×')));
    this.setSpeed(1);

    const c = $('#controls');
    const toggle = (label, get, set) => {
      const b = h('button', { class: 'chip', onclick: () => { set(!get()); b.classList.toggle('on', get()); } }, label);
      b.classList.toggle('on', get());
      return b;
    };
    c.append(
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => { const n = W.animals.feed(); this.toast(n ? 'Fish food scattered on the water.' : 'No open water to feed.'); } }, '🍤 Feed fish'),
        h('button', { class: 'chip', onclick: () => this.addFlies() }, '🪰 Add flies'),
        h('button', { class: 'chip', onclick: () => { E.mist = 1; E.humidity = Math.min(100, E.humidity + 12); W.log('Misted the tank.'); } }, '💦 Mist'),
        h('button', { class: 'chip', onclick: () => { E.nitrate += 10; W.log('Added liquid fertiliser.'); } }, '🧪 Fertilise'),
        h('button', { class: 'chip', onclick: () => { E.ammonia *= 0.6; E.nitrite *= 0.6; E.nitrate *= 0.6; E.detritus *= 0.8; W.log('Changed 40% of the water.'); } }, '🪣 Water change'),
      ),
      h('div', { class: 'chips' },
        toggle('Heater', () => E.heater, (v) => { E.heater = v; }),
        toggle('Lid', () => E.lid, (v) => { E.lid = v; this.scene.getObjectByName('lid').visible = v; }),
        toggle('Filter', () => E.filter, (v) => { E.filter = v; }),
        toggle('Auto-feed', () => E.autoFeed, (v) => { E.autoFeed = v; }),
        h('select', { class: 'chip', onchange: (e) => { E.lights = e.target.value; } },
          h('option', { value: 'auto' }, 'Lights 8–20'), h('option', { value: 'on' }, 'Lights on'), h('option', { value: 'off' }, 'Lights off')),
      ),
      h('label', { class: 'row' }, h('span', { id: 'setpt' }, `Heater ${E.setpoint} °C`),
        h('input', { type: 'range', min: 16, max: 30, step: 0.5, value: E.setpoint, oninput: (e) => { E.setpoint = +e.target.value; $('#setpt').textContent = `Heater ${E.setpoint} °C`; } })),
    );
    this.scene.getObjectByName('lid').visible = E.lid;

    $('#file').append(
      h('button', { class: 'chip', onclick: () => { if (confirm('Replace this tank with the starter layout?')) { W.starter(); this.afterLoad(); } } }, 'Starter tank'),
      h('button', { class: 'chip', onclick: () => { if (confirm('Clear everything and start from an empty tank?')) { W.empty(); this.afterLoad(); } } }, 'Empty tank'),
      h('button', { class: 'chip', onclick: () => this.exportFile() }, 'Export'),
      h('button', { class: 'chip', onclick: () => $('#importFile').click() }, 'Import'),
    );
    $('#importFile').addEventListener('change', (e) => this.importFile(e.target.files[0]));
    $('#togglePanel').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
  }

  addFlies() {
    const W = this.world;
    let n = 0;
    for (let k = 0; k < 10; k++) {
      const p = W.randomSpot((x, y, z, s) => s === -Infinity);
      if (p && W.animals.add('fly', p.clone().setY(p.y + 4))) n++;
    }
    this.toast(n ? `Added ${n} fruit flies.` : 'No dry land for flies to land on.');
  }

  setSpeed(i) {
    this.speed = i;
    document.querySelectorAll('#speed .chip').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
  }

  afterLoad() {
    this.selected = null;
    this.renderOptions();
    this.refresh();
    this.renderLog();
  }

  refresh() {
    const W = this.world, E = W.env;
    const light = E.light();
    $('#clock').textContent = `Day ${E.day + 1} · ${E.clock} ${light > 0.5 ? '☀' : light > 0.05 ? '◐' : '☾'}`;
    const rows = [
      ['Temperature', E.temp.toFixed(1) + ' °C', E.temp < 19 || E.temp > 28 ? 'bad' : ''],
      ['Humidity', Math.round(E.humidity) + ' %', E.humidity < 60 ? 'warn' : ''],
      ['Water', W.water.volumeLitres().toFixed(1) + ' L', ''],
      ['Ammonia', E.ammonia.toFixed(2) + ' ppm', E.ammonia > 0.5 ? 'bad' : E.ammonia > 0.2 ? 'warn' : ''],
      ['Nitrite', E.nitrite.toFixed(2) + ' ppm', E.nitrite > 0.5 ? 'bad' : E.nitrite > 0.25 ? 'warn' : ''],
      ['Nitrate', E.nitrate.toFixed(0) + ' ppm', E.nitrate > 60 ? 'bad' : E.nitrate > 40 ? 'warn' : ''],
      ['Oxygen', E.oxygen.toFixed(1) + ' mg/L', E.oxygen < 4 ? 'bad' : E.oxygen < 5 ? 'warn' : ''],
      ['Bacteria', Math.round(E.cycle * 100) + ' % cycled', E.cycle < 0.5 ? 'warn' : ''],
      ['Detritus', E.detritus.toFixed(1) + ' g', E.detritus > 15 ? 'warn' : ''],
    ];
    $('#stats').innerHTML = rows.map(([k, v, c]) => `<div class="stat ${c}"><span>${k}</span><b>${v}</b></div>`).join('');

    // Census.
    const out = [];
    for (const [id, sp] of Object.entries(SPECIES)) {
      const arr = W.animals.by[id];
      if (!arr.length) continue;
      const hp = arr.reduce((s, a) => s + a.health, 0) / arr.length;
      const hu = arr.reduce((s, a) => s + a.hunger, 0) / arr.length;
      const worry = arr.flatMap((a) => a.why ?? []);
      const top = worry.length ? mode(worry) : '';
      out.push(`<div class="census"><span class="n">${arr.length}</span><span class="nm">${sp.name}</span>
        <span class="bar" title="health"><i style="width:${Math.round(hp * 100)}%;background:${hp > 0.6 ? '#6fcf7a' : hp > 0.3 ? '#e6b84a' : '#e65a4a'}"></i></span>
        <span class="bar hunger" title="hunger"><i style="width:${Math.round(hu * 100)}%"></i></span>
        ${top ? `<span class="why">${top}</span>` : ''}</div>`);
    }
    const plantCount = W.plants.list.length;
    const sick = W.plants.list.filter((p) => p.health < 0.6).length;
    out.push(`<div class="census"><span class="n">${plantCount}</span><span class="nm">Plants</span>${sick ? `<span class="why">${sick} struggling</span>` : ''}</div>`);
    $('#census').innerHTML = out.join('');
    this.renderInspect();
  }

  renderLog() {
    $('#log').innerHTML = this.world.logs.slice(0, 14).map((l) => `<div class="log ${l.kind}"><i>${l.t}</i> ${l.msg}</div>`).join('');
  }

  renderInspect() {
    const s = this.selected;
    const box = $('#inspect');
    if (!s || s.dead) { box.hidden = true; this.marker.visible = false; return; }
    box.hidden = false;
    if (s.kind === 'animal') {
      const a = s.obj, sp = SPECIES[a.sp];
      const days = (a.age / 1440).toFixed(1);
      box.innerHTML = `<b>${sp.name}</b><div class="sub">${sp.group} · ${days} days old</div>
        <div class="stat"><span>Health</span><b>${Math.round(a.health * 100)} %</b></div>
        <div class="stat"><span>Hunger</span><b>${Math.round(a.hunger * 100)} %</b></div>
        <div class="stat"><span>Needs</span><b>${sp.temp[0]}–${sp.temp[1]} °C${sp.humidity ? `, ${sp.humidity}%+ RH` : ''}</b></div>
        <div class="stat"><span>Eats</span><b>${sp.eats.join(', ')}</b></div>
        ${a.why?.length ? `<div class="stat bad"><span>Stress</span><b>${a.why.join(', ')}</b></div>` : '<div class="stat good"><span>Status</span><b>content</b></div>'}
        <p class="note">${sp.note}</p>`;
    } else {
      const p = s.obj, sp = PLANTS[p.id];
      box.innerHTML = `<b>${sp.name}</b><div class="sub">${sp.habitat.split('|').join(' / ')}</div>
        <div class="stat"><span>Health</span><b>${Math.round(p.health * 100)} %</b></div>
        <div class="stat"><span>Grown</span><b>${Math.round(p.grown * 100)} %</b></div>
        <p class="note">${sp.note}</p>`;
    }
  }

  // --- Pointer -----------------------------------------------------------
  bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => { this.setMouse(e); this.hover(); });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.tool === 'view') return;
      this.setMouse(e);
      this.down = true;
      this.strokeChanged = false;
      el.setPointerCapture(e.pointerId);
      this.click();
    });
    const up = () => {
      if (!this.down) return;
      this.down = false;
      if (this.strokeChanged) {
        this.world.groundChanged();
        this.strokeChanged = false;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMouse(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick(kinds) {
    const W = this.world;
    this.ray.setFromCamera(this.mouse, this.camera);
    const objs = [];
    if (kinds.includes('terrain')) objs.push(W.terrain.mesh, ...W.decor.rockMeshes);
    if (kinds.includes('wall')) objs.push(W.wall.mesh);
    if (kinds.includes('water')) { if (W.water.surface.visible) objs.push(W.water.surface); objs.push(...W.water.ponds.map((p) => p.mesh)); }
    const hits = this.ray.intersectObjects(objs, false);
    if (!hits.length) return null;
    const hit = hits[0];
    let surface = hit.object.userData.surface ?? 'terrain';
    if (hit.object.name === 'rocks') surface = 'terrain';
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { point: hit.point.clone(), surface, normal, object: hit.object };
  }

  hover() {
    if (!['sculpt', 'paint', 'rock'].includes(this.tool)) { this.cursor.visible = false; return; }
    const hit = this.pick(['terrain', 'wall']);
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.point).addScaledVector(hit.normal, 0.15);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.surface === 'wall' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
    const s = this.brush.size;
    this.cursor.scale.set(s, s, s);
  }

  // Continuous brush while the button is held.
  frame(dt) {
    this.frameMarker();
    if (!this.down || !['sculpt', 'paint'].includes(this.tool)) return;
    const hit = this.pick(['terrain', 'wall']);
    if (!hit) return;
    const W = this.world;
    const onWall = hit.surface === 'wall';
    const f = onWall ? W.wall.field : W.terrain.field;
    const [a, b] = onWall ? [hit.point.x, hit.point.y] : [hit.point.x, hit.point.z];
    const st = this.brush.strength * dt * 12;
    if (this.tool === 'paint') f.brush(a, b, this.brush.size, 'paint', st, { mat: this.sub.paint });
    else {
      const op = this.sub.sculpt;
      if (!this.flatTarget) this.flatTarget = onWall ? f.sample(a, b) : hit.point.y;
      f.brush(a, b, this.brush.size, op, st * (op === 'raise' || op === 'lower' ? 0.5 : 1), { target: this.flatTarget });
    }
    this.strokeChanged = true;
    W.terrain.update();
    W.wall.update();
  }

  click() {
    const W = this.world;
    this.flatTarget = null;
    switch (this.tool) {
      case 'rock': {
        const hit = this.pick(['terrain']);
        if (!hit) return;
        W.decor.addRock(hit.point.x, hit.point.z, this.brush.size * 0.8);
        W.groundChanged();
        break;
      }
      case 'water': {
        if (this.sub.water === 'pond') {
          const hit = this.pick(['terrain']);
          if (!hit) return;
          const r = W.water.addPond(hit.point.x, hit.point.z);
          if (r.error) this.toast(r.error, 'bad');
          else { this.toast('Pond filled.'); W.plants.onWaterChanged(W); W.water.refreshFalls(W.wall); }
        } else {
          const hit = this.pick(['terrain', 'wall']);
          if (!hit) return;
          const src = hit.point.clone();
          if (hit.surface === 'wall') src.z += 0.6;
          const r = W.water.addFall(src, W.wall);
          if (r.error) this.toast(r.error, 'bad');
          else { this.toast('Waterfall running. More humidity and oxygen.'); W.log('Added a waterfall.'); }
        }
        break;
      }
      case 'plant': {
        const id = this.sub.plant;
        const floating = PLANTS[id].habitat === 'floating';
        const hit = this.pick(floating ? ['terrain', 'wall', 'water'] : ['terrain', 'wall']);
        if (!hit) return;
        const err = W.plants.canPlace(id, hit, W);
        if (err) { this.toast(err, 'bad'); return; }
        const pos = hit.point.clone();
        if (PLANTS[id].habitat === 'floating') pos.y = W.water.surfaceAt(pos.x, pos.z);
        const p = W.plants.add(id, pos, { normal: hit.normal, surface: hit.surface === 'wall' ? 'wall' : 'terrain' });
        if (!p) this.toast('Too many of this plant.', 'bad');
        break;
      }
      case 'animal': {
        const id = this.sub.animal;
        const hit = this.pick(['terrain', 'water']);
        if (!hit) return;
        if (hit.surface === 'water' || hit.surface === 'pond') {
          // Use the ground under the water.
          hit.point.y = W.terrain.heightAt(hit.point.x, hit.point.z);
        }
        const pl = W.animals.placement(id, hit);
        if (pl.error) { this.toast(pl.error, 'bad'); return; }
        const n = BATCH[id] ?? 1;
        let added = 0;
        for (let k = 0; k < n; k++) {
          const jitter = n > 1 ? new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4) : new THREE.Vector3();
          const p2 = pl.pos.clone().add(jitter);
          const again = W.animals.placement(id, { point: p2 });
          if (again.pos && W.animals.add(id, again.pos)) added++;
        }
        if (added) W.log(`Released ${added} ${SPECIES[id].name.toLowerCase()}.`);
        break;
      }
      case 'inspect': {
        this.ray.setFromCamera(this.mouse, this.camera);
        const a = W.animals.pick(this.ray.ray, 2.5);
        if (a) { this.selected = { kind: 'animal', obj: a }; this.renderInspect(); break; }
        const hit = this.pick(['terrain', 'wall', 'water']);
        const p = hit && W.plants.near(hit.point, 5);
        this.selected = p ? { kind: 'plant', obj: p } : null;
        this.renderInspect();
        break;
      }
      case 'erase': {
        this.ray.setFromCamera(this.mouse, this.camera);
        const a = W.animals.pick(this.ray.ray, 2);
        if (a) { W.animals.remove(a, 'removed'); this.toast(`Removed a ${SPECIES[a.sp].name.toLowerCase()}.`); break; }
        const hit = this.pick(['terrain', 'wall', 'water']);
        if (!hit) return;
        const p = W.plants.near(hit.point, 3);
        if (p) { W.plants.remove(p); this.toast('Plant removed.'); break; }
        const f = W.water.nearestFall(hit.point, 3);
        if (f) { W.water.removeFall(f); this.toast('Waterfall removed.'); break; }
        const pond = W.water.pondAt(hit.point.x, hit.point.z);
        if (pond) { W.water.removePond(pond); W.water.refreshFalls(W.wall); this.toast('Pond drained.'); break; }
        const r = W.decor.rockNear(hit.point, 0.5);
        if (r) { W.decor.removeRock(r); W.groundChanged(); this.toast('Rock removed.'); break; }
        break;
      }
    }
  }

  frameMarker() {
    const s = this.selected;
    if (!s || s.dead || s.obj.dead) { this.marker.visible = false; return; }
    this.marker.visible = true;
    this.marker.position.copy(s.obj.pos).add(new THREE.Vector3(0, 0.3, 0));
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { this.setSpeed(this.speed === 0 ? 1 : 0); e.preventDefault(); }
      else if (e.key === 'Escape') this.setTool('view');
      else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('panel-hidden');
      else if (/^[1-9]$/.test(e.key)) this.setTool(TOOLS[+e.key - 1].id);
    });
  }

  // --- Files -------------------------------------------------------------
  autosave() {
    try { localStorage.setItem('paludarium.save', JSON.stringify(this.world.serialize())); } catch (e) { /* storage full or blocked */ }
  }

  exportFile() {
    const blob = new Blob([JSON.stringify(this.world.serialize())], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `paludarium-day${this.world.env.day + 1}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  async importFile(file) {
    if (!file) return;
    try {
      this.world.load(JSON.parse(await file.text()));
      this.afterLoad();
      this.toast('Tank imported.');
    } catch (e) { this.toast('Could not read that file: ' + e.message, 'bad'); }
  }
}

function mode(arr) {
  const c = {};
  let best = arr[0], bn = 0;
  for (const v of arr) { c[v] = (c[v] ?? 0) + 1; if (c[v] > bn) { bn = c[v]; best = v; } }
  return best;
}
