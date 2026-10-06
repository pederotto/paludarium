// The spin on the spot is a body movement (owner, 6 Oct 2026): head, then torso, then hands and legs; the yaw comes out of the thrust.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swimState, swimStep, swimPose } from '../src/util/gait.js';
import { swimProfile } from '../src/util/bodyplan.js';
import { swimMotion, SPIN_YAW, spinHz, queuePush } from '../src/util/swimturn.js';
import { skeletonRig, poseStroke, ROW_FLOATS } from '../src/render/creatures/skeleton.js';
import fs from 'node:fs';

const prof = swimProfile('toad'), dt = 1 / 30, DEG = Math.PI / 180;
function run(dir, style, secs, { err = 9, stopAt = Infinity } = {}) {
  const st = swimState(() => 0.5); st.phase = 0.9; const rows = []; let yaw = 0, e = err;
  for (let k = 0; k < secs / dt; k++) {
    const on = yaw * dir < stopAt && e > 0.9;
    swimStep(st, prof, { spin: on ? dir : 0, spinStyle: style, spinErr: e, spinHz: spinHz(0.5), rnd: () => 0.5 }, dt);
    const mo = swimMotion(st, prof, st.sp && st.sp.run ? { intent: 'spin', dir: st.sp.dir } : {}, dt);
    yaw += mo.dyaw; e = err - Math.abs(yaw);
    const tr = swimPose(st, prof, { level: 0 }).stroke.trunk;
    rows.push({ t: k * dt, act: st.act, dyaw: mo.dyaw, fwd: mo.fwd, px: mo.px, head: tr ? tr[3] : 0, torso: tr ? tr[0] : 0, run: st.sp?.run ?? 0, sp: !!st.sp });
  }
  return { rows, yaw, st };
}
for (const dir of [1, -1]) for (const style of ['pivot', 'opposed']) {
  test(`spin ${style} dir ${dir}: yaw only inside a thrust, about SPIN_YAW a cycle, no translation`, () => {
    const { rows, yaw } = run(dir, style, 1.5 * 4);
    assert.ok(rows.every((r) => r.dyaw === 0 || (r.act && r.dyaw * dir > 0)), 'yaw outside a thrust or the wrong way');
    assert.ok(rows.every((r) => r.fwd === 0 && r.px === 0), 'translation');
    const cycles = 4 - 0.3;                                          // (the clock starts 0.15 of a cycle before the first thrust)
    assert.ok(Math.abs(yaw) > 0.7 * SPIN_YAW * cycles && Math.abs(yaw) < 1.3 * SPIN_YAW * cycles, `${(yaw / DEG).toFixed(0)} deg in 4 cycles`);
  });
}
test('order: head onset, then torso onset, then the first thrust; head peak before torso peak', () => {
  const { rows } = run(1, 'pivot', 1.2), on = (k) => rows.find((r) => Math.abs(r[k]) > 0.5).t, pk = (k) => rows.reduce((b, r) => (Math.abs(r[k]) > b.v ? { v: Math.abs(r[k]), t: r.t } : b), { v: -1, t: 0 }).t;
  const t0 = rows.find((r) => r.act).t;
  assert.ok(on('head') < on('torso') && on('torso') < t0, `${on('head')} ${on('torso')} ${t0}`);
  assert.ok(pk('head') < pk('torso'));
});
test('stops asking within 0.9 rad: the thrust begun is finished, then head and torso unwind to nothing and the spin ends', () => {
  const { rows, st } = run(1, 'pivot', 6, { err: 1.6 });
  const last = rows[rows.length - 1];
  assert.ok(!last.sp && st.sp == null && last.head === 0 && last.torso === 0, 'channels still on');
  assert.ok(rows.some((r) => r.run) && !last.run);
});
test('no spin asked: swimPose has no trunk or hand channels (the ordinary stroke is untouched)', () => {
  const st = swimState(() => 0.5); for (let k = 0; k < 90; k++) swimStep(st, prof, { rnd: () => 0.5 }, dt);
  const s = swimPose(st, prof, { level: 0 }).stroke;
  assert.ok(s.trunk === undefined && s.armA === undefined && st.sp === undefined);
});

const man = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
test('the legs and hands do not pop when the spin starts or ends: no tick moves a foot or a hand further than the stroke itself does', () => {
  const rig = skeletonRig(man['toad.swim'].skeleton), row = new Float32Array(ROW_FLOATS), st = swimState(() => 0.5);
  let prev = null, base = 0, around = 0, t = 0, spinOn = null, spinOff = null;
  for (let k = 0; k < 30 * 9; k++, t += dt) {
    const ask = t > 3 && t < 6.2 ? 1 : 0;                         // 3 s of ordinary swimming, then the spin, then ordinary again
    if (ask && spinOn == null) spinOn = t;
    swimStep(st, prof, { urgency: 0.5, spin: ask, spinErr: 9, spinHz: spinHz(0.5), rnd: () => 0.5 }, dt);
    if (!ask && spinOn != null && spinOff == null && !st.sp?.run) spinOff = t;
    const tips = poseStroke(rig, swimPose(st, prof, { level: 0 }).stroke, row, 0, {}).tips;
    const cur = [1, 2, 3, 4].map((l) => [...tips[l]]);
    if (prev) {
      const step = Math.max(...cur.map((c, i) => Math.hypot(c[0] - prev[i][0], c[1] - prev[i][1], c[2] - prev[i][2])));
      const near = (spinOn != null && t - spinOn < 0.45) || (spinOff != null && t - spinOff < 0.45);
      if (near) around = Math.max(around, step); else if (t < 3) base = Math.max(base, step);
    }
    prev = cur;
  }
  assert.ok(spinOn != null && spinOff != null, 'the spin ran and ended');
  assert.ok(around < 1.5 * base, `a limb tip jumped ${around.toFixed(2)} cm in a tick around the spin (the stroke itself: ${base.toFixed(2)} cm)`);
});
test('the spin\'s kicks release a push queued on the body, once, and only while a leg thrusts', () => {
  for (const style of ['pivot', 'opposed']) {
    const st = swimState(() => 0.5); queuePush(st, 1.2, -0.8);
    let sx = 0, sz = 0, out = 0;
    for (let k = 0; k < 30 * 4; k++) {
      swimStep(st, prof, { spin: 1, spinStyle: style, spinErr: 9, spinHz: spinHz(0.5), rnd: () => 0.5 }, dt);
      const m = swimMotion(st, prof, { intent: 'spin', dir: 1 }, dt);
      sx += m.px; sz += m.pz; if ((m.px || m.pz) && !st.act) out++;
    }
    assert.ok(Math.abs(sx - 1.2) < 1e-9 && Math.abs(sz + 0.8) < 1e-9, `${style}: released ${sx.toFixed(3)}, ${sz.toFixed(3)} of 1.2, -0.8`);
    assert.equal(out, 0, `${style}: released outside a thrust`);
  }
});
