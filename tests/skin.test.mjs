// Runtime skeletons (src/render/creatures/skeleton.js): the bone texture's packing, the frog's leg IK and the body plan's joint limits, on the
// skeletons the bake wrote into the manifest; and the capsule binding of the bake (tools/rig/skeleton.mjs bindCapsules).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skeletonRig, poseBones, applyBone, footOffset, RowAllocator, ROW_FLOATS, BONE_TEXELS, MAX_BONES } from '../src/render/creatures/skeleton.js';
import { PLANS, bendAngle } from '../src/util/bodyplan.js';
import { bindCapsules, carryJoints } from '../tools/rig/skeleton.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
// (the frogs' sitting bodies: a swimming body's skeleton, `bind: 'swim'`, is posed by the stroke and has its own tests in
// swim.test.mjs; a skeleton of another body plan (a lizard's) is not a frog's and is tested with its own rig)
const skinned = Object.entries(manifest).filter(([, m]) => m.skeleton && m.skeleton.bind !== 'swim' && (m.skeleton.plan ?? 'anuran') === 'anuran');
const anim = { legLift: 0.25, legStride: 0.35, limb: 1, turn: { pz: -1.4, R: 2.2 } };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const dirOf = (row, b, rig) => { const h = applyBone(row, 0, b, rig.head[b]), t = applyBone(row, 0, b, rig.tail[b]); return [t[0] - h[0], t[1] - h[1], t[2] - h[2]]; };

test('the bake wrote a skeleton for every frog model, within the texture row', () => {
  const ids = skinned.map(([k]) => k);
  assert.ok(ids.includes('dartfrog'), 'dartfrog has a skeleton: ' + ids.join(', '));
  for (const [id, m] of skinned) {
    assert.ok(m.skeleton.bones.length <= MAX_BONES, id);
    assert.equal(BONE_TEXELS * MAX_BONES <= ROW_FLOATS / 4, true);
    assert.ok(skeletonRig(m.skeleton, anim), id + ' poses');
  }
});

test('packing: the rest state packs identity bones; a packed bone moves points as the shader reads it (rows of [R | t])', () => {
  for (const [id, m] of skinned) {
    const rig = skeletonRig(m.skeleton, anim), row = new Float32Array(ROW_FLOATS);
    poseBones(rig, { phase: 0, tau: 0, hop: 0, calm: 1, pose: 0 }, row);
    for (let b = 0; b < rig.n; b++) {
      for (const p of [rig.head[b], rig.tail[b], [1, 2, 3]]) {
        const q = applyBone(row, 0, b, p);
        for (let k = 0; k < 3; k++) near(q[k], p[k], 1e-3, `${id} ${rig.B[b].name} at rest`);
      }
    }
  }
  // a known matrix: rows [R | t] at texel 3b … 3b + 2
  const row = new Float32Array(ROW_FLOATS);
  row.set([0, -1, 0, 5, 1, 0, 0, 6, 0, 0, 1, 7], 2 * 12);
  assert.deepEqual(applyBone(row, 0, 2, [1, 0, 0]), [5, 7, 7]);
});

test('legs: the foot reaches the rig\'s target, bones keep their lengths, knee and heel stay inside the anuran ranges', () => {
  const lim = PLANS.anuran.joints;
  for (const [id, m] of skinned) {
    const rig = skeletonRig(m.skeleton, anim), row = new Float32Array(ROW_FLOATS);
    let reached = 0, total = 0;
    for (let i = 0; i < 200; i++) {
      const st = { phase: i * 0.37, tau: Math.sin(i * 0.7) * (i % 3 === 0 ? 1 : 0), hop: i % 5 === 0 ? (i % 7) / 6 : 0, calm: (i % 4) / 4, pose: i % 9 === 0 ? 1 : 0 };
      const info = poseBones(rig, st, row, 0, {});
      for (let b = 0; b < rig.n; b++) {
        const d = dirOf(row, b, rig);
        near(Math.hypot(...d), rig.L[b], 2e-3 * rig.L[b] + 1e-4, `${id} ${rig.B[b].name} length`);
        const p = rig.parent[b], l = lim[rig.B[b].name.replace(/[LR]$/, '')];
        if (p < 0 || !l || !/shin|forearm|foot|hand/.test(rig.B[b].name)) continue;
        const a = bendAngle(dirOf(row, p, rig), d);
        assert.ok(a >= l.min - 0.5 && a <= l.max + 0.5, `${id} ${rig.B[b].name} bend ${a.toFixed(1)} outside ${l.min} … ${l.max} (state ${JSON.stringify(st)})`);
      }
      // a walking or turning foot (no hop, no swim) reaches where the rig puts it unless a limit held it
      if (st.hop || st.pose) continue;
      for (const c of rig.chains) {
        total++;
        const f = footOffset(rig, c.limb, c.side, st.phase, st.tau, st.calm, 0, 0);
        const st0 = c.hind ? anim.legStride * f.go : 0;          // (the walking stance: hind feet a sweep further out)
        let T = [c.T[0] + f.off[0] + c.out[0] * st0, c.T[1] + f.off[1], c.T[2] + f.off[2] + c.out[2] * st0];
        const pz = anim.turn.pz, cy = Math.cos(f.yaw), sy = Math.sin(f.yaw), x = T[0], z = T[2] - pz;
        T = [x * cy + z * sy, T[1], -x * sy + z * cy + pz];
        if (Math.hypot(...info.tips[c.limb].map((v, k) => v - T[k])) < 1e-3) reached++;
      }
    }
    assert.ok(reached / total > 0.95, `${id}: feet on target ${reached} / ${total}`);
  }
});

