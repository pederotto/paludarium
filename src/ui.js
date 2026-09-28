// Tools (sculpt, paint, hardscape, waterways, plants, animals, inspect,
// remove), the camera keys and views, pointer handling and the side panels.

import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import CameraControls from 'camera-controls';
import { MATERIALS, SPEEDS, TANK, MAT } from './config.js';
import { PLANTS } from './plants.js';
import { SPECIES } from './animals.js';
import { PIECES } from './decor.js';
import { STAGES } from './ecology.js';

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
  { id: 'view', icon: '🖐', name: 'Look', hint: 'Drag to orbit, right-drag to pan, scroll to zoom toward the pointer. Double-click to focus. WASD pans, Q/E turns.' },
  { id: 'sculpt', icon: '⛰', name: 'Sculpt', hint: 'Drag on the ground or the background to shape it. Right-drag orbits, middle-drag pans. Ctrl+Z undoes.' },
  { id: 'paint', icon: '🖌', name: 'Paint', hint: 'Paint soil, sand, gravel, rock, moss or stone on the ground and the background. Moss grows and spreads if the air is damp.' },
  { id: 'rock', icon: '🪨', name: 'Hardscape', hint: 'Click the ground to place a piece (on top of others to stack). Click a piece to select it, then drag the handles.' },
  { id: 'water', icon: '💧', name: 'Water', hint: 'Dig channels and pools, build banks, place pump outlets. The water flows live as you shape the ground.' },
  { id: 'plant', icon: '🌿', name: 'Plants', hint: 'Pick a plant, then click where it should grow.' },
  { id: 'animal', icon: '🐸', name: 'Animals', hint: 'Pick a species, then click to release it.' },
  { id: 'inspect', icon: '🔍', name: 'Inspect', hint: 'Click an animal, plant or pool to see how it is doing.' },
  { id: 'erase', icon: '✖', name: 'Remove', hint: 'Click a plant, animal, rock or pump outlet to remove it, or a pool to drain it.' },
];

const WATER_TOOLS = [
  ['channel', 'Channel', 'Drag a path: a stream bed is carved along it, always running downhill from where you start.'],
  ['basin', 'Pool', 'Click to dig a round pool with a raised lip. Brush size is its radius, strength its depth.'],
  ['bank', 'Bank', 'Drag a path to raise a bank: hold water in or steer a stream.'],
  ['outlet', 'Outlet', 'Click the ground, a rock or the background to place a pump outlet. The blue line shows where its water will go.'],
  ['fill', 'Fill', 'Click a hollow to fill it now with water from the main pool.'],
  ['pump', 'Pump', 'Click in the main pool to move the pump.'],
];

const BATCH = { neon: 6, cory: 3, guppy: 3, shrimp: 5, isopod: 10, springtail: 20, fly: 10 };
const VIEWS = {
  front: [0, 40, 158, 0, 25, -2],
  top: [0, 175, 12, 0, 8, 0],
  left: [-150, 45, 40, 0, 22, -4],
  right: [150, 45, 40, 0, 22, -4],
  close: [-8, 30, 62, -4, 18, -8],
};

