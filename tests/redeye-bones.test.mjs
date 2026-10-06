// The 22-bone frog (the red-eyed tree frog's plan: fingers and a shoulder girdle): the swimming-body poser turns the scapula to lift and swing the shoulder
// and bends the fingers from the stroke's `scap` and `fcurl` channels; with none set the pose is the 18-bone body's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skeletonRig, poseStroke, applyBone, ROW_FLOATS } from '../src/render/creatures/skeleton.js';
import { climbState, climbStep, climbPose } from '../src/util/climb.js';

const man = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
const base = man['toad.swim'].skeleton;
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// the toad swimmer with each hand split into a hand and a fingers bone (the last 40 %) and a scapula from a point above and behind the shoulder
function with22(sk) {
  const B = JSON.parse(JSON.stringify(sk.bones)), out = [];
  for (const b of B) {
    if (/^arm[LR]$/.test(b.name)) {
      const s = b.name.slice(3), up = [b.head[0] * 0.5, b.head[1] + 0.35, b.head[2] - 0.25];
      out.push({ name: 'scapula' + s, parent: b.parent, head: up, tail: b.head, limb: 0, r: b.r });
      out.push({ ...b, parent: 'scapula' + s });
    } else if (/^hand[LR]$/.test(b.name)) {
      const s = b.name.slice(4), cut = lerp3(b.head, b.tail, 0.6);
      out.push({ ...b, tail: cut });
      out.push({ name: 'fingers' + s, parent: b.name, head: cut, tail: b.tail, limb: b.limb, r: b.r * 0.7 });
    } else out.push(b);
  }
  return { ...sk, bones: out };
}
const sk22 = with22(base);
const pose = (sk, st) => { const rig = skeletonRig(sk, { legLift: 0.3, legStride: 0.35, limb: 1 }), row = new Float32Array(ROW_FLOATS); assert.ok(rig, 'no rig'); poseStroke(rig, st, row); return { rig, at: (n, p) => applyBone(row, 0, rig.byName[n], p) }; };
const G = { pL: 0.45, pR: 0.45, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.5 };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('22 bones: the rig builds, the arm chain has its fingers and a scapula, the row holds them', () => {
  assert.equal(sk22.bones.length, 22);
  const rig = skeletonRig(sk22, {}); assert.ok(rig);
  const arm = rig.limbs.find((l) => !l.hind && l.side > 0);
  assert.equal(arm.bones.length, 4); assert.equal(rig.B[arm.bones[3]].name, 'fingersR'); assert.equal(rig.B[arm.sc].name, 'scapulaR');
  assert.ok(rig.n * 3 * 4 <= ROW_FLOATS);
});

test('no scapula or fingers channel set: the hands are where the 18-bone body puts them', () => {
  const a = pose(base, G), b = pose(sk22, G);
  for (const s of 'LR') {
    const tipA = a.at('hand' + s, base.bones.find((x) => x.name === 'hand' + s).tail), h22 = sk22.bones.find((x) => x.name === 'fingers' + s);
    const tipB = b.at('fingers' + s, h22.tail);
    assert.ok(dist(tipA, tipB) < 0.02, `${s}: the hand tip moved ${dist(tipA, tipB).toFixed(3)} cm`);
  }
});

test('the scapula lifts and swings the shoulder: elevation raises the arm\'s root, protraction brings it forward', () => {
  const rest = pose(sk22, G), up = pose(sk22, { ...G, scap: [0, 0, 0, 25] }), fwd = pose(sk22, { ...G, scap: [0, 0, 25, 0] });
  const sh = sk22.bones.find((x) => x.name === 'armR').head, h = rest.at('armR', sh), hu = up.at('armR', sh), hf = fwd.at('armR', sh);
  assert.ok(hu[1] > h[1] + 0.1, `elevation: ${(hu[1] - h[1]).toFixed(3)} cm up`);
  assert.ok(hf[2] > h[2] + 0.05, `protraction: ${(hf[2] - h[2]).toFixed(3)} cm forward`);
  const l = pose(sk22, { ...G, scap: [0, 25, 0, 0] }), shL = sk22.bones.find((x) => x.name === 'armL').head;
  assert.ok(l.at('armL', shL)[1] > rest.at('armL', shL)[1] + 0.1, 'the left side lifts the same way');
  // the hand goes up with the shoulder
  const handR = sk22.bones.find((x) => x.name === 'handR').tail;
  assert.ok(up.at('fingersR', sk22.bones.find((x) => x.name === 'fingersR').tail)[1] > rest.at('fingersR', sk22.bones.find((x) => x.name === 'fingersR').tail)[1] + 0.05);
});

test('the fingers curl toward the belly by fcurl and straighten at zero', () => {
  const rest = pose(sk22, G), cur = pose(sk22, { ...G, fcurl: [0, 40] }), fb = sk22.bones.find((x) => x.name === 'fingersR');
  const t0 = rest.at('fingersR', fb.tail), t1 = cur.at('fingersR', fb.tail);
  assert.ok(dist(t0, t1) > 0.05 && t1[1] < t0[1] + 1e-6, `tip moved ${dist(t0, t1).toFixed(3)} cm, y ${t0[1].toFixed(2)} -> ${t1[1].toFixed(2)}`);
  const left = cur.at('fingersL', sk22.bones.find((x) => x.name === 'fingersL').tail), l0 = rest.at('fingersL', sk22.bones.find((x) => x.name === 'fingersL').tail);
  assert.ok(dist(left, l0) < 1e-4, 'only the right hand curled');
});

test('the crawl\'s reach lifts the shoulder and curls the fingers of the reaching side', () => {
  const st = climbState(() => 0.5, 'crawl'); let maxEl = 0, maxCurl = 0, side = 0;
  for (let i = 0; i < 80; i++) { climbStep(st, { go: 1, urgency: 0, rnd: () => 0.5 }, 0.02); const P = climbPose(st); if (P.scap[3] > maxEl) { maxEl = P.scap[3]; } maxCurl = Math.max(maxCurl, P.fcurl[1], P.fcurl[0]); side += P.scap[1] > 0 ? 1 : 0; }
  assert.ok(maxEl > 10, `elevation ${maxEl}`); assert.ok(maxCurl > 10, `curl ${maxCurl}`); assert.ok(side > 0, 'the left side reaches too');
});
