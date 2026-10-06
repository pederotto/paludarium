// T4: the swim toad's trunk in two bones (spine + spineB): the total yaw is shared half and half, a 17-bone frog is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skeletonRig, poseStroke, MUSCLE_TEXEL0, ROW_TEXELS } from '../src/render/creatures/skeleton.js';
import { MAX_SLOTS } from '../src/content/anuranmuscles.js';
import { frogBones, spineRamp } from '../tools/rig/skeleton.mjs';

const man = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
const sk = man['toad.swim'].skeleton, st = (trunk) => ({ pL: 0, pR: 0, ampL: 0, ampR: 0, float: 0, scull: 0, arms: 0.35, push: 0, trunk });
const yawOf = (rg, nm, trunk) => { const o = new Float32Array(300); poseStroke(rg, st(trunk), o, 0); const b = rg.byName[nm]; return Math.atan2(o[b * 12 + 2], o[b * 12]) * 180 / Math.PI; };
// the 17-bone toad as shipped before T4, or the 18-bone one after: either way build both here from the bones' own joints
const split = (bones) => {
  if (bones.some((b) => b.name === 'spineB')) return bones;
  const B = JSON.parse(JSON.stringify(bones)), sp = B.find((b) => b.name === 'spine'), mid = sp.head.map((v, i) => (v + sp.tail[i]) / 2), tail = sp.tail;
  sp.tail = mid; B.splice(B.indexOf(sp) + 1, 0, { ...sp, name: 'spineB', parent: 'spine', head: mid, tail });
  for (const b of B) if (b.parent === 'spine' && b.name !== 'spineB') b.parent = 'spineB';
  return B;
};
test('row layout: the bellies start after an 18-bone row, 21 slots, 75 texels', () => {
  assert.equal(MUSCLE_TEXEL0, 54); assert.equal(MAX_SLOTS, 21); assert.equal(ROW_TEXELS, 75); assert.ok(18 * 3 <= MUSCLE_TEXEL0);
});
test('frogBones with mid2: spineB between spine and head, arms on spineB; without it 17 bones', () => {
  const j = { vent: [0, 0, 0], mid: [0, 0, 1], mid2: [0, 0, 2], chest: [0, 0, 3], neck: [0, 0, 4], snout: [0, 0, 5] };
  for (const s of 'LR') for (const k of ['hip', 'knee', 'heel', 'ankle', 'toe', 'shoulder', 'elbow', 'wrist', 'finger']) j[k + s] = [1, 0, 1];
  const b = frogBones(j), nm = b.map((x) => x.name);
  assert.equal(b.length, 18); assert.equal(nm[2], 'spineB'); assert.equal(b.find((x) => x.name === 'head').parent, 'spineB'); assert.equal(b.find((x) => x.name === 'armL').parent, 'spineB');
  assert.equal(frogBones({ ...j, mid2: undefined }).length, 17);
});
test('ramp: 0 behind, 1 in front, 0.5 at the split', () => { assert.equal(spineRamp(0), 0); assert.equal(spineRamp(1), 1); assert.ok(Math.abs(spineRamp(0.5) - 0.5) < 1e-12); });
test('trunk yaw 20 turns spine 10 and spineB 20; head tip within 0.2 cm of one 20 deg joint; 17 bones: one joint, clamp 25', () => {
  const two = skeletonRig({ ...sk, bones: split(sk.bones) }, {}), one = skeletonRig({ ...sk, bones: sk.bones.filter((b) => b.name !== 'spineB').map((b) => (b.parent === 'spineB' ? { ...b, parent: 'spine' } : b)) }, {});
  assert.ok(Math.abs(Math.abs(yawOf(two, 'spine', [20, 0, 0, 0, 0, 0])) - 10) < 1e-3);
  assert.ok(Math.abs(Math.abs(yawOf(two, 'spineB', [20, 0, 0, 0, 0, 0])) - 20) < 1e-3);
  assert.ok(Math.abs(Math.abs(yawOf(two, 'spineB', [60, 0, 0, 0, 0, 0])) - 35) < 1e-3, 'two joints: total clamp 35');
  assert.ok(Math.abs(Math.abs(yawOf(one, 'spine', [60, 0, 0, 0, 0, 0])) - 25) < 1e-3, '17 bones: clamp 25');
});