test('hop: the hind legs straighten out behind the hips (the knee opens), the forelegs do not move', () => {
  for (const [id, m] of skinned) {
    const rig = skeletonRig(m.skeleton, anim), row = new Float32Array(ROW_FLOATS);
    const knee = (hop) => { poseBones(rig, { phase: 0, tau: 0, hop, calm: 1, pose: 0 }, row); const c = rig.chains.find((q) => q.hind); return bendAngle(dirOf(row, c.u, rig), dirOf(row, c.w, rig)); };
    const k0 = knee(0), k1 = knee(1);
    assert.ok(k1 < k0 - 60, `${id}: knee bend ${k0.toFixed(0)} at rest, ${k1.toFixed(0)} extended`);
    poseBones(rig, { phase: 0, tau: 0, hop: 1, calm: 1, pose: 0 }, row, 0, {});
    const toe = applyBone(row, 0, rig.byName.toesR, rig.tail[rig.byName.toesR]);
    assert.ok(toe[2] < rig.head[rig.byName.thighR][2] - 0.5 * rig.chains[0].Ltot, `${id}: extended toe behind the hip (${toe[2].toFixed(2)})`);
    for (const b of ['armR', 'forearmR', 'handR']) { const q = applyBone(row, 0, rig.byName[b], rig.tail[rig.byName[b]]); for (let k = 0; k < 3; k++) near(q[k], rig.tail[rig.byName[b]][k], 1e-3, `${id} ${b} still`); }
  }
});

test('the frog skeletons rest inside the anuran ranges', () => {
  for (const [id, m] of skinned) {
    const rig = skeletonRig(m.skeleton, anim);
    for (let b = 0; b < rig.n; b++) {
      const p = rig.parent[b], l = rig.limits[b];
      if (p < 0 || !l) continue;
      const a = bendAngle(rig.dir[p], rig.dir[b]);
      assert.ok(a >= l.min - 1 && a <= l.max + 1, `${id} ${rig.B[b].name} rests at ${a.toFixed(1)} outside ${l.min} … ${l.max}`);
    }
  }
});

test('row allocator: runs do not overlap, freed rows are reused, a full texture says so', () => {
  const A = new RowAllocator(16);
  const a = A.take(8), b = A.take(8);
  assert.deepEqual([a, b], [0, 8]);
  assert.equal(A.take(1), -1);
  A.free(a, 8);
  assert.equal(A.take(4), 0);
  assert.equal(A.take(4), 4);
});

test('capsule binding: two bones a vertex, a limb bone only on its own side, weights blend across a joint', () => {
  const bones = [
    { name: 'pelvis', parent: null, head: [0, 0, -1], tail: [0, 0, 0], limb: 0 },
    { name: 'thighR', parent: 'pelvis', head: [0.2, 0, -0.5], tail: [1, 0, -0.5], limb: 4 },
    { name: 'shinR', parent: 'thighR', head: [1, 0, -0.5], tail: [1, 0, -1.5], limb: 4 },
    { name: 'thighL', parent: 'pelvis', head: [-0.2, 0, -0.5], tail: [-1, 0, -0.5], limb: 3 },
  ];
  const pos = new Float32Array([0.6, 0.05, -0.5, 1, 0, -0.5, 1, 0, -1.3, -0.6, 0, -0.5, 0, 0.1, -0.3]);
  const { idx, w } = bindCapsules(pos, bones, { radius: { pelvis: 0.2, thigh: 0.1, shin: 0.1 } });
  assert.equal(idx[0], 1);                       // mid-thigh
  assert.ok(w[1] > 0.4 && w[1] < 0.6, 'the knee is shared: ' + w[1]);
  assert.equal(idx[4], 2);                       // down the shin
  assert.equal(idx[6], 3);                       // the left thigh, never a right bone
  assert.ok(idx[7] !== 1 && idx[7] !== 2);
  assert.equal(idx[8], 0);                       // the body
  // joints carried into a frame twice as large and shifted
  const J = carryJoints({ knee: [1, 0, -0.5] }, pos, pos.map((v, i) => v * 2 + (i % 3 === 1 ? 5 : 0)), 3);
  near(J.knee[0], 2, 1e-3, 'x'); near(J.knee[1], 5, 1e-3, 'y'); near(J.knee[2], -1, 1e-3, 'z');
});
