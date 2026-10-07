// The trunk muscles (docs/MUSCLES.md "Trunk"): the longissimus dorsi pair, one belly a side along the back from the sacrum to the skull, drawn
// in the row's last belly texel (slot 20 in .xy, slot 21 in .zw). Checked: where they sit, that the trunk's own channels move them (a bend
// to one side shortens that side's strap and lengthens the other's, the nose up shortens both), the activation that goes with it, the slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ANURAN_MUSCLES, anuranMuscleSet, anuranFrames, musclePathLength, visibleSlots, excitation, PAIR_SLOT } from '../src/content/anuranmuscles.js';
import { skeletonRig, poseStroke, applyBone, ROW_FLOATS, ROW_TEXELS, MUSCLE_TEXEL0, MUSCLE_PAIR } from '../src/render/creatures/skeleton.js';
import { motionOf, bellyRig, writeBellies, bellyTexel, bellyChannel } from '../src/render/creatures/muscles.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
const SKELS = ['toad', 'toad.swim', 'dartfrog', 'dartfrog.swim'];                 // 17 and 18 bones, the sitting and the swimming bodies
const LGD = ANURAN_MUSCLES.find((d) => d.id === 'LGD');

// the stroke pose of a swimming body with the trunk channels set (degrees: spine yaw, pitch, twist, head yaw, pitch, twist)
function posed(skel, trunk) {
  const rig = skeletonRig(skel, { legLift: 0.3, legStride: 0.35, limb: 1 }), row = new Float32Array(ROW_FLOATS);
  poseStroke(rig, { pL: 0.45, pR: 0.45, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.5, trunk }, row);
  return (b, p) => applyBone(row, 0, b, p);
}
const ID = (b, p) => p;
const strap = (set, s) => set.find((m) => m.id === 'LGD' && m.side === s);

test('the longissimus is one visible pair, in the slots the row has: 20 limb bellies, then the trunk pair', () => {
  const slots = visibleSlots();
  assert.equal(slots.length, 22);
  assert.equal(slots[PAIR_SLOT], 'LGDL'); assert.equal(slots[PAIR_SLOT + 1], 'LGDR');
  assert.equal(MUSCLE_PAIR, PAIR_SLOT);
  assert.ok(LGD.visible && LGD.trunk && LGD.drive === 'trunk');
  assert.ok(MUSCLE_TEXEL0 + PAIR_SLOT < ROW_TEXELS, 'the pair must fit the row');
  // the limb bellies keep the slots they had before the pair (the models bound at 766f73e carry them)
  assert.deepEqual(slots.slice(0, 3), ['TRIL', 'SML', 'GRL']);
  // a slot's place in the row: one texel a limb belly, the pair sharing the last
  assert.equal(bellyTexel(0), MUSCLE_TEXEL0); assert.equal(bellyTexel(19), MUSCLE_TEXEL0 + 19);
  assert.equal(bellyTexel(20), MUSCLE_TEXEL0 + 20); assert.equal(bellyTexel(21), MUSCLE_TEXEL0 + 20);
  assert.equal(bellyChannel(20), 0); assert.equal(bellyChannel(21), 2);
});

test('the straps lie along the back, one each side, from the pelvis to the head, inside the body', () => {
  for (const k of SKELS) {
    const sk = manifest[k].skeleton, set = anuranMuscleSet(sk), L = strap(set, 'L'), R = strap(set, 'R');
    assert.ok(L && R, `${k}: no longissimus`);
    assert.equal(L.pts.length, sk.bones.some((b) => b.name === 'spineB') ? 4 : 3, `${k}: the path's points`);
    assert.equal(L.pts[0].bone, sk.bones.findIndex((b) => b.name === 'pelvis'));
    assert.equal(L.pts.at(-1).bone, sk.bones.findIndex((b) => b.name === 'head'));
    for (let i = 0; i < L.pts.length; i++) {
      const l = L.pts[i].p, r = R.pts[i].p;
      assert.ok(l[0] < 0 && r[0] > 0, `${k}: ${L.pts[i].id} not on its own side`);
      // (the scan's axis is not exactly x = 0: the sitting toad's is at 0.01 cm)
      assert.ok(Math.abs(l[0] + r[0]) < 0.05 && Math.abs(l[1] - r[1]) < 0.03 && Math.abs(l[2] - r[2]) < 0.03, `${k}: not mirrored`);
    }
    // front to back: z falls from the head to the pelvis, and the strap is as long as the trunk between them
    const z = L.pts.map((q) => q.p[2]);
    for (let i = 1; i < z.length; i++) assert.ok(z[i] > z[i - 1], `${k}: the path does not run toward the head`);
    const pv = sk.bones.find((b) => b.name === 'pelvis').head, hd = sk.bones.find((b) => b.name === 'head').tail, svl = Math.hypot(hd[0] - pv[0], hd[1] - pv[1], hd[2] - pv[2]);
    assert.ok(L.L0 / svl > 0.35 && L.L0 / svl < 0.65, `${k}: ${L.L0.toFixed(2)} cm of a ${svl.toFixed(2)} cm trunk`);   // (from the sacrum to the back of the skull: about half of the vent-to-snout length)
  }
});

