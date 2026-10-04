// util/plantbend.js: how far and which way a submerged plant leans in the water's push (B5b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plantBend, localFlow, BEND_MAX, V50 } from '../src/util/plantbend.js';

const deg = (r) => r * 180 / Math.PI;
const angleBetween = (ax, az, bx, bz) => deg(Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz))))));
const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4 + 0.3), Math.sin(i * Math.PI / 4 + 0.3)]);

test('the lean points the way the water goes (within 10 degrees), whatever the flow vector length', () => {
  for (const [fx, fz] of DIRS) for (const k of [0.01, 1, 40]) {
    const b = plantBend(fx * k, fz * k, 4, 1, 1);
    assert.ok(Math.hypot(b.x, b.z) > 0);
    assert.ok(angleBetween(b.x, b.z, fx, fz) < 10, `direction ${fx},${fz}`);
  }
});

test('opposite flow leans the opposite way by the same amount', () => {
  const a = plantBend(0.6, 0.8, 5, 1, 1), b = plantBend(-0.6, -0.8, 5, 1, 1);
  assert.ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.z + b.z) < 1e-9);
});

test('a stronger flow bends a plant more, never less', () => {
  let last = -1;
  for (let v = 0; v <= 40; v += 0.5) {
    const b = plantBend(1, 0, v, 1, 1), l = Math.hypot(b.x, b.z);
    assert.ok(l >= last, `speed ${v}`);
    if (v >= 0.5 && v <= 10) assert.ok(l > last, `strictly more at ${v}`);
    last = l;
  }
});

test('still water leans nothing, and so does a flow with no direction', () => {
  for (const b of [plantBend(1, 0, 0, 1, 1), plantBend(0, 0, 5, 1, 1), plantBend(0, 0, 0, 1, 1)]) {
    assert.equal(b.x, 0); assert.equal(b.z, 0); assert.equal(b.sag, 0);
  }
});

test('the tip trails more than the base, and the root does not move', () => {
  const at = (h) => Math.hypot(plantBend(1, 0, 6, h, 1).x, plantBend(1, 0, 6, h, 1).z);
  assert.equal(at(0), 0);
  assert.ok(at(0.3) < at(0.6) && at(0.6) < at(1));
});

test('the lean is capped at BEND_MAX, in a gale and for a limp plant', () => {
  assert.ok(BEND_MAX > 0 && V50 > 0);
  for (const s of [0.05, 1]) for (const v of [10, 1e3, 1e9]) {
    const b = plantBend(1, 1, v, 1, s);
    assert.ok(Math.hypot(b.x, b.z) <= BEND_MAX + 1e-9, `speed ${v} stiffness ${s}`);
  }
  const gale = plantBend(1, 0, 1e9, 1, 1);
  assert.ok(Math.hypot(gale.x, gale.z) > 0.99 * BEND_MAX);
});

test('a stiffer plant leans less than a limp one in the same flow, and a lean sags the tip a little', () => {
  const limp = plantBend(1, 0, 4, 1, 0.3), stiff = plantBend(1, 0, 4, 1, 3);
  assert.ok(Math.hypot(limp.x, limp.z) > Math.hypot(stiff.x, stiff.z));
  assert.ok(limp.sag > 0 && limp.sag < Math.hypot(limp.x, limp.z));
});

test('localFlow turns the water flow into the plant\'s own frame: the lean, turned back by the plant, points downstream', () => {
  for (const yaw of [0, 0.7, 2, -2.5]) {
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };   // a plant turned by `yaw` about the vertical
    for (const [wx, wz] of DIRS) {
      const [lx, lz] = localFlow(q, wx * 7, wz * 7);
      assert.ok(Math.abs(Math.hypot(lx, lz) - 7) < 1e-9);
      const b = plantBend(lx, lz, 7, 1, 1);
      // the instance matrix turns the local offset by q about y: x' = x cos + z sin, z' = -x sin + z cos
      const ox = b.x * Math.cos(yaw) + b.z * Math.sin(yaw), oz = -b.x * Math.sin(yaw) + b.z * Math.cos(yaw);
      assert.ok(angleBetween(ox, oz, wx, wz) < 1, `yaw ${yaw}`);
    }
  }
  // a plant tilted to follow a slope still gets a flow in its own xz
  const t = Math.sin(0.2), tilted = { x: t, y: 0, z: 0, w: Math.cos(0.2) };
  const [lx, lz] = localFlow(tilted, 3, 4);
  assert.ok(Number.isFinite(lx) && Number.isFinite(lz) && Math.hypot(lx, lz) > 4);
});

