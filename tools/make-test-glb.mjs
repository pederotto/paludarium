// Builds a small textured four-legged test creature (a "frog") as a .glb with the
// spec's conventions, to exercise tools/import-creatures.mjs and the loader:
//   node tools/make-test-glb.mjs /tmp/test-src/dartfrog.glb
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';

const out = process.argv[2] ?? '/tmp/test-src/dartfrog.glb';
fs.mkdirSync(path.dirname(out), { recursive: true });
const parts = [];
const add = (g, x, y, z) => { g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
const M = 0.01; // build in cm-ish numbers then scale to metres
const body = new THREE.SphereGeometry(1, 40, 28); body.scale(0.9, 0.7, 1.3); add(body, 0, 0.9, -0.2);
const head = new THREE.SphereGeometry(1, 32, 24); head.scale(0.75, 0.5, 0.6); add(head, 0, 1.1, 1.1);
for (const s of [-1, 1]) {
  add(new THREE.SphereGeometry(0.22, 16, 12), s * 0.45, 1.5, 1.3);
  const front = new THREE.CapsuleGeometry(0.14, 0.7, 6, 12); front.rotateZ(s * 0.5); add(front, s * 0.95, 0.45, 0.7);
  const back = new THREE.CapsuleGeometry(0.2, 0.9, 6, 12); back.rotateZ(s * 1.1); add(back, s * 1.2, 0.35, -0.8);
}
const geo = mergeGeometries(parts, false);
geo.scale(M, M, M); geo.computeVertexNormals();
// planar-ish uv from position
const pos = geo.attributes.position, uvs = new Float32Array(pos.count * 2);
for (let i = 0; i < pos.count; i++) { uvs[i * 2] = pos.getX(i) / (4 * M) + 0.5; uvs[i * 2 + 1] = pos.getZ(i) / (5 * M) + 0.5; }
// a blue frog texture with black spots
const W = 512, px = Buffer.alloc(W * W * 3);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const n = Math.sin(x * 0.11) * Math.sin(y * 0.13) + Math.sin(x * 0.05 + y * 0.07);
  const c = n > 1.05 ? [8, 8, 14] : [30 + (y % 40), 80 + (x % 30), 200];
  px.set(c, (y * W + x) * 3);
}
const png = await sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer();

const doc = new Document();
const buf = doc.createBuffer();
const P = doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array)).setBuffer(buf);
const N = doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.normal.array)).setBuffer(buf);
const T = doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buf);
const tex = doc.createTexture('skin').setImage(png).setMimeType('image/png');
const mat = doc.createMaterial('skin').setBaseColorTexture(tex).setRoughnessFactor(0.5).setMetallicFactor(0);
const prim = doc.createPrimitive().setAttribute('POSITION', P).setAttribute('NORMAL', N).setAttribute('TEXCOORD_0', T).setMaterial(mat);
const mesh = doc.createMesh('frog').addPrimitive(prim);
doc.createScene().addChild(doc.createNode('frog').setMesh(mesh));
await new NodeIO().write(out, doc);
console.log('wrote', out, `${(pos.count / 3).toFixed(0)} tris`);
