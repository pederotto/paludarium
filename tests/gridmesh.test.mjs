// The height-field mesh arithmetic: vertex normals must match three.js exactly, so the faster path changes nothing on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { normalsFromIndexed } from '../src/sim/gridmesh.js';

function bumpyPlane(nx, nz, seed = 1) {
  const g = new THREE.PlaneGeometry(90, 45, nx, nz);
  g.rotateX(-Math.PI / 2);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, 3 + rnd() * 9 + Math.sin(i * 0.37) * 4);
  return g;
}

test('normalsFromIndexed matches computeVertexNormals bit for bit on the terrain layout', () => {
  const g = bumpyPlane(120, 60);
  const mine = normalsFromIndexed(g.attributes.position.array, g.index.array, new Float32Array(g.attributes.position.array.length));
  g.computeVertexNormals();
  const ref = g.attributes.normal.array;
  assert.equal(mine.length, ref.length);
  for (let i = 0; i < ref.length; i++) assert.equal(mine[i], ref[i], `component ${i}`);
});

test('normalsFromIndexed matches on an unrotated wall plane with a Uint16 index, and on a flat plane (up)', () => {
  const w = new THREE.PlaneGeometry(90, 60, 120, 80);
  const p = w.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.cos(i * 0.11) * 2);
  const mine = normalsFromIndexed(p.array, w.index.array, new Float32Array(p.array.length));
  w.computeVertexNormals();
  for (let i = 0; i < mine.length; i++) assert.equal(mine[i], w.attributes.normal.array[i]);

  const flat = bumpyPlane(10, 10);
  for (let i = 0; i < flat.attributes.position.count; i++) flat.attributes.position.setY(i, 5);
  const n = normalsFromIndexed(flat.attributes.position.array, flat.index.array, new Float32Array(flat.attributes.position.array.length));
  for (let i = 0; i < n.length; i += 3) { assert.equal(n[i], 0); assert.equal(n[i + 1], 1); assert.equal(n[i + 2], 0); }
});