// ---- render/airflow.js plantFlow: what the plant meshes' `flow` attribute receives (a fake world, no GPU) ----
import { plantFlow, PF } from '../src/render/airflow.js';

function fakeWorld(ports = null) {
  const N = 16, H = {
    N, d: new Float32Array(N).fill(5), vx: new Float32Array(N), vz: new Float32Array(N), ports,
    cellOf: (x, z) => Math.max(0, Math.min(3, Math.floor(z))) * 4 + Math.max(0, Math.min(3, Math.floor(x))),
  };
  const geo = { attributes: { flow: { array: new Float32Array(8 * 4), needsUpdate: false }, flowDepth: { array: new Float32Array(8), needsUpdate: false } } };
  const plants = { list: [], key: () => 'v', meshes: { v: { geometry: geo } } };
  const add = (x, y, z, yaw, s = 2) => {
    const p = { pos: { x, y, z }, index: plants.list.length, _s: s, _q: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } };
    plants.list.push(p); return p;
  };
  return { W: { plants, water: { hydro: H } }, H, geo, add, slot: (p) => Array.from(geo.attributes.flow.array.slice(p.index * 4, p.index * 4 + 4)) };
}
const toWorld = (yaw, lx, lz) => [lx * Math.cos(yaw) + lz * Math.sin(yaw), -lx * Math.sin(yaw) + lz * Math.cos(yaw)];

test('plantFlow gives each plant the flow of its own cell, in its own frame, and the old target as the one to ease from', () => {
  const f = fakeWorld(), a = f.add(1.5, 0, 1.5, 0.9), b = f.add(2.5, 0, 2.5, -2), dry = f.add(3.5, 0, 3.5, 0);
  f.H.vx[5] = 3; f.H.vz[5] = 4;      // a's cell (1,1)
  f.H.vx[10] = -2; f.H.vz[10] = 1;   // b's cell (2,2)
  f.H.vx[15] = 9; f.H.d[15] = 0.1;   // a dry cell: no flow however fast
  const calls = PF.calls;
  plantFlow(f.W);
  assert.equal(PF.calls, calls + 1);
  const [ax, az] = toWorld(0.9, ...f.slot(a).slice(2)), [bx, bz] = toWorld(-2, ...f.slot(b).slice(2));
  assert.ok(angleBetween(ax, az, 3, 4) < 1 && Math.abs(Math.hypot(ax, az) - 5) < 1e-6, 'plant a leans along its own cell');
  assert.ok(angleBetween(bx, bz, -2, 1) < 1, 'plant b along its own, a different direction');
  assert.deepEqual(f.slot(a).slice(0, 2), [0, 0]);           // it eases from still water
  assert.deepEqual(f.slot(dry), [0, 0, 0, 0]);
  assert.equal(f.geo.attributes.flow.needsUpdate, true);
  assert.ok(Math.abs(f.geo.attributes.flowDepth.array[a.index] - 2.5) < 1e-6, 'the depth is in the plant\'s own units');
  // the next sample: the old target becomes the one to ease from; nothing changed, so one more upload to settle and then none
  const t1 = f.slot(a).slice(2);
  f.geo.attributes.flow.needsUpdate = false;
  plantFlow(f.W);
  assert.deepEqual(f.slot(a).slice(0, 2), t1);
  assert.equal(f.geo.attributes.flow.needsUpdate, true);
  f.geo.attributes.flow.needsUpdate = false;
  plantFlow(f.W);
  assert.equal(f.geo.attributes.flow.needsUpdate, false, 'a still sample costs no upload');
});

test('plantFlow adds the filter jet, which is not in the hydro field', () => {
  const f = fakeWorld({ lph: 900, ret: { x: 0.2, y: 2, z: 1.5, dx: 1, dz: 0, D: 1.2 } });
  const p = f.add(3.0, 1, 1.5, -1.2);       // downstream of the return, at the nozzle's height (the plant's middle is 1 cm above its base)
  plantFlow(f.W);
  const [x, z] = toWorld(-1.2, ...f.slot(p).slice(2));
  assert.ok(Math.hypot(x, z) > 1, 'the jet moves it');
  assert.ok(angleBetween(x, z, 1, 0) < 5, 'along the return\'s axis');
});
