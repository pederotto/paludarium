// The lizard muscle layer (G2): the plan's muscle groups on the gecko's 25 baked bones (util/bodyplan.js PLANS.lizard.muscles, the
// per-species gains in PLANS.lizard.species), the swell the frog's writeBones gives them (render/creatures/skeleton.js), the tail
// base's coupling to the hind legs, the toe-peel channel and the jaw and throat channels (util/lizardmuscles.js, lizardpose.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLANS, bendAngle } from '../src/util/bodyplan.js';
import { skeletonRig, poseBones } from '../src/render/creatures/skeleton.js';
import { LIZARD_GROUPS, lizardSpecies, swellOf, tailBaseSwing, toePeel, throatFlutter, headSwell, SWELL_CAP } from '../src/util/lizardmuscles.js';

const skel = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8')).gecko.skeleton;
const names = skel.bones.map((b) => b.name);
const has = (k) => names.includes(k) || (names.includes(k + 'L') && names.includes(k + 'R'));
const plan = PLANS.lizard, RAD = Math.PI / 180;
const rig = skeletonRig(skel);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotYv = (d, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]]; };
// a rest-frame point p of bone b as the pose wrote it (rows of [R | t])
const at = (out, b, p) => { const o = b * 12; return [0, 1, 2].map((r) => out[o + r * 4] * p[0] + out[o + r * 4 + 1] * p[1] + out[o + r * 4 + 2] * p[2] + out[o + r * 4 + 3]); };
const pose = (st) => { const out = new Float32Array(rig.n * 12); poseBones(rig, st, out, 0); return out; };
const GROUPS = ['trunk', 'tailBase', 'shoulderSwing', 'shoulderPush', 'hipSwing', 'hipPush', 'elbow', 'knee', 'wrist', 'ankle', 'fingers', 'toes', 'jaw', 'throat'];

test('every lizard muscle group is in the plan, on a bone and a joint of the 25-bone list, with a gecko gain', () => {
  assert.equal(names.length, 25);
  assert.ok(rig && rig.bellies, 'the lizard rig carries its muscle records');
  const gains = lizardSpecies('gecko').gains;
  assert.deepEqual([...LIZARD_GROUPS].sort(), [...GROUPS].sort());
  for (const id of GROUPS) {
    const r = plan.muscles.find((m) => m.id === id);
    assert.ok(r, `group ${id}`);
    assert.ok(has(r.bone), `${id}: bone ${r.bone}`);
    if (r.channel) assert.ok(['jaw', 'throat'].includes(r.channel), id);
    else assert.ok(has(r.joint) && plan.joints[r.joint] && ['fold', 'retract', 'protract', 'peel'].includes(r.acts), `${id}: joint ${r.joint}`);
    assert.ok(gains[id] > 0, `${id}: gecko gain`);
    assert.ok(r.note?.length > 10 && r.name, `${id}: anatomy note`);
    if (r.joint) assert.ok(rig.bellies.some((m) => m.id === id), `${id} is live on the rig`);
  }
  assert.equal(lizardSpecies('skink').gains, lizardSpecies('gecko').gains, 'a species without its own table takes the gecko\'s (until its builder sets it)');
});

test('each bulge is zero at rest, grows steadily with its joint and stays under the frog\'s cap', () => {
  for (const m of rig.bellies) {
    const a0 = m.flex0 * 180, tag = `${m.id} ${names[m.b]} by ${names[m.j]}`;
    assert.equal(swellOf(m, a0), 0, tag);
    assert.ok(swellOf(m, a0 + m.sense * 5) > 0, `${tag} grows at once`);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const k = swellOf(m, Math.max(0, Math.min(180, a0 + (m.sense * m.span * i) / 20)));
      assert.ok(k >= prev - 1e-12 && k <= SWELL_CAP, `${tag} step ${i}: ${k}`);
      prev = k;
    }
    assert.ok((Math.abs(m.k) * m.span) / 180 < SWELL_CAP, `${tag}: under the cap by design, not by the clamp`);
  }
});

test('retracting a thigh swells the tail base and the hip push; protracting it the hip swing', () => {
  const P = rig.dir[rig.byName.pelvis];
  for (const s of ['L', 'R']) {
    const t = rig.byName['thigh' + s], d = rig.dir[t];
    const back = rotYv(d, 0.5 * Math.sign(d[0])), fwd = rotYv(d, -0.5 * Math.sign(d[0]));
    assert.ok(back[2] < d[2] && fwd[2] > d[2]);
    const k = (id, v) => swellOf(rig.bellies.find((m) => m.id === id && m.j === t), bendAngle(P, v));
    assert.ok(k('tailBase', back) > 0.01 && k('hipPush', back) > 0.01 && k('hipSwing', back) <= 0, s);
    assert.ok(k('hipSwing', fwd) > 0.01 && k('tailBase', fwd) <= 0, s);
  }
  // a walking pose writes one belly a bone (the strongest), as the frog's writeBones takes one
  pose({ phase: 1.3, calm: 0 });
  const bs = rig.muscles.map((m) => m.b);
  assert.equal(new Set(bs).size, bs.length);
});

