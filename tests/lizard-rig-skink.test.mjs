// The skink's baked skeleton and skin (tools/bake-lizard.mjs skink, on tools/rig/lizard.mjs and tools/rig/lizard-skink.mjs; the bone
// list in docs/agents/lizards/CONTRACTS.md, the anatomy in RIG_skink.md): the same eight checks as the gecko's (tests/lizard-rig.test.mjs).
//   node --test tests/lizard-rig-skink.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NodeIO, ImageUtils } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { LIZARD_BONES, FAN_BONES, lizardBones } from '../tools/rig/lizard.mjs';
import { SKINK, SKINK_ANATOMY, measureSkink, readRaw } from '../tools/rig/lizard-skink.mjs';

const DIR = 'public/assets/creatures/';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// one level of detail: positions in the model's frame (metres, the node's dequantising transform applied), its primitive, extras
async function load(file) {
  const doc = await io.read(DIR + file);
  const node = doc.getRoot().listNodes().find((x) => x.getMesh());
  const mesh = node.getMesh(), prim = mesh.listPrimitives()[0], M = node.getWorldMatrix();
  const P = prim.getAttribute('POSITION'), n = P.getCount(), pos = new Float32Array(n * 3), e = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    P.getElement(i, e);
    for (let c = 0; c < 3; c++) pos[i * 3 + c] = M[c] * e[0] + M[4 + c] * e[1] + M[8 + c] * e[2] + M[12 + c];
  }
  return { file, prim, pos, n, tris: prim.getIndices().getCount() / 3, extras: mesh.getExtras() };
}
const hi = await load('skink.glb'), lo = await load('skink.lo.glb');
const sk = hi.extras.skeleton;
const zRange = (m) => { let a = Infinity, b = -Infinity; for (let i = 0; i < m.n; i++) { const z = m.pos[i * 3 + 2]; a = Math.min(a, z); b = Math.max(b, z); } return [a, b]; };

// RIG_skink.md "Anatomy the rig must cover": skull, short neck, presacral trunk with ribs, 2 sacrals, caudals, both girdles, the
// three segments of each limb, five fused digits
const NEEDED = ['skull', 'neck', 'trunk', 'ribs', 'sacrum', 'tail', 'pectoral girdle', 'pelvic girdle', 'humerus', 'radius-ulna', 'hand',
  'femur', 'tibia-fibula', 'foot', 'digits'];
const PAIRED = /^(arm|forearm|hand|thigh|shin|foot|fingers|toes)$/;

test('1 the bone list covers the skink anatomy, in the contract order, 25 bones with the toe fans', () => {
  const names = sk.bones.map((b) => b.name);
  assert.equal(sk.plan, 'lizard');
  assert.deepEqual(names, [...LIZARD_BONES, ...FAN_BONES]);
  assert.equal(names.length, 25);
  for (const b of sk.bones) assert.ok(b.r > 0 && Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]) > 0.02, b.name);
  for (const part of NEEDED) {
    assert.ok(SKINK_ANATOMY[part]?.length, `no bone stands for the ${part}`);
    for (const b of SKINK_ANATOMY[part]) for (const w of PAIRED.test(b) ? [b + 'L', b + 'R'] : [b]) assert.ok(names.includes(w), `${part}: ${w} missing`);
  }
  for (const b of sk.bones) if (b.parent != null) assert.ok(names.indexOf(b.parent) >= 0 && names.indexOf(b.parent) < names.indexOf(b.name), `${b.name}'s parent`);
  assert.deepEqual(lizardBones(sk.joints, { fans: false }).map((b) => b.name), LIZARD_BONES);
});

test('2 every vertex is bound to bones that exist, the weights summing to 1, and every bone holds skin', () => {
  for (const m of [hi, lo]) {
    const S = m.prim.getAttribute('_SKIN'), nb = sk.bones.length, e = [0, 0, 0, 0], held = new Array(nb).fill(0);
    let bad = 0;
    for (let i = 0; i < m.n; i++) {
      S.getElement(i, e);
      const b0 = Math.round(e[0] * 32), b1 = Math.round(e[1] * 32);
      if (!(b0 >= 0 && b0 < nb && b1 >= 0 && b1 < nb && e[2] >= 0 && e[2] <= 1 + 1e-6 && Math.abs(e[2] + e[3] - 1) < 2e-3)) bad++;
      else held[b0]++;
    }
    assert.equal(bad, 0, `${m.file}: ${bad} vertices badly bound`);
    if (m === hi) held.forEach((c, b) => assert.ok(c >= 20, `${sk.bones[b].name} holds ${c} vertices`));
  }
});

