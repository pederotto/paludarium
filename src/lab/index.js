// The test lab (lab.html): a plain arena where animals are released, selected and watched, with the clock under your hand.
// This file wires the arena, the pointer, the selection ring and the readout together and publishes `window.lab`, the same
// handle a headless run (tools/steps/lab.mjs) drives.

import * as THREE from 'three/webgpu';
import { effect } from '@preact/signals';
import { SPECIES } from '../sim/animals.js';
import { TANK } from '../sim/tank.js';
import { L } from './state.js';
import { buildArena, shapeGround, setDepth, setView, setPaused, setRate, stepFrames } from './arena.js';
import { animalAt, groundAt, onTap } from './pick.js';
import { spawn } from './spawn.js';
import { readout, census } from './readout.js';
import { createDriver } from './driver.js';
import { createRadar } from './radar.js';
import { buildReport, copyText } from './report.js';

export async function start(game, params) {
  let ring = null;
  const driver = createDriver(game);
  const radar = createRadar(game);

  const makeRing = () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicNodeMaterial({ color: 0xffd34d, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 30; m.visible = false; m.frustumCulled = false;
    game.scene.add(m);
    return m;
  };
  ring = makeRing();

  let shownDrive = 'free';
  // A message stays on screen for six seconds.
  let noteTimer = 0;
  effect(() => { const n = L.note.value; clearTimeout(noteTimer); if (n) noteTimer = setTimeout(() => { L.note.value = ''; }, 6000); });

  const select = (a) => {
    L.sel.value = a;
    if (a && !a.dead) L.tab.value = 'sel';
    const t = a?.lab?.drive?.type;
    L.dtab.value = t === 'path' ? 'path' : t === 'goto' ? 'goto' : t === 'follow' ? 'follow' : 'free';
    L.pick.value = null;
    shownDrive = a?.lab?.drive?.type ?? 'free';
    refresh();
  };

  // The selection ring follows its animal every frame; the panels refresh at the game's 4 Hz tick.
  game.frameHooks.push(() => {
    const a = L.sel.value;
    if (!a || a.dead || !game.world) { ring.visible = false; return; }
    const r = Math.max(1.2, SPECIES[a.sp].size * 1.1);
    ring.visible = true;
    ring.position.set(a.pos.x, a.pos.y + 0.2, a.pos.z);
    ring.scale.setScalar(r);
  });
  const refresh = () => {
    const W = game.world;
    if (!W) return;
    const a = L.sel.value;
    if (a?.dead) L.sel.value = null;
    L.info.value = L.sel.value ? readout(L.sel.value) : null;
    // The Drive tab follows what the selected animal is really doing (a drive given by a button, a tap or a script).
    const type = L.sel.value?.lab?.drive?.type ?? 'free';
    if (type !== shownDrive) { shownDrive = type; L.dtab.value = type; }
    L.census.value = census(W.animals);
    L.fps.value = game.gfx.stats.fps;
  };
  game.tickHooks.push(refresh);

  const add = (hit, id = L.species.value, n = L.count.value) => {
    const r = spawn(game, id, n, hit);
    L.note.value = r.error ?? '';
    if (r.added.length) select(r.added[r.added.length - 1]);
    refresh();
    return r;
  };

  onTap(game.renderer.domElement, (e) => {
    if (!game.world) return;
    // A tap that is an answer: where to go, or the next waypoint of a drawn path.
    if (L.pick.value) {
      const hit = groundAt(game, e, { water: true });
      if (!hit) return;
      const p = hit.ground ?? hit.point;
      if (L.pick.value === 'goto' && L.sel.value) { driver.goto(p.x, p.z); L.pick.value = null; }
      else if (L.pick.value === 'draw') L.draft.value = [...L.draft.value, { x: p.x, z: p.z }];
      refresh();
      return;
    }
    const a = animalAt(game, e);
    if (a) { select(a); return; }
    const gecko = SPECIES[L.species.value].kind === 'gecko';
    const hit = groundAt(game, e, { wall: gecko });
    if (L.tapAdds.value && hit) add(hit);
    else select(null);
  });

  const api = {
    game, L, driver, radar, SPECIES, TANK,
    // The report as text, copied if the browser lets it; else shown for selecting by hand.
    report: () => buildReport(game, driver, radar),
    async copyReport() {
      const text = buildReport(game, driver, radar);
      if (await copyText(text)) { L.note.value = `Copied a report of ${radar.rows().length} findings.`; L.report.value = null; }
      else L.report.value = text;
      return text;
    },
    // Look at an animal from close by (the camera goes where you ask: this is a button, not something that happens by itself).
    focus(a) {
      if (!a || a.dead) return;
      select(a);
      game.rig.controls.setLookAt(a.pos.x, a.pos.y + 9, a.pos.z + 13, a.pos.x, a.pos.y + 1, a.pos.z, true);
    },
    async arena(opts = {}) {
      await buildArena(game, { tank: opts.tank ?? L.tank.value, ground: opts.ground ?? L.ground.value, depth: opts.depth ?? L.depth.value });
      refresh();
    },
    // The ground under the animals: 'flat' or 'shore'. Animals already there stay where they are (they may end up under it).
    ground(kind) { shapeGround(game, kind); setDepth(game, L.depth.value); },
    depth: (cm) => setDepth(game, cm),
    view: (id) => setView(game, id),
    pause: (on = true) => setPaused(game, on),
    rate: (r) => setRate(game, r),
    step: (n = 1) => { stepFrames(game, n); refresh(); },
    // Release n of a species at (x, z) on the floor (or the water's surface), or at the middle.
    add(id, n = 1, x = 0, z = 0) {
      const W = game.world, g = W.terrain.heightAt(x, z), s = W.water.surfaceAt(x, z, 0.2);
      const water = s > g + 0.2;
      return add({ point: new THREE.Vector3(x, water ? s : g, z), surface: water ? 'water' : 'terrain' }, id, n);
    },
    select,
    remove(a = L.sel.value) { if (a) { game.world.animals.remove(a, 'removed'); if (L.sel.value === a) L.sel.value = null; refresh(); } },
    clear() { game.world.animals.clear(); L.sel.value = null; driver.clear(); refresh(); },
    animals: () => game.world.animals.all,
  };
  window.lab = api;

  setRate(game, 1);
  await buildArena(game, { tank: params.get('tank') ?? 'standard', ground: params.get('ground') ?? 'flat', depth: +(params.get('depth') ?? 0), settle: false });
  game.rig.setZone(params.get('view') === 'top' ? 'top' : 'tank', false);
  L.backend.value = game.gfx.backend;
  game.start();
  await game.settle();
  L.ready.value = true;
  refresh();
  return api;
}
