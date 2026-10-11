// Fits the analytic eye (render/creatures/material.js analyticEyes) to the eyeball of a baked creature mesh: a sphere fitted to the skin of
// the +x eye's bulge, and its axis, the direction from the centre to the middle of the ball's exposed cap. Prints the fit against the
// manifest's eye and how much of the drawn cap lies on the ball (the share of the cap's surface within 6 % of r of the fitted sphere).
//
//   node tools/rig/eye-fit.mjs <manifest id> [--lod=hi|lo] [--start=x,y,z,r]
// (11 Oct 2026: the red-eyed tree frog's walking body took the sitting body's axis, and its painted iris sat on the back of the ball.)
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { dequantize } from '@gltf-transform/functions'; import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const id = process.argv[2], lod = arg('lod', 'hi');
const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'));
const ent = man[id], e = ent.finish.eyes[0];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(`public/assets/creatures/${lod === 'lo' ? ent.lo : ent.file}`); await doc.transform(dequantize());
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const node = doc.getRoot().listNodes().find((n) => n.getMesh());
const S = node?.getScale() ?? [1, 1, 1], T = node?.getTranslation() ?? [0, 0, 0];
const pa = prim.getAttribute('POSITION'), na = prim.getAttribute('NORMAL'), n = pa.getCount();
// (the game draws the GLB in cm: the node's transform (meshopt quantization) and x 100, as render/creatures/glb.js does)
const P = [], N = [];
for (let i = 0; i < n; i++) { const p = pa.getElement(i, []); P.push([0, 1, 2].map((k) => (p[k] * S[k] + T[k]) * 100)); N.push(na.getElement(i, [])); }
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(...a), nz = (a) => { const l = len(a) || 1; return a.map((v) => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = len(sub(P.reduce((m, p) => p.map((v, i) => Math.max(m[i], v)), [-1e9, -1e9, -1e9]), P.reduce((m, p) => p.map((v, i) => Math.min(m[i], v)), [1e9, 1e9, 1e9])));

// algebraic sphere fit: |p|^2 = 2 c.p + (r^2 - |c|^2), least squares over the points
function sphere(pts) {
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]), b = [0, 0, 0, 0];
  for (const p of pts) { const row = [2 * p[0], 2 * p[1], 2 * p[2], 1], y = dot(p, p); for (let i = 0; i < 4; i++) { b[i] += row[i] * y; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; } }
  for (let i = 0; i < 4; i++) { let m = i; for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let k = i + 1; k < 4; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; } }
  const x = [0, 0, 0, 0]; for (let i = 3; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < 4; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  const c = x.slice(0, 3); return { c, r: Math.sqrt(x[3] + dot(c, c)) };
}
const st = arg('start', '').split(',').filter(Boolean).map(Number);
let c = st.length ? st.slice(0, 3) : [Math.abs(e.c[0]), e.c[1], e.c[2]], r = st[3] ?? e.r;
let pts = [];
for (let it = 0; it < 30; it++) {
  // the ball's skin: points near the sphere whose normal points away from its centre (not the head's skin beyond it), on the +x side
  const tol = Math.max(0.12, 0.35 * Math.pow(0.85, it)) * r;
  pts = P.filter((p, i) => p[0] > 0 && Math.abs(len(sub(p, c)) - r) < tol && dot(N[i], nz(sub(p, c))) > 0.6);
  if (pts.length < 12) break;
  const f = sphere(pts);
  if (!(f.r > 0.3 * r && f.r < 2 * r) || len(sub(f.c, c)) > r) break;
  ({ c, r } = f);
}
// the exposed cap: the ball's skin points as above, tighter; its middle (the mean direction, weighted by nothing) is the axis
const cap = P.map((p, i) => [p, i]).filter(([p, i]) => p[0] > 0 && Math.abs(len(sub(p, c)) - r) < 0.06 * r && dot(N[i], nz(sub(p, c))) > 0.8);
const axis = nz(cap.reduce((s, [p]) => s.map((v, k) => v + nz(sub(p, c))[k]), [0, 0, 0]));
const spread = Math.acos(Math.min(1, cap.reduce((m, [p]) => Math.min(m, dot(nz(sub(p, c)), axis)), 1))) * 180 / Math.PI;
const h = nz(cross(axis, [0, 1, 0])), w = nz(cross(axis, h));
// how much of a drawn cap (centre, axis, r, cap) lies on the ball: the mesh points the shader would paint, and the share of them on the fitted sphere
function onBall(E) {
  const C = E.c, AX = E.axis, R = E.r, K = E.cap ?? 0.84; let painted = 0, good = 0;
  for (const p of P) { if (p[0] <= 0) continue; const rel = sub(p, C), d = len(rel); if (d > R * 1.3 || dot(rel, AX) / d < 0.2) continue;
    const u = dot(rel, E.h), v = dot(rel, E.w); if (Math.hypot(u, v) / (R * K) > 1) continue; painted++; if (Math.abs(len(sub(p, c)) - r) < 0.08 * r) good++; }
  return { painted, onBall: painted ? +(good / painted).toFixed(3) : 0 };
}
const ang = (a, b) => +(Math.acos(Math.min(1, Math.max(-1, dot(nz(a), nz(b))))) * 180 / Math.PI).toFixed(1);
const r3 = (a) => a.map((v) => +v.toFixed(3));
console.log(JSON.stringify({ id, lod, verts: n, sizeCm: +scale.toFixed(2), ballPts: pts.length, capPts: cap.length, capSpreadDeg: +spread.toFixed(1),
  fit: { c: r3(c), r: +r.toFixed(3), axis: r3(axis) },
  manifest: { c: e.c, r: e.r, axis: r3(e.axis), offsetCm: +len(sub(e.c, c)).toFixed(3), axisOffDeg: ang(e.axis, axis) },
  drawnNow: onBall(e), drawnFitted: onBall({ ...e, c, r, axis, h, w }) }, null, 1));
