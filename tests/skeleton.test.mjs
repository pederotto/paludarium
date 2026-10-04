// The skeleton tool (tools/rig/skeleton.mjs): binding skin to bones, posing by joint targets, skinning. Every new animal is built
// on it, so its basic promises are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSkin, poseMatrices, skin, moveBy } from '../tools/rig/skeleton.mjs';

// A two-bone arm along +z: upper arm 0 … 1, forearm 1 … 2, as a cloud of points along it (limb 1), plus a body bone along x.
const bones = [
  { name: 'body', parent: null, head: [-1, 0, 0], tail: [0, 0, 0], limb: 0 },
  { name: 'armR', parent: 'body', head: [0, 0, 0], tail: [0, 0, 1], limb: 1 },
  { name: 'forearmR', parent: 'armR', head: [0, 0, 1], tail: [0, 0, 2], limb: 1 },
];
const pts = [], leg = [], legT = [];
for (let i = 0; i <= 20; i++) { pts.push(0.05, 0, i * 0.1); leg.push(1); legT.push(i / 20); }
for (let i = 1; i <= 5; i++) { pts.push(-i * 0.2, 0, 0); leg.push(0); legT.push(0); }
const pos = Float32Array.from(pts), nor = new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0));
const rig = { leg: Uint8Array.from(leg), legT: Float32Array.from(legT) };

test('weights sum to one and a limb point only binds to its own limb (and the body bone near the root)', () => {
  const b = bindSkin(pos, bones, rig);
  for (let i = 0; i < pos.length / 3; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      sum += b.w[i * 4 + k];
      if (b.w[i * 4 + k] > 0 && rig.leg[i] === 1 && rig.legT[i] > 0.2) assert.ok(bones[b.idx[i * 4 + k]].limb === 1, `point ${i} bound to the body`);
      if (b.w[i * 4 + k] > 0 && rig.leg[i] === 0) assert.equal(bones[b.idx[i * 4 + k]].limb, 0);
    }
    assert.ok(Math.abs(sum - 1) < 1e-5);
  }
});

test('the rest pose leaves the skin where it is', () => {
  const b = bindSkin(pos, bones, rig), out = skin(pos, nor, b, poseMatrices(bones, {}));
  for (let i = 0; i < pos.length; i++) assert.ok(Math.abs(out.pos[i] - pos[i]) < 1e-6);
});

test('a joint target turns the bone toward it, keeps its length and carries the bones below it', () => {
  // bend the elbow: the forearm points down (-y) from the elbow
  const m = poseMatrices(bones, { forearmR: [0, -5, 1] });
  const tail = moveBy(m.world[2], [0, 0, 2]);
  assert.ok(Math.hypot(tail[0] - 0, tail[1] + 1, tail[2] - 1) < 1e-6, `forearm tail at ${tail}`);
  // swing the whole arm to +x: the forearm goes with it
  const m2 = poseMatrices(bones, { armR: [3, 0, 0] });
  const elbow = moveBy(m2.world[1], [0, 0, 1]), hand = moveBy(m2.world[2], [0, 0, 2]);
  assert.ok(Math.hypot(elbow[0] - 1, elbow[1], elbow[2]) < 1e-6 && Math.hypot(hand[0] - 2, hand[1], hand[2]) < 1e-6);
  // the skin follows: the tip of the arm cloud ends near the bent forearm's tail
  const b = bindSkin(pos, bones, rig), out = skin(pos, nor, b, m);
  const n = 20;
  assert.ok(Math.hypot(out.pos[n * 3] - 0.05, out.pos[n * 3 + 1] + 1, out.pos[n * 3 + 2] - 1) < 0.08);
});

test('mirror copies a right-side target to the left with x flipped', () => {
  const B = [...bones, { name: 'armL', parent: 'body', head: [0, 0, 0], tail: [0, 0, 1], limb: 2 }];
  const m = poseMatrices(B, { mirror: true, armR: [3, 0, 0] });
  const r = moveBy(m.world[1], [0, 0, 1]), l = moveBy(m.world[3], [0, 0, 1]);
  assert.ok(Math.abs(r[0] - 1) < 1e-6 && Math.abs(l[0] + 1) < 1e-6);
});
