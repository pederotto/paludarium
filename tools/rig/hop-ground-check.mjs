// A one-body frog's hop checked through the game's own code, frame by frame (9 Oct 2026, the owner: "the frog goes through the ground at landing"): the plan (util/hop.js
// hopPlan), the frame it is drawn in (hopFrame: lifted, pitched and rolled about the hips), the limbs (util/gait.js leapPose, render/creatures/skeleton.js poseStroke with the
// hop's frames, so its planted legs and its floor rule apply), the shipped file skinned on the CPU with its four-bone weights, and, from the landing's LEAP_TO on, the sitting
// stance the game draws then (SPECIES.<id>.sit: util/frogstrike.js lungePose, its root nose up about the origin and lifted by offsetCm). Per frame: the lowest skin point above the
// landing ground (it must not go below 0: a point under it is the frog drawn through the floor), the bone it belongs to, and how far the body's reference point jumped from the
// frame before (a pop at the hand-over from the hop's body to the sit's).
//   node tools/rig/hop-ground-check.mjs [id] [--d 0.8,1.5,3,5] [--rise 0] [--frames 120] [--verbose] [--tol 0.02]
// --generic: the hop as it was drawn until 9 Oct (the generic crouch, the swimming body lifted by 0.27 size, handed over to the sitting stance at LEAP_TO). exit 1 when a frame goes lower than -tol cm. id: a manifest key (default harlequin.swim); the species block is read from src/sim/animals.js as lunge-check does.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseStroke, stanceClearance, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';
import { hopPlan, hopAt, hopFrame, svlOf, LEAP_TO } from '../../src/util/hop.js';
import { leapPose, HIND, FORE } from '../../src/util/gait.js';
import { lungePose, lungeRoot } from '../../src/util/frogstrike.js';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), id = args[0] && !args[0].startsWith('--') ? args[0] : 'harlequin.swim';
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const GENERIC = args.includes('--generic'), DS = opt('--d', '0.8,1.5,3,5').split(',').map(Number), RISE = +opt('--rise', 0), FR = +opt('--frames', 120), TOL = +opt('--tol', 0.02), VERBOSE = args.includes('--verbose');
const DIR = 'public/assets/creatures/', man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'))[id];
const src = fs.readFileSync('src/sim/animals.js', 'utf8'), k0 = src.indexOf(`\n  ${id.split('.')[0]}: {`), blk = src.slice(Math.max(0, k0));
const sitM = blk.match(/sit: (\{ pitchDeg[^\n]*?\}),?\n/); if (!sitM) throw new Error('no sit stance in src/sim/animals.js');
const SIT = Function('return ' + sitM[1])(), SIZE = +(blk.match(/size: ([0-9.]+)/)?.[1] ?? 1), SC = +opt('--sc', 1);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(DIR + man.file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], Mw = node.getWorldMatrix();
const get = (name) => { const a = prim.getAttribute(name), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), n = P0.length / 3;
for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }   // cm
const bones = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
const rig = skeletonRig(man.skeleton, {}), N = rig.byName, out = new Float32Array(ROW_FLOATS);
const bonePt = (b, p) => { const m = b * 12; return [out[m] * p[0] + out[m + 1] * p[1] + out[m + 2] * p[2] + out[m + 3], out[m + 4] * p[0] + out[m + 5] * p[1] + out[m + 6] * p[2] + out[m + 7], out[m + 8] * p[0] + out[m + 9] * p[1] + out[m + 10] * p[2] + out[m + 11]]; };
const dom = new Int16Array(n); for (let i = 0; i < n; i++) dom[i] = bones(i).reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1])[0];
const L = N.thighL, R = N.thighR, pivot = L != null && R != null ? rig.head[L].map((v, i) => (v + rig.head[R][i]) / 2) : null;
const skin = (i, o) => { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); x += w * q[0]; y += w * q[1]; z += w * q[2]; } o[0] = x; o[1] = y; o[2] = z; return o; };
const tmp = [0, 0, 0], st = {};
const REST = GENERIC ? null : (() => { const r = lungeRoot(SIT, 0, 0, 0, {}); return { pitch: r.pitch, off: [...r.off], stanceY: stanceClearance(rig, SIT) }; })(), STANCE = GENERIC ? null : { legA: SIT.legA, armA: SIT.armA, roll: SIT.roll ?? null };
const sitPts = (() => { const ls = lungePose(SIT, 0, 0, 0, HIND, FORE, {}), Rt = ls.root, c = Math.cos(Rt.pitch), sn = Math.sin(Rt.pitch); poseStroke(rig, ls, out); const A = new Float64Array(n * 3); for (let i = 0; i < n; i++) { const q = skin(i, tmp); A[i * 3] = q[0] + Rt.off[0] * SC; A[i * 3 + 1] = (c * q[1] - sn * q[2] + Rt.off[1]) * SC; A[i * 3 + 2] = (sn * q[1] + c * q[2] + Rt.off[2]) * SC; } return A; })();
let worst = 0, fail = false, worstPop = 0; const JSONOUT = args.includes('--json'), results = [];
let stanceLow = 1e9; for (let i = 0; i < n; i++) stanceLow = Math.min(stanceLow, sitPts[i * 3 + 1]);
for (const d of DS) {
  const plan = hopPlan({ d, rise: RISE }, svlOf(SIZE, SC), [0.3, 0.5]);
  if (!plan.ok) { console.log(`d ${d}: no arc`); continue; }
  const hop = { plan }; let prev = null, low = 1e9, lowAt = null; const bad = [], per = {};
  for (let f = 0; f <= FR; f++) {
    const t = f / FR, at = hopAt(plan, t), hf = hopFrame(t, hop, SIZE, SC, pivot, REST);
    let pts, ref;
    if (hf.body === 'swim') {
      const s = leapPose(plan, at, null, STANCE); s.frames = { f0: hopFrame(0, hop, SIZE, SC, pivot, REST), ft: hf }; poseStroke(rig, s, out);
      pts = (i) => hf.toWorld(skin(i, tmp)); ref = hf.pos;
    } else {
      const ls = lungePose(SIT, 0, 0, 0, HIND, FORE, {}), Rt = ls.root, c = Math.cos(Rt.pitch), sn = Math.sin(Rt.pitch); poseStroke(rig, ls, out);
      const gx = 0, gy = at.pos[1], gz = at.pos[2];
      pts = (i) => { const q = skin(i, tmp); return [gx + q[0] + Rt.off[0] * SC, gy + (c * q[1] - sn * q[2] + Rt.off[1]) * SC, gz + (sn * q[1] + c * q[2] + Rt.off[2]) * SC]; };
      ref = [gx + Rt.off[0] * SC, gy + Rt.off[1] * SC, gz + Rt.off[2] * SC];
    }
    let fl = 1e9, fa = -1; const ground = at.phase === 'launch' || (at.phase === 'flight' && at.u < 0.5) ? 0 : RISE;
    for (let i = 0; i < n; i++) { const y = pts(i)[1] - ground; if (y < fl) { fl = y; fa = i; } }
    const pop = prev ? Math.hypot(ref[1] - prev[1], ref[2] - prev[2]) : 0; if (f > 0 && Math.abs(pop) > worstPop) worstPop = Math.abs(pop);
    { const key = at.phase + '/' + hf.body, q = per[key] ??= { low: 1e9, bone: '', n: 0 }; q.n++; if (fl < q.low) { q.low = fl; q.bone = rig.B[dom[fa]]?.name; } }
    if (fl < low) { low = fl; lowAt = { t: +t.toFixed(3), phase: at.phase, u: +at.u.toFixed(2), bone: rig.B[dom[fa]]?.name, body: hf.body }; }
    if (fl < -TOL) bad.push({ t: +t.toFixed(3), ph: at.phase, u: +at.u.toFixed(2), body: hf.body, low: +fl.toFixed(3), bone: rig.B[dom[fa]]?.name });
    if (VERBOSE && (at.phase !== 'flight' || f % 10 === 0)) console.log(`  t ${t.toFixed(3)} ${at.phase.padEnd(6)} u ${at.u.toFixed(2)} ${hf.body.padEnd(4)} low ${fl.toFixed(3)} (${rig.B[dom[fa]]?.name}) ref y ${ref[1].toFixed(3)} z ${ref[2].toFixed(3)} pitch ${(hf.pitch * 57.3).toFixed(1)}`);
    prev = ref;
  }
  worst = Math.min(worst, low); if (bad.length) fail = true;
  { // the seams: the hop's first frame against the sitting stance at its start place, and its last against the stance where it lands (the largest distance of any skin point, cm)
    const seam = (f, dz, dy) => { const at = hopAt(plan, f), hf = hopFrame(f, hop, SIZE, SC, pivot, REST); const s = leapPose(plan, at, null, STANCE); s.frames = { f0: hopFrame(0, hop, SIZE, SC, pivot, REST), ft: hf }; poseStroke(rig, s, out);
      let m = 0; const by = {}; for (let i = 0; i < n; i++) { const w = hf.toWorld(skin(i, tmp)), e = Math.hypot(w[0] - sitPts[i * 3], w[1] - (sitPts[i * 3 + 1] + dy), w[2] - (sitPts[i * 3 + 2] + dz)); m = Math.max(m, e); const nm = rig.B[dom[i]]?.name; by[nm] = Math.max(by[nm] ?? 0, e); } seam.by = by; return m; };
    const s0 = seam(0, 0, 0), b0 = seam.by, s1 = seam(1, plan.d, RISE), b1 = seam.by, top = (b) => Object.entries(b).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
    if (!JSONOUT) console.log(`   seams (largest skin distance from the sitting stance): start ${s0.toFixed(3)} cm (${top(b0)}), end ${s1.toFixed(3)} cm (${top(b1)})`); results.push({ d, seamStart: +s0.toFixed(4), seamEnd: +s1.toFixed(4), by: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, +v.low.toFixed(4)])) }); }
  if (!JSONOUT) console.log('   by phase:', Object.entries(per).map(([k, v]) => `${k} ${v.low.toFixed(3)} (${v.bone})`).join(', '));
  if (!JSONOUT) console.log(`d ${d} cm (dur ${plan.dur.toFixed(3)} s, short ${plan.short.toFixed(2)}): lowest skin ${low.toFixed(3)} cm at ${JSON.stringify(lowAt)}; ${bad.length} frames below -${TOL} cm` + (bad.length ? `, first ${JSON.stringify(bad[0])}, worst ${JSON.stringify(bad.reduce((m, b) => (b.low < m.low ? b : m)))}` : ''));
}
if (JSONOUT) console.log(JSON.stringify({ id, stanceLow: +stanceLow.toFixed(4), results })); else console.log(`${id}: worst ${worst.toFixed(3)} cm below the ground, biggest jump of the reference point between frames ${worstPop.toFixed(3)} cm (LEAP_TO ${LEAP_TO})`);
process.exit(fail ? 1 : 0);
