// The frog's hop against real frogs (docs/MUSCLES.md "The hop", the reference pack's hardest test), drawn as the game draws it near the
// camera: the swimming body from the launch until the landing has settled (util/hop.js hopFrame, util/gait.js leapPose, render/
// creatures/skeleton.js poseStroke with its planted legs), the sitting body after, each moved, pitched and rolled as sim/animals.js
// moves the frog along its hop. The references: the owner's two clips (.agents/muscles/refs/JUMPS.md), Essner et al. 2022, Li et al.
// 2021, Duman et al. 2023, Cox et al. 2018. Every fault the owner named on 5 Oct has its test here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skeletonRig, poseBones, poseStroke, applyBone, ROW_FLOATS } from '../src/render/creatures/skeleton.js';
import { leapPose, HIND } from '../src/util/gait.js';
import { hopFrame, hopPlan, svlOf } from '../src/util/hop.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
const SIT = manifest.dartfrog.skeleton, SWIM = manifest['dartfrog.swim'].skeleton;
const sitRig = skeletonRig(SIT, { legLift: 0.3, legStride: 0.35, limb: 1 }), swimRig = skeletonRig(SWIM, {});
const PIVOT = (() => { const L = SWIM.bones.find((b) => b.name === 'thighL').head, R = SWIM.bones.find((b) => b.name === 'thighR').head; return L.map((v, i) => (v + R[i]) / 2); })();   // the hips
const SIZE = 1.4, SC = 1;                         // the dart frog (sim/animals.js SPECIES.dartfrog), drawn at scale 1
// hops of 1.5, 3 and 6 cm on the flat, each leg leading once, a short and a long lag; and a hop up a 2 cm step and down a 2 cm one
// (C1b round 3: the tests only ever hopped on the flat)
const HOPS = [[1.5, 0, [0.2, 0.3]], [3, 0, [0.8, 0.9]], [6, 0, [0.3, 0.1]], [8, 0, [0.7, 0.4]], [3, 2, [0.6, 0.5]], [4, -2, [0.4, 0.7]]].map(([d, rise, rnd]) => ({ d, rise, plan: hopPlan({ d, rise }, svlOf(SIZE, SC), rnd) }));
// (the floor under the frog in the hop's frame: the take-off ground through the launch and the first half of the flight, then the
// landing's, as render/creatures/skeleton.js floorLimb takes it)
const floorAt = (at, hop) => (at.phase === 'launch' || (at.phase === 'flight' && at.u < 0.5) ? 0 : hop.rise);
const ts = Array.from({ length: 81 }, (_, i) => i / 80);

// Where the game draws the frog at hop time t: which body, its bones, and the model-to-world map (util/hop.js hopFrame).
function drawn(t, hop = HOPS[1]) {
  const fr = hopFrame(t, hop, SIZE, SC, PIVOT), row = new Float32Array(ROW_FLOATS), swim = fr.body === 'swim';
  const info = {};
  if (swim) { const st = leapPose(hop.plan, fr.at); st.frames = { f0: hopFrame(0, hop, SIZE, SC, PIVOT), ft: fr }; poseStroke(swimRig, st, row, 0, info); }
  else poseBones(sitRig, { phase: 0, tau: 0, hop: 0, calm: 1, pose: 0 }, row, 0, info);
  const skel = swim ? SWIM : SIT, rig = swim ? swimRig : sitRig;
  const toWorld = (p) => fr.toWorld(p);
  return { fr, row, skel, rig, info, toWorld, at: (b, p) => toWorld(applyBone(row, 0, b, p)) };
}
const toeTip = (D, s) => { const i = D.skel.bones.findIndex((b) => b.name === 'toes' + s); return D.at(i, D.skel.bones[i].tail); };

