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
import { armClear } from './arm-clear.mjs';
import { loadRef, placeRef, surface } from './ref-sit.mjs';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), id = args[0] && !args[0].startsWith('--') ? args[0] : 'commonfrog.swim';
const opt = (k, d) => (args.includes(k) ? +args[args.indexOf(k) + 1] : d);
for (const k of ['peel', 'short', 'armMix', 'liftPerDeg']) if (args.includes('--' + k)) FROG_LUNGE[k] = opt('--' + k, FROG_LUNGE[k]);
const FR = opt('--frames', 26), DIP = opt('--dip', FROG_LUNGE.dipDeg), SLIDE = opt('--slide', FROG_LUNGE.slideCm);
const DIR = 'public/assets/creatures/', man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'))[id];
// the stance: --stance '<json>', else SPECIES.<species>.sit read from src/sim/animals.js's text (the module itself does not load in node: it imports the browser's three);
// (a fallback that silently stood in for it fitted the arms to a stance the game did not have, 7 Oct 2026: no fallback now)
const SIT0 = (() => { if (args.includes('--stance')) return JSON.parse(args[args.indexOf('--stance') + 1]);
  const src = fs.readFileSync('src/sim/animals.js', 'utf8'), m = src.match(/sit: (\{ pitchDeg[^\n]*?\}),?\n/); if (!m) throw new Error('no sit stance in src/sim/animals.js'); return Function('return ' + m[1].replace(/, mouthCm[\s\S]*$/, ' }'))(); })();
