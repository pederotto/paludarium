// A baked body's binding checked for strays: per bone, the vertices it dominates split into the pieces of the mesh they form (vertices welded by position, edges of the
// triangles between vertices of the same bone). A good binding gives each bone ONE big piece; a second big piece is skin a bone owns across a fold (the scan's thigh against
// its shin, a foot against the flank): when that bone turns, the piece is carried away from the surface it belongs to. Also per bone the share of its vertices whose
// second bone is not its parent or child (should be 0: two-bone blends are across a joint only).
//   CREATURES=/tmp/rebake3 node tools/rig/bind-check.mjs <manifest id>     (default folder public/assets/creatures)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const dir = (process.env.CREATURES || 'public/assets/creatures').replace(/\/?$/, '/'), id = process.argv[2] || 'redeye.swim';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const man = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8'))[id], doc = await io.read(dir + man.file);
const node = doc.getRoot().listNodes().find((nd) => nd.getMesh()), M = node.getWorldMatrix(), pr = node.getMesh().listPrimitives()[0];
const px = node.getMesh().listPrimitives()[0].getAttribute('_SKINX'), WS = new Float64Array(64);
const B = man.skeleton.bones, n = pr.getAttribute('POSITION').getCount(), el = [], P = [], b0 = new Int16Array(n), b1 = new Int16Array(n), w0 = new Float32Array(n);
for (let i = 0; i < n; i++) {
  pr.getAttribute('POSITION').getElement(i, el); P.push([0, 1, 2].map((r) => (M[r] * el[0] + M[4 + r] * el[1] + M[8 + r] * el[2] + M[12 + r]) * 100));
  pr.getAttribute('_SKIN').getElement(i, el); b0[i] = Math.round(el[0] * 32); b1[i] = Math.round(el[1] * 32); w0[i] = el[2];
  WS[b0[i]] += el[2]; WS[b1[i]] += el[3];
  if (px) { px.getElement(i, el); WS[Math.round(el[0] * 32)] += el[2]; WS[Math.round(el[1] * 32)] += el[3]; }
}
const key = new Map(), weld = new Int32Array(n);
for (let i = 0; i < n; i++) { const k = P[i].map((v) => Math.round(v * 1e4)).join(','); if (!key.has(k)) key.set(k, i); weld[i] = key.get(k); }
const ind = pr.getIndices().getArray(), nb = Array.from({ length: n }, () => []);
for (let t = 0; t < ind.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = weld[ind[t + a]], v = weld[ind[t + b]]; if (u !== v) { nb[u].push(v); nb[v].push(u); } }
const byName = Object.fromEntries(B.map((b, i) => [b.name, i])), par = B.map((b) => (b.parent != null ? byName[b.parent] ?? -1 : -1));
const dom = (i) => (w0[i] >= 0.5 ? b0[i] : b1[i]);
const comp = new Int32Array(n).fill(-1); let nc = 0; const sizes = [], owner = [], cen = [];
for (let s = 0; s < n; s++) {
  if (weld[s] !== s || comp[s] >= 0) continue;
  const st = [s], cs = [s]; comp[s] = nc;
  while (st.length) { const u = st.pop(); for (const v of nb[u]) if (comp[v] < 0 && dom(v) === dom(s)) { comp[v] = nc; st.push(v); cs.push(v); } }
  sizes.push(cs.length); owner.push(dom(s)); cen.push(cs.reduce((a, i) => a.map((x, k) => x + P[i][k] / cs.length), [0, 0, 0])); nc++;
}
console.log('total skin weight per bone (all four slots): ' + B.map((b, i) => `${b.name} ${WS[i].toFixed(0)}`).join(', '));
console.log(`${id}: ${n} vertices, ${nc} pieces; bone: vertices | pieces over 1 % of the bone's (size at centroid x y z cm) | second bone not across a joint`);
for (let b = 0; b < B.length; b++) {
  const tot = sizes.reduce((a, s, c) => a + (owner[c] === b ? s : 0), 0); if (!tot) continue;
  const big = sizes.map((s, c) => [s, c]).filter(([s, c]) => owner[c] === b && s > 0.01 * tot).sort((a, c) => c[0] - a[0]);
  let bad = 0, cnt = 0; for (let i = 0; i < n; i++) if (weld[i] === i && dom(i) === b) { cnt++; const o = w0[i] >= 0.5 ? b1[i] : b0[i]; if (o !== b && par[o] !== b && par[b] !== o && !(par[b] === -1 || par[o] === -1 || !/[LR]$/.test(B[b].name) || !/[LR]$/.test(B[o].name))) bad++; }
  // where along its own axis the bone's vertices lie (0 head ... 1 tail): a bone that owns skin past its own ends (t piled at 0 or 1) is carrying a neighbour's
  const hd = B[b].head, tl = B[b].tail, ax = tl.map((v, k) => v - hd[k]), l2 = ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2 || 1e-9, ts = [], ds = [];
  for (let i = 0; i < n; i++) if (weld[i] === i && dom(i) === b) { const t = P[i].reduce((a, v, k) => a + (v - hd[k]) * ax[k], 0) / l2, tc = Math.max(0, Math.min(1, t)); ts.push(t); ds.push(Math.hypot(...P[i].map((v, k) => v - hd[k] - ax[k] * tc))); }
  ts.sort((x, y) => x - y); ds.sort((x, y) => x - y); const at = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(2);
  console.log(' ', B[b].name.padEnd(8), String(tot).padStart(6), `| t ${at(ts, 0.1)}/${at(ts, 0.5)}/${at(ts, 0.9)} r50 ${at(ds, 0.5)} cm |`, big.map(([s, c]) => `${s} @ ${cen[c].map((v) => v.toFixed(2)).join(' ')}`).join('; '), '|', bad ? `${bad} not across a joint` : '');
}