test('during the launch each hind toe stays where it was planted (within 1 mm) until its own toe-off', () => {
  const bad = [];
  for (const hop of HOPS) for (const s of ['L', 'R']) {
    const T0 = toeTip(drawn(0, hop), s), off = hop.plan.lead === s ? 1 - hop.plan.lag : 1;
    for (const t of ts) {
      const D = drawn(t, hop);
      if (D.fr.at.phase !== 'launch' || D.fr.at.u >= off) continue;
      const T = toeTip(D, s), d = Math.hypot(T[0] - T0[0], T[1] - T0[1], T[2] - T0[2]);
      if (d > 0.1) bad.push(`${hop.d} cm ${s} u ${D.fr.at.u.toFixed(2)}: ${(d * 10).toFixed(1)} mm`);
    }
  }
  assert.deepEqual(bad.slice(0, 12), []);
});

test('the launch moves the body: the hip rises and goes forward while the feet push', () => {
  for (const hop of HOPS) {
    const hip = (D) => { const i = D.skel.bones.findIndex((b) => b.name === 'thighL'); return D.at(i, D.skel.bones[i].head); };
    const a = hip(drawn(0, hop)), tOff = hop.plan.tLaunch / hop.plan.dur, b = hip(drawn(tOff * 0.999, hop));
    assert.ok(b[1] - a[1] > 0.2 && b[2] - a[2] > 0.2, `${hop.d} cm: hip moved ${(b[1] - a[1]).toFixed(2)} up, ${(b[2] - a[2]).toFixed(2)} forward`);
  }
});

test('the hop flies on a ballistic arc under real gravity (981 cm/s2)', () => {
  for (const hop of HOPS) {
    const p = hop.plan, f = (s) => { const t = (p.tLaunch + s) / p.dur; return drawn(t, hop).fr.at.pos[1]; }, h = p.tFlight / 4;
    const g = -(f(h * 3) - 2 * f(h * 2) + f(h)) / (h * h);
    assert.ok(Math.abs(g - 981) < 20, `${hop.d} cm: ${g.toFixed(0)} cm/s2`);
  }
});

test('in the air no hind foot rises above the frog\'s back', () => {
  const bad = [];
  for (const hop of HOPS) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones;
    if (D.fr.at.phase !== 'flight') continue;
    // the back: the top of the trunk's flesh over the pelvis and spine, in the world
    const top = Math.max(...['pelvis', 'spine'].flatMap((n) => { const i = B.findIndex((b) => b.name === n); return [B[i].head, B[i].tail].map((p) => D.at(i, [p[0], p[1] + (B[i].r ?? 0.3), p[2]])[1]); }));
    for (const s of ['L', 'R']) { const y = toeTip(D, s)[1]; if (y > top) bad.push(`${hop.d} cm ${s} t ${t.toFixed(3)}: toes ${(10 * (y - top)).toFixed(1)} mm above the back`); }
  }
  assert.deepEqual(bad, []);
});

// The owner, 5 Oct: "photograms 1 2 and 3 show a real and huge problem here": the legs crossed under the body in the launch. Every
// hind-limb joint and toe tip stays on its own side of the body's midline (the model's x = 0), with 1 mm to spare.
test('the hind legs never cross the body\'s midline', () => {
  const bad = [];
  for (const hop of HOPS) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones, row = D.row;
    for (const s of ['L', 'R']) for (const n of ['shin', 'foot', 'toes']) {
      const i = B.findIndex((b) => b.name === n + s);
      for (const p of [B[i].head, B[i].tail]) {
        const x = applyBone(row, 0, i, p)[0];
        if ((s === 'L' && x > -0.1) || (s === 'R' && x < 0.1)) bad.push(`${hop.d} cm ${n}${s} t ${t.toFixed(3)} (${D.fr.at.phase}): x ${x.toFixed(2)} cm`);
      }
    }
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t')).slice(0, 2).join('; ')), []);
});