const SIT = { ...SIT0, offsetCm: [...SIT0.offsetCm], pivotCm: [...(SIT0.pivotCm ?? [0, 0.08, -3.85])], armDeg: [...SIT0.armDeg], pitchDeg: opt('--pitch', SIT0.pitchDeg) };      // (keep in step with SPECIES.commonfrog.sit)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(DIR + man.file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], Mw = node.getWorldMatrix();
const get = (name) => { const a = prim.getAttribute(name), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), n = P0.length / 3;
for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }   // cm
const bones = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
const rig = skeletonRig(man.skeleton, {}), N = rig.byName;
// the vertices that may touch the ground: mostly a foot's, a toe's, a hand's or a forearm's (the shin too: a sitting frog rests its folded shank on it), or the tongue's
const limbEnd = new Set(['footL', 'toesL', 'footR', 'toesR', 'handL', 'handR', 'forearmL', 'forearmR', 'shinL', 'shinR', 'tongue1', 'tongue2', 'tongue3', 'tongue4'].map((k) => N[k]).filter((b) => b != null));      // (and the tongue: it goes to the prey on the ground)
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
  // the arm clear of the body (the owner, 7 Oct 2026: at least 0.5 mm between the arm and the chest and throat, no arm skin inside the body), measured as
  // tools/rig/sit-check.mjs measures it (tools/rig/arm-clear.mjs: the nearest skin exactly, inside by the winding number), outside the armpit's own crease (--seam,
  // cm along the arm's skin from its seam with the body: 0.4, the narrowest band at which the unposed model itself is 0.5 mm clear)
  const domB = new Int16Array(n); for (let i = 0; i < n; i++) domB[i] = bones(i).reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1])[0];
  const I = prim.getIndices().getArray(), AC = armClear({ P0, I, dom: domB, names: rig.B.map((b) => b.name), seamCm: args.includes('--seam') ? +args[args.indexOf('--seam') + 1] : 0.4 });
  const Vtorso = G('spine', 'spineB', 'pelvis', 'head', 'jaw', 'hyoid'), Qp = new Float32Array(n * 3);
  // (--target-arm '<6 angles>': the arm's directions set from the owner's sitting model (8 Oct 2026: the elbow beside the chest just below the shoulder, the forearm
  // down and a little forward about 1.8 cm out, the hand flat ahead beside the head), kept by the same direction term while the hand is planted)
  const TGT = args.includes('--target-arm') ? JSON.parse(args[args.indexOf('--target-arm') + 1]) : null;
  const REF = TGT ? (() => { const sit = SD === 'R' ? { ...SIT, armA: [...SIT.armA.slice(0, 6), ...TGT] } : { ...SIT, armA: [...TGT, ...SIT.armA.slice(6, 12)] }; lungePose(sit, 0, 0, 0, HIND, FORE, st); poseStroke(rig, st, out);
    const a = -SIT.pitchDeg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), g = (b, end) => { const p = bonePt(N[b + SD], end ? rig.tail[N[b + SD]] : rig.head[N[b + SD]]); return [p[0], c * p[1] - sn * p[2], sn * p[1] + c * p[2]]; };
    return [['arm', 'forearm'], ['forearm', 'hand'], ['hand', null]].map(([b, nx]) => { const h = g(b, false), t = nx ? g(nx, false) : g(b, true), d = t.map((v, i) => v - h[i]), L = Math.hypot(...d); return d.map((v) => v / L); }); })()
    : args.includes('--ref') ? (() => { const B = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'))[args[args.indexOf('--ref') + 1]].skeleton.bones, g = (k) => B.find((b) => b.name === k + SD);
    return ['arm', 'forearm', 'hand'].map((k) => { const b = g(k), d = b.tail.map((v, i) => v - b.head[i]), L = Math.hypot(...d); return d.map((v) => v / L); }); })() : null;
  // (--ref-glb <file> --ref-align <json>: the owner's own SITTING model of the species laid over the body by its trunk and head (tools/rig/ref-sit.mjs); the arm's skin
  // fitted onto that model's arm, both ways: the arm's skin on the model's surface, and the model's arm (its skin not explained by the body's trunk or legs, on this
  // side, below the shoulder, in front of the hips) covered by the arm's skin)
  const RG = args.includes('--ref-glb') ? await (async () => {
    const R = await loadRef(args[args.indexOf('--ref-glb') + 1]), AL = JSON.parse(fs.readFileSync(args[args.indexOf('--ref-align') + 1], 'utf8')).align, RQ = placeRef(R, AL), S = surface(RQ, R.I);
    const a = -SIT.pitchDeg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), o = SIT.offsetCm, toG = (p) => [p[0] + o[0], c * p[1] - sn * p[2] + o[1], sn * p[1] + c * p[2] + o[2]];
    lungePose(SIT, 0, 0, 0, HIND, FORE, st); poseStroke(rig, st, out);
    const sideSign = SD === 'L' ? -1 : 1, mine = [], grid = new Map(), gk = (q) => `${Math.floor(q[0] / 0.2)},${Math.floor(q[1] / 0.2)},${Math.floor(q[2] / 0.2)}`;
    for (let i = 0; i < n; i++) { const nm = rig.B[domB[i]].name; if (/^(arm|forearm|hand)[LR]$/.test(nm) || /^tongue/.test(nm)) continue; const q = toG(skinAt(i, [0, 0, 0])); const k = gk(q); (grid.get(k) ?? grid.set(k, []).get(k)).push(q); }
    const near = (q) => { let b = 9; const [x, y, z] = [0, 1, 2].map((k) => Math.floor(q[k] / 0.2)); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const r of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) b = Math.min(b, Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2])); return b; };
    const sh = toG(bonePt(N['arm' + SD], rig.head[N['arm' + SD]])), vent = toG(bonePt(N.pelvis, rig.head[N.pelvis]));
    const pts = []; for (let i = 0; i < R.n; i++) { const q = [RQ[i * 3], RQ[i * 3 + 1], RQ[i * 3 + 2]]; if (q[0] * sideSign < 0.15 || q[1] > sh[1] + 0.3 || q[2] < vent[2] + 2.5) continue; if (near(q) > 0.15) pts.push(q); }
    const thin = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 600)) === 0);
    console.log('reference model: its', SD, 'arm region', pts.length, 'points (', thin.length, 'used ); shoulder (ground)', sh.map((v) => +v.toFixed(2)));
    if (args.includes('--ref-dump')) fs.writeFileSync(args[args.indexOf('--ref-dump') + 1], JSON.stringify({ pts: thin, ref: Array.from({ length: Math.floor(R.n / 4) }, (_, j) => [RQ[j * 12], RQ[j * 12 + 1], RQ[j * 12 + 2]]) }));
    return { S, toG, pts: thin };
  })() : null;
  const VarmRef = RG ? G('arm' + SD, 'forearm' + SD, 'hand' + SD).filter((_, i) => i % 4 === 0) : null;
  let WHERE = null;
  function clearance() {
    for (let i = 0; i < n; i++) skinAt(i, tmp), Qp[i * 3] = tmp[0], Qp[i * 3 + 1] = tmp[1], Qp[i * 3 + 2] = tmp[2];
    const m = AC.measure(Qp, { side: ARM ? SD : null, where: !!WHERE });
    if (WHERE) for (const e of m.list) (WHERE[e.bone + ' near ' + e.against] ??= []).push(e.sdMm);
    const nIn = Object.values(m.inside).reduce((u, v) => u + v, 0), tp = Vtorso.map((i) => [Qp[i * 3], Qp[i * 3 + 1], Qp[i * 3 + 2]]);
    return { pen: Math.max(0, 0.05 - m.closest) ** 2 * m.nUnder ** 0.5, low: m.closest, nClose: m.nUnder, nIn, tp };
  }
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
    const CL = clearance();
    // (the body's half width beside the elbow, from the trunk's and the head's skin there: the back's alone has none under the head, and a fallback of 0.8 cm put
    // the 'tucked' elbow inside a chest 1.3 cm wide)
    const elM = bonePt(N['forearm' + SD], rig.head[N['forearm' + SD]]), side = CL.tp.filter((q) => Math.abs(q[2] - elM[2]) < 0.4 && Math.abs(q[1] - elM[1]) < 0.6), flankL = side.length ? Math.max(...side.map((q) => Math.abs(q[0]))) : 1.2;
    const T = {
      clear: CL.pen * 3000 + CL.nIn * 50,                                                         // the arm at least 0.5 mm off the trunk's skin
      handLow: Math.min(...hy) ** 2 * 400,                                         // the hand on the ground
      handFlat: Math.max(0, pct(hy, 0.8) - 0.18) ** 2 * 120,                       // flat: most of it within 1.8 mm of the ground
      // (under the eye or a little ahead of it: this body's arm is long, about 5.8 cm shoulder to fingertip on a 7 cm frog, so it cannot fold under the eye)
      handUnderEye: Math.max(0, Math.abs(handC[2] - (e[2] + 0.5)) - 0.9) ** 2 * 20 + Math.max(0, Math.abs(Math.abs(handC[0]) - Math.abs(e[0]) - 0.1) - 0.45) ** 2 * 20,
      elbowIn: Math.max(0, Math.abs(elbow[0]) - flankL - 0.35) ** 2 * 30,         // (the elbow close beside the body, not out to the side)
      foreUp: Math.max(0, faUp - 22) ** 2 * 0.02,
      armOff: Math.max(0, -Math.min(...fore.map((p) => p[1]))) ** 2 * 200,
      kneeLow: Math.max(0, knee[1] - (backTop - 0.5)) ** 2 * 30,
      kneeOut: Math.max(0, flank * 0.9 - Math.abs(knee[0])) ** 2 * 20,
      kneeIn: Math.max(0, Math.abs(knee[0]) - (flank + 0.9)) ** 2 * 30,           // (the knee close beside the flank, not splayed out: a sitting frog is not squashed flat)
      kneeFwd: Math.max(0, vent[2] + 2.0 - knee[2]) ** 2 * 10,                     // (and forward of the hip, about mid-trunk: the thigh folded forward along the body)
      heelVent: Math.max(0, Math.hypot(heel[2] - vent[2], heel[1] - vent[1]) - 1.2) ** 2 * 10 + Math.max(0, heel[0] + 0.6) ** 2 * 60,      // (by the vent, on its own side: the two heels do not cross)
      footFlat: Math.min(...fy) ** 2 * 200 + Math.max(0, pct(fy, 0.7) - 0.25) ** 2 * 60,
      toesFwd: Math.max(0, heel[2] - toes[2] + 0.5) ** 2 * 10 + Math.max(0, Math.abs(toes[0]) - (flank + 2.2)) ** 2 * 20 + Math.max(0, knee[2] - toes[2]) ** 2 * 10,      // (the foot forward along its side, the toes toward the hands, not out sideways)
      pitch: Math.max(0, Math.abs(P[0] - 26) - 6) ** 2 * 0.2,
      elbowBack: Math.max(0, elbow[2] - wrist[2] - 0.1) ** 2 * 200 + Math.max(0, elbow[1] - shoulder[1] + 0.2) ** 2 * 60,      // (the elbow behind the wrist and below the shoulder)
      eyeH: Math.max(0, Math.abs(e[1] - 3.0) - 0.4) ** 2 * 15,                       // (a 7 cm frog sitting has its eyes about 3 cm up)
      ref: REF ? [[shoulder, elbow], [elbow, wrist], [wrist, J('hand' + SD, true)]].reduce((u, [a, b], k) => { const d = b.map((v, i) => v - a[i]), L = Math.hypot(...d); return u + (1 - d.reduce((w, v, i) => w + v * REF[k][i], 0) / L) * [60, 60, 30][k]; }, 0) : 0,
    };
    if (REF) { T.elbowIn = 0; T.handUnderEye = 0; T.foreUp = 0; }
    if (RG) {
      T.elbowIn = 0; T.handUnderEye = 0; T.foreUp = 0; T.elbowBack = 0;
      const mine = VarmRef.map((i) => RG.toG(skinAt(i, [0, 0, 0])));
      let a2 = 0; for (const q of mine) { const d = RG.S(q, 2.0); a2 += d * d; }
      let b2 = 0; for (const r of RG.pts) { let b = 9; for (const q of mine) { const d = (q[0] - r[0]) ** 2 + (q[1] - r[1]) ** 2 + (q[2] - r[2]) ** 2; if (d < b) b = d; } b2 += b; }
      T.refSkin = a2 / mine.length * 100; T.refCover = b2 / RG.pts.length * 100;      // (1 mm root mean square of either: a cost of 1)
    }
    const cost = Object.values(T).reduce((u, v) => u + v, 0);
    return detail ? { cost, T, CL, flankL, y0, elbow, wrist, knee, heel, toes, vent, eye: e, handC, faUp, backTop, flank } : cost;
  }
  // start: the present stance (both sides as the left), then a coordinate search with shrinking steps, from a few starts
  const armOf = (d) => [FORE.stand[0], FORE.stand[1], FORE.stand[2], FORE.stand[3] - d, FORE.stand[4] - d, FORE.stand[5]];
  const starts = !ARM && SIT.legA ? [[SIT.pitchDeg, ...SIT.armA.slice(0, 6), ...SIT.legA], [26, 179, 5, 154, -83, -89, -6, 100, -20, 100, 130, -5, 5, -20, -15, -30], [26, 179, 5, 154, -83, -89, -6, 140, -10, 150, 110, -15, 10, -20, -15, -20]] : SD === 'L' && ARM ? [[SIT.pitchDeg, ...SIT.armA.slice(0, 6), 0, 0], [SIT.pitchDeg, ...SIT.armA.slice(0, 6), 30, 20], [SIT.pitchDeg, ...SIT.armA.slice(0, 6), -30, -20]] : SD === 'R' ? [[SIT.pitchDeg, ...SIT.armA.slice(6, 12), 48, 30], [SIT.pitchDeg, 170, -28, 133, -86, -55, 8, 0, 0], [SIT.pitchDeg, 160, -10, 140, -60, -55, -10, 20, -20]] : [[SIT.pitchDeg, ...armOf(SIT.armDeg[0]), ...HIND.crouch], [26, 140, 20, 175, -60, -70, -5, ...HIND.crouch], [26, 150, 10, 170, -55, -75, 0, 120, -20, 100, 150, -5, 5, -20, -15, 0]];
  const lo = [16, 60, -30, 120, -90, -95, -40, 60, -60, 40, 60, -40, -30, -40, -40, -30], hi = [34, 179, 179, 179, 10, 10, 30, 179, 40, 179, 179, 40, 40, 30, 30, 30];
  if (args.includes('--ref-glb') || args.includes('--target-arm')) { lo[1] = 0; lo[2] = -200; hi[2] = 200; lo[3] = -200; hi[3] = 200; }      // (the sitting model may want the upper arm back along the flank, the hand turned in)
  // (--hum <th>,<ph>: an arm-only fit with the humerus held at those angles (the owner, 7 Oct 2026: the elbow swung a little out from the flank); the forearm, the
  // hand and their rolls fitted to it)
  const HUM = args.includes('--hum') ? args[args.indexOf('--hum') + 1].split(',').map(Number) : null;
  // (--ref <id>: the arm laid as that sitting body's is (the owner, 7 Oct 2026: "compare with the other .glb we have for consistency": the game's sitting frogs,
  // one scan (frog_mesh.glb) for the dart frogs, and the toad's): its upper arm, forearm and hand directions on the ground, from its manifest skeleton (a sitting
  // body is bound as it sits, y up from its floor); the elbow and hand placement terms of the anatomy fit give way to it)
  if (REF) console.log('reference', TGT ? 'target arm ' + JSON.stringify(TGT) : args[args.indexOf('--ref') + 1], SD, 'directions (ground):', JSON.stringify(REF.map((d) => d.map((v) => +v.toFixed(2)))));
  if (TGT && ARM) starts.splice(0, starts.length, [SIT.pitchDeg, ...TGT, 0, 0], [SIT.pitchDeg, ...TGT, 30, 0], [SIT.pitchDeg, ...TGT, -30, 0]);
  if (HUM) for (const s0 of starts) { s0[1] = HUM[0]; s0[4] = HUM[1]; }
  // (fitting to the sitting model: starts with the upper arm down and back along the flank, down and out, and down and forward; the forearm down and forward)
  if (args.includes('--ref-glb') && ARM) starts.push([SIT.pitchDeg, 40, 170, 175, -65, -60, -5, 0, 0], [SIT.pitchDeg, 70, 175, 175, -70, -65, -5, 0, 0], [SIT.pitchDeg, 120, 175, 170, -75, -70, -5, 20, 0], [SIT.pitchDeg, 20, 160, 175, -50, -55, -5, 0, 0]);
  let best = null;
  for (const s0 of starts) {
    const LO = ARM ? [...lo.slice(0, 7), -70, -70] : lo, HI = ARM ? [...hi.slice(0, 7), 70, 70] : hi;
    let P = s0.map((v, i) => Math.min(HI[i], Math.max(LO[i], v))), cst = evalP(P);
    for (const step of [16, 8, 4, 2, 1]) for (let rep = 0; rep < 3; rep++) {
      let moved = false;
      for (let i = 0; i < (ARM ? 9 : P.length); i++) if (!ARM || (i > 0 && !(HUM && (i === 1 || i === 4)))) for (const d of [step, -step]) { const Q = [...P]; Q[i] = Math.min(HI[i], Math.max(LO[i], Q[i] + d)); const c2 = evalP(Q); if (c2 < cst - 1e-6) { P = Q; cst = c2; moved = true; } }
      if (!moved) break;
    }
    console.log('start', starts.indexOf(s0), 'cost', cst.toFixed(3));
    if (!best || cst < best[1]) best = [P, cst];
  }
  WHERE = {}; const D = evalP(best[0], true), f2 = (v) => v.map((x) => +x.toFixed(2));
  console.log('arm skin inside, by its bone and the trunk bone it is under:', JSON.stringify(Object.fromEntries(Object.entries(WHERE).map(([k, v]) => [k, `${v.length}, deepest ${Math.min(...v)}`]))));
  console.log('clearance: closest arm skin', D.CL.low.toFixed(3), 'cm from the trunk, vertices under 0.5 mm', D.CL.nClose, ', inside', D.CL.nIn);
  console.log('terms', JSON.stringify(Object.fromEntries(Object.entries(D.T).map(([k, v]) => [k, +v.toFixed(3)]))));
  console.log('joints (ground frame): elbow', f2(D.elbow), 'wrist', f2(D.wrist), 'hand', f2(D.handC), 'eye', f2(D.eye), 'forearm from upright', D.faUp.toFixed(0), 'deg; flank', D.flank.toFixed(2), '| body half width beside the elbow', D.flankL.toFixed(2));
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
  { const a = frame(tc, 0, 0), b = frame(0, 0, 0); console.log(`body frame (before the stance): tongue tip at contact [${f3(a.tipBody)}], jaw tip at rest [${f3(b.jawBody)}]; sit from ${args.includes('--stance') ? '--stance' : 'src/sim/animals.js'}`); }
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
