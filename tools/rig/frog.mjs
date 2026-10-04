// A frog's rig, baked from its scan (tools/bake-creature.mjs, jobs with rig: 'frog'). Input: positions in the scan's own units,
// head towards +z, up +y, standing on its feet. Output per vertex, for render/creatures/instanced.js:
//   leg   1 front-left, 2 front-right, 3 back-left, 4 back-right, 0 body
//   legT  0 where the limb leaves the body … 1 at the tip of the longest toe, measured ALONG the limb (geodesic), so a folded
//         hind leg moves most at the foot, not at the knee that sticks out sideways (the guess in render/creatures/glb.js
//         measured legT as the distance out from the midline, which made the knee the "tip")
//   part  'body' | 'leg' | 'foot' (legT beyond `footT`: the hand or foot with its toes) | 'belly' for the paint
// plus `zf` (0 tail … 1 snout) and the body's extent (to scale the animal by its body length rather than its sprawl).
//
// The thigh of a sitting frog is about as thick as the flank, so the "thin" pieces start at the knee and the elbow. The thigh is
// then claimed for the hind leg by growing each limb back into the body through the vertices beside the hip (a short geodesic
// reach, only below the back), so the upper leg moves with the leg instead of being stretched between the body and the knee.
import { segment, normals } from './appendages.mjs';

export function frogRig(pos, idx, { thin = 0.24, distal = 0.08, thigh = 0.34, footT = 0.62 } = {}) {
  const n = pos.length / 3;
  const seg = segment(pos, idx, { thin, eyeMax: 30, distal, minLimb: 30 });
  // Four limbs: the biggest pieces (stray thin bits, a toe that came apart, are folded into the nearest big one).
  const big = [...seg.limbs].sort((a, b) => b.n - a.n).slice(0, 4);
  if (big.length < 4) throw new Error(`frog rig: expected 4 limbs, found ${seg.limbs.length} (${seg.limbs.map((L) => L.n).join(', ')})`);
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
  const byZ = [...big].sort((a, b) => b.c[2] - a.c[2]);
  const id = new Map();
  for (const [k, L] of byZ.entries()) id.set(L.k, (k < 2 ? 1 : 3) + (L.c[0] > 0 ? 1 : 0));
  if (new Set(id.values()).size !== 4) throw new Error('frog rig: limbs are not one per corner: ' + JSON.stringify(byZ.map((L) => [L.c.map((v) => +v.toFixed(2)), L.n])));
  const near = (L) => big.reduce((b, M) => (Math.hypot(...M.c.map((v, a) => v - L.c[a])) < Math.hypot(...b.c.map((v, a) => v - L.c[a])) ? M : b));
  for (const L of seg.limbs) if (!id.has(L.k)) id.set(L.k, id.get(near(L).k));

  // Grow each limb into the body: geodesic distance from the limb's base ring, over body vertices that are low enough to be
  // a thigh or a shoulder (not the back), up to `thigh` (scan units, measured on this scan: a thigh is about 0.4 long).
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = idx[t + k], b = idx[t + (k + 1) % 3]; adj[a].push(b); adj[b].push(a); }
  const len = (i, j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  const leg = new Uint8Array(n), legT = new Float32Array(n), into = new Float32Array(n).fill(Infinity);
  const H = (i) => (pos[i * 3 + 1] - y0) / (y1 - y0);
  const heap = [];
  const push = (d, i, l) => { heap.push([d, i, l]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let i = 0; i < n; i++) {
    if (seg.limb[i] < 0) continue;
    leg[i] = id.get(seg.limb[i]);
    for (const j of adj[i]) if (seg.limb[j] < 0) { into[j] = 0; push(0, j, leg[i]); }
  }
  // Which corner may claim body vertices: a vertex only joins the limb on its own side and its own half (front or back).
  const ok = (j, l) => (pos[j * 3] > 0) === (l % 2 === 0) && H(j) < (l >= 3 ? 0.62 : 0.45) && Math.abs(pos[j * 3]) > 0.12 * (y1 - y0);
  const owner = new Uint8Array(n);
  while (heap.length) {
    const [d, i, l] = pop();
    if (d > into[i] || owner[i]) continue;
    owner[i] = l;
    for (const j of adj[i]) {
      if (seg.limb[j] >= 0 || owner[j] || !ok(j, l)) continue;
      const nd = d + len(i, j);
      if (nd < into[j] && nd < thigh * (l >= 3 ? 1 : 0.55)) { into[j] = nd; push(nd, j, l); }
    }
  }
  // legT along the whole limb: the claimed part of the body ramps 0 … t0, the thin part t0 … 1 by its geodesic distance.
  const reach = {}, base = {};
  for (let i = 0; i < n; i++) if (owner[i]) { const l = owner[i]; base[l] = Math.max(base[l] ?? 0, into[i]); }
  for (let i = 0; i < n; i++) if (seg.limb[i] >= 0) { const l = leg[i]; reach[l] = Math.max(reach[l] ?? 0, seg.legT[i] * seg.limbs[seg.limb[i]].reach); }
  for (let i = 0; i < n; i++) {
    if (owner[i]) {
      const l = owner[i], b = base[l] || 1, full = b + (reach[l] ?? 1);
      leg[i] = l; legT[i] = Math.max(0, (b - into[i]) / full);
    } else if (seg.limb[i] >= 0) {
      const l = leg[i], b = base[l] ?? 0, full = b + (reach[l] ?? 1);
      legT[i] = Math.min(1, (b + seg.legT[i] * seg.limbs[seg.limb[i]].reach) / full);
    }
  }
  // A little smoothing of legT over the mesh so the seam between the body and the limb bends softly.
  for (let it = 0; it < 4; it++) {
    const o = Float32Array.from(legT);
    for (let i = 0; i < n; i++) { if (!leg[i]) continue; let s = legT[i], c = 1; for (const j of adj[i]) { s += leg[j] === leg[i] ? legT[j] : 0; c++; } o[i] = s / c; }
    legT.set(o);
  }
  const nor = normals(pos, idx);
  const part = new Array(n);
  for (let i = 0; i < n; i++) part[i] = leg[i] ? (legT[i] > footT ? 'foot' : 'leg') : nor[i * 3 + 1] < -0.35 && H(i) < 0.4 ? 'belly' : 'body';
  const zf = new Float32Array(n);
  for (let i = 0; i < n; i++) zf[i] = (pos[i * 3 + 2] - z0) / (z1 - z0);
  // The body's extent along z without the limbs (the snout to the vent): a frog's length is measured that way.
  const zs = []; for (let i = 0; i < n; i++) if (!leg[i]) zs.push(pos[i * 3 + 2]);
  zs.sort((a, b) => a - b);
  const q = (f) => zs[Math.floor(f * (zs.length - 1))];
  return { leg, legT, part, zf, body: { z0: q(0.002), z1: q(0.998) }, limbs: big.length };
}