test('a bend to one side shortens that side\'s strap and lengthens the other; the nose up shortens both', () => {
  for (const k of ['toad.swim', 'dartfrog.swim']) {
    const sk = manifest[k].skeleton, set = anuranMuscleSet(sk), L = strap(set, 'L'), R = strap(set, 'R');
    const len = (m, at) => musclePathLength(m, sk, at, null) / m.L0;
    const rest = posed(sk, [0, 0, 0, 0, 0, 0]);
    assert.ok(Math.abs(len(L, rest) - 1) < 0.02 && Math.abs(len(R, rest) - 1) < 0.02, `${k}: rest is not the rest`);
    const right = posed(sk, [25, 0, 0, 0, 0, 0]);          // yaw > 0 turns the head to the right (+x)
    assert.ok(len(R, right) < 0.98 && len(L, right) > 1.02, `${k}: R ${len(R, right).toFixed(3)} L ${len(L, right).toFixed(3)} with the trunk bent right`);
    const left = posed(sk, [-25, 0, 0, 0, 0, 0]);
    assert.ok(len(L, left) < 0.98 && len(R, left) > 1.02, `${k}: bent left`);
    const up = posed(sk, [0, -20, 0, 0, 0, 0]);            // pitch < 0: nose up, the back extends
    assert.ok(len(L, up) < 0.99 && len(R, up) < 0.99, `${k}: L ${len(L, up).toFixed(3)} R ${len(R, up).toFixed(3)} with the back extended`);
    // over the whole range of each channel on its own, and half of both together (a muscle shortens about 15 % through its range, not to 0.6)
    for (const [y, p] of [[-35, 0], [-25, 0], [25, 0], [35, 0], [0, -25], [0, 25], [-17, -12], [17, -12], [-17, 12], [17, 12]]) for (const m of [L, R]) {
      const l = len(m, posed(sk, [y, p, 0, 0, 0, 0]));
      assert.ok(l > 0.75 && l < 1.3, `${k} ${m.side} yaw ${y} pitch ${p}: ${l.toFixed(2)} of rest`);
    }
  }
});

test('the strap fires with the bend toward its side and with the back\'s extension, a low tone otherwise', () => {
  const L = { side: -1, yaw: 0, pitch: 0 }, R = { side: 1, yaw: 0, pitch: 0 }, tone = excitation(LGD, { ...L, mode: 'swim', t: 0.3 });
  assert.ok(tone > 0 && tone < 0.1, `tone ${tone}`);
  assert.ok(excitation(LGD, { ...R, yaw: 25 }) > 0.8 && excitation(LGD, { ...L, yaw: 25 }) === tone, 'a right bend fires the right strap only');
  assert.ok(excitation(LGD, { ...L, yaw: -25 }) > 0.8 && excitation(LGD, { ...R, yaw: -25 }) === tone, 'a left bend fires the left strap only');
  assert.ok(excitation(LGD, { ...L, pitch: -20 }) > 0.4 && excitation(LGD, { ...R, pitch: -20 }) > 0.4, 'the back extends: both fire');
  assert.equal(excitation(LGD, { ...L, pitch: 20 }), tone, 'the nose down: no extension');
  // the pose state's trunk channels reach it through motionOf (the sides, the spine's yaw and pitch in degrees)
  const st = { trunk: [20, -10, 0, 0, 0, 0], pL: 0.5, pR: 0.5 };
  assert.deepEqual([motionOf(st, true, 'L').side, motionOf(st, true, 'R').side, motionOf(st, true, 'R').yaw, motionOf(st, true, 'R').pitch], [-1, 1, 20, -10]);
});

test('the belly state is written into the shared texel: left in .xy, right in .zw, the limb bellies untouched', () => {
  for (const k of ['toad.swim', 'toad']) {
    const sk = manifest[k].skeleton, rig = skeletonRig(sk, { legLift: 0.3, legStride: 0.35, limb: 1, muscles: true });
    assert.ok(rig?.belly, `${k}: no belly rig`);
    assert.equal(rig.belly.items.length, 22, `${k}: bellies`);
    const row = new Float32Array(ROW_FLOATS), n = sk.bones.length, R = [], H = [];
    for (let b = 0; b < n; b++) { R.push([1, 0, 0, 0, 1, 0, 0, 0, 1]); H.push(sk.bones[b].head); }
    const head = sk.bones.map((b) => b.head);
    writeBellies(rig.belly, R, H, head, row, 0, { trunk: [0, 0, 0, 0, 0, 0], pL: 0.5, pR: 0.5 }, true);
    const t = (MUSCLE_TEXEL0 + PAIR_SLOT) * 4;
    // at rest the straps are at tone: no swell, no slide (the texel is [dR, slide, dR, slide] of the pair)
    for (let c = 0; c < 4; c++) assert.ok(Math.abs(row[t + c]) < 0.05, `${k}: texel ${PAIR_SLOT} channel ${c} = ${row[t + c]} at rest`);
  }
});
