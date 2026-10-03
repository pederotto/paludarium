// Per-pond water quality: a deep pond with fish loads up, a planted shallow pond
// cleans itself, linked ponds share what flows between them, and env keeps the mean.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Hydro } from '../src/sim/hydro.js';

const NX = 120, NY = 60, W = 90, D = 45;
class Field {
  constructor() {
    this.nx = NX; this.ny = NY; this.cols = NX + 1; this.rows = NY + 1;
    this.da = W / NX; this.db = D / NY; this.oa = -W / 2; this.ob = -D / 2;
    this.h = new Float32Array(this.cols * this.rows); this.base = this.h; this.stamped = new Uint8Array(this.cols * this.rows);
  }
  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }
  idx(i, j) { return j * this.cols + i; }
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function build() {
  const f = new Field();
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const [x, z] = f.toWorld(i, j);
    let h = 3 + smooth(-2, -5, z) * 12;
    h -= (1 - smooth(0, 9, Math.hypot(x + 28, z + 20))) * 9;     // deep bowl, floor 6
    h -= (1 - smooth(0, 8, Math.hypot(x + 6, z + 20))) * 3.5;    // shallow bowl, floor 11.5
    f.h[f.idx(i, j)] = h;
  }
  const env = { temp: 23, cycle: 0.9, mediaBio: 0.55, filter: true, fan: 0, rain: 0, lampPower: 1, algae: 0.05, ammonia: 0, nitrite: 0, nitrate: 8, oxygen: 7.5 };
  const animals = { all: [] }, plants = { list: [] };
  const world = { terrain: { field: f, heightAt: () => 0 }, wall: { zAt: () => 0 }, log() {}, env, animals, plants, water: { falls: [] } };
  const H = new Hydro(world);
  H.pump.intake = { x: 8, z: 12 }; H.rebuild(); H.setLevel(10);
  const r1 = H.fillAt(-28, -20); assert.ok(r1.litres > 0.3, 'deep bowl filled ' + JSON.stringify(r1));
  const r2 = H.fillAt(-6, -20); assert.ok(r2.litres > 0.05, 'shallow bowl filled ' + JSON.stringify(r2));
  for (let k = 0; k < 60; k++) H.step(0.05);
  return { H, world, env, animals, plants };
}
const SPECIES = { neon: { kind: 'swim', size: 3 } };
const PLANTS = { valli: { habitat: 'aquatic' } };

test('a deep fish pond loads up while a planted shallow pond cleans itself', () => {
  const { H, env, animals, plants } = build();
  const B = H.bodies;
  const deep = B.at(-28, -20), shallow = B.at(-6, -20);
  assert.ok(deep && shallow && deep !== shallow && deep.kind === 'pool', 'two separate ponds are found');
  assert.ok(deep.depth > shallow.depth, 'one is deeper');
  for (let k = 0; k < 4; k++) animals.all.push({ sp: 'neon', pos: { x: -28 + k * 0.5, y: 8, z: -20 } });
  for (let k = 0; k < 6; k++) plants.list.push({ id: 'valli', grown: 1, scale: 1, pos: { x: -6 + (k - 3) * 0.6, y: 13, z: -20 } });
  for (let hour = 0; hour < 72; hour++) {
    for (let t = 0; t < 12; t++) B.chemistry(5, { SPECIES, PLANTS, light: 0.8, rotting: 0.001, waterFrac: 0.2 });
    for (let t = 0; t < 20; t++) H.step(0.05);
  }
  const d2 = B.at(-28, -20), s2 = B.at(-6, -20);
  assert.ok(d2.ammonia + d2.nitrite * 2 + d2.nitrate / 40 > s2.ammonia + s2.nitrite * 2 + s2.nitrate / 40 + 0.3, `fish pond is dirtier: ${JSON.stringify([d2.ammonia, d2.nitrite, d2.nitrate].map((v) => +v.toFixed(2)))} vs ${JSON.stringify([s2.ammonia, s2.nitrite, s2.nitrate].map((v) => +v.toFixed(2)))}`);
  assert.ok(s2.nitrate < 4, 'plants drew the nitrate down');
  assert.ok(d2.oxygen < s2.oxygen + 0.01 || d2.oxygen < 7, 'fish breathe the deep pond down');
  // env is the volume-weighted mean of the bodies.
  let w = 0, a = 0;
  for (const b of B.list) { const V = b.kind === 'sump' ? Math.max(1, b.vol) : Math.max(0.25, b.vol); w += V; a += b.nitrate * V; }
  assert.ok(Math.abs(env.nitrate - a / w) < 0.05, `env.nitrate ${env.nitrate} is the mean ${a / w}`);
});

test('ponds linked by the pump share their water', () => {
  const { H, env, animals } = build();
  const B = H.bodies;
  H.addOutlet(new THREE.Vector3(-28, H.f.h[H.cellOf(-28, -20)] + 0.2, -20), false);
  for (let k = 0; k < 4; k++) animals.all.push({ sp: 'neon', pos: { x: -28 + k * 0.5, y: 8, z: -20 } });
  for (let hour = 0; hour < 24; hour++) {
    for (let t = 0; t < 12; t++) B.chemistry(5, { SPECIES, PLANTS, light: 0.8, rotting: 0.001, waterFrac: 0.2 });
    for (let t = 0; t < 40; t++) H.step(0.05);
  }
  const deep = B.at(-28, -20);
  assert.ok(deep.inLph > 20, `the pump feeds the pond (${deep.inLph} L/h)`);
  assert.ok(Math.abs(deep.ammonia - B.sump.ammonia) < 0.1, 'a flushed pond stays close to the sump');
  assert.ok(env.ammonia >= 0 && env.oxygen > 0.5);
});

test('the filter media cleans the water only while the filter runs', () => {
  const nitrified = (on) => {
    const { H, env } = build();
    env.filter = on;
    const B = H.bodies, ctx = { SPECIES, PLANTS, light: 0.8, rotting: 0, waterFrac: 0.2 };
    B.chemistry(0.01, ctx);
    B.sump.ammonia = 1; B.sump.nitrite = 0;
    B.chemistry(2, ctx);
    return 1 - B.sump.ammonia;
  };
  const on = nitrified(true), off = nitrified(false);
  assert.ok(off < on * 0.8, `ammonia turned over in 2 min: filter on ${on.toFixed(4)}, off ${off.toFixed(4)}`);
});