export class UI {
  constructor({ world, camera, renderer, controls, scene }) {
    this.world = world; this.camera = camera; this.renderer = renderer; this.controls = controls; this.scene = scene;
    this.tool = 'view';
    this.sub = { sculpt: 'raise', paint: MAT.moss, water: 'channel', plant: 'fernph', animal: 'neon', rock: 'boulder' };
    this.brush = { size: 5, strength: 1 };
    this.speed = 1;
    this.selected = null;
    this.piece = null;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.down = false;
    this.keys = new Set();

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
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: 0xffe08a, depthTest: false }));
    this.pathLine.renderOrder = 22;
    this.pathLine.frustumCulled = false;
    this.pathLine.visible = false;
    scene.add(this.pathLine);

    // Handles for moving, turning and scaling hardscape.
    this.tc = new TransformControls(camera, renderer.domElement);
    this.tc.setSize(0.85);
    this.tcHelper = this.tc.getHelper();
    scene.add(this.tcHelper);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) world.pushUndo();
      else this.pieceMoved(true);
    });
    this.tc.addEventListener('objectChange', () => this.pieceMoved(false));
    this.box = new THREE.BoxHelper(new THREE.Object3D(), 0xffd34d);
    this.box.visible = false;
    scene.add(this.box);

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
    TOOLS.forEach((t, i) => {
      bar.append(h('button', { class: 'tool', 'data-tool': t.id, title: `${t.name} (${i + 1})`, onclick: () => this.setTool(t.id) }, h('span', { class: 'ic' }, t.icon), h('span', { class: 'lb' }, t.name)));
    });
    const views = $('#views');
    for (const [id, label] of [['front', 'Front'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right'], ['close', 'Close']]) {
      views.append(h('button', { class: 'chip', title: `${label} view`, onclick: () => this.view(id) }, label));
    }
  }

  view(id) {
    const v = VIEWS[id];
    this.controls.setLookAt(...v, true);
  }

  setTool(id) {
    this.tool = id;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    this.setButtons();
    if (id !== 'rock') this.selectPiece(null);
    if (id !== 'water') this.world.water.hideTrace();
    this.renderOptions();
    this.hint(TOOLS.find((t) => t.id === id).hint);
    this.cursor.visible = false;
    this.world.water.outletMeshes.forEach((m) => { m.visible = id === 'water' || id === 'erase'; });
    this.world.water.pumpMesh.visible = id === 'water';
  }

  // Look: left orbits, right pans. Editing tools: left edits, right orbits,
  // middle (or Shift + right) pans. The wheel always zooms toward the pointer.
  setButtons() {
    const A = CameraControls.ACTION;
    const c = this.controls;
    const editing = this.tool !== 'view';
    const pan = this.keys.has('Shift');
    c.mouseButtons.left = editing ? A.NONE : A.ROTATE;
    c.mouseButtons.right = editing ? (pan ? A.TRUCK : A.ROTATE) : A.TRUCK;
    c.mouseButtons.middle = A.TRUCK;
    c.mouseButtons.wheel = A.DOLLY;
    c.touches.one = editing ? A.NONE : A.TOUCH_ROTATE;
    c.touches.two = A.TOUCH_DOLLY_TRUCK;
    c.touches.three = A.TOUCH_ROTATE;
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
    const W = this.world, H = W.water.hydro;
    switch (this.tool) {
      case 'sculpt':
        o.append(chips([['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']], 'sculpt'));
        o.append(slider('Brush size', 'size', 1.5, 14, 0.5), slider('Strength', 'strength', 0.2, 3, 0.1));
        o.append(this.undoButton());
        break;
      case 'paint':
        o.append(chips(MATERIALS.map((m, i) => [i, m.name]), 'paint'));
        o.append(slider('Brush size', 'size', 1.5, 14, 0.5), slider('Strength', 'strength', 0.2, 3, 0.1));
        o.append(this.undoButton());
        break;
      case 'rock': {
        o.append(chips(Object.entries(PIECES).map(([id, p]) => [id, p.name]), 'rock'));
        o.append(slider('Size', 'size', 1.5, 14, 0.5));
        const p = this.piece;
        if (p) {
          const mode = this.tc.mode;
          const b = (label, m, key) => h('button', { class: 'chip' + (mode === m ? ' on' : ''), title: `${label} (${key})`, onclick: () => { this.tc.setMode(m); this.renderOptions(); } }, label);
          o.append(h('div', { class: 'grp' }, `Selected: ${PIECES[p.type].name}`));
          o.append(h('div', { class: 'chips' }, b('Move', 'translate', 'G'), b('Turn', 'rotate', 'R'), b('Scale', 'scale', 'T')));
          o.append(h('div', { class: 'chips' },
            h('button', { class: 'chip', title: 'Ctrl+D', onclick: () => this.duplicatePiece() }, 'Duplicate'),
            h('button', { class: 'chip', title: 'Sit it on whatever is under it', onclick: () => this.dropPiece() }, 'Drop to ground'),
            h('button', { class: 'chip', title: 'Stand it up straight', onclick: () => this.levelPiece() }, 'Level'),
            h('button', { class: 'chip', title: 'Delete', onclick: () => this.deletePiece() }, 'Delete'),
            h('button', { class: 'chip', title: 'Esc', onclick: () => this.selectPiece(null) }, 'Done'),
          ));
        } else o.append(h('p', { class: 'note' }, 'Click the ground to place; click on top of a piece to stack. Click a piece to move, turn or scale it.'));
        o.append(this.undoButton());
        break;
      }
      case 'water': {
        o.append(chips(WATER_TOOLS, 'water'));
        const cur = WATER_TOOLS.find((t) => t[0] === this.sub.water);
        o.append(h('p', { class: 'note' }, cur[2]));
        if (['channel', 'bank', 'basin'].includes(this.sub.water)) {
          o.append(slider(this.sub.water === 'basin' ? 'Radius' : 'Width', 'size', 1.5, 10, 0.5), slider('Depth', 'strength', 0.3, 3, 0.1));
        }
        o.append(h('div', { class: 'grp' }, 'Water'));
        o.append(h('label', { class: 'row' }, h('span', {}, 'Main pool level'),
          h('input', { type: 'range', min: 0, max: TANK.h - 10, step: 0.5, value: W.water.level, id: 'wl',
            oninput: (e) => { W.setWaterLevel(+e.target.value); } })));
        o.append(h('label', { class: 'row' }, h('span', { id: 'pumpLbl' }, `Pump ${H.pump.rate} L/h`),
          h('input', { type: 'range', min: 20, max: 600, step: 10, value: H.pump.rate,
            oninput: (e) => { H.pump.rate = +e.target.value; $('#pumpLbl').textContent = `Pump ${H.pump.rate} L/h`; } })));
        const toggle = (label, get, set, title) => {
          const b = h('button', { class: 'chip', title, onclick: () => { set(!get()); b.classList.toggle('on', get()); } }, label);
          b.classList.toggle('on', get());
          return b;
        };
        o.append(h('div', { class: 'chips' },
          toggle('Pump on', () => H.pump.on, (v) => { H.pump.on = v; }),
          toggle('Auto top-up', () => H.topUp, (v) => { H.topUp = v; if (v) H.targetTotal = Math.max(H.targetTotal, H.total()); }, 'Replaces evaporated water, like a float valve'),
        ));
        o.append(h('div', { id: 'waterinfo', class: 'note' }));
        if (H.outlets.length) {
          o.append(h('div', { class: 'grp' }, 'Outlets'));
          H.outlets.forEach((out, i) => o.append(h('div', { class: 'stat' }, h('span', {}, `${i + 1}. ${out.wall ? 'Background spring' : 'On the ground'}`),
            h('button', { class: 'chip', onclick: () => { W.pushUndo(); W.water.removeOutlet(out); this.renderOptions(); } }, 'Remove'))));
        }
        o.append(this.undoButton());
        this.renderWaterInfo();
        break;
      }
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
        for (const [id, s] of Object.entries(SPECIES)) if (s.kind !== 'egg') (groups[s.group] ??= []).push([id, s.name, s.note]);
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

  undoButton() {
    return h('div', { class: 'chips' }, h('button', { class: 'chip', title: 'Ctrl+Z', onclick: () => this.undo() }, '↶ Undo'));
  }

  undo() {
    if (this.world.undo()) { this.selectPiece(null); this.toast('Undone.'); this.renderOptions(); } else this.toast('Nothing to undo.');
  }

  renderWaterInfo() {
    const el = $('#waterinfo');
    if (!el) return;
    const W = this.world, H = W.water.hydro;
    const total = H.total() / 1000, main = H.resVol / 1000;
    const pools = H.pools.reduce((s, p) => s + p.litres, 0);
    const pump = !H.outlets.length ? 'no outlets yet' : !H.pump.on ? 'switched off' : H.pump.running ? `${H.pump.rate} L/h` : 'running dry! Add water';
    el.innerHTML = `Total ${total.toFixed(1)} L · main pool ${main.toFixed(1)} L<br>Pools ${pools.toFixed(2)} L · streams ${(total - main - pools).toFixed(2)} L<br>Main level ${W.water.level.toFixed(1)} cm · pump ${pump}`;
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
        h('button', { class: 'chip', title: 'Fishless cycling: feeds the bacteria of a new tank', onclick: () => { E.ammonia += 1; W.log('Dosed ammonia to feed the bacteria.'); } }, '⚗ Dose ammonia'),
        h('button', { class: 'chip', onclick: () => { E.ammonia *= 0.6; E.nitrite *= 0.6; E.nitrate *= 0.6; E.detritus *= 0.8; E.algae *= 0.7; W.log('Changed 40% of the water.'); } }, '🪣 Water change'),
      ),
      h('div', { class: 'chips' },
        toggle('Heater', () => E.heater, (v) => { E.heater = v; }),
        toggle('Lid', () => E.lid, (v) => { E.lid = v; this.scene.getObjectByName('lid').visible = v; }),
        toggle('Filter', () => E.filter, (v) => { E.filter = v; }),
        toggle('Auto-feed', () => E.autoFeed, (v) => { E.autoFeed = v; }),
        toggle('Fly culture', () => E.culture, (v) => { E.culture = v; }),
        h('select', { class: 'chip', onchange: (e) => { E.lights = e.target.value; } },
          h('option', { value: 'auto' }, 'Lights 8–20'), h('option', { value: 'on' }, 'Lights on'), h('option', { value: 'off' }, 'Lights off')),
      ),
      h('label', { class: 'row' }, h('span', { id: 'setpt' }, `Heater ${E.setpoint} °C`),
        h('input', { type: 'range', min: 16, max: 30, step: 0.5, value: E.setpoint, oninput: (e) => { E.setpoint = +e.target.value; $('#setpt').textContent = `Heater ${E.setpoint} °C`; } })),
    );
    this.scene.getObjectByName('lid').visible = E.lid;

    $('#file').append(
      h('button', { class: 'chip', onclick: () => { if (confirm('Replace this tank with the starter layout?')) { W.starter(); this.afterLoad(); } } }, 'Starter tank'),
      h('button', { class: 'chip', onclick: () => { if (confirm('Clear everything and set up a new, empty tank?')) { W.empty(); this.afterLoad(); } } }, 'New tank'),
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
    this.selectPiece(null);
    this.renderOptions();
    this.refresh();
    this.renderLog();
  }

  refresh() {
    const W = this.world, E = W.env;
    const light = E.light();
    $('#clock').textContent = `Day ${E.day + 1} · ${E.clock} ${light > 0.5 ? '☀' : light > 0.05 ? '◐' : '☾'}`;
    const stage = STAGES.find((s) => s.id === W.sim.eco.updateStage());
    const prog = W.sim.eco.progress();
    const rows = [
      ['Temperature', E.temp.toFixed(1) + ' °C', E.temp < 19 || E.temp > 28 ? 'bad' : ''],
      ['Humidity', Math.round(E.humidity) + ' %', E.humidity < 60 ? 'warn' : ''],
      ['Water', W.water.volumeLitres().toFixed(1) + ' L', W.water.hydro.outlets.length && !W.water.hydro.pump.running && W.water.hydro.pump.on ? 'bad' : ''],
      ['Ammonia', E.ammonia.toFixed(2) + ' ppm', E.ammonia > 0.5 ? 'bad' : E.ammonia > 0.2 ? 'warn' : ''],
      ['Nitrite', E.nitrite.toFixed(2) + ' ppm', E.nitrite > 0.5 ? 'bad' : E.nitrite > 0.25 ? 'warn' : ''],
      ['Nitrate', E.nitrate.toFixed(0) + ' ppm', E.nitrate > 60 ? 'bad' : E.nitrate > 40 ? 'warn' : ''],
      ['Oxygen', E.oxygen.toFixed(1) + ' mg/L', E.oxygen < 4 ? 'bad' : E.oxygen < 5 ? 'warn' : ''],
      ['Bacteria', Math.round(E.cycle * 100) + ' % cycled', E.cycle < 0.5 ? 'warn' : ''],
      ['Algae', E.algae > 0.3 ? 'bloom' : E.diatoms > 0.3 ? 'diatoms' : E.algae > 0.15 ? 'some' : 'little', E.algae > 0.3 ? 'bad' : E.algae > 0.15 || E.diatoms > 0.3 ? 'warn' : ''],
      ['Moss cover', Math.round(W.mossFraction() * 100) + ' %', ''],
      ['Detritus', E.detritus.toFixed(1) + ' g', E.detritus > 15 ? 'warn' : ''],
    ];
    $('#stage').innerHTML = `<div class="stat"><span>Tank</span><b>${stage.name} · day ${Math.floor(E.tankDays) + 1}</b></div>
      <div class="bar" title="maturity"><i style="width:${Math.round(prog * 100)}%;background:#7fd1a0"></i></div><div class="note">${stage.tip}</div>`;
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
    if (this.tool === 'water') this.renderWaterInfo();
  }

  renderLog() {
    $('#log').innerHTML = this.world.logs.slice(0, 14).map((l) => `<div class="log ${l.kind}"><i>${l.t}</i> ${l.msg}</div>`).join('');
  }

  renderInspect() {
    const s = this.selected;
    const box = $('#inspect');
    if (!s || s.dead || s.obj?.dead) { box.hidden = true; this.marker.visible = false; return; }
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
    } else if (s.kind === 'pool') {
      const p = s.obj;
      box.innerHTML = `<b>Pool</b><div class="sub">fed by the pump or the rain of a stream</div>
        <div class="stat"><span>Water</span><b>${p.litres.toFixed(2)} L</b></div>
        <div class="stat"><span>Surface</span><b>${Math.round(p.area)} cm²</b></div>
        <div class="stat"><span>Level</span><b>${p.level.toFixed(1)} cm</b></div>`;
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
    el.addEventListener('pointermove', (e) => { this.setMouse(e); this.hover(); if (this.down) this.drag(); });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.tc.dragging || this.tc.axis) return;   // the handles take this one
      this.setMouse(e);
      if (this.tool === 'view') {
        // A tap on the water makes ripples.
        const hit = this.pick(['terrain', 'water']);
        if (hit?.surface === 'water') this.world.fx?.addDrop(hit.point.x, hit.point.z, -9, 1.1);
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
      if (this.strokeChanged) {
        this.world.groundChanged();
        this.strokeChanged = false;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      this.setMouse(e);
      const hit = this.pick(['terrain', 'wall', 'water']);
      if (!hit) return;
      this.controls.moveTo(hit.point.x, hit.point.y, hit.point.z, true);
      if (this.controls.distance > 70) this.controls.dollyTo(60, true);
    });
  }

  setMouse(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  // Ray against the ground, hardscape and background; with 'water', a hit
  // on any water surface in front of that counts first.
  pick(kinds) {
    const W = this.world;
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
        if (t > 0 && t < hit.distance) {
          return { point: q, surface: W.water.inMainPool(q.x, q.z) ? 'water' : 'pond', normal: new THREE.Vector3(0, 1, 0), object: null, ground: res };
        }
      }
    }
    return res;
  }

  hover() {
    const W = this.world;
    const brushTools = ['sculpt', 'paint'].includes(this.tool) || (this.tool === 'water' && ['channel', 'bank', 'basin'].includes(this.sub.water));
    if (this.tool === 'water' && ['outlet', 'fill'].includes(this.sub.water) && !this.down) {
      const now = performance.now();
      if (now - (this._traceT ?? 0) > 90) {
        this._traceT = now;
        const hit = this.pick(['terrain', 'wall']);
        if (hit) {
          let x = hit.point.x, z = hit.point.z;
          if (hit.surface === 'wall') z = W.wall.zAt(x, hit.point.y) + 1.2;
          const t = W.water.showTrace(x, z);
          this.hint(traceText(t, this.sub.water));
        } else W.water.hideTrace();
      }
    }
    if (!brushTools) { this.cursor.visible = false; return; }
    const hit = this.pick(this.tool === 'water' ? ['terrain'] : ['terrain', 'wall']);
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.point).addScaledVector(hit.normal, 0.15);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.surface === 'wall' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
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
    const W = this.world;
    const pts = this.path;
    this.path = null;
    this.pathLine.visible = false;
    if (pts.length < 2) return;
    W.pushUndo();
    if (this.sub.water === 'channel') W.terrain.carveChannel(pts, this.brush.size * 0.5, this.brush.strength);
    else W.terrain.raiseBank(pts, this.brush.size * 0.5, this.brush.strength * 1.5);
    W.groundChanged();
    this.toast(this.sub.water === 'channel' ? 'Channel dug. Water will run along it from where you started.' : 'Bank raised.');
  }

  // Continuous brush while the button is held.
  frame(dt) {
    this.frameMarker();
    this.frameKeys(dt);
    if (this.piece) this.box.update();
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

  click() {
    const W = this.world;
    this.flatTarget = null;
    switch (this.tool) {
      case 'sculpt':
      case 'paint':
        W.pushUndo();
        break;
      case 'rock': {
        const hit = this.pick(['terrain']);
        if (!hit) return;
        const piece = hit.object && W.decor.pieceAt(hit.object);
        // Click a piece to select it; Shift+click (or click with one
        // selected) places a new one on top of it.
        if (piece && !this.keys.has('Shift') && piece !== this.piece) { this.selectPiece(piece); return; }
        if (this.piece && piece === this.piece) return;
        if (this.piece && !piece) { this.selectPiece(null); return; }
        const type = this.sub.rock;
        const size = PIECES[type].size * (this.brush.size / 6);
        W.pushUndo();
        // On the ground it settles into the substrate; on another piece it
        // sits where you clicked.
        const onTop = piece || !PIECES[type].stamp;
        const p = W.decor.addPiece(type, hit.point.x, hit.point.z, { size, y: onTop ? hit.point.y - size * 0.08 : undefined });
        if (!p) { this.toast('Still loading models…', 'bad'); return; }
        W.groundChanged();
        this.selectPiece(p);
        break;
      }
      case 'water': {
        const mode = this.sub.water;
        if (mode === 'channel' || mode === 'bank') {
          const hit = this.pick(['terrain']);
          if (hit) this.path = [hit.point.clone()];
          return;
        }
        if (mode === 'basin') {
          const hit = this.pick(['terrain']);
          if (!hit) return;
          W.pushUndo();
          W.terrain.digBasin(hit.point.x, hit.point.z, this.brush.size, this.brush.strength * 2);
          W.groundChanged();
          this.toast('Pool dug. Fill it, or lead a stream into it.');
          return;
        }
        if (mode === 'outlet') {
          const hit = this.pick(['terrain', 'wall']);
          if (!hit) return;
          W.pushUndo();
          const wall = hit.surface === 'wall';
          const pos = hit.point.clone();
          if (wall) pos.z += 0.6; else pos.y += 0.2;
          W.water.addOutlet(pos, wall);
          W.log(wall ? 'Added a spring on the background.' : 'Added a pump outlet.');
          this.toast(W.water.hydro.pump.running || W.water.level > 3 ? 'Outlet placed: water is flowing.' : 'Outlet placed. The main pool needs water for the pump to run.');
          this.renderOptions();
          return;
        }
        if (mode === 'fill') {
          const hit = this.pick(['terrain']);
          if (!hit) return;
          const r = W.water.fillAt(hit.point.x, hit.point.z);
          if (r.error) this.toast(r.error, 'bad'); else { this.toast(`Filled with ${r.litres.toFixed(2)} L from the main pool.`); W.plants.onWaterChanged(W); }
          return;
        }
        if (mode === 'pump') {
          const hit = this.pick(['terrain', 'water']);
          if (!hit) return;
          const p = hit.ground?.point ?? hit.point;
          if (!W.water.inMainPool(p.x, p.z) && W.water.level > 0.5) { this.toast('Put the pump in the main pool.', 'bad'); return; }
          W.pushUndo();
          W.water.setPump(p.x, p.z);
          this.toast('Pump moved.');
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
        if (floating) pos.y = W.water.surfaceAt(pos.x, pos.z, 0.2);
        const p = W.plants.add(id, pos, { normal: hit.normal, surface: hit.surface === 'wall' ? 'wall' : 'terrain' });
        if (!p) this.toast('Too many of this plant.', 'bad');
        break;
      }
      case 'animal': {
        const id = this.sub.animal;
        const hit = this.pick(SPECIES[id].kind === 'gecko' ? ['terrain', 'wall', 'water'] : ['terrain', 'water']);
        if (!hit) return;
        if (hit.ground) hit.point = hit.ground.point.clone();
        const pl = W.animals.placement(id, hit);
        if (pl.error) { this.toast(pl.error, 'bad'); return; }
        const n = BATCH[id] ?? 1;
        let added = 0;
        for (let k = 0; k < n; k++) {
          const jitter = n > 1 ? new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4) : new THREE.Vector3();
          const p2 = pl.pos.clone().add(jitter);
          const again = pl.wall ? pl : W.animals.placement(id, { point: p2 });
          const a = again.pos && W.animals.add(id, again.pos);
          if (a) { added++; if (pl.wall) { a.onWall = true; a.wallMode = true; a.normal = new THREE.Vector3(0, 0, 1); } }
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
        const pool = hit && !p && W.water.pondAt(hit.point.x, hit.point.z);
        this.selected = p ? { kind: 'plant', obj: p } : pool ? { kind: 'pool', obj: pool } : null;
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
        const o = W.water.hydro.nearestOutlet(hit.point, 3);
        if (o) { W.pushUndo(); W.water.removeOutlet(o); this.toast('Outlet removed.'); break; }
        const piece = hit.object && W.decor.pieceAt(hit.object);
        if (piece) { W.pushUndo(); W.decor.removePiece(piece); W.groundChanged(); this.toast(`${PIECES[piece.type].name} removed.`); break; }
        const pool = W.water.pondAt(hit.point.x, hit.point.z);
        if (pool) { W.water.drainPool(pool); this.toast('Pool drained into the main pool.'); break; }
        break;
      }
    }
  }

  // --- Hardscape editing -------------------------------------------------
  selectPiece(p) {
    this.piece = p;
    if (p) {
      this.tc.attach(p.mesh);
      this.box.setFromObject(p.mesh);
      this.box.visible = true;
    } else {
      this.tc.detach();
      this.box.visible = false;
    }
    if (this.tool === 'rock') this.renderOptions();
  }

  // While a piece is dragged its stamp follows (a few times a second), so
  // water and animals see it move; the full update runs when you let go.
  pieceMoved(final) {
    const p = this.piece;
    if (!p) return;
    const D = this.world.decor;
    D.clampPiece(p);
    const now = performance.now();
    if (!final && now - (this._moveT ?? 0) < 120) return;
    this._moveT = now;
    D.restamp(p);
    this.world.groundChanged({ quick: !final });
  }

  duplicatePiece() {
    if (!this.piece) return;
    this.world.pushUndo();
    const np = this.world.decor.duplicate(this.piece);
    this.world.groundChanged();
    this.selectPiece(np);
  }

  dropPiece() {
    if (!this.piece) return;
    this.world.pushUndo();
    this.world.decor.settle(this.piece, 0.08);
    this.pieceMoved(true);
  }

  levelPiece() {
    if (!this.piece) return;
    this.world.pushUndo();
    const e = new THREE.Euler().setFromQuaternion(this.piece.mesh.quaternion, 'YXZ');
    this.piece.mesh.rotation.set(0, e.y, 0, 'YXZ');
    this.pieceMoved(true);
  }

  deletePiece() {
    if (!this.piece) return;
    const p = this.piece;
    this.world.pushUndo();
    this.selectPiece(null);
    this.world.decor.removePiece(p);
    this.world.groundChanged();
  }

  frameMarker() {
    const s = this.selected;
    if (!s || s.dead || !s.obj || s.obj.dead || s.kind === 'pool') { this.marker.visible = false; return; }
    this.marker.visible = true;
    this.marker.position.copy(s.obj.pos).add(new THREE.Vector3(0, 0.3, 0));
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
  }

  // --- Keys ----------------------------------------------------------------
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const k = e.key;
      if (k === 'Shift') { this.keys.add('Shift'); this.setButtons(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { this.undo(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'd' || k === 'D')) { this.duplicatePiece(); e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { this.setSpeed(this.speed === 0 ? 1 : 0); e.preventDefault(); }
      else if (k === 'Escape') { if (this.piece) this.selectPiece(null); else this.setTool('view'); }
      else if (k === 'Delete' || k === 'Backspace') this.deletePiece();
      else if (this.piece && (k === 'g' || k === 'G')) { this.tc.setMode('translate'); this.renderOptions(); }
      else if (this.piece && (k === 'r' || k === 'R')) { this.tc.setMode('rotate'); this.renderOptions(); }
      else if (this.piece && (k === 't' || k === 'T')) { this.tc.setMode('scale'); this.renderOptions(); }
      else if (k === 'f' || k === 'F') this.focus();
      else if (k === 'h' || k === 'H') document.body.classList.toggle('panel-hidden');
      else if (/^[1-9]$/.test(k)) this.setTool(TOOLS[+k - 1].id);
      else this.keys.add(k.toLowerCase());
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') { this.keys.delete('Shift'); this.setButtons(); return; }
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  // WASD pans over the tank, Q/E turn around it, Z/X zoom, arrows tilt.
  frameKeys(dt) {
    const c = this.controls;
    const k = this.keys;
    if (!k.size) return;
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
    const t = this.piece?.mesh.position ?? this.selected?.obj?.pos;
    if (t) { this.controls.moveTo(t.x, t.y, t.z, true); this.controls.dollyTo(Math.min(this.controls.distance, 50), true); } else this.view('front');
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

function traceText(t, mode) {
  const pools = t.pits.length;
  const lit = t.pits.reduce((s, p) => s + p.litres, 0);
  const end = t.end === 'pool' ? 'then into the main pool' : t.end === 'open' ? 'and spreads out over a wide hollow' : 'and ends in a hollow';
  if (mode === 'fill') return pools ? `Fills a hollow of ${t.pits[0].litres.toFixed(2)} L here.` : 'Water here runs away: no hollow to fill.';
  return pools ? `Water from here fills ${pools} pool${pools > 1 ? 's' : ''} (${lit.toFixed(2)} L) on the way, ${end}.` : `Water from here runs straight downhill, ${end}.`;
}

function mode(arr) {
  const c = {};
  let best = arr[0], bn = 0;
  for (const v of arr) { c[v] = (c[v] ?? 0) + 1; if (c[v] > bn) { bn = c[v]; best = v; } }
  return best;
}
