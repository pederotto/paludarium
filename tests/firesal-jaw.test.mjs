// The fire salamander's jaw (6 Oct): a bone built into the baked mesh (tools/rig/firesal-mouth.mjs, tools/blender/firesal-mouth.py), turned by the `gape`
// channel (render/creatures/lizardpose.js openJaw) and driven by the strike (util/lizardgait.js strikeGape). A body with no jaw bone ignores the channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skeletonRig, poseBones, ROW_FLOATS } from '../src/render/creatures/skeleton.js';
import { GAIT, strikeGape } from '../src/util/lizardgait.js';

const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'));
const rigOf = (id) => skeletonRig(man[id].skeleton, { legLift: 0.3, legStride: 0.35, limb: 1, turn: { pz: man[id].skeleton.bones[3].head[2], R: 2.2 } });
const pose = (rig, st) => { const out = new Float32Array(ROW_FLOATS * 4); poseBones(rig, { phase: 0, tau: 0, hop: 0, calm: 1, pose: 0, ...st }, out, 0); return out; };
const row = (out, b) => Array.from(out.slice(b * 12, b * 12 + 12));
// the angle of a bone's 3 x 4 matrix (rows of 4: three numbers of rotation, one of translation)
const angle = (m) => Math.acos(Math.max(-1, Math.min(1, (m[0] + m[5] + m[10] - 1) / 2)));

test('the salamander has a jaw bone after the head, with its own gait profile', () => {
  const sk = man.firesal.skeleton, names = sk.bones.map((b) => b.name);
  assert.equal(sk.species, 'firesal');
  assert.ok(names.includes('jaw') && !names.some((n) => /^(fingers|toes)/.test(n)), 'a jaw and no digit fans');
  assert.ok(names.length <= 25, 'the 25-bone cap holds');
  const jaw = sk.bones[names.indexOf('jaw')], head = sk.bones[names.indexOf('head')];
  assert.equal(jaw.parent, 'head');
  assert.ok(jaw.head[2] < head.tail[2] && jaw.tail[2] > jaw.head[2] + 1.5, 'the hinge is behind the snout, the chin tip 2 cm ahead of it');
  assert.ok(GAIT.firesal.gape > 0.5 && GAIT.firesal.gape < 0.8, 'a gape of 30-45 degrees');
});

test('gape turns the jaw about its hinge, chin down, up to the profile gape, and no further', () => {
  const rig = rigOf('firesal'), j = rig.byName.jaw, h = rig.byName.head;
  const shut = pose(rig, { gape: 0 }), wide = pose(rig, { gape: 1 }), over = pose(rig, { gape: 3 }), half = pose(rig, { gape: 0.5 });
  assert.ok(angle(row(shut, j)) < 0.01, 'shut: the jaw does not turn');
  assert.ok(Math.abs(angle(row(wide, j)) - GAIT.firesal.gape) < 0.02, `wide: ${angle(row(wide, j))} vs ${GAIT.firesal.gape}`);
  assert.deepEqual(row(over, j), row(wide, j), 'more than 1 is clamped');
  assert.ok(Math.abs(angle(row(half, j)) - GAIT.firesal.gape / 2) < 0.02, 'half way is half the angle');
  // the chin tip goes down (the tip of the bone, the rest pose's tail, through the bone's matrix)
  const chin = man.firesal.skeleton.bones[j].tail, m = row(wide, j);
  const y = m[4] * chin[0] + m[5] * chin[1] + m[6] * chin[2] + m[7];
  assert.ok(y < chin[1] - 0.8, `the chin drops: ${chin[1]} -> ${y}`);
  assert.deepEqual(row(wide, h), row(shut, h), 'the head itself does not move with the jaw');
});

test('a lizard with no jaw bone (the gecko) ignores the gape channel', () => {
  const rig = rigOf('gecko');
  assert.equal(rig.byName.jaw, undefined);
  assert.deepEqual(Array.from(pose(rig, { gape: 0 })), Array.from(pose(rig, { gape: 1 })));
});

test('the strike opens the mouth before the tongue and shuts it on the catch', () => {
  assert.equal(strikeGape('aim', 0, 0.3), 0);
  assert.ok(Math.abs(strikeGape('aim', 0.25, 0.3) - 0.35) < 1e-9 && strikeGape('aim', 2, 0.3) === 0.35, 'aim: up to 0.35 and held');
  assert.ok(Math.abs(strikeGape('out', 0, 0.075) - 0.35) < 1e-9 && strikeGape('out', 0.075, 0.075) === 1, 'out: 0.35 to 1');
  assert.equal(strikeGape('back', 0, 0.09), 1); assert.equal(strikeGape('back', 0.09, 0.09), 0);
  assert.equal(strikeGape('gulp', 0.1, 0.5), 0); assert.equal(strikeGape(undefined, 1, 1), 0);
  // continuous across the phases (no jump in the mouth)
  assert.ok(Math.abs(strikeGape('aim', 0.25, 0.3) - strikeGape('out', 0, 0.075)) < 1e-9);
  assert.ok(Math.abs(strikeGape('out', 0.075, 0.075) - strikeGape('back', 0, 0.09)) < 1e-9);
});
