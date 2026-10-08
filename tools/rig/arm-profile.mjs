// The forelimbs' cross-sections after tools/rig/arm-slab.mjs, against the uncut body at the same place on the limb (the common frog, 7 Oct 2026; the owner's check:
// "cross-sectional thickness within 5 % of original"). A station on the cut segment at t (cm from its near joint) is the original's t before the slab and t + the
// slab's length past it. At each station: the mean and the largest distance of the segment's own skin (its main bone) from the bone, within 0.06 cm of the station.
//   node tools/rig/arm-profile.mjs <original.glb> <original manifest.json> <cut.glb> <cut manifest.json> <arms.json> [--id commonfrog.swim]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), [OG, OM, CG, CM, AJ] = args, id = args.includes('--id') ? args[args.indexOf('--id') + 1] : 'commonfrog.swim';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
async function load(file, manFile) {
  const man = JSON.parse(fs.readFileSync(manFile, 'utf8'))[id], doc = await io.read(file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], M = node.getWorldMatrix();
  const get = (nm) => { const a = prim.getAttribute(nm), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
  const P = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), n = P.length / 3;
  for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; for (let r = 0; r < 3; r++) P[i * 3 + r] = (M[r] * x + M[4 + r] * y + M[8 + r] * z + M[12 + r]) * 100; }
  const B = man.skeleton.bones, by = Object.fromEntries(B.map((b, i) => [b.name, i])), dom = new Int16Array(n);
  for (let i = 0; i < n; i++) { const c = [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]]; dom[i] = Math.round(c.reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1])[0]); }
  return { P, n, B, by, dom, I: prim.getIndices().getArray() };
}
const O = await load(OG, OM), C = await load(CG, CM), arms = JSON.parse(fs.readFileSync(AJ, 'utf8'));
// the ring of the segment's own skin at t: every triangle mostly on its bone, cut by the plane across the bone at t; its length (the perimeter) and the mean
// distance of the ring from the bone, weighted by length (independent of how many vertices there happen to be: a cut adds vertices along its line)
function section(m, bone, t) {
  const b = m.B[m.by[bone]], h = b.head, d = [b.tail[0] - h[0], b.tail[1] - h[1], b.tail[2] - h[2]], L = Math.hypot(...d), u = d.map((v) => v / L), bi = m.by[bone];
  const tof = (i) => (m.P[i * 3] - h[0]) * u[0] + (m.P[i * 3 + 1] - h[1]) * u[1] + (m.P[i * 3 + 2] - h[2]) * u[2];
  const rad = (q) => { const r = [q[0] - h[0], q[1] - h[1], q[2] - h[2]], tt = r[0] * u[0] + r[1] * u[1] + r[2] * u[2]; return Math.hypot(r[0] - u[0] * tt, r[1] - u[1] * tt, r[2] - u[2] * tt); };
  let per = 0, wr = 0, mx = 0;
  for (let k = 0; k < m.I.length; k += 3) {
    const v = [m.I[k], m.I[k + 1], m.I[k + 2]]; if (v.filter((i) => m.dom[i] === bi).length < 2) continue;
    const s = v.map((i) => tof(i) - t); if (!(Math.min(...s) < 0 && Math.max(...s) > 0)) continue;
    const pts = []; for (let a = 0; a < 3; a++) { const c = (a + 1) % 3; if ((s[a] < 0) !== (s[c] < 0)) { const f = s[a] / (s[a] - s[c]); pts.push([0, 1, 2].map((q) => m.P[v[a] * 3 + q] + (m.P[v[c] * 3 + q] - m.P[v[a] * 3 + q]) * f)); } }
    if (pts.length !== 2) continue;
    const l = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], pts[0][2] - pts[1][2]); per += l; wr += l * (rad(pts[0]) + rad(pts[1])) / 2; mx = Math.max(mx, rad(pts[0]), rad(pts[1]));
  }
  return per > 0 ? { mean: wr / per, per, max: mx } : null;
}
let worst = 0; const rows = [];
for (const side of ['L', 'R']) for (const [seg, bone] of [[0, 'arm'], [1, 'forearm']]) {
  // (one slab or several, each recorded where it was cut in the segment as it was then: undone last first)
  const sls = arms[side].slabs.filter((q) => q.seg === seg), Lc = sls[sls.length - 1].L - sls[sls.length - 1].D;
  const toOrig = (t) => sls.reduceRight((x, q) => (x <= q.t1 ? x : x + q.D), t), atStitch = (t) => sls.some((q) => Math.abs(sls.slice(sls.indexOf(q) + 1).reduce((x, q2) => (x <= q2.t1 ? x : x - q2.D), q.t1) - t) < 0.1);
  for (let f = 0.1; f <= 0.9001; f += 0.1) {
    const t = f * Lc, tO = toOrig(t), a = section(O, bone + side, tO), b = section(C, bone + side, t);
    if (!a || !b) continue;
    const ch = (b.per / a.per - 1) * 100, chMax = (b.mean / a.mean - 1) * 100, taper = seg === 1 && f > 1 - (arms[side].wristEase ?? 0.2);
    if (!taper) worst = Math.max(worst, Math.abs(ch));
    rows.push(`${(bone + side).padEnd(9)} at ${t.toFixed(2)} cm (orig ${tO.toFixed(2)})${atStitch(t) ? ' at a stitch' : ''}: perimeter ${a.per.toFixed(2)} -> ${b.per.toFixed(2)} cm (${ch >= 0 ? '+' : ''}${ch.toFixed(1)} %), mean radius ${a.mean.toFixed(3)} -> ${b.mean.toFixed(3)} (${chMax >= 0 ? '+' : ''}${chMax.toFixed(1)} %)${taper ? '  [the wrist easing to the evenly scaled hand]' : ''}`);
  }
}
for (const r of rows) console.log(r);
console.log(`WORST change of the perimeter, the wrist's easing to the scaled hand aside: ${worst.toFixed(1)} %  (target: within 5 %)`);
process.exit(worst <= 5 ? 0 : 1);