// The owner, 5 Oct: "the landing frames give me the impression the frog is landing trough the floor". Nothing may: every limb bone's
// ends stay on or above the floor (feet may rest on it), and the trunk (pelvis, spine, head) with its flesh stays above it, through the
// whole hop of every length.
test('nothing goes through the floor: limb bones, and the trunk with its flesh, stay on or above it all hop long', () => {
  const bad = [];
  for (const hop of HOPS) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones;
    for (let i = 0; i < B.length; i++) {
      const trunk = ['pelvis', 'spine', 'head'].includes(B[i].name), r = trunk ? (B[i].r ?? 0.3) * 0.75 : 0;
      for (const p of [B[i].head, B[i].tail]) {
        const y = D.at(i, p)[1] - r - floorAt(D.fr.at, hop);
        if (y < -0.05) bad.push(`${hop.d} cm ${B[i].name} t ${t.toFixed(3)} (${D.fr.at.phase}): ${(10 * y).toFixed(1)} mm`);
      }
    }
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t')).slice(0, 2).join('; ')), []);
});

// Twist: a bone's rotation about its own length beyond the swing that turns its axis (the swing-twist split of its pose rotation),
// against the swimming scan's rest pose. Thigh and shank 30 deg; the tarsus and toes 40 (the frog's tarsal joints let the foot turn
// over a little: the crouch itself turns them 30-31 deg from the swimming scan). The sitting scan straightened in the old take-off
// twisted 77-84 deg.
const TWIST = { thigh: 30, shin: 30, foot: 40, toes: 40 };
test('no hind-limb bone twists about its own length beyond its limit through the hop', () => {
  const bad = [];
  for (const hop of HOPS) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones;
    for (const s of ['L', 'R']) for (const n of ['thigh', 'shin', 'foot', 'toes']) {
      const i = B.findIndex((b) => b.name === n + s), k = i * 12, R = [0, 1, 2].map((r) => [D.row[k + r * 4], D.row[k + r * 4 + 1], D.row[k + r * 4 + 2]]);
      const a = norm(sub(B[i].tail, B[i].head)), u0 = across([0, 1, 0], a);
      const mv = (v) => R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
      const a1 = norm(mv(a)), u1 = mv(u0), sw = swing(a, a1), u0s = rot(sw, u0);
      const tw = Math.acos(Math.max(-1, Math.min(1, dot(norm(across(u1, a1)), norm(across(u0s, a1)))))) * 180 / Math.PI;
      if (tw > TWIST[n]) bad.push(`${hop.d} cm ${n}${s} t ${t.toFixed(3)} (${D.fr.body}): ${tw.toFixed(0)} deg`);
    }
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t')).slice(0, 2).join('; ')), []);
});

// The owner, 5 Oct 13:47: "pics 2,3,4 still show something wrong going on with the hips and first half of the leg": in the push the
// thighs hung straight down beside the body, the knees came in under the hips and the feet stuck out past them. Clip A (fine frames
// 0.97-1.29 s, from behind): the thighs slant down and out to wide knees, or lie level, and the shanks drop from the knees to the
// planted feet, vertical or a little out. From a third of each leg's push to its toe-off, seen from behind: the knee stands out
// from the hip by at least 0.6 of the thigh's length, the thigh is no steeper than 45 deg below the horizontal (the clip's steepest,
// 0.97-1.13 s) nor above 15 deg, and the shank leans in from the knee by no more than 15 deg. (Measured 14:55: knee 0.72 out, thigh
// -26 to +12 deg, shank leaning out; the first bounds, 0.5 / 55 / 25, were looser than the clip: C1b round 5.)
test('in a short hop\'s push the thighs go out to wide knees and the shanks drop from them (clip A, from behind)', () => {
  const bad = [];
  for (const hop of HOPS.filter((h) => h.plan.short >= 0.5)) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones, at = D.fr.at;
    if (at.phase !== 'launch') continue;
    for (const s of ['L', 'R']) {
      const off = hop.plan.lead === s ? 1 - hop.plan.lag : 1, e = at.u / off;
      if (e < 0.35 || e >= 1) continue;
      const th = B.findIndex((b) => b.name === 'thigh' + s), sh = B.findIndex((b) => b.name === 'shin' + s);
      const H = D.at(th, B[th].head), K = D.at(th, B[th].tail), A = D.at(sh, B[sh].tail), Lt = Math.hypot(...sub(B[th].tail, B[th].head));
      const out = Math.abs(K[0]) - Math.abs(H[0]), elev = Math.atan2(K[1] - H[1], Math.hypot(K[0] - H[0], K[2] - H[2])) * 180 / Math.PI;
      const lean = Math.atan2(Math.abs(K[0]) - Math.abs(A[0]), K[1] - A[1]) * 180 / Math.PI;
      const why = [out < 0.6 * Lt && `knee only ${(10 * out).toFixed(1)} mm out`, (elev < -45 || elev > 15) && `thigh at ${elev.toFixed(0)} deg`, (lean > 15 || K[1] <= A[1]) && `shank leans in ${lean.toFixed(0)} deg`].filter(Boolean);
      if (why.length) bad.push(`${hop.d} cm ${s} t ${t.toFixed(3)} (push ${e.toFixed(2)}): ${why.join(', ')}`);
    }
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t')).slice(0, 2).join('; ')), []);
});