test('3 the levels of detail fit their budgets (hi about 30k, lo as low as the UV seams allow toward 10k)', () => {
  console.log(`  skink: hi ${hi.tris} triangles, lo ${lo.tris}`);
  assert.ok(hi.tris <= 30000 && hi.tris >= 25000, `hi ${hi.tris}`);
  // (the skink's atlas has more UV islands than the gecko's: meshoptimizer keeps the seams and stops near 21k at any error bound
  // from 0.01 to 0.08; the number is reported, not forced past visible damage: reports/S1a.md)
  assert.ok(lo.tris <= 21500 && lo.tris < hi.tris * 0.75, `lo ${lo.tris}`);
});

test('4 left and right bones are the same length (within 5 %)', () => {
  const L = (b) => Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
  for (const b of sk.bones.filter((x) => /L$/.test(x.name))) {
    const r = sk.bones.find((x) => x.name === b.name.replace(/L$/, 'R'));
    assert.ok(Math.abs(L(b) - L(r)) <= 0.05 * Math.max(L(b), L(r)), `${b.name} ${L(b).toFixed(3)} vs ${L(r).toFixed(3)}`);
  }
});

test('5 the model keeps its UVs and its 1024 base-colour texture, with no metal-rough map, metal 0 / rough 0.6', () => {
  for (const m of [hi, lo]) {
    assert.equal(m.prim.getAttribute('TEXCOORD_0')?.getCount(), m.n);
    const mat = m.prim.getMaterial(), tex = mat.getBaseColorTexture();
    assert.ok(tex, 'base colour texture');
    assert.equal(tex.getMimeType(), 'image/webp');
    assert.deepEqual(ImageUtils.getSize(tex.getImage(), tex.getMimeType()), [1024, 1024]);
    assert.equal(mat.getMetallicRoughnessTexture(), null);
    assert.equal(mat.getMetallicFactor(), 0);
    assert.equal(mat.getRoughnessFactor(), 0.6);
  }
});

test('6 the tail is straight: its tip within 2 % of the length of the midline (and level in the side view)', () => {
  const [z0, z1] = zRange(hi), Lz = z1 - z0;
  let sx = 0, sy = 0, c = 0;
  for (let i = 0; i < hi.n; i++) if (hi.pos[i * 3 + 2] < z0 + 0.03 * Lz) { sx += hi.pos[i * 3]; sy += hi.pos[i * 3 + 1]; c++; }
  assert.ok(c > 0);
  const vy = sk.joints.vent[1] / 100;
  console.log(`  tail tip: ${(sx / c / Lz * 100).toFixed(2)} % of the length to the side, ${((sy / c - vy) / Lz * 100).toFixed(2)} % above the vent`);
  assert.ok(Math.abs(sx / c) < 0.02 * Lz, `tip ${(sx / c / Lz * 100).toFixed(1)} % of the length off the midline`);
  assert.ok(Math.abs(sy / c - vy) < 0.03 * Lz, `tip ${((sy / c - vy) / Lz * 100).toFixed(1)} % of the length off the vent's height`);
});

test('7 the proportions are the model\'s: snout-to-vent over total length within 2 % of the source mesh, snout-to-vent the real 9 cm', async () => {
  const [z0, z1] = zRange(hi), svl = z1 - sk.joints.vent[2] / 100, ratio = svl / (z1 - z0);
  const src = measureSkink((await readRaw(SKINK.raw, { level: false })).pos, SKINK), want = src.svl / src.total;
  console.log(`  snout-vent ${(svl * 100).toFixed(2)} cm of ${((z1 - z0) * 100).toFixed(2)} cm: ${ratio.toFixed(3)} (source model ${want.toFixed(3)})`);
  assert.ok(Math.abs(ratio - want) <= 0.02 * want, `${ratio} vs ${want}`);
  assert.ok(Math.abs(svl * 100 - SKINK.svlCm) < 0.05, `snout-vent ${svl * 100} cm`);
});

test('8 the rig and skin attributes are in the file (glb-dump), and the original is kept untouched', () => {
  for (const f of ['skink.glb', 'skink.lo.glb']) {
    const out = execFileSync('node', ['docs/agents/lizards/tools/glb-dump.mjs', DIR + f], { encoding: 'utf8' });
    assert.match(out, /_RIG/, f);
    assert.match(out, /_SKIN/, f);
  }
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const orig = SKINK.source.replace(/^~/, os.homedir());
  assert.ok(fs.existsSync(SKINK.raw));
  if (fs.existsSync(orig)) assert.equal(sha(SKINK.raw), sha(orig));
});
