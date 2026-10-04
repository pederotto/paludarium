// The occupancy grid (sim/occupancy.js) and its exact test: a body next to a piece is in one of the piece's solid cells (they are
// 1.5 cm and the shell is thickened by one), but only a body really inside the piece is moved out (insideSolid, nudge).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Occupancy } from '../src/sim/occupancy.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

function rootOver(x, y, z) {
  // a 6 x 3 x 6 cm block (a root, a piece of wood) standing clear of the ground
  const g = new THREE.BoxGeometry(6, 3, 6);
  g.computeBoundsTree();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z);
  return { decor: { occupancyVersion: 1, pieces: [{ type: 'root', mesh }] }, mesh };
}

test('a point inside a piece is solid and really inside', () => {
  const { decor } = rootOver(0, 10, 0);
  const occ = new Occupancy();
  occ.rebuild(decor, {});
  assert.ok(occ.solidAt(0, 10, 0));
  assert.ok(occ.inside(0, 10, 0));
});

test('a point under the piece, in its thickened shell, is in a solid cell but not inside the piece', () => {
  const { decor } = rootOver(0, 10, 0);
  const occ = new Occupancy();
  occ.rebuild(decor, {});
  // the underside is at y = 8.5; 0.8 cm below it a newt hides
  const y = 7.7;
  assert.ok(occ.solidAt(0.2, y, 0.2), 'the shell thickening makes the cell under the root solid');
  assert.equal(occ.inside(0.2, y, 0.2), false);
  assert.equal(occ.inside(30, 5, 0), false);
});