// The owner, 5 Oct 13:48: "let's also fix the arms": they stuck straight out like wings. Clip A (1.29-1.53 s): in the air the arms
// are out to the sides with the elbows bent, the forearms angled forward and down, the hands below the shoulders. From the second half
// of the launch (the arms lift off the floor as the body rises, clip A 1.05-1.17 s) and through the flight: each elbow bends at least
// 40 deg (cane toads land on it at 110 +- 12 deg inside, Cox et al. 2018; 63, Duman et al. 2023), the forearm points at least 15 deg
// forward of the side (the body's +z), the hand is lower than the shoulder and off the floor until they start down for the landing (0.6 of the flight; clip A 1.45 s), when
// the hands reach down to land first. (Measured 14:55: bend 51 deg or more,
// forearm 24 deg forward or more.)
test('in a short hop, from the launch on, the elbows bend and the forearms angle forward and down (clip A)', () => {
  const bad = [];
  for (const hop of HOPS.filter((h) => h.plan.short >= 0.5)) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones, at = D.fr.at;
    if (!((at.phase === 'launch' && at.u >= 0.5) || at.phase === 'flight')) continue;
    for (const s of ['L', 'R']) {
      const a = B.findIndex((b) => b.name === 'arm' + s), f = B.findIndex((b) => b.name === 'forearm' + s), h = B.findIndex((b) => b.name === 'hand' + s);
      const m = (i, p) => applyBone(D.row, 0, i, p), S = m(a, B[a].head), E = m(a, B[a].tail), W = m(f, B[f].tail), T = m(h, B[h].tail);
      const u = norm(sub(E, S)), v = norm(sub(W, E)), bend = Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180 / Math.PI;
      const why = [bend < 40 && `elbow bent ${bend.toFixed(0)} deg`, v[2] < Math.sin(15 * Math.PI / 180) && `forearm ${(Math.asin(v[2]) * 180 / Math.PI).toFixed(0)} deg forward`,
        D.toWorld(T)[1] >= D.toWorld(S)[1] && 'hand above the shoulder', (at.phase === 'launch' || at.u < 0.6) && D.toWorld(T)[1] < floorAt(at, hop) + 0.05 && 'hand on the floor'].filter(Boolean);   // (until they reach for the landing)
      if (why.length) bad.push(`${hop.d} cm ${s} t ${t.toFixed(3)}: ${why.join(', ')}`);
    }
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t')).slice(0, 2).join('; ')), []);
});

