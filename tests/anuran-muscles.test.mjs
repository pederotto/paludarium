// The frog's muscle layer (docs/MUSCLES.md, content/anuranmuscles.js) checked before it drives anything: the validators of the
// frog hind-limb muscle reference pack. Attachments on or inside their bone; left and right alike; every moment arm with the sign its
// source gives, at the posture the source used; muscle-tendon lengths and fibre lengths in range through the game's real motions
// (the sitting body's walk and hop, the swimming body's stroke and the hop as the game draws it) and over each joint's range; the mass
// budget against the scans' volumes (tools/rig/muscles.mjs reads the models).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MUSCLES_SCHEMA, ANURAN_MUSCLES, ANURAN_LANDMARKS, ANURAN_WHOLE, anuranMuscleSet, anuranFrames, crossedJoints, musclePathLength,
  momentArmAt, turnJoint, foldAt, protractionAt, muscleUnit } from '../src/content/anuranmuscles.js';
import { fibreState } from '../src/util/musculo.js';
import { skeletonRig, poseBones, poseStroke, applyBone, ROW_FLOATS } from '../src/render/creatures/skeleton.js';
import { leapPose, hopLegs } from '../src/util/gait.js';
import { hopPlan, hopFrame, svlOf } from '../src/util/hop.js';
import { loadFrog } from '../tools/rig/muscles.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
const anurans = Object.entries(manifest).filter(([k, m]) => m.skeleton && (m.skeleton.plan ?? 'anuran') === 'anuran' && !k.includes(':') && !k.endsWith('.sleep'));
const SIT = 'dartfrog', SWIM = 'dartfrog.swim';
console.log(`MUSCLES_SCHEMA ${MUSCLES_SCHEMA}: ${ANURAN_MUSCLES.length} muscles a side, ${Object.keys(ANURAN_LANDMARKS).length} landmarks, bodies ${anurans.map(([k]) => k).join(' ')}`);

const ID = (b, p) => p;
const WANT = { protractor: 1, flexor: 1, retractor: -1, extensor: -1 };

// The game's poses of a body as point maps: the sitting body through poseBones, the swimming body through poseStroke; its leap is the
// hop as the game draws it near the camera (a 3 cm hop, util/hop.js and util/gait.js leapPose, as tests/frog-hop.test.mjs draws it).
function poser(skel) {
  const rig = skeletonRig(skel, { legLift: 0.3, legStride: 0.35, limb: 1 }), row = new Float32Array(ROW_FLOATS);
  const map = () => { const r = row.slice(); return (b, p) => applyBone(r, 0, b, p); };
  if (rig.stroke) {
    const hip = (s) => skel.bones.find((b) => b.name === 'thigh' + s).head, pivot = [0, 1, 2].map((i) => (hip('L')[i] + hip('R')[i]) / 2);
    const hop = { d: 3, rise: 0 }; hop.plan = hopPlan(hop, svlOf(1.4, 1), [0.3, 0.6]);
    return {
      swim: (ph) => { poseStroke(rig, { pL: ph, pR: ph, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.5 }, row); return map(); },
      leap: (t) => { const fr = hopFrame(t, hop, 1.4, 1, pivot), st = leapPose(hop.plan, fr.at); st.frames = { f0: hopFrame(0, hop, 1.4, 1, pivot), ft: fr }; poseStroke(rig, st, row); return map(); },
    };
  }
  return {
    walk: (ph) => { poseBones(rig, { phase: ph, tau: 0, hop: 0, calm: 0, pose: 0 }, row); return map(); },
    hop: (t) => { poseBones(rig, { phase: 0, tau: 0, hop: hopLegs(t), calm: 1, pose: 0 }, row); return map(); },
  };
}

test('every landmark lies on or inside its bone\'s flesh, a bony one close to the bone', () => {
  for (const [id, lm] of Object.entries(ANURAN_LANDMARKS)) {
    const across = Math.hypot(lm.post ?? 0, lm.dors ?? 0, lm.out ?? 0);
    assert.ok(across <= (lm.soft ? 0.9 : 0.75), `${id}: ${across.toFixed(2)} flesh radii off its bone`);
    assert.ok(lm.t >= -0.25 && lm.t <= 1.15, `${id}: t ${lm.t} too far past its bone`);
  }
  for (const [k, m] of anurans) {
    const set = anuranMuscleSet(m.skeleton), B = m.skeleton.bones;
    assert.ok(set, `${k}: no muscle set`);
    for (const mu of set) for (const q of mu.pts) {
      const b = B[q.bone], d = segDist(q.p, b.head, b.tail);
      // (a pelvis landmark hangs from the hip, which sits on the pelvis' flesh radius)
      const lim = (b.r ?? 0.2) * (b.name === 'pelvis' ? 1.35 : 1.0);
      assert.ok(d <= lim, `${k} ${mu.id}${mu.side} ${q.id}: ${d.toFixed(3)} cm from ${b.name} (flesh radius ${b.r})`);
    }
  }
});