test('the tail base swings toward the side of the retracting hind leg, follows it with a lag, inside the tail\'s range', () => {
  const c = lizardSpecies('gecko').tailBase;
  const yL = tailBaseSwing(0, 0.6, 0, 1, c), yR = tailBaseSwing(0, 0, 0.6, 1, c);
  assert.ok(yL > 0 && yR < 0 && Math.abs(yL + yR) < 1e-12);       // + yaw turns the backward tail toward -x (left)
  assert.ok(Math.abs(tailBaseSwing(0, 0.6, 0.2, 1, c) - tailBaseSwing(0, 0.4, 0, 1, c)) < 1e-12);
  const target = tailBaseSwing(0, 0.6, 0, 1e9, c);
  assert.ok(Math.abs(tailBaseSwing(0, 0.6, 0, c.lag, c) / target - (1 - Math.exp(-1))) < 1e-9);
  let y = 0;
  for (let i = 0; i < 40; i++) { const y2 = tailBaseSwing(y, 0.6, 0, c.lag / 4, c); assert.ok(y2 >= y && y2 <= target + 1e-12); y = y2; }
  assert.ok(Math.abs(tailBaseSwing(0, 3, -3, 1e9, c)) <= plan.rom.tail.yaw[1] * RAD + 1e-12);
  // in the pose: st.tailBase turns tail1 that way
  const t1 = rig.byName.tail1, tip = rig.tail[t1];
  assert.ok(at(pose({ calm: 1, tailBase: 0.2 }), t1, tip)[0] < tip[0] - 0.05);
  assert.ok(at(pose({ calm: 1, tailBase: -0.2 }), t1, tip)[0] > tip[0] + 0.05);
});

test('the toe channel peels each fan from flat (0) to the plan\'s limit (1), tips up and back toward the heel, no further', () => {
  for (const fan of ['toes', 'fingers']) {
    const lim = -plan.rom[fan].hinge[0] * RAD;
    assert.equal(toePeel(0, fan), 0);
    assert.equal(toePeel(-1, fan), 0);
    assert.ok(Math.abs(toePeel(1, fan) - lim) < 1e-12 && toePeel(3, fan) === toePeel(1, fan));
    assert.ok(toePeel(0.5, fan) > 0 && toePeel(0.5, fan) < lim);
  }
  const o0 = pose({ calm: 1 }), o1 = pose({ calm: 1, peel: 1 }), oH = pose({ calm: 1, peel: [0, 0, 1, 0] });
  for (const k of ['toesL', 'toesR', 'fingersL', 'fingersR']) {
    const b = rig.byName[k], d = rig.dir[b], h = rig.head[b], T = rig.tail[b];
    const t0 = at(o0, b, T), t1 = at(o1, b, T);
    assert.ok(Math.abs(t0[0] - T[0]) + Math.abs(t0[1] - T[1]) + Math.abs(t0[2] - T[2]) < 1e-5, `${k} flat at rest`);
    assert.ok(t1[1] > t0[1] + 0.5 * rig.L[b], `${k} tip up`);
    assert.ok(dot(sub(t1, h), d) < dot(sub(t0, h), d) - 0.3 * rig.L[b], `${k} tip back toward the heel`);
    const tH = at(oH, b, T), moved = Math.abs(tH[1] - t0[1]) > 1e-3;
    assert.equal(moved, k === 'toesL', `${k}: the channel is per foot [foreL, foreR, hindL, hindR]`);
  }
});

test('throat flutter and jaw: bounded channels, a breathing pulse at rest, the head swells inside the cap', () => {
  const c = lizardSpecies('gecko').throat;
  let lo = 1, hi = 0;
  for (let t = 0; t < 2 / c.hz; t += 0.005) { const v = throatFlutter(t, 1, c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= 0 && hi <= 1 && hi - lo > 0.1);
  assert.ok(Math.abs(throatFlutter(1 / c.hz + 0.1, 1, c) - throatFlutter(0.1, 1, c)) < 1e-9);
  assert.equal(throatFlutter(0.3, 0, c), 0);
  const h = headSwell(1, 1, 'gecko');
  assert.ok(h.jaw > 0 && h.jaw < SWELL_CAP && h.throat > 0 && h.throat < SWELL_CAP);
  assert.deepEqual(headSwell(0, 0, 'gecko'), { jaw: 0, throat: 0 });
  assert.deepEqual(headSwell(5, -2, 'gecko'), headSwell(1, 0, 'gecko'));
  // in the pose: the throat deepens the head below its axis, the jaw widens it at the cheeks
  const hd = rig.byName.head, { up, side } = rig.headAxes, r = skel.bones[hd].r, H = rig.head[hd];
  const below = H.map((v, i) => v - up[i] * r), cheek = H.map((v, i) => v + side[i] * r);
  const o0 = pose({ calm: 1 }), oT = pose({ calm: 1, throat: 1 }), oJ = pose({ calm: 1, jaw: 1 });
  assert.ok(at(oT, hd, below)[1] < at(o0, hd, below)[1] - 0.01);
  assert.ok(Math.abs(at(oJ, hd, cheek)[0]) > Math.abs(at(o0, hd, cheek)[0]) + 0.01);
});