// A long jump's push (Porro et al. 2017, read by anatomy specialist A1: .agents/muscles/control/anatomy-A1.md 14; the owner's clips C
// and D): the shank keeps its direction through the first ~80 % of the push, the thigh and the tarsus turn together, parallel from
// above. Until the afternoon of 5 Oct the long jump pushed with the short hop's wide knees, and retracting the thigh alone sank the heel under the
// floor and slid the toes.
test('in a long jump\'s push the shank keeps its direction and the thigh and tarsus stay parallel from above (Porro 2017)', () => {
  const bad = [];
  for (const hop of HOPS.filter((h) => h.plan.short < 0.5)) for (const s of ['L', 'R']) {
    const off = hop.plan.lead === s ? 1 - hop.plan.lag : 1, dirs = [];
    for (const t of ts) {
      const D = drawn(t, hop), B = D.skel.bones, at = D.fr.at;
      if (at.phase !== 'launch' || at.u / off < 0.1 || at.u / off > 0.75) continue;
      const seg = (n) => { const i = B.findIndex((b) => b.name === n + s); return norm(sub(D.at(i, B[i].tail), D.at(i, B[i].head))); };
      const th = seg('thigh'), sh = seg('shin'), ft = seg('foot');
      const head = (v) => Math.atan2(v[0], v[2]) * 180 / Math.PI, gap = Math.abs(((head(th) - head(ft) + 540) % 360) - 180);
      dirs.push(sh);
      if (gap > 30) bad.push(`${hop.d} cm ${s} t ${t.toFixed(3)}: thigh and tarsus ${gap.toFixed(0)} deg apart from above`);
    }
    const turn = Math.max(0, ...dirs.map((d) => Math.acos(Math.max(-1, Math.min(1, dot(d, dirs[0])))) * 180 / Math.PI));
    if (turn > 20) bad.push(`${hop.d} cm ${s}: the shank turned ${turn.toFixed(0)} deg in the push`);
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t') || b === k).slice(0, 2).join('; ')), []);
});

// A long jump's arms in the air: laid back along the flanks (the owner's clip C 6.5 s; A2 16), not out like wings: each hand behind
// its shoulder and no further out from the body than the shoulder plus half the arm's reach.
test('in a long jump the arms lie back along the flanks in the air (clip C)', () => {
  const bad = [];
  for (const hop of HOPS.filter((h) => h.plan.short < 0.5)) for (const t of ts) {
    const D = drawn(t, hop), B = D.skel.bones;
    if (D.fr.at.phase !== 'flight' || D.fr.at.u < 0.15 || D.fr.at.u > 0.55) continue;
    for (const s of ['L', 'R']) {
      const a = B.findIndex((b) => b.name === 'arm' + s), f = B.findIndex((b) => b.name === 'forearm' + s), h = B.findIndex((b) => b.name === 'hand' + s);
      const m = (i, p) => applyBone(D.row, 0, i, p), S = m(a, B[a].head), T = m(h, B[h].tail);
      const reach = [a, f, h].reduce((r, i) => r + Math.hypot(...sub(B[i].tail, B[i].head)), 0);
      if (T[2] >= S[2]) bad.push(`${hop.d} cm ${s} t ${t.toFixed(3)}: hand ${(10 * (T[2] - S[2])).toFixed(1)} mm ahead of the shoulder`);
      if (Math.abs(T[0]) > Math.abs(S[0]) + 0.5 * reach) bad.push(`${hop.d} cm ${s} t ${t.toFixed(3)}: hand ${(10 * (Math.abs(T[0]) - Math.abs(S[0]))).toFixed(1)} mm out from the shoulder`);
    }
  }
  assert.deepEqual([...new Set(bad.map((b) => b.split(' t ')[0]))].map((k) => bad.filter((b) => b.startsWith(k + ' t')).slice(0, 2).join('; ')), []);
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const across = (d, a) => { const v = sub(d, a.map((x) => x * dot(d, a))); return Math.hypot(...v) > 1e-6 ? norm(v) : norm(cross(a, [1, 0, 0])); };
function swing(a, b) {                     // the shortest-arc rotation from unit a to unit b, as [axis, angle]
  const c = cross(a, b), s = Math.hypot(...c);
  return [s > 1e-9 ? c.map((v) => v / s) : across([0, 1, 0], a), Math.atan2(s, dot(a, b))];
}
function rot([n, t], v) { const c = Math.cos(t), s = Math.sin(t), k = dot(n, v) * (1 - c), x = cross(n, v); return [0, 1, 2].map((i) => v[i] * c + x[i] * s + n[i] * k); }