// The template is the same both sides by construction, so on a skeleton mirrored exactly the two sides must match to 0.1 %: a frame or
// sign that is not mirrored shows up here. On the real scans, with both legs in the same pose (the game's symmetric poses), within 3 %
// (the target), or the scan's own left/right difference in the bones the muscle spans and 1 % beside: the swimming scan's left toes
// are 13.5 % longer than its right, its tarsus 7.4 %, and a muscle cannot be more alike than its bones. (Until 5 Oct the scans were
// checked in their rest poses, which hold the legs differently, at 6 %: C1b round 3.)
test('left and right muscles match: exactly on a mirrored skeleton, within 3 % (or their bones\' own difference) on the scans', () => {
  const bad = [];
  const mirror = (skel) => {
    const B = skel.bones.map((b) => ({ ...b }));
    const by = Object.fromEntries(B.map((b, i) => [b.name, i]));
    for (const b of B) {
      if (b.name.endsWith('R')) { const l = B[by[b.name.slice(0, -1) + 'L']]; b.head = [-l.head[0], l.head[1], l.head[2]]; b.tail = [-l.tail[0], l.tail[1], l.tail[2]]; b.r = l.r; }
      else if (!b.name.endsWith('L')) { b.head = [0, b.head[1], b.head[2]]; b.tail = [0, b.tail[1], b.tail[2]]; }
    }
    return { ...skel, bones: B };
  };
  const sym = (skel) => {
    const rig = skeletonRig(skel, { legLift: 0.3, legStride: 0.35, limb: 1 }), row = new Float32Array(ROW_FLOATS), out = [];
    const put = () => { const r = row.slice(); out.push((b, p) => applyBone(r, 0, b, p)); };
    if (rig.stroke) for (const ph of [0, 0.08, 0.16, 0.4, 0.8]) { poseStroke(rig, { pL: ph, pR: ph, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.5 }, row); put(); }
    else for (const t of [0, 0.5, 1]) { poseBones(rig, { phase: 0, tau: 0, hop: hopLegs(t), calm: 1, pose: 0 }, row); put(); }
    return out;
  };
  const boneLen = (B, i) => Math.hypot(B[i].tail[0] - B[i].head[0], B[i].tail[1] - B[i].head[1], B[i].tail[2] - B[i].head[2]);
  for (const [k, m] of anurans) {
    for (const [skel, mirrored] of [[mirror(m.skeleton), true], [m.skeleton, false]]) {
      const set = anuranMuscleSet(skel), B = skel.bones, poses = mirrored ? [ID] : sym(skel);
      for (const mu of set.filter((x) => x.side === 'L')) {
        const r = set.find((x) => x.side === 'R' && x.id === mu.id);
        // (the bones it spans, left against right)
        const own = Math.max(0, ...[...new Set(mu.pts.map((q) => B[q.bone].name))].filter((n) => n.endsWith('L')).map((n) => Math.abs(boneLen(B, B.findIndex((b) => b.name === n)) / boneLen(B, B.findIndex((b) => b.name === n.slice(0, -1) + 'R')) - 1)));
        // (and on a scan, the muscle's own left-right difference as the scan was bound, unposed: the common frog's scan has its right hip a little wider, 5 %)
        const rest = mirrored ? 0 : Math.abs(musclePathLength(mu, skel, ID) / musclePathLength(r, skel, ID) - 1);
        const tol = mirrored ? 0.001 : Math.max(0.03, own + 0.01, rest + 0.01);
        for (const at of poses) {
          const a = musclePathLength(mu, skel, at), b = musclePathLength(r, skel, at);
          if (Math.abs(a / b - 1) > tol) { bad.push(`${k}${mirrored ? ' (mirrored)' : ''} ${mu.id}: L ${a.toFixed(3)} R ${b.toFixed(3)} cm (allowed ${(tol * 100).toFixed(1)} %)`); break; }
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

// The sources' actions: the hip's from Collings et al. 2022 Table 6 ("maintained" over femur protraction 10-135 deg; IE and SA change
// sign at 10): checked with the femur at 45, 90 and 135 deg; groups whose source gives no posture (HIPR: Leavey 2024) at 90 only. Knee
// and ankle from Leavey et al. 2024 Table 1, read as the action over the joint's working range: checked with the joint at a 90 deg
// fold. 'variable' is not asserted. (HIPR is checked over the femur's 90-135 deg, the short hop's push: below about 60 deg its line
// crosses the rig's hip, which sits lateral of the real acetabulum, and it turns protractor; no source gives its action there. C1b
// round 3, item 6: open.)
test('every moment arm has the sign its source gives', () => {
  const rows = [], bad = [];
  for (const k of [SIT, SWIM]) {
    const skel = manifest[k].skeleton, set = anuranMuscleSet(skel), F = anuranFrames(skel);
    for (const mu of set) {
      for (const j of crossedJoints(mu, skel)) {
        const act = mu.def.acts[j];
        if (!act || act === 'variable') continue;
        const pro = protractionAt(skel, mu.side, ID, F), toPro = (deg) => turnJoint(skel, 'hip', mu.side, ((deg - pro) * Math.PI) / 180, ID, F);
        const poses = j === 'hip' ? (mu.def.hipAt ?? [90]).map(toPro)
          : [turnJoint(skel, j, mu.side, ((90 - foldAt(skel, j, mu.side)) * Math.PI) / 180, ID, F)];
        for (const at of poses) {
          const r = momentArmAt(mu, skel, j, at);
          rows.push(`${k} ${mu.id}${mu.side} ${j} ${(r * 10).toFixed(2)} mm (${act})`);
          if (Math.sign(r) !== WANT[act]) bad.push(`${k} ${mu.id}${mu.side} ${j}: ${(r * 10).toFixed(2)} mm, the source says ${act}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(rows.length >= 40, `only ${rows.length} moment arms checked`);
});

test('muscle-tendon lengths stay within 0.6-1.6 of rest through the game\'s walk, hop, stroke and leap', () => {
  const bad = [];
  for (const k of [SIT, SWIM]) {
    const skel = manifest[k].skeleton, set = anuranMuscleSet(skel), P = poser(skel);
    const poses = P.walk ? [...range(12).map((i) => P.walk((i / 12) * Math.PI * 2)), ...range(11).map((i) => P.hop(i / 10))]
      : [...range(16).map((i) => P.swim(i / 16)), ...range(11).map((i) => P.leap(i / 10))];
    for (const mu of set) {
      const L0 = musclePathLength(mu, skel, ID);
      let lo = Infinity, hi = 0;
      for (const at of poses) { const l = musclePathLength(mu, skel, at) / L0; lo = Math.min(lo, l); hi = Math.max(hi, l); }
      if (!(lo >= 0.6 && hi <= 1.6)) bad.push(`${k} ${mu.id}${mu.side}: ${lo.toFixed(2)}-${hi.toFixed(2)} of rest`);
    }
  }
  assert.deepEqual(bad, []);
});

// Over each joint's whole range, one joint at a time from rest (knee and ankle folded 20-170 deg, the femur protracted 10-135 deg): the
// game's poses use only part of it (C1b round 3, item 3).
test('muscle-tendon lengths stay within 0.6-1.6 of rest over each crossed joint\'s range', () => {
  const bad = [];
  for (const k of [SIT, SWIM]) {
    const sk = manifest[k].skeleton, set = anuranMuscleSet(sk), F = anuranFrames(sk);
    for (const mu of set) {
      const L0 = musclePathLength(mu, sk, ID);
      for (const j of crossedJoints(mu, sk)) {
        if (j === 'tarsus') continue;              // (no chain of its own to turn: the tarsal joints are inside the foot bone)
        for (const deg of j === 'hip' ? [10, 30, 45, 60, 90, 112, 135] : [20, 45, 70, 90, 110, 135, 150, 170]) {
          const at = j === 'hip' ? turnJoint(sk, 'hip', mu.side, ((deg - protractionAt(sk, mu.side, ID, F)) * Math.PI) / 180, ID, F)
            : turnJoint(sk, j, mu.side, ((deg - foldAt(sk, j, mu.side)) * Math.PI) / 180, ID, F);
          const l = musclePathLength(mu, sk, at) / L0;
          if (l < 0.6 || l > 1.6) bad.push(`${k} ${mu.id}${mu.side} ${j} ${deg} deg: ${l.toFixed(2)} of rest`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

// Every muscle switched fully on at every pose the game draws with bones (any of them may be called on there): its fibres, in
// equilibrium with the tendon, must stay on the force-length curve (0.5-1.6 of optimal). Mid-hop (t 0.06-0.9) a frog near the camera
// is drawn in its swimming body as a leap (sim/animals.js leapMesh), so the sitting body's hop counts only at its two ends.
// (5 Oct: with the sitting body's whole hop the plantaris' guessed fibres reached 0.45 at t 0.7, a pose never drawn with bones.)
// Switched off too (a = 0: the passive stretch is longest then; C1b round 3, item 4), and never at the edge of the solver's bracket (no
// equilibrium: the MTU too short or too long for its muscle, item 10).
test('fibres stay on their force-length curve (0.5-1.6 of optimal), the muscle off or fully on, at every pose of the walk, hop, stroke and leap', () => {
  const runs = [];
  for (const k of [SIT, SWIM]) {
    const sk = manifest[k].skeleton, P = poser(sk);
    const poses = P.walk ? [...range(12).map((i) => ['walk', i / 12, P.walk((i / 12) * Math.PI * 2)]), ...[0, 0.03, 0.06, 0.9, 0.95, 1].map((t) => ['hop', t, P.hop(t)])]
      : [...range(16).map((i) => ['swim', i / 16, P.swim(i / 16)]), ...range(11).map((i) => ['leap', i / 10, P.leap(i / 10)])];
    runs.push([k, sk, anuranMuscleSet(sk), poses]);
  }
  const bad = [], rows = [];
  for (const [k, sk, S, poses] of runs) {
    for (const mu of S) {
      const u = muscleUnit(mu, sk);
      let lo = Infinity, hi = 0, wl = '', wh = '';
      for (const [mode, t, at] of poses) for (const a of [0, 1]) {
        const f = fibreState(u, musclePathLength(mu, sk, at), a);
        if (f.clamped) bad.push(`${k} ${mu.id}${mu.side} ${mode} ${t.toFixed(2)} a ${a}: no equilibrium`);
        if (f.ln < lo) { lo = f.ln; wl = `${mode} ${t.toFixed(2)} a ${a}`; }
        if (f.ln > hi) { hi = f.ln; wh = `${mode} ${t.toFixed(2)} a ${a}`; }
      }
      if (mu.side === 'L') rows.push(`${k} ${mu.id} ${lo.toFixed(2)}-${hi.toFixed(2)}`);
      if (!(lo >= 0.5 && hi <= 1.6)) bad.push(`${k} ${mu.id}${mu.side}: ${lo.toFixed(2)} (${wl}) to ${hi.toFixed(2)} (${wh}) of optimal`);
    }
  }
  console.log('fibres off and fully on, range over the motions: ' + rows.join(' | '));
  assert.deepEqual(bad, []);
});

// The mass budget: the hind-limb muscle mass, both legs, within the published share of body mass for frogs (ANURAN_WHOLE.hindlimbOfBody:
// 13-25 %, Roberts et al. 2011 Table 1, three species), the body's mass from the scan's volume; and each leg segment's muscles inside
// the segment: no more than the capsule of the bone's measured flesh radius (the skin the bone owns is no measure where the scan fuses
// the thigh to the body: 133 % of it on the dart frog). Both dart frog bodies, the toad and the reed frog.
test('hind-limb muscle mass within the published share of body mass, and inside each leg segment', async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const W = ANURAN_WHOLE.hindlimbOfBody, bad = [], rows = [];
  assert.ok(W.value >= W.band[0] && W.value <= W.band[1], `share ${W.value} outside ${W.band}`);
  for (const k of [SIT, SWIM, 'toad', 'reedfrog'].filter((x) => manifest[x])) {
    const F = await loadFrog(io, manifest, k);
    const m = F.bodies.reduce((t, b) => t + b.mass, 0) / F.BM;
    if (m < W.band[0] - 1e-6 || m > W.band[1] + 1e-6) bad.push(`${k}: hind-limb muscle ${(100 * m).toFixed(1)} % of body mass`);
    for (const g of F.segs) {
      rows.push(`${k} ${g.seg}${g.side} ${(100 * g.muscle / g.capsule).toFixed(0)} %`);
      if (g.muscle > g.capsule) bad.push(`${k} ${g.seg} ${g.side}: muscle ${g.muscle.toFixed(3)} cm3, ${(100 * g.muscle / g.capsule).toFixed(0)} % of the segment`);
    }
  }
  console.log('muscle volume of each segment: ' + rows.join(' | '));
  assert.deepEqual(bad, []);
});

function segDist(p, h, t) {
  const u = [t[0] - h[0], t[1] - h[1], t[2] - h[2]], L2 = u[0] ** 2 + u[1] ** 2 + u[2] ** 2 || 1e-12;
  const k = Math.max(0, Math.min(1, ((p[0] - h[0]) * u[0] + (p[1] - h[1]) * u[1] + (p[2] - h[2]) * u[2]) / L2));
  return Math.hypot(p[0] - h[0] - u[0] * k, p[1] - h[1] - u[1] * k, p[2] - h[2] - u[2] * k);
}
function range(n) { return Array.from({ length: n }, (_, i) => i); }
