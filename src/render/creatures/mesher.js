// Turns a body definition (kit.js) into a mesh with naive surface nets (from
// CAUSTIC//VOLUME's lite version, MIT), with two speed-ups so that fine, close-up
// meshes are affordable:
//
//  - adaptive sampling: a coarse grid is sampled first, and blocks that are
//    clearly far from the surface are skipped, so only a thin shell of the
//    volume is evaluated;
//  - smooth normals from the SDF gradient, so shading is smooth at any cell size.

import * as THREE from 'three/webgpu';
import { surfaceNet, bodyArrays } from './shape.js';

export { surfaceNet };

// Geometry from the arrays bodyArrays (or a worker) produced.
export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('rig', new THREE.BufferAttribute(a.rig, 4));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  g.userData.verts = a.verts;
  return g;
}

// Builds a geometry from a body definition, synchronously (tools and tests; the game meshes in workers, see
// meshpool.js). `detail` 'lo' uses def.cell, 'hi' uses def.cell * (def.hiScale ?? 0.5).
export function bodyGeometry(def, detail = 'lo') {
  return geometryFromArrays(bodyArrays(def, detail));
}

// Adds a neutral rig attribute to a geometry built elsewhere (legacy low-poly bugs).
export function withRig(g, spineAxis = 'z') {
  const n = g.attributes.position.count;
  const rig = new Float32Array(n * 4);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  for (let i = 0; i < n; i++) {
    const v = g.attributes.position.getComponent(i, spineAxis === 'z' ? 2 : 0);
    rig[i * 4] = 1 - (v - bb.min.z) / Math.max(1e-3, bb.max.z - bb.min.z);
  }
  g.setAttribute('rig', new THREE.BufferAttribute(rig, 4));
  return g;
}
