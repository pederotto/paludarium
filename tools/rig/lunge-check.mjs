// The common frog's strike lunge checked through the game's own pose code (gate 4, 7 Oct 2026): the sitting body (SPECIES.commonfrog.sit) posed by
// render/creatures/skeleton.js poseStroke with the lunge's legs, arms and strike (util/frogstrike.js lungePose), tilted and slid by the lunge's root motion
// (lungeRoot), skinned on the CPU with the shipped file's four-bone weights. Per frame: where the tongue's tip is (cm, ground frame: y up from the ground, z
// ahead of the frog's origin), the lowest point of the body that is not a foot or a hand (it must stay above the ground), and how far the planted toes slid.
//   node tools/rig/lunge-check.mjs [id] [--dip deg] [--slide cm] [--frames 26]     a strike at that dip and slide, frame by frame; exit 1 on a fault
//   node tools/rig/lunge-check.mjs [id] --grid                                     the tongue's tip at contact over the lunge's range (what the sim's reach uses)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseStroke, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';
import { FROG_LUNGE, lungePose, lungeRoot, strikeCurves } from '../../src/util/frogstrike.js';
import { HIND, FORE } from '../../src/util/gait.js';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), id = args[0] && !args[0].startsWith('--') ? args[0] : 'commonfrog.swim';
const opt = (k, d) => (args.includes(k) ? +args[args.indexOf(k) + 1] : d);
for (const k of ['peel', 'short', 'armMix', 'liftPerDeg']) if (args.includes('--' + k)) FROG_LUNGE[k] = opt('--' + k, FROG_LUNGE[k]);
const FR = opt('--frames', 26), DIP = opt('--dip', FROG_LUNGE.dipDeg), SLIDE = opt('--slide', FROG_LUNGE.slideCm);
const DIR = 'public/assets/creatures/', man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'))[id];
const { SPECIES } = await import('../../src/sim/animals.js').catch(() => ({ SPECIES: null }));
const SIT0 = SPECIES?.[id.split('.')[0]]?.sit ?? { pitchDeg: 34, offsetCm: [0, 1.698, 0.237], pivotCm: [0, 0.792, -3.801], legKey: 'crouch', armDeg: [0, 0], armA: [179, -6, 120, -59, -51, 10, 179, -20, 120, -78, -58, -5], roll: [-46, 17, 48, 30, 0, 0], legA: [147, -25, 125, 131, -11, 2, -24, -33, -30] };
const SIT = { ...SIT0, offsetCm: [...SIT0.offsetCm], pivotCm: [...(SIT0.pivotCm ?? [0, 0.08, -3.85])], armDeg: [...SIT0.armDeg], pitchDeg: opt('--pitch', SIT0.pitchDeg) };      // (keep in step with SPECIES.commonfrog.sit)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(DIR + man.file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], Mw = node.getWorldMatrix();
const get = (name) => { const a = prim.getAttribute(name), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), n = P0.length / 3;
for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }   // cm
const bones = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
const rig = skeletonRig(man.skeleton, {}), N = rig.byName;
// the vertices that may touch the ground: mostly a foot's, a toe's, a hand's or a forearm's (the shin too: a sitting frog rests its folded shank on it)
const limbEnd = new Set(['footL', 'toesL', 'footR', 'toesR', 'handL', 'handR', 'forearmL', 'forearmR', 'shinL', 'shinR'].map((k) => N[k]).filter((b) => b != null));
const free = new Uint8Array(n); for (let i = 0; i < n; i++) { let w = 0; for (const [b, ww] of bones(i)) if (limbEnd.has(b)) w += ww; free[i] = w < 0.5 ? 1 : 0; }
const out = new Float32Array(ROW_FLOATS);
const bonePt = (b, p) => { const m = b * 12; return [out[m] * p[0] + out[m + 1] * p[1] + out[m + 2] * p[2] + out[m + 3], out[m + 4] * p[0] + out[m + 5] * p[1] + out[m + 6] * p[2] + out[m + 7], out[m + 8] * p[0] + out[m + 9] * p[1] + out[m + 10] * p[2] + out[m + 11]]; };
const root = {}, st = {};
// one frame: the body posed and placed; returns the ground-frame points that matter
function frame(t, dip, slide) {
  lungePose(SIT, t, dip, slide, HIND, FORE, st); poseStroke(rig, st, out); Object.assign(root, st.root);
  const c = Math.cos(root.pitch), s = Math.sin(root.pitch), place = (p) => [p[0] + root.off[0], c * p[1] - s * p[2] + root.off[1], s * p[1] + c * p[2] + root.off[2]];
  let low = 1e9, lowAt = null;
  for (let i = 0; i < n; i++) {
    if (!free[i]) continue;
    let x = 0, y = 0, z = 0;
    for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); x += w * q[0]; y += w * q[1]; z += w * q[2]; }
    const g = place([x, y, z]); if (g[1] < low) { low = g[1]; lowAt = rig.B[bones(i).reduce((m, bw) => (bw[1] > m[1] ? bw : m), [0, -1])[0]].name; }
  }
  const T4 = N.tongue4, tip = place(bonePt(T4, rig.tail[T4])), jaw = place(bonePt(N.jaw, rig.tail[N.jaw]));
  const toes = ['toesL', 'toesR'].map((k) => place(bonePt(N[k], rig.tail[N[k]]))), hands = ['handL', 'handR'].map((k) => place(bonePt(N[k], rig.tail[N[k]])));
  return { tip, jaw, low, lowAt, toes, hands, tipBody: bonePt(T4, rig.tail[T4]), jawBody: bonePt(N.jaw, rig.tail[N.jaw]) };
}
if (args.includes('--fit-limbs')) {
  // The sitting stance refitted as a common frog sits (the owner, 7 Oct 2026: "the front limbs are floating"; the first stance had the upper arms out to the sides,
  // the body slung between them, the hands touching with the fingertips, and the knees above the back): the arm and leg angles (both sides alike) and the pitch
  // searched for, against what a sitting Rana shows: each hand flat on the ground under the eye, the elbow against the flank, the forearm near upright; the knee
  // beside the flank and below the back, the heel by the vent, the foot flat with its toes forward; the hips, shins and feet carrying the body, no skin under
  // the ground. Prints the stance for SPECIES.commonfrog.sit.
  const groups = {}; for (let i = 0; i < n; i++) { const b = bones(i).reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1])[0], nm = rig.B[b].name; (groups[nm] ??= []).push(i); }
  const G = (...names) => names.flatMap((k) => groups[k] ?? []);
  const SD = args.includes('--side') ? args[args.indexOf('--side') + 1] : 'L', ARM = SD === 'R' || args.includes('--arm-only');
  const Vhand = G('hand' + SD), Vfore = G('forearm' + SD, 'arm' + SD), Vfoot = G('footL', 'toesL'), Vbody = G('pelvis', 'spine', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'), Vback = G('spine', 'spineB', 'pelvis'), Vall = [...Array(n).keys()].filter((i) => free[i] || true);
  const skinAt = (i, o) => { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); x += w * q[0]; y += w * q[1]; z += w * q[2]; } o[0] = x; o[1] = y; o[2] = z; return o; };
  const eye = [0.642 * (SD === 'L' ? 1 : -1), 1.899, 2.003], tmp = [0, 0, 0];
  const pct = (a, q) => { const b = [...a].sort((u, v) => u - v); return b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))]; };
  function evalP(P, detail = false) {
    const sit = !ARM ? { pitchDeg: P[0], offsetCm: [0, 0, 0.237], pivotCm: [0, 0, 0], legKey: 'crouch', armDeg: [0, 0], armA: P.slice(1, 7), legA: P.slice(7, 16) }
      : SD === 'R' ? { ...SIT, offsetCm: [0, 0, 0.237], pivotCm: [0, 0, 0], armA: [...SIT.armA.slice(0, 6), ...P.slice(1, 7)], legA: SIT.legA, roll: [...(SIT.roll ?? [0, 0]).slice(0, 2), P[7] ?? 0, P[8] ?? 0, 0, 0] }
      : { ...SIT, offsetCm: [0, 0, 0.237], pivotCm: [0, 0, 0], armA: [...P.slice(1, 7), ...SIT.armA.slice(6, 12)], legA: SIT.legA, roll: [P[7] ?? 0, P[8] ?? 0, ...(SIT.roll ?? [0, 0, 0, 0]).slice(2, 4), 0, 0] };
    lungePose(sit, 0, 0, 0, HIND, FORE, st); poseStroke(rig, st, out);
    const a = -P[0] * Math.PI / 180, c = Math.cos(a), s_ = Math.sin(a), pl = (p) => [p[0], c * p[1] - s_ * p[2], s_ * p[1] + c * p[2]];
    const ys = (V) => V.map((i) => pl(skinAt(i, tmp)));
    const body = ys(Vbody), y0 = -Math.min(...body.map((p) => p[1]));
    const up = (pts) => pts.map((p) => [p[0], p[1] + y0, p[2]]);
    const hand = up(ys(Vhand)), fore = up(ys(Vfore)), foot = up(ys(Vfoot)), back = up(ys(Vback));
    const J = (nm, end) => { const b = N[nm], p = pl(bonePt(b, end ? rig.tail[b] : rig.head[b])); p[1] += y0; return p; };
    const elbow = J('forearm' + SD, false), wrist = J('hand' + SD, false), shoulder = J('arm' + SD, false), knee = J('shinL', false), heel = J('footL', false), toes = J('toesL', true), vent = J('pelvis', false), e = pl(eye); e[1] += y0;
    const hy = hand.map((p) => p[1]), fy = foot.map((p) => p[1]);
    const backTop = Math.max(...back.filter((p) => Math.abs(p[2] - knee[2]) < 1).map((p) => p[1]), -9), flank = Math.max(...back.filter((p) => Math.abs(p[2] - elbow[2]) < 0.8).map((p) => Math.abs(p[0])), 0.8);
    const handC = [hand.reduce((u, p) => u + p[0], 0) / hand.length, 0, hand.reduce((u, p) => u + p[2], 0) / hand.length];
    const fa = [wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]], faUp = Math.acos(Math.min(1, -fa[1] / Math.hypot(...fa))) * 180 / Math.PI;
    const T = {
      handLow: Math.min(...hy) ** 2 * 400,                                         // the hand on the ground
      handFlat: Math.max(0, pct(hy, 0.8) - 0.18) ** 2 * 120,                       // flat: most of it within 1.8 mm of the ground
      // (under the eye or a little ahead of it: this body's arm is long, about 5.8 cm shoulder to fingertip on a 7 cm frog, so it cannot fold under the eye)
      handUnderEye: Math.max(0, Math.abs(handC[2] - (e[2] + 0.5)) - 0.9) ** 2 * 20 + Math.max(0, Math.abs(Math.abs(handC[0]) - Math.abs(e[0]) - 0.1) - 0.45) ** 2 * 20,
      elbowIn: Math.max(0, Math.abs(elbow[0]) - flank - 0.25) ** 2 * 30,
      foreUp: Math.max(0, faUp - 22) ** 2 * 0.02,
      armOff: Math.max(0, -Math.min(...fore.map((p) => p[1]))) ** 2 * 200,
      kneeLow: Math.max(0, knee[1] - (backTop - 0.5)) ** 2 * 30,
      kneeOut: Math.max(0, flank * 0.9 - Math.abs(knee[0])) ** 2 * 20,
      heelVent: Math.max(0, Math.hypot(heel[2] - vent[2], heel[1] - vent[1]) - 1.2) ** 2 * 10,
      footFlat: Math.min(...fy) ** 2 * 200 + Math.max(0, pct(fy, 0.7) - 0.25) ** 2 * 60,
      toesFwd: Math.max(0, heel[2] - toes[2] + 0.5) ** 2 * 10,
      pitch: Math.max(0, Math.abs(P[0] - 26) - 6) ** 2 * 0.2,
      elbowBack: Math.max(0, elbow[2] - wrist[2] - 0.1) ** 2 * 200 + Math.max(0, elbow[1] - shoulder[1] + 0.2) ** 2 * 60,      // (the elbow behind the wrist and below the shoulder)
      eyeH: Math.max(0, Math.abs(e[1] - 3.0) - 0.4) ** 2 * 15,                       // (a 7 cm frog sitting has its eyes about 3 cm up)
    };
    const cost = Object.values(T).reduce((u, v) => u + v, 0);
    return detail ? { cost, T, y0, elbow, wrist, knee, heel, toes, vent, eye: e, handC, faUp, backTop, flank } : cost;
  }
  // start: the present stance (both sides as the left), then a coordinate search with shrinking steps, from a few starts
  const armOf = (d) => [FORE.stand[0], FORE.stand[1], FORE.stand[2], FORE.stand[3] - d, FORE.stand[4] - d, FORE.stand[5]];
  const starts = SD === 'L' && ARM ? [[SIT.pitchDeg, ...SIT.armA.slice(0, 6), 0, 0], [SIT.pitchDeg, ...SIT.armA.slice(0, 6), 30, 20], [SIT.pitchDeg, ...SIT.armA.slice(0, 6), -30, -20]] : SD === 'R' ? [[SIT.pitchDeg, ...SIT.armA.slice(6, 12), 48, 30], [SIT.pitchDeg, 170, -28, 133, -86, -55, 8, 0, 0], [SIT.pitchDeg, 160, -10, 140, -60, -55, -10, 20, -20]] : [[SIT.pitchDeg, ...armOf(SIT.armDeg[0]), ...HIND.crouch], [26, 140, 20, 175, -60, -70, -5, ...HIND.crouch], [26, 150, 10, 170, -55, -75, 0, 120, -20, 100, 150, -5, 5, -20, -15, 0]];
  const lo = [16, 60, -30, 120, -90, -95, -40, 60, -60, 40, 60, -40, -30, -40, -40, -30], hi = [34, 179, 179, 179, 10, 10, 30, 179, 40, 179, 179, 40, 40, 30, 30, 30];
  let best = null;
  for (const s0 of starts) {
    const LO = ARM ? [...lo.slice(0, 7), -70, -70] : lo, HI = ARM ? [...hi.slice(0, 7), 70, 70] : hi;
    let P = s0.map((v, i) => Math.min(HI[i], Math.max(LO[i], v))), cst = evalP(P);
    for (const step of [16, 8, 4, 2, 1]) for (let rep = 0; rep < 3; rep++) {
      let moved = false;
      for (let i = 0; i < (ARM ? 9 : P.length); i++) if (!ARM || i > 0) for (const d of [step, -step]) { const Q = [...P]; Q[i] = Math.min(HI[i], Math.max(LO[i], Q[i] + d)); const c2 = evalP(Q); if (c2 < cst - 1e-6) { P = Q; cst = c2; moved = true; } }
      if (!moved) break;
    }
    console.log('start', starts.indexOf(s0), 'cost', cst.toFixed(3));
    if (!best || cst < best[1]) best = [P, cst];
  }
  const D = evalP(best[0], true), f2 = (v) => v.map((x) => +x.toFixed(2));
  console.log('terms', JSON.stringify(Object.fromEntries(Object.entries(D.T).map(([k, v]) => [k, +v.toFixed(3)]))));
  console.log('joints (ground frame): elbow', f2(D.elbow), 'wrist', f2(D.wrist), 'hand', f2(D.handC), 'eye', f2(D.eye), 'forearm from upright', D.faUp.toFixed(0), 'deg; flank', D.flank.toFixed(2));
  console.log('                       knee', f2(D.knee), 'back top', D.backTop.toFixed(2), 'heel', f2(D.heel), 'vent', f2(D.vent), 'toes', f2(D.toes));
  const P = best[0], a = -P[0] * Math.PI / 180, v = rig.head[N.pelvis];
  if (ARM) console.log(SD + ' arm armA:', JSON.stringify(P.slice(1, 7)), 'roll (forearm, hand):', JSON.stringify(P.slice(7, 9)));
  console.log('sit:', JSON.stringify({ pitchDeg: P[0], offsetCm: [0, +D.y0.toFixed(3), 0.237], pivotCm: [0, +(Math.cos(a) * v[1] - Math.sin(a) * v[2] + D.y0).toFixed(3), +(Math.sin(a) * v[1] + Math.cos(a) * v[2] + 0.237).toFixed(3)], armA: P.slice(1, 7), legA: P.slice(7, 16) }));
  process.exit(0);
}
if (args.includes('--fit-sit')) {
  // the sitting stance refitted on the skin: the body lifted until the lowest of the hips, feet and shins rests on the ground, then each arm turned (armDeg) until
  // its hand's skin just touches (the toes are reported: the scan's toes hang a little under the soles)
  const lowOf = (sit, names) => { lungePose(sit, 0, 0, 0, HIND, FORE, st); poseStroke(rig, st, out); Object.assign(root, st.root); const c = Math.cos(root.pitch), s = Math.sin(root.pitch), set = new Set(names.map((k) => N[k]));
    let low = 1e9; for (let i = 0; i < n; i++) { const bw = bones(i).reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1]); if (!set.has(bw[0])) continue; let y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); y += w * q[1]; z += w * q[2]; } low = Math.min(low, c * y - s * z + root.off[1]); } return low; };
  const sit = JSON.parse(JSON.stringify(SIT));
  const body = ['pelvis', 'spine', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];
  sit.offsetCm[1] -= lowOf(sit, body);
  { const a = -sit.pitchDeg * Math.PI / 180, v = rig.head[N.pelvis]; sit.pivotCm = [0, Math.cos(a) * v[1] - Math.sin(a) * v[2] + sit.offsetCm[1], Math.sin(a) * v[1] + Math.cos(a) * v[2] + sit.offsetCm[2]]; }
  for (const [k, side] of [[0, 'L'], [1, 'R']]) { let lo = -40, hi = 40;      // (more armDeg reaches further down)
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; sit.armDeg[k] = m; if (lowOf(sit, ['hand' + side, 'forearm' + side, 'arm' + side]) < 0) hi = m; else lo = m; } sit.armDeg[k] = +lo.toFixed(1); }
  console.log('sit refitted:', JSON.stringify({ offsetCm: sit.offsetCm.map((v) => +v.toFixed(3)), pivotCm: sit.pivotCm.map((v) => +v.toFixed(3)), armDeg: sit.armDeg }));
  for (const g of [body, ['toesL'], ['toesR'], ['handL', 'forearmL'], ['handR', 'forearmR'], ['head', 'jaw', 'hyoid']]) console.log('  lowest', g.join('/').padEnd(48), lowOf(sit, g).toFixed(3));
  if (args.includes('--dump')) { const f = args[args.indexOf('--dump') + 1]; Object.assign(SIT, sit); const pts = [];
    for (const [t, dip, sl] of [[0, 0, 0], [FROG_LUNGE.contactT, opt('--dip', FROG_LUNGE.dipDeg), opt('--slide', FROG_LUNGE.slideCm)]]) { lungePose(SIT, t, dip, sl, HIND, FORE, st); poseStroke(rig, st, out); Object.assign(root, st.root); const c = Math.cos(root.pitch), s_ = Math.sin(root.pitch), P = [];
      for (let i = 0; i < n; i += 3) { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); x += w * q[0]; y += w * q[1]; z += w * q[2]; } P.push([+(x + root.off[0]).toFixed(3), +(c * y - s_ * z + root.off[1]).toFixed(3), +(s_ * y + c * z + root.off[2]).toFixed(3)]); }
      pts.push(P); }
    fs.writeFileSync(f, JSON.stringify({ sit, pts })); }
  process.exit(0);
}
if (args.includes('--sit')) {
  // the sitting body at rest: the lowest point of each bone's skin (by its main bone), the vent bone point, the toes and the hands
  lungePose(SIT, 0, 0, 0, HIND, FORE, st); poseStroke(rig, st, out); Object.assign(root, st.root);
  const c = Math.cos(root.pitch), s = Math.sin(root.pitch), low = {};
  for (let i = 0; i < n; i++) { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); x += w * q[0]; y += w * q[1]; z += w * q[2]; }
    const gy = c * y - s * z + root.off[1], gz = s * y + c * z + root.off[2], nm = rig.B[bones(i).reduce((m, bw) => (bw[1] > m[1] ? bw : m), [0, -1])[0]].name;
    if (!low[nm] || gy < low[nm][0]) low[nm] = [gy, gz, x]; }
  for (const [k, v] of Object.entries(low).sort((a, b) => a[1][0] - b[1][0])) console.log(k.padEnd(9), 'lowest y', v[0].toFixed(2), 'at z', v[1].toFixed(2), 'x', v[2].toFixed(2));
  process.exit(0);
}
const f3 = (v) => v.map((x) => x.toFixed(2)).join(', ');
if (args.includes('--grid')) {
  const tc = FROG_LUNGE.contactT;
  { const a = frame(tc, 0, 0), b = frame(0, 0, 0); console.log(`body frame (before the stance): tongue tip at contact [${f3(a.tipBody)}], jaw tip at rest [${f3(b.jawBody)}]; sit from ${SPECIES ? 'SPECIES' : 'the fallback'}`); }
  console.log(`tongue tip at contact (t ${tc}), ground frame [x, y up, z ahead], cm; lowest free body point`);
  for (const dip of [0, 10, 20, 30, 40]) for (const slide of [0, 0.6, 1.2]) { const r = frame(tc, dip, slide); console.log(`dip ${String(dip).padStart(2)} slide ${slide.toFixed(1)}: tip [${f3(r.tip)}]  jaw tip [${f3(r.jaw)}]  lowest ${r.low.toFixed(2)} (${r.lowAt})`); }
  process.exit(0);
}
const rest = frame(0, DIP, SLIDE), toe0 = rest.toes;
let faults = 0;
for (let f = 0; f < FR; f++) {
  const t = f / (FR - 1), r = frame(t, DIP, SLIDE), c = strikeCurves(t);
  const slip = Math.max(...r.toes.map((p, k) => Math.hypot(p[0] - toe0[k][0], p[2] - toe0[k][2]))), toeY = Math.max(...r.toes.map((p) => p[1]));
  const bad = r.low < -0.05;
  if (bad) faults++;
  console.log(`t ${t.toFixed(2)} lunge ${lungeRoot(SIT, t, DIP, SLIDE, root).k.toFixed(2)} gape ${(c.gape * 180 / Math.PI).toFixed(0).padStart(2)} | tip [${f3(r.tip)}] | lowest body ${r.low.toFixed(2)} (${r.lowAt})${bad ? ' INTO THE GROUND' : ''} | toes slid ${slip.toFixed(2)}, up ${toeY.toFixed(2)} | hands y ${r.hands.map((p) => p[1].toFixed(2)).join(' ')}`);
}
console.log(`${id}: dip ${DIP} deg, slide ${SLIDE} cm; ${faults} frames with the body in the ground`);
process.exit(faults ? 1 : 0);
