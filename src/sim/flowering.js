// Flowering plants for the vivarium (2026-10): miniature orchids, bromeliads, two gesneriads and a begonia, each with its
// real habit (mostly epiphytes, so they grow on the background too), its needs and the colour forms it comes in.
// plants.js spreads FLOWERING into PLANTS. The bodies are built like the plants there: low-poly, vertex-coloured, with leaf
// coordinates for the veins of plantMaterial. The `flower` field follows the flower contract (team-plants):
//   build(b, r)   one flower or inflorescence head at the origin, opening along +Y, the flower's top toward +Z (see
//                 headMatrix); petals, sepals, lip and bracts carry leaf coords [u -1..1 across, v 0 base..1 tip], stalks,
//                 tubes and columns none. The vertex colour is a PALETTE MASK: r main, g accent, b centre, r+g+b = 1.
//   palettes      the real colour forms [main, accent, centre]; heads(r, grown) where the heads sit (plant-local);
//   translucent   0 waxy bract … 1 thin petal; daily; cycle in game days; after: what follows the bloom.
// Flower stalks are part of the plant body unless the comment on heads() says otherwise.

import * as THREE from 'three/webgpu';
import { Builder } from '../render/geo.js';
import { rng, clamp } from '../util/math.js';
import { ORCHID_LEAF, orchidLeafMap, orchidLeafRelief, orchidLeafNoise } from './orchid-leaves.js';   // (run orchids T1: painted orchid leaves; T2: their relief)

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _c = new THREE.Color();
const once = (f) => { let v; return () => (v ??= f()); };
// The per-plant rng a heads() call gets may be an xorshift seeded with a small number, whose first draws are all near 0.
const warm = (r) => { r(); r(); r(); return r; };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lc = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1));
// A palette mask: weights of the main, accent and centre colours, normalised to sum to 1.
const M = (r, g, b) => { const s = r + g + b || 1; return [r / s, g / s, b / s]; };

// Outlines: half-width (fraction of the width) at t, 0 base … 1 tip.
const OVAL = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.96)), 0.7);
const ROUND = (t) => 0.5 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.45);
const STRAP = (t) => 0.5 * Math.min(1, 0.75 + t * 2) * Math.pow(Math.max(0, 1 - t * t * t), 0.5);
const TRI = (t) => 0.5 * Math.pow(1 - t, 0.9);
const OVATE = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.8) * (1 - 0.3 * t);
const OBOVATE = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, 0.06 + 0.94 * t), 1.5)), 0.45);
const PETIOLATE = (t) => (t < 0.28 ? 0.09 : Math.max(0.09, 0.5 * Math.pow(Math.sin(Math.PI * Math.pow((t - 0.28) / 0.72, 1.6)), 0.6)));
const CORDATE = (t) => (t < 0.22 ? 0.32 + 0.18 * Math.sin((Math.PI / 2) * t / 0.22) : 0.5 * Math.pow(Math.cos((Math.PI / 2) * (t - 0.22) / 0.78), 0.8));
// A broad sepal drawn out into a thin tail from `k` of its length on (Masdevallia, Dracula).
const tailed = (k, tw = 0.05) => (t) => (t < k ? Math.max(tw, 0.5 * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t / k)), 0.8)) : tw * (1 - 0.7 * (t - k) / (1 - k)));

function put(b, p, n, col, sway, leaf) {
  b.pos.push(p.x, p.y, p.z);
  b.nor.push(n.x, n.y, n.z);
  if (Array.isArray(col)) b.col.push(col[0], col[1], col[2]);
  else { _c.set(col); b.col.push(_c.r, _c.g, _c.b); }
  b.sway.push(sway);
  if (leaf) b.leaf.push(leaf[0], leaf[1]); else b.leaf.push(0, -1);
}

// The face normal a sheet along `dir` gets from the hint `face` (the part of `face` across `dir`).
function faceOf(dir, face = UP) {
  const d = dir.clone().normalize();
  let side = new THREE.Vector3().crossVectors(face, d);
  if (side.lengthSq() < 1e-6) side = new THREE.Vector3().crossVectors(Math.abs(d.x) < 0.9 ? V(1, 0, 0) : V(0, 0, 1), d);
  side.normalize();
  return { d, side, nrm: new THREE.Vector3().crossVectors(d, side).normalize() };
}

// A curved sheet (leaf, petal, sepal, bract) from `base` along `dir`, its upper face toward `face`. `rows` are the t of each
// row of vertices (or `nv` even rows), `nu` the columns across. `curl` bends it toward its face along its length (negative:
// away), `cup` raises the edges toward the face, `twist` turns it about its axis toward the tip, `droop` lowers it, `shift`
// starts the sheet that fraction of its length behind `base` (a heart-shaped leaf on its stalk). `color(u, t)` is a hex
// colour, a THREE.Color or a palette mask [r, g, b]. Leaf coordinates [u, t] unless `leaf` is false. 2·nu·rows triangles.
function sheet(b, { base = V(0, 0, 0), dir, face = UP, len, width, outline = OVAL, nu = 2, nv = 4, rows = null, curl = 0, cup = 0, twist = 0, droop = 0, shift = 0, color = 0x3a6a2a, leaf = true, sway = (t) => t }) {
  const { d, side, nrm } = faceOf(dir, face);
  const ts = rows ?? Array.from({ length: nv + 1 }, (_, i) => i / nv);
  const W = nu + 1, P = [], N0 = [];
  for (const t of ts) {
    const tw = twist * t, ct = Math.cos(tw), st = Math.sin(tw);
    const sd = side.clone().multiplyScalar(ct).addScaledVector(nrm, st);
    const nm = nrm.clone().multiplyScalar(ct).addScaledVector(side, -st);
    const hw = width * outline(t);
    const c = base.clone().addScaledVector(d, len * (t - shift)).addScaledVector(nrm, curl * len * t * t);
    c.y -= droop * len * t * t;
    for (let j = 0; j <= nu; j++) {
      const u = -1 + (2 * j) / nu;
      P.push(c.clone().addScaledVector(sd, u * hw).addScaledVector(nm, cup * u * u * hw));
    }
    N0.push(nm);
  }
  const nr = ts.length, at = (i, j) => P[i * W + j];
  const nor = [];
  for (let i = 0; i < nr; i++) for (let j = 0; j <= nu; j++) {
    const pu = at(i, Math.min(nu, j + 1)).clone().sub(at(i, Math.max(0, j - 1)));
    const pt = at(Math.min(nr - 1, i + 1), j).clone().sub(at(Math.max(0, i - 1), j));
    const n = new THREE.Vector3().crossVectors(pt, pu);
    nor.push(n.lengthSq() > 1e-10 ? n.normalize() : N0[i].clone());
  }
  const vert = (i, j) => {
    const u = -1 + (2 * j) / nu, t = ts[i];
    put(b, at(i, j), nor[i * W + j], color(u, t), sway(t), leaf ? [u, t] : null);
  };
  if (typeof color !== 'function') { const c0 = color; color = () => c0; }
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nu; j++) {
    vert(i, j); vert(i + 1, j); vert(i, j + 1);
    vert(i, j + 1); vert(i + 1, j); vert(i + 1, j + 1);
  }
}

// A tapering prism along `pts` (stems, pseudobulbs, scapes, flower tubes, stamens): `radii` per point, `sides` faces, the
// rings carried along the curve without twisting. `color(t, k)`: hex, THREE.Color or a palette mask. Not a leaf.
// 2·sides·(points - 1) triangles.
function tube(b, pts, radii, { sides = 3, color = 0x4a6a2a, sway = (t) => t }) {
  const n = pts.length, rings = [], norms = [];
  let s1 = null;
  for (let i = 0; i < n; i++) {
    const T = pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    if (!s1) { s1 = new THREE.Vector3().crossVectors(Math.abs(T.y) < 0.95 ? UP : V(1, 0, 0), T).normalize(); }
    else { s1 = s1.clone().addScaledVector(T, -T.dot(s1)); if (s1.lengthSq() < 1e-8) s1 = new THREE.Vector3().crossVectors(V(1, 0, 0), T); s1.normalize(); }
    const s2 = new THREE.Vector3().crossVectors(T, s1).normalize();
    const ring = [], nn = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, o = s1.clone().multiplyScalar(Math.cos(a)).addScaledVector(s2, Math.sin(a));
      ring.push(pts[i].clone().addScaledVector(o, radii[i])); nn.push(o);
    }
    rings.push(ring); norms.push(nn);
  }
  const fn = typeof color === 'function' ? color : () => color;
  const vert = (i, k) => { k %= sides; const t = i / (n - 1); put(b, rings[i][k], norms[i][k], fn(t, k), sway(t), null); };
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
    vert(i, k); vert(i, k + 1); vert(i + 1, k);
    vert(i, k + 1); vert(i + 1, k + 1); vert(i + 1, k);
  }
}

// Where a head goes: local +Y to its facing, local +Z (the flower's top: the dorsal sepal) as near plant-local up as the
// facing allows, scaled by s and moved to (x, y, z). The flower renderer should orient bilateral flowers the same way.
export function headMatrix([x, y, z, dx, dy, dz, s]) {
  const Y = V(dx, dy, dz).normalize();
  let Z = UP.clone().addScaledVector(Y, -Y.dot(UP));
  if (Z.lengthSq() < 1e-4) Z = V(0, 0, 1).addScaledVector(Y, -Y.z);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  return new THREE.Matrix4().makeBasis(X.multiplyScalar(s), Y.multiplyScalar(s), Z.multiplyScalar(s)).setPosition(x, y, z);
}

// Shared material settings (one shader per kind, so the species share pipelines): monocots with parallel veins, the rest
// pinnate.
const ORCHID_MAT = { amp: 0.12, speed: 0.6, veins: { kind: 'parallel', n: 4, rib: 0.05, k: 0.7 } };
const BROM_MAT = { amp: 0.1, speed: 0.6, veins: { kind: 'parallel', n: 5, rib: 0.03, k: 0.6 } };
const DICOT_MAT = { amp: 0.2, speed: 0.7, veins: { kind: 'pinnate', n: 6, slope: 1.1, rib: 0.07, k: 0.9 } };

// ---------------------------------------------------------------------------------------------------------------------
// Orchids

// Orchid flower parts in 3D (run orchids, pass 3, shared by the orchid flowers below). Head space: +Y the facing, +Z the
// dorsal side (headMatrix). HEAD_DOWN: straight down as seen from a head that faces out and a little down.
const HEAD_DOWN = V(0, 0.4, -1).normalize();

// Rows x columns of points P[i][j] into 2 triangles a cell, normals across the row and column directions (the same winding as
// `sheet`). `leaf(i, j)` [u, v] or null, `col(i, j)` a mask or colour, `sway(i, j)`; `wrap` closes each row into a ring.
function surf(b, P, { leaf = null, col, sway = () => 1, wrap = false }) {
  const nr = P.length, nc = P[0].length, cols = wrap ? nc : nc - 1;
  const at = (i, j) => P[Math.min(nr - 1, Math.max(0, i))][wrap ? (j + nc) % nc : Math.min(nc - 1, Math.max(0, j))];
  const N = P.map((row, i) => row.map((_, j) => {
    const n = new THREE.Vector3().crossVectors(at(i + 1, j).clone().sub(at(i - 1, j)), at(i, j + 1).clone().sub(at(i, j - 1)));
    return n.lengthSq() > 1e-12 ? n.normalize() : V(0, 1, 0);
  }));
  const vert = (i, j) => { j = wrap ? j % nc : j; put(b, P[i][j], N[i][j], col(i, j), sway(i, j), leaf ? leaf(i, j) : null); };
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < cols; j++) {
    vert(i, j); vert(i + 1, j); vert(i, j + 1);
    vert(i, j + 1); vert(i + 1, j); vert(i + 1, j + 1);
  }
}

// One sepal of a cupped flower, from the bowl's floor (r0 from the centre, toward angle th about +Y: 0 the dorsal, about
// +-2.1 the laterals) out over the rim. `depth`: how far forward the rim sits (the bowl); `hood` arches the outer blade forward
// and in; `cup` raises the margins toward the face. The margin is rounded and narrows in a concave curve into a thin tail of
// `tail` length that bends toward `bend` (`hang` per step). Near the base the half-width is about tan 60 deg x the radius, so
// three sepals close into a bowl. Leaf v: 0 ... k on the blade, k ... 1 on the tail (k = len / (len + tail)); `col(u, v)`.
// Returns margin and face points for `bristles`. Triangles: 2 nu (rows - 1) + 2 (tRows - 1) (x2 tails with `fork`).
// Optional (run orchids, pass 4; missing = the shape above): `spine(s)` -> [radius, forward] replaces the bowl's spine (a
// sepal tube: a long forward run, then the flare); `outline(s)` the half-width (rounded bodies, a narrow triangle);
// `cupAt(s)` the margin lift (1 with outline(s) = radius closes two sepals into a tube); `vk` the leaf v at the blade's tip
// (pattern scale; default k); `fork { f, notch, bend: [b0, b1] }` splits the tip into two tails from the margin lobes
// (columns 0..f and nu-f..nu; the middle of the tip pulled back by `notch` of s): a fused synsepal.
function cupSepal(b, { th, r0 = 0.25, len, width, depth = 0.9, hood = 0, cup = 0.35, tail, tw = 0.06, bend = HEAD_DOWN, hang = 0.7, rows = [0, 0.14, 0.3, 0.45, 0.6, 0.74, 0.87, 1], nu = 3, tRows = 6, col, spine = null, outline = null, cupAt = null, vk = null, fork = null }) {
  const R = V(Math.sin(th), 0, Math.cos(th)), T = V(Math.cos(th), 0, -Math.sin(th)), F = V(0, 1, 0), k = vk ?? len / (len + tail);
  const sp = spine ? (s) => { const [r, f] = spine(s); return R.clone().multiplyScalar(r).addScaledVector(F, f); }
    : (s) => R.clone().multiplyScalar(r0 + len * s - 0.45 * hood * s * s * s).addScaledVector(F, depth * (1 - (1 - s) * (1 - s)) + hood * s * s * s);
  const hw = outline ? (s) => Math.max(tw, outline(s))
    : (s) => tw + (width / 2 - tw) * (s < 0.3 ? 0.3 + 0.7 * Math.pow(Math.sin((Math.PI / 2) * s / 0.3), 0.7) : Math.pow(Math.cos((Math.PI / 2) * (s - 0.3) / 0.7), 1.5));
  const cq = cupAt ?? ((s) => cup * (0.4 + 0.6 * sstep(0, 0.3, s)));
  const frame = (s) => { const d = sp(Math.min(1, s + 0.01)).sub(sp(Math.max(0, s - 0.01))).normalize(); return { d, n: new THREE.Vector3().crossVectors(d, T).normalize() }; };
  const at = (s, u) => { const { n } = frame(s), w = hw(s); return sp(s).addScaledVector(T, u * w).addScaledVector(n, cq(s) * u * u * w); };
  const P = [], hairs = { margin: [], face: [] }, last = rows[rows.length - 1];
  for (const s of rows) {
    const c = sp(s), { d, n } = frame(s), w = hw(s), q = cq(s), row = [];
    for (let j = 0; j <= nu; j++) { const u = -1 + (2 * j) / nu; row.push(fork && s === last ? at(s - fork.notch * Math.max(0, 1 - 1.5 * Math.abs(u)), u) : at(s, u)); }
    P.push(row);
    if (s > 0.2 && s < 0.9 && P.length % 2) {     // bristles on every other row
      for (const u of [-1, 1]) hairs.margin.push({ p: row[u < 0 ? 0 : nu].clone().addScaledVector(n, 0.006), dir: T.clone().multiplyScalar(u).addScaledVector(n, 0.6).normalize(), along: d, leaf: [u, k * s] });
      const uf = P.length % 4 === 1 ? 0.45 : -0.45;
      hairs.face.push({ p: c.clone().addScaledVector(T, uf * w).addScaledVector(n, q * uf * uf * w + 0.01), dir: n.clone().addScaledVector(d, 0.4).normalize(), along: T, leaf: [uf, k * s] });
    }
  }
  surf(b, P, { leaf: (i, j) => [-1 + (2 * j) / nu, k * rows[i]], col: (i, j) => col(-1 + (2 * j) / nu, k * rows[i]), sway: (i) => k * rows[i] });
  // the tail(s): on from the blade's tip along its direction, bending toward `bend`, narrowing to a third
  const L = P.length - 1, tv = (i) => k + ((1 - k) * i) / (tRows - 1);
  const tails = fork ? [[0, fork.f, fork.bend[0]], [nu - fork.f, nu, fork.bend[1]]] : [[0, nu, bend]];
  for (const [ja, jb, bd] of tails) {
    const Q = [[P[L][ja], P[L][jb]]], w0 = P[L][ja].distanceTo(P[L][jb]) / 2;
    let p = fork ? P[L][ja].clone().add(P[L][jb]).multiplyScalar(0.5) : sp(1), d = frame(1).d;
    for (let i = 1; i < tRows; i++) {
      d = d.clone().addScaledVector(bd, hang).normalize();
      p = p.clone().addScaledVector(d, tail / (tRows - 1));
      const a = T.clone().addScaledVector(d, -T.dot(d)).normalize();
      const w = tw * (1 - (0.7 * i) / (tRows - 1)) + (fork ? Math.max(0, w0 - tw) * Math.pow(1 - i / (tRows - 1), 3) : 0);
      Q.push([p.clone().addScaledVector(a, -w), p.clone().addScaledVector(a, w)]);
    }
    surf(b, Q, { leaf: (i, j) => [j ? 1 : -1, tv(i)], col: (i, j) => col(j ? 1 : -1, tv(i)), sway: (i) => tv(i) });
  }
  return hairs;
}

// A cupped scallop-shell lip: an oval dish (half-axes `w` across, `h` up) about `c`, hollow toward `axis` (`depth` at its rim),
// with radiating ridges on alternate spokes (`rib`). `col(ring, spoke)`. Triangles: 2 segs (rings - 1).
function shellLip(b, { c, axis, up = V(0, 0, 1), w, h, depth, segs = 10, rings = [0.03, 0.55, 1], rib = 0.06, col, leafV = 0.1 }) {
  const A = axis.clone().normalize(), U = up.clone().addScaledVector(A, -up.dot(A)).normalize(), S = new THREE.Vector3().crossVectors(U, A);
  const P = rings.map((r) => Array.from({ length: segs }, (_, j) => {
    const a = (j / segs) * Math.PI * 2;
    return c.clone().addScaledVector(S, Math.cos(a) * r * w).addScaledVector(U, Math.sin(a) * r * h).addScaledVector(A, (depth + (j % 2 ? -rib : rib)) * r * r).addScaledVector(S, Math.cos(a) * r * w * (j % 2 ? -0.05 : 0.04)).addScaledVector(U, Math.sin(a) * r * h * (j % 2 ? -0.05 : 0.04));
  }));
  surf(b, P, { wrap: true, leaf: (i, j) => [Math.cos((j / segs) * Math.PI * 2), leafV * rings[i]], col, sway: () => leafV });
}

// Short stiff hairs: one thin triangle a point ({ p, dir, along, leaf }), standing out along `dir`, `len` long, `w` half-wide.
function bristles(b, pts, { len, w, col }) {
  for (const h of pts) {
    const n = new THREE.Vector3().crossVectors(h.along, h.dir).normalize();
    put(b, h.p.clone().addScaledVector(h.along, -w), n, col, h.leaf[1], h.leaf);
    put(b, h.p.clone().addScaledVector(h.along, w), n, col, h.leaf[1], h.leaf);
    put(b, h.p.clone().addScaledVector(h.dir, len), n, col, h.leaf[1], h.leaf);
  }
}

// Masdevallia: a dense tuft of erect, narrow spoon-shaped leaves on channelled petioles (no pseudobulbs), 8.5-12 x 1.7-2.3 cm,
// and single flowers on wiry stems from the base, held at or above the leaves, one arching out sideways.
// Leathery, glossy spoon leaves with a channelled midrib (painted, sim/orchid-leaves.js); the underside a little paler.
const MASD_MAT = () => ({ ...ORCHID_MAT, rough: 0.8, wax: [0.38, 0.82, 0.45], leafMap: orchidLeafMap('masdevallia'), leafRelief: orchidLeafRelief('masdevallia'), leafNoise: orchidLeafNoise(), mottle: [0.08, 0.1, 0.06], leafPale: [0.62, 0.76, 0.46], leafBack: [1.1, 1.12, 1.0] });
const masdLayout = once(() => {
  const r = rng(101), leaves = [], stalks = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + ((k * 0.618034) % 1 - 0.5) * 4.4 + (r() - 0.5) * 0.3, o = 0.15 + r() * 0.35, lean = 0.22 + r() * 0.25;   // (T1b: front three-quarters, never into the wall)
    leaves.push({ a, base: V(Math.cos(a) * o, 0, Math.sin(a) * o), dir: V(Math.cos(a) * lean, 1, Math.sin(a) * lean), len: 8.5 + r() * 3.5, width: 1.7 + r() * 0.6 });
  }
  for (let k = 0; k < 4; k++) {
    // Stems over the front three-quarters of the tuft (local +Z: toward the room on the wall), each flower held out
    // sideways, about 30 degrees above level (on the wall plant "up" points at the viewer, so they face the room there too).
    const a = k * 1.05 + 0.05 + r() * 0.3, arch = k === 3, h = arch ? 10.5 : 12 + r() * 2, out = V(Math.cos(a), 0, Math.sin(a));
    const p0 = out.clone().multiplyScalar(0.3);
    const pts = [p0, p0.clone().add(V(0, h * 0.5, 0)).addScaledVector(out, arch ? 1.8 : 0.5), p0.clone().add(V(0, h, 0)).addScaledVector(out, arch ? 5 : 1.6)];
    stalks.push({ pts, tip: pts[2], face: out.clone().add(V(0, arch ? 0.3 : 0.55, 0)).normalize() });
  }
  return { leaves, stalks };
});

// Dracula: a tuft of keeled, arching leaves; the flower stems grow out sideways past the leaves and arch over, so the
// flowers hang facing out and down (they stay above the ground when it grows on land).
// Keeled straps with a fold line and faint parallel veins, a satin sheen, a paler underside.
const DRAC_MAT = () => ({ ...ORCHID_MAT, rough: 0.78, wax: [0.55, 0.82, 0.4], leafMap: orchidLeafMap('dracula'), leafRelief: orchidLeafRelief('dracula'), leafNoise: orchidLeafNoise(), mottle: [0.07, 0.1, 0.06], leafPale: [0.7, 0.8, 0.5], leafBack: [1.25, 1.25, 1.1] });
const dracLayout = once(() => {
  const r = rng(103), leaves = [], stalks = [];
  // (photos 1-3: about a dozen long narrow straps, 13-17 cm, erect then arching out)
  for (let k = 0; k < 12; k++) {
    const a = Math.PI / 2 + ((k * 0.618034) % 1 - 0.5) * 4.6 + (r() - 0.5) * 0.3, o = 0.25 + r() * 0.35, lean = 0.35 + r() * 0.45;   // (T1b)
    leaves.push({ a, base: V(Math.cos(a) * o, 0, Math.sin(a) * o), dir: V(Math.cos(a) * lean, 1, Math.sin(a) * lean), len: 13 + r() * 4, width: 1.35 + r() * 0.35 });
  }
  // pendent stems: out past the leaves, up over an arch, then down, so the flower hangs facing out with its tails below it
  for (let k = 0; k < 3; k++) {
    // (F5) All three round local +Z (pi/2 +- 0.4), facing out and a little up in the body frame: on a wall (up leaning ~50 deg
    // out, wallTilt 1.2) that is out and 25-35 deg down at every spin, on land out and level; tips high enough for the tails.
    const a = Math.PI / 2 + (k - 1) * 0.38 + (r() - 0.5) * 0.2, out = V(Math.cos(a), 0, Math.sin(a)), L = 7.4 + r() * 1.2, y = 7.6 + 0.4 * k;
    const p0 = out.clone().multiplyScalar(0.3).add(V(0, 0.3, 0));
    const pts = [p0, p0.clone().addScaledVector(out, L * 0.5).add(V(0, y + 1.2, 0)), p0.clone().addScaledVector(out, L).add(V(0, y, 0))];
    stalks.push({ pts, tip: pts[2], face: out.clone().add(V(0, 0.25, 0)).normalize() });
  }
  return { leaves, stalks };
});

// Heart-leaf Pleurothallis: a clump of thin wiry stems (ramicauls), each as long as or longer than its leaf and ending in one
// heart-shaped leaf; the blades held steeply out and down, overlapping in all directions. A fascicle of tiny flowers sits in
// the notch on the leaf's upper face. Leaves 6.5-9.5 cm (7.5-11 along the curve), width 0.55-0.92 x length (P. coriacardia narrow, P. cordata round).
// The heart: rounded base lobes reaching back past the stem into a deep notch, a smooth margin, the tip drawn out (acuminate).
const HEART = (t) => (t < 0.24 ? 0.14 + 0.36 * Math.pow(Math.sin((Math.PI / 2) * t / 0.24), 0.55)
  : 0.5 * Math.pow(Math.cos((Math.PI / 2) * (t - 0.24) / 0.76), 1.1) * (1 - 0.3 * sstep(0.7, 1, t)));
// Thick, glossy hearts: a pale midrib, very faint arcuate veins, a soft mottling; the outline (lobes, notch, acuminate tip) is
// the texture's alpha on a coarse blade (sim/orchid-leaves.js).
const PLEURO_MAT = () => ({ ...ORCHID_MAT, rough: 0.8, wax: [0.34, 0.82, 0.45], leafMap: orchidLeafMap('pleurothallis'), leafRelief: orchidLeafRelief('pleurothallis'), leafNoise: orchidLeafNoise(), mottle: [0.07, 0.12, 0.07], leafPale: [0.78, 0.86, 0.55], leafBack: [1.04, 1.07, 0.97] });
// (F3) A smooth tepal for the bell and cup flowers of Pleurothallis and D. cuthbertsonii: from radius r0 about the head axis
// (+Y) at angle th (0 = +Z, the dorsal side), its spine leaves at a0 from the axis and bends out to a1 at the tip (radians: a
// trumpet that flares, or a cup); the outline widens from `base` x width to the full width at s = 0.68 and closes in a rounded
// tip by the last row; `cup` [at the base, at the tip] curls the margins inward. `fr` { o, X, Y, Z } places it (right-handed;
// default the head frame). `col(u, s)`. Leaf v = s. Triangles: 2 nu (rows - 1).
function bellTepal(b, { th, y0 = 0, r0 = 0.2, len, width, a0 = 0.25, a1 = 1.3, base = 0.45, cup = [0.5, 0.15], nu = 3, rows = [0, 0.22, 0.44, 0.63, 0.79, 0.91, 0.97], fr = null, col }) {
  const R = V(Math.sin(th), 0, Math.cos(th)), T = V(Math.cos(th), 0, -Math.sin(th)), F = V(0, 1, 0);
  const at = (p) => (fr ? fr.o.clone().addScaledVector(fr.X, p.x).addScaledVector(fr.Y, p.y).addScaledVector(fr.Z, p.z) : p);
  const ang = (s) => a0 + (a1 - a0) * s * s;
  const sp = (s) => {
    const p = R.clone().multiplyScalar(r0).addScaledVector(F, y0), n = 12, ds = s / n;
    for (let i = 0; i < n; i++) { const a = ang((i + 0.5) * ds); p.addScaledVector(R, Math.sin(a) * len * ds).addScaledVector(F, Math.cos(a) * len * ds); }
    return p;
  };
  const hw = (s) => (width / 2) * (base + (1 - base) * Math.pow(Math.sin((Math.PI / 2) * Math.min(1, s / 0.68)), 0.8)) * (s > 0.68 ? Math.sqrt(Math.max(0, 1 - ((s - 0.68) / 0.32) ** 2)) : 1);
  const P = rows.map((s) => {
    const a = ang(s), d = R.clone().multiplyScalar(Math.sin(a)).addScaledVector(F, Math.cos(a)), n = new THREE.Vector3().crossVectors(d, T);
    const c = sp(s), w = hw(s), q = cup[0] + (cup[1] - cup[0]) * s, row = [];
    for (let j = 0; j <= nu; j++) { const u = -1 + (2 * j) / nu; row.push(at(c.clone().addScaledVector(T, u * w).addScaledVector(n, q * u * u * w))); }
    return row;
  });
  surf(b, P, { leaf: (i, j) => [-1 + (2 * j) / nu, rows[i]], col: (i, j) => col(-1 + (2 * j) / nu, rows[i]), sway: (i) => rows[i] });
}

const pleuroLayout = once(() => {
  // (T1b) On the wall (wallTilt 1.6, wallSpin 0.35) local +Y is up-and-out, world-down is about local (0, -0.85, 0.53) and the
  // wall's normal local (0, 0.53, 0.85). So the stems fan over the sides and the front (never local -Z: into the wall), arch
  // up and out, and each blade hangs from the stem tip toward world-down with its upper face to the room (photo 4); on land
  // the same body reads as wiry stems with the hearts hanging steeply, all a little to one side (photo 2).
  const r = rng(107), stems = [], DOWN = V(0, -0.85, 0.53), OUTF = V(0, 0.53, 0.85);
  for (let k = 0; k < 11; k++) {
    const a = Math.PI / 2 + ((k * 0.618034) % 1 - 0.5) * 4.6 + (r() - 0.5) * 0.3, lean = 0.3 + r() * 0.35, out = V(Math.cos(a), 0, Math.sin(a));
    const len0 = 6.5 + r() * 3, h = len0 * (1 + r() * 0.55);
    const p0 = V(-1.5 + 3 * r(), 0, -0.5 + 1.5 * r());
    const top = p0.clone().add(V(Math.cos(a) * lean * h, h * (1 - lean * 0.45), Math.sin(a) * lean * h));
    const mid = p0.clone().lerp(top, 0.5).addScaledVector(out, 0.16 * h).add(V(0, 0.08 * h, 0));
    // the blade hangs tip-down from the stem tip, turned a little out to its stem's side, its face to the room
    const sw = 0.28 + r() * 0.2, dir = DOWN.clone().addScaledVector(out, sw).add(V(0, -0.1 * r(), 0)).normalize();
    const len = len0, ratio = k % 3 === 0 ? 0.82 + r() * 0.12 : 0.6 + r() * 0.2, face = OUTF.clone().addScaledVector(out, 0.35);
    const { nrm } = faceOf(dir, face);
    stems.push({ p0, mid, top, dir, face, len, width: len * ratio, nrm, tone: k % 4 === 1 ? 'wine' : k % 5 === 3 ? 'flush' : 'green' });
  }
  return { stems };
});

// Lepanthes: tiny stems sheathed in ribbed funnels, each topped by a round leaf; the flowers lie on the leaf.
const lepLayout = once(() => {
  const r = rng(109), stems = [];
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4 + r() * 0.4, lean = 0.15 + r() * 0.25, h = 2 + r() * 1.6, out = V(Math.cos(a), 0, Math.sin(a));
    const p0 = out.clone().multiplyScalar(0.2), top = p0.clone().add(V(Math.cos(a) * lean * h, h, Math.sin(a) * lean * h));
    const dir = V(Math.cos(a) * 0.9, 0.4 + r() * 0.4, Math.sin(a) * 0.9).normalize(), len = 1.4 + r() * 0.4;
    const { nrm } = faceOf(dir, UP);
    stems.push({ p0, top, dir, len, width: 1.15 + r() * 0.25, nrm });
  }
  return { stems };
});

// Dendrobium cuthbertsonii (run orchids, O2c): a tight clump (about 4 cm) of a dozen tiny pseudobulbs, one or two small
// dark leaves on each; one flower per bulb on a short stalk, all round the clump and facing out (photo 2), the flowers far
// bigger than the leaves. Bulbs on a sunflower spiral; the facings from a little below the horizon to steep.
// Small dark leaves with raised silver-white warts on top (painted), flushed red-brown underneath (the back-face tint).
const CUTH_MAT = () => ({ ...ORCHID_MAT, rough: 0.74, wax: [0.45, 0.8, 0.45], leafMap: orchidLeafMap('cuthbertsonii'), leafRelief: orchidLeafRelief('cuthbertsonii'), leafNoise: orchidLeafNoise(), mottle: [0.15, 0.1, 0.05], leafPale: [0.86, 0.9, 0.86], leafBack: [3.0, 0.85, 1.15] });
const cuthLayout = once(() => {
  const r = rng(113), r2 = rng(117), bulbs = [], stalks = [], N = 12;
  for (let k = 0; k < N; k++) {
    const a = k * 2.39996 + (r() - 0.5) * 0.4, d = 0.25 + 0.85 * Math.sqrt((k + 0.5) / N), out = V(Math.cos(a), 0, Math.sin(a));
    const p = out.clone().multiplyScalar(d), lean = V(out.x * 0.3, 1, out.z * 0.3).normalize(), h = 0.7 + r() * 0.35;
    const top = p.clone().addScaledVector(lean, h), leaves = [], nl = k % 2 ? 1 : 2;
    for (let j = 0; j < nl; j++) {
      const b = a + (nl === 1 ? (r() - 0.5) * 0.6 : j ? 0.55 : -0.55);
      leaves.push({ dir: V(Math.cos(b) * 0.65, 1, Math.sin(b) * 0.65), len: 1.5 + r() * 1.0, width: 0.62 + r() * 0.14, red: r() });
    }
    bulbs.push({ a, p, top, lean, h, leaves });
  }
  // (F5, photo 2; decision 21: wallSpin 0.4, so local +Z stays down the wall) Eight flowers round the lower, front side of the
  // clump, each on a stalk from the nearest outer bulb out past the leaf ring, facing out and up 31-39 deg in the body frame (on
  // a wall: out and down 10-30 deg); the upper side stays free, so leaves show between and above them (the old ten made a wheel).
  for (let j = 0; j < 8; j++) {
    const az = Math.PI / 2 + ((j + 0.5) / 8 - 0.5) * 2.3 + (r2() - 0.5) * 0.16, side = Math.abs(Math.cos(az));
    const B = bulbs.slice(4).reduce((m, q) => (Math.cos(q.a - az) > Math.cos(m.a - az) ? q : m));
    const e = 0.55 + 0.08 * side + 0.05 * r2(), ce = Math.cos(e), face = V(Math.cos(az) * ce, Math.sin(e), Math.sin(az) * ce);
    const R = 2.0 + 0.45 * r2(), tip = V(Math.cos(az) * R, 1.1 + 0.6 * side + 0.2 * r2(), Math.sin(az) * R);
    stalks.push({ pts: [B.top.clone(), tip], tip, face, age: r2() });
  }
  return { bulbs, stalks };
});

// ---------------------------------------------------------------------------------------------------------------------
// Bromeliads and the others

// Miniature Neoregelia: three tubular rosettes joined by stolons (how these minis spread over a branch).
const neoLayout = once(() => {
  const r = rng(127);
  const ros = [{ c: V(0, 0, 0), s: 1 }, { c: V(2.9, 0, 0.9), s: 0.85 }, { c: V(-1.8, 0, 2.5), s: 0.7 }];
  for (const R of ros) {
    R.leaves = [];
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4 + r() * 0.3, lean = 0.3 + (k / 8) * 0.25;
      R.leaves.push({ a, dir: V(Math.cos(a) * lean, 1, Math.sin(a) * lean), len: (4.2 + r() * 1.6) * R.s, width: 0.95 * R.s, twist: (r() - 0.5) * 0.5 });
    }
  }
  return { ros };
});

const guzLayout = once(() => {
  const r = rng(131), leaves = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + r() * 0.3; leaves.push({ a, outer: true, dir: V(Math.cos(a), 0.95, Math.sin(a)), len: 8.5 + r() * 1.6, width: 1.7, droop: 0.3 }); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.5 + r() * 0.3; leaves.push({ a, outer: false, dir: V(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45), len: 6.5 + r() * 1.2, width: 1.5, droop: 0.25 }); }
  return { leaves };
});

const tillLayout = once(() => {
  const r = rng(137), leaves = [];
  for (let k = 0; k < 24; k++) {
    const age = k / 23, a = k * 2.4 + r() * 0.2, spread = 0.3 + 0.9 * age;
    leaves.push({ a, dir: V(Math.cos(a) * spread, 1 - 0.25 * age, Math.sin(a) * spread), len: 2.2 + 1.8 * age + r() * 0.4, width: 0.55 });
  }
  return { leaves };
});

const sinnLayout = once(() => {
  const r = rng(139), leaves = [], stalks = [];
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + r() * 0.4; leaves.push({ a, len: 1.5 + r() * 0.4, width: 1.15 + r() * 0.15 }); }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5 + r() * 0.5, out = V(Math.cos(a), 0, Math.sin(a)), h = 2.6 + r() * 0.6;
    const pts = [out.clone().multiplyScalar(0.1).add(V(0, 0.1, 0)), out.clone().multiplyScalar(0.3).add(V(0, h * 0.55, 0)), out.clone().multiplyScalar(0.9).add(V(0, h, 0))];
    stalks.push({ pts, tip: pts[2], face: out.clone().add(V(0, 0.35, 0)).normalize() });
  }
  return { leaves, stalks };
});

// Columnea: trailing stems with pairs of small leaves; the flowers come singly from the leaf axils.
const colLayout = once(() => {
  const r = rng(149), stems = [], nodes = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4 + r() * 0.4, out = V(Math.cos(a), 0, Math.sin(a)), L = 9 + r() * 2.5;
    const pts = [];
    for (let i = 0; i <= 6; i++) { const s = i / 6; pts.push(out.clone().multiplyScalar(0.2 + L * s).add(V(0, 0.3 + 1.6 * Math.sin(Math.PI * s * 0.7) - 3.2 * s * s, 0))); }
    stems.push({ a, out, pts });
    for (let i = 1; i <= 6; i++) nodes.push({ k, i, p: pts[i], out });
  }
  const flowers = nodes.filter((n) => n.i === 3 || (n.i === 5 && n.k % 2 === 0));
  return { stems, flowers };
});

// Begonia foliosa: arching stems with two rows of tiny leaves; small nodding flowers near the tips.
const begLayout = once(() => {
  const r = rng(151), stems = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r() * 0.5, out = V(Math.cos(a), 0, Math.sin(a)), L = 9 + r() * 2.5;
    const pts = [];
    for (let i = 0; i <= 5; i++) { const s = i / 5; pts.push(out.clone().multiplyScalar(0.15 + L * 0.5 * s * s + L * 0.12 * s).add(V(0, L * (1.05 * s - 0.55 * s * s), 0))); }
    stems.push({ a, out, pts, L });
  }
  return { stems };
});

// A point on a polyline at s (0 … 1) and its direction there.
function along(pts, s) {
  const f = clamp(s, 0, 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
  return { p: pts[i].clone().lerp(pts[i + 1], u), t: pts[i + 1].clone().sub(pts[i]).normalize() };
}

// ---------------------------------------------------------------------------------------------------------------------
// Flower heads shared by the cup bromeliads: a ring of short blushing bracts and a nest of small three-petalled flowers.
function blushNest(b, { bracts, blen, bw, spread = 0.55, flowers, ring, fy, plen = 0.35 }) {
  for (let k = 0; k < bracts; k++) {
    const a = (k / bracts) * Math.PI * 2 + 0.2;
    sheet(b, { base: V(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12), dir: V(Math.cos(a) * spread, 1, Math.sin(a) * spread), face: V(-Math.cos(a), 0.4, -Math.sin(a)), len: blen, width: bw, outline: STRAP, nu: 1, rows: [0, 0.5, 1], curl: -0.08, color: (u, t) => M(1, 0.12 * t, 0) });
  }
  for (let f = 0; f < flowers; f++) {
    const a = f === 0 ? 0 : (f / (flowers - 1)) * Math.PI * 2, rr = f === 0 ? 0 : ring;
    const c = V(Math.cos(a) * rr, fy, Math.sin(a) * rr);
    tube(b, [c.clone().add(V(0, -0.35, 0)), c], [0.06, 0.09], { sides: 3, color: (t) => M(0, 0.3 + 0.4 * t, 0.7 - 0.4 * t), sway: () => 0 });
    for (let p = 0; p < 3; p++) {
      const pa = (p / 3) * Math.PI * 2 + f;
      sheet(b, { base: c, dir: V(Math.cos(pa), 0.7, Math.sin(pa)), face: V(-Math.cos(pa) * 0.3, 1, -Math.sin(pa) * 0.3), len: plen, width: plen * 0.75, outline: ROUND, nu: 1, nv: 1, color: (u, t) => M(0, 0.25 + 0.75 * t, 0.75 - 0.75 * t) });
    }
  }
}

// The existing cup bromeliad's bloom (plants.js `bromeliad`, a Neoregelia carolinae type): the heart of the rosette blushes
// and a nest of violet flowers opens in the water of the cup, a few at a time, for months.
export const BROMELIAD_FLOWER = {
  build(b) { blushNest(b, { bracts: 8, blen: 3.8, bw: 1.25, spread: 0.85, flowers: 5, ring: 0.38, fy: 0.45 }); },
  palettes: [
    [0xd4152e, 0x7a5ad0, 0xf6f2f8],     // red blush ('Flandria', the classic)
    [0xe04a86, 0x6a58c8, 0xf6f0f4],     // pink
    [0xa0206a, 0x8060d8, 0xf0f0f8],     // magenta
    [0xe8401c, 0x6a5ac8, 0xf6f0f0],     // orange-red
  ],
  heads(r, grown) { r = warm(r); return grown < 0.6 ? [] : [[0, 0.35, 0, 0, 1, 0, 0.95 + r() * 0.1]]; },
  translucent: 0, daily: null,
  cycle: { budDays: 30, openDays: 120, fadeDays: 30, restDays: 330, season: 'any', minLight: 0.4, minHumidity: 55 },
  after: 'pup',
};

// ---------------------------------------------------------------------------------------------------------------------

export const FLOWERING = {
  masdevallia: {
    name: 'Masdevallia orchid', habitat: 'wall|land', humidity: [70, 100], light: 0.3, size: 12, tall: 0.08, wallTilt: 1.2, wallSpin: 0.4,
    note: 'Cloud-forest orchid: three sepals fused into a bright cup ending in tails. Cool, damp, shaded; on the background or a branch.',
    build() {
      const b = new Builder(), L = masdLayout();
      for (const l of L.leaves) {
        sheet(b, { base: l.base, dir: l.dir, face: V(-Math.cos(l.a), 0.6, -Math.sin(l.a)), len: l.len, width: l.width, outline: ORCHID_LEAF.masdevallia.env, nu: 2, rows: ORCHID_LEAF.masdevallia.rows, cup: 0.4, droop: 0.06, twist: 0.25,
          color: (u, t) => (t < 0.28 ? lc(0x6f7f3c, 0x2f5a26, t / 0.28) : lc(0x2f5a26, 0x3e7330, (t - 0.28) / 0.72)) });
      }
      for (const s of L.stalks) tube(b, s.pts, [0.07, 0.055, 0.04], { sides: 3, color: (t) => lc(0x6a7a3a, 0x7a6a40, t) });
      return b.build();
    },
    get material() { return MASD_MAT(); },
    flower: {
      build(b) {
        // (F5, photos 1-3) A SHORT narrow tube, then three sepals that open almost flat at its mouth (front view): the dorsal a
        // narrow triangle drawn into a long tail straight up; the two laterals broad, spreading out and down and a little
        // forward, joined along the midline over their inner 36 % (one wide kite-shaped blade from the front), the free lobes
        // tapering into tails 1.2-1.4x the blade. Each blade starts just inside the mouth, so tube and blades join without a gap.
        // Colours: blade main (decumana's spots), a throat blotch at each blade's base in the accent, the tails (and a tint of
        // the dorsal) in the centre colour.
        const tl = 0.5, r0 = 0.19, vk = 0.4, al = 0.65, ta = Math.tan(al), ef = 0.36, Ll = 1.35;
        const col = (hood) => (u, v) => {
          const s = v / vk, tail = sstep(0.96, 1.04, s), thr = 0.85 * (1 - sstep(0.06, 0.32, s)) * (1 - tail);
          const h = hood * (1 - tail) * sstep(0.4, 0.95, s), m = (1 - tail) * (1 - thr) * (1 - h);
          return M(m, thr, 1 - m - thr);
        };
        const spine = (len, fwd) => (s) => [r0 + len * s, tl - 0.12 * (1 - s) ** 4 + fwd * s];
        tube(b, [V(0, 0, 0), V(0, tl, 0)], [0.15, 0.22], { sides: 6, color: () => M(0.85, 0.15, 0), sway: () => 0 });
        // dorsal: a narrow cupped triangle, its tail ~1.3x the blade, up and a little forward
        cupSepal(b, { th: 0, len: 1.0, width: 0.7, tail: 1.6, tw: 0.04, nu: 3, rows: [0, 0.14, 0.32, 0.52, 0.74, 1], tRows: 6, vk, spine: spine(1.0, 0.18),
          outline: (s) => 0.34 * (1 - s) * (0.8 + 0.2 * sstep(0, 0.2, s)) * (1 + 0.6 * s * (1 - s)), cupAt: (s) => 0.12 + 0.7 * (1 - sstep(0, 0.3, s)),
          bend: V(0, 0.2, 1).normalize(), hang: 0.12, col: col(0.35) });
        // laterals: each a blade at `al` from straight down; over s < ef its inner margin runs down the midline (half-width =
        // radius x tan al, so the two meet: the fused synsepal), then the free lobe keeps its width a little and tapers to the tail
        const wf = 1.02 * ta * (r0 + Ll * ef);
        const latW = (s) => (s <= ef ? 1.02 * ta * (r0 + Ll * s) : wf * Math.pow(Math.cos((Math.PI / 2) * Math.max(0, s - ef - 0.08) / (0.92 - ef)), 0.85));
        for (const sd of [-1, 1]) cupSepal(b, { th: Math.PI + sd * al, len: Ll, width: 2 * wf, tail: 1.9, tw: 0.04, nu: 4, rows: [0, 0.12, 0.24, 0.36, 0.5, 0.62, 0.75, 0.88, 1], tRows: 6, vk,
          spine: spine(Ll, 0.32), outline: latW, cupAt: (s) => 0.06 + 0.5 * (1 - sstep(0, 0.25, s)), bend: V(-sd * 0.45, 0.35, -1).normalize(), hang: 0.2, col: col(0) });
        // tiny petals and the lip just inside the mouth
        for (const s of [-1, 1]) sheet(b, { base: V(s * 0.07, tl - 0.12, 0.04), dir: V(s * 0.6, 0.6, 0.3), len: 0.26, width: 0.1, nu: 1, nv: 1, color: () => M(0.3, 0.7, 0) });
        sheet(b, { base: V(0, tl - 0.12, -0.07), dir: V(0, 0.7, -0.6), face: V(0, 0.6, 1), len: 0.32, width: 0.16, nu: 1, nv: 1, color: () => M(0, 1, 0) });
      },
      palettes: [
        [0xc2185b, 0x6a0a30, 0x7a0a3a, 0, 1],      // M. coccinea, magenta, dark magenta tails (the common form)
        [0xd8261c, 0x8a1010, 0xa01a14, 0, 1],      // scarlet (M. ignea)
        [0xf06a12, 0x8a2a6a, 0xd85a10, 0, 1],      // orange with purple hairs (M. veitchiana)
        [0xe89ab0, 0x6a0f2a, 0xf0c030, 1, 1],   // M. decumana: pink, densely spotted maroon, yellow tails (photo 1)
        [0xf2e2b0, 0xb0182a, 0xf0d070, 0, 1],      // cream-yellow with a magenta-red throat blotch (photo 2)
        [0xfaf8f2, 0xf0a020, 0xf2c418, 0, 1],      // white with an orange-yellow throat and long yellow tails (photo 3)
      ],
      // One flower on each wiry stem of the body; a young plant does not flower.
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        const S = masdLayout().stalks, n = (r(), S.length);   // every stalk of the body ends in a flower (no bare stalks)
        return S.slice(0, n).map((s) => [s.tip.x, s.tip.y, s.tip.z, s.face.x, s.face.y, s.face.z, 0.88 + r() * 0.12]);
      },
      translucent: 0.3, daily: null,
      cycle: { budDays: 21, openDays: 21, fadeDays: 5, restDays: 120, season: 'any', minLight: 0.2, minHumidity: 70 },
      after: null,
    },
  },

  dracula: {
    name: 'Dracula orchid', habitat: 'wall|land', humidity: [75, 100], light: 0.2, size: 16, tall: 0.08, wallTilt: 1.2, wallSpin: 0.4,
    note: 'The "monkey-face" orchid of misty Andean forests: flowers with long tails hang out of the plant. Cool, wet, shady.',
    build() {
      const b = new Builder(), L = dracLayout();
      for (const l of L.leaves) {
        sheet(b, { base: l.base, dir: l.dir, face: V(-Math.cos(l.a), 0.6, -Math.sin(l.a)), len: l.len, width: l.width, outline: ORCHID_LEAF.dracula.env, nu: 2, rows: ORCHID_LEAF.dracula.rows, cup: 0.4, droop: 0.42,
          color: (u, t) => lc(0x6a8a3c, 0x447a30, sstep(0, 0.25, t)).lerp(new THREE.Color(0x5a8e3a), t * 0.6) });
      }
      for (const s of L.stalks) tube(b, s.pts, [0.07, 0.055, 0.045], { sides: 3, color: (t) => lc(0x5a6a34, 0x6a5a3a, t) });
      return b.build();
    },
    get material() { return DRAC_MAT(); },
    flower: {
      build(b) {
        // Pass 3: three broad sepals joined at the base into a shallow bowl (the dorsal arched forward into a hood, the laterals
        // out and down), each narrowing in a curve into a long tail that hangs; dark bristles on the margins and the hood; a
        // white scallop-shell lip with radiating pink veins below a short column, the two tiny dark petals (the "eyes") beside it.
        // Blade in the main colour (the pattern shows here), pale at its base (centre); tails in the accent.
        const col = (u, t) => { const tail = sstep(0.25, 0.31, t), pale = 0.7 * (1 - sstep(0.01, 0.07, t)); return M((1 - tail) * (1 - pale), tail, (1 - tail) * pale); };
        // Pass 4 (photos 1-3, front view): each sepal a broad ovate blade, joined to its neighbours over the inner third (a
        // shallow notch between them), widest at about 0.4, rounded shoulders tapering over the outer part into the tail.
        const round = (W) => (s) => W * (s < 0.4 ? 0.7 + 0.3 * Math.sin((Math.PI / 2) * s / 0.4) : Math.pow(Math.cos((Math.PI / 2) * (s - 0.4) / 0.6), 0.8));
        const rows = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.88, 1], hair = [];   // (F5: one row less pays for more, longer hairs)
        const lat = (s) => ({ len: 3, width: 2.7, outline: round(1.35), cup: 0.3, tail: 7, tw: 0.1, bend: HEAD_DOWN.clone().add(V(s * 0.35, 0, 0)).normalize(), hang: 0.38 });
        for (const [th, o] of [[0, { len: 2.8, width: 2.4, outline: round(1.2), hood: 0.8, cup: 0.45, tail: 6.6, tw: 0.1, bend: V(0, 0.3, 1).normalize(), hang: 0.3 }], [2.15, lat(1)], [-2.15, lat(-1)]]) {
          const h = cupSepal(b, { th, depth: 0.9, col, rows, tRows: 5, ...o });
          hair.push(...h.margin, ...(th === 0 ? h.face : []));
        }
        bristles(b, hair.slice(0, 24), { len: 0.42, w: 0.05, col: M(0.1, 0.9, 0) });
        for (const s of [-1, 1]) sheet(b, { base: V(s * 0.22, 0.6, 0.3), dir: V(s, 0.7, 0.35), face: V(0, 1, 0), len: 0.4, width: 0.26, nu: 1, nv: 1, cup: 0.3, color: () => M(0.08, 0.84, 0.08) });
        tube(b, [V(0, 0.1, 0.1), V(0, 0.7, 0.3)], [0.1, 0.07], { sides: 3, color: () => M(0.25, 0.05, 0.7), sway: () => 0 });
        tube(b, [V(0, 0.1, -0.05), V(0, 0.8, -0.3)], [0.07, 0.05], { sides: 3, color: () => M(0, 0.05, 0.95), sway: () => 0 });
        shellLip(b, { c: V(0, 0.95, -0.4), axis: V(0, 1, -0.8), w: 0.62, h: 0.52, depth: 0.42,
          segs: 12, col: (i, j) => (i === 0 ? M(0.05, 0.4, 0.55) : j % 2 ? M(0, 0.42, 0.58) : M(0, 0.03, 0.97)) });   // (F5) 6 pink rays
      },
      palettes: [
        [0xf0e6d8, 0x6a1020, 0xfaf4f0, 1, 3],   // D. simia (photo 3): cream, dense maroon spots, maroon tails, white lip
        [0xc07a3c, 0x24101a, 0xf0e8ec, 2, 3],   // D. vampira (photo 1): orange-tan under a black-purple net, black tails
        [0x4a0e1c, 0x2a0810, 0xf4ece8, 0, 3],   // D. hirtzii (photo 2): dark maroon, pale bases, white lip
        [0xd8b890, 0x6a1420, 0xf6eee8, 1, 3],   // D. gigas / bella type: tan, maroon spotted
      ],
      // At the ends of the stems that grow out and down from the plant: the flowers hang and face out.
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        const S = dracLayout().stalks, n = (r(), S.length);   // every stalk of the body ends in a flower (no bare stalks)
        return S.slice(0, n).map((s) => [s.tip.x, s.tip.y, s.tip.z, s.face.x, s.face.y, s.face.z, 0.9 + r() * 0.2]);
      },
      translucent: 0.4, daily: null,
      cycle: { budDays: 30, openDays: 10, fadeDays: 3, restDays: 60, season: 'any', minLight: 0.15, minHumidity: 75 },
      after: null,
    },
  },

  pleurothallis: {
    name: 'Heart-leaf orchid', habitat: 'wall|land', humidity: [70, 100], light: 0.25, size: 18, tall: 0.07, wallTilt: 1.6, wallSpin: 0.35,
    note: 'Pleurothallis: each stem carries one heart-shaped leaf with the small flowers sitting on it. Humid shade.',
    build() {
      const b = new Builder();
      // glossy mid/yellow-green with a pale midrib; some leaves wine-purple (young P. teaguei type), some green with a purple flush
      const TONE = { green: [0x3c6e1e, 0x5e9a2c], wine: [0x543e4e, 0x664a5a], flush: [0x3a681c, 0x5a8c28] };
      for (const s of pleuroLayout().stems) {
        tube(b, [s.p0, s.mid, s.top], [0.06, 0.045, 0.035], { sides: 3, color: (t) => lc(0x8a7a4a, 0x5a7a32, t * 1.4) });
        const [c0, c1] = TONE[s.tone], P = ORCHID_LEAF.pleurothallis;
        sheet(b, { base: s.top, dir: s.dir, face: s.face, len: s.len, width: s.width, outline: P.env, shift: 0.2, nu: 2, rows: P.rows, cup: 0.1, droop: 0.22,
          color: (u, t) => {
            const c = lc(c0, c1, Math.min(1, t * 1.3));
            if (s.tone === 'flush') c.lerp(new THREE.Color(0x664a5a), 0.5 * Math.abs(u));
            return c;
          }, sway: (t) => 0.6 + 0.4 * t });
      }
      return b.build();
    },
    get material() { return PLEURO_MAT(); },
    flower: {
      build(b) {
        // (F3) One fascicle in the leaf notch (photos 3-4): eight tiny flowers on short pedicels from one point, four open and
        // four buds. An open flower (~6 mm) is a deep cup of three concave sepals (the dorsal and the two laterals), the
        // throat in the centre colour, the sepal tips a little accent; a bud is a swollen spindle in the main colour.
        // (F5, photos 1 and 3) four OPEN cups (~9 mm: the sepals spread to 1.35 rad, a paler throat, a tiny dark lip) + three buds
        const FL = [[0.4, 0.42, 0.32, 1], [2.5, 0.45, 0.3, 1], [4.5, 0.45, 0.34, 1], [1.4, 0.1, 0.2, 1],
          [3.5, 0.95, 0.16, 0], [5.6, 0.95, 0.2, 0], [0.9, 1.05, 0.14, 0]];   // [azimuth, tilt, pedicel, open]
        for (const [az, tl, pl, open] of FL) {
          const Y = V(Math.sin(tl) * Math.cos(az), Math.cos(tl), Math.sin(tl) * Math.sin(az)), o = Y.clone().multiplyScalar(pl);
          if (!open) { tube(b, [V(0, 0, 0), o, o.clone().addScaledVector(Y, 0.24)], [0.022, 0.075, 0.015], { sides: 3, color: (t) => M(0.4 + 0.6 * t, 0.6 - 0.6 * t, 0), sway: () => 0 }); continue; }
          tube(b, [V(0, 0, 0), o], [0.022, 0.02], { sides: 3, color: () => M(0.3, 0.7, 0), sway: () => 0 });
          const Z = V(0, 0, 1).addScaledVector(Y, -Y.z); if (Z.lengthSq() < 1e-3) Z.set(1, 0, 0);
          Z.normalize();
          const fr = { o, X: new THREE.Vector3().crossVectors(Y, Z), Y, Z };
          for (const th of [0, 2.15, -2.15]) bellTepal(b, { th, r0: 0.03, len: th ? 0.5 : 0.55, width: th ? 0.48 : 0.42, a0: 0.6, a1: 1.35, base: 0.55, cup: [0.4, 0.1], nu: 2, rows: [0, 0.4, 0.75, 0.97], fr,
            col: (u, t) => { const thr = 0.85 * (1 - sstep(0.15, 0.6, t)), ac = 0.3 * sstep(0.6, 1, t); return M((1 - thr) * (1 - ac), ac, thr); } });
          sheet(b, { base: o.clone().addScaledVector(Y, 0.05), dir: Y.clone().addScaledVector(Z, -1.1), face: Y, len: 0.22, width: 0.1, nu: 1, nv: 1, color: () => M(0, 1, 0) });   // (F5) the tiny lip
        }
      },
      palettes: [
        [0x5e0c22, 0x3a0816, 0x962a44, 0, 1],   // P. cardiothallis: dark wine-maroon (photo 4)
        [0x9a2a5a, 0x5a1030, 0xf0c040, 0, 1],   // purple-red (P. palliolata)
        [0xe8a020, 0x7a3a12, 0xc05a20, 0, 1],   // yellow-orange with brown (photo 1)
        [0x7a3a1a, 0x4a1a10, 0xc89040, 0, 1],   // brown-maroon (P. cordata type, photo 3)
        [0xb8b860, 0x7a3a2a, 0x8a2a3a, 0, 1],   // greenish yellow, brown-striped (P. phyllocardia type)
      ],
      // A fascicle in the notch of most leaves, on the upper face; on one leaf more flowers in a line along the midrib (photo 1).
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        const out = [];
        pleuroLayout().stems.forEach((s, k) => {
          if (r() > 0.6 || out.length >= 7) return;   // (F3) at most 8 notch heads + 6 on the midribs: <= 15
          const p = s.top.clone().addScaledVector(s.dir, 0.08 * s.len).addScaledVector(s.nrm, 0.3), f = s.nrm.clone().addScaledVector(s.dir, 0.4).normalize();
          out.push([p.x, p.y, p.z, f.x, f.y, f.z, 0.9 + r() * 0.2]);
          if (k === 2 || k === 7) for (const t of [0.28, 0.45, 0.62]) { const q = s.top.clone().addScaledVector(s.dir, t * s.len).addScaledVector(s.nrm, 0.22); out.push([q.x, q.y, q.z, s.nrm.x, s.nrm.y, s.nrm.z, 0.7]); }   // (F3) a line along the midrib (photo 1)
        });
        return out;
      },
      translucent: 0.3, daily: null,
      cycle: { budDays: 14, openDays: 14, fadeDays: 4, restDays: 60, season: 'any', minLight: 0.15, minHumidity: 70 },
      after: null,
    },
  },

  lepanthes: {
    name: 'Lepanthes orchid', habitat: 'wall|land', humidity: [80, 100], light: 0.15, size: 4, tall: 0.03, wallTilt: 0.5,
    note: 'A jewel of an orchid a few centimetres tall: round leaves on sheathed stems, flowers smaller than a fingernail. Always wet.',
    build() {
      const b = new Builder();
      for (const s of lepLayout().stems) {
        // the stem's ribbed funnel sheaths: pale rims at each node
        tube(b, [s.p0, s.p0.clone().lerp(s.top, 0.33), s.p0.clone().lerp(s.top, 0.66), s.top], [0.06, 0.07, 0.065, 0.05], { sides: 3, color: (t, k) => (Math.round(t * 3) % 2 ? 0xa89a62 : 0x5a7034) });
        sheet(b, { base: s.top, dir: s.dir, face: UP, len: s.len, width: s.width, outline: OVAL, nu: 2, rows: [0, 0.3, 0.7, 1], cup: 0.1, droop: 0.1,
          color: (u, t) => lc(0x4a6a2c, 0x5a7432, t).lerp(new THREE.Color(0x6a4a2a), 0.25 * Math.abs(u)), sway: (t) => 0.6 + 0.4 * t });
      }
      return b.build();
    },
    material: ORCHID_MAT,
    flower: {
      build(b) {
        // Three broad sepals; the petals split crosswise into two wing-like lobes each side; a tiny bilobed lip.
        for (const th of [0, 2.2, -2.2]) sheet(b, { base: V(Math.sin(th) * 0.04, 0.05, Math.cos(th) * 0.04), dir: V(Math.sin(th), 0.35, Math.cos(th)), face: V(-Math.sin(th) * 0.3, 1, -Math.cos(th) * 0.3), len: 0.4, width: 0.36, outline: OVATE, nu: 1, nv: 2, cup: 0.2, color: (u, t) => M(1, 0, 0.3 * (1 - t)) });
        for (const s of [-1, 1]) sheet(b, { base: V(s * 0.04, 0.09, 0.02), dir: V(s, 0.5, 0.05), len: 0.26, width: 0.38, outline: (t) => 0.5 * Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * t)), 0.4), nu: 2, nv: 1, color: () => M(0, 1, 0) });
        sheet(b, { base: V(0, 0.1, -0.03), dir: V(0, 0.7, -0.3), face: V(0, 0.3, 1), len: 0.15, width: 0.2, outline: ROUND, nu: 1, nv: 1, color: () => M(0, 0.2, 0.8) });
      },
      palettes: [
        [0xd8301a, 0xf0c020, 0x8a1a40],   // L. calodictyon: red and yellow
        [0xf07a10, 0xffd040, 0xc02020],   // L. telipogoniflora: orange, the flower bigger than the leaf
        [0xc02a50, 0xf3a020, 0x6a1030],   // crimson
        [0xe8d020, 0xd04020, 0xa02020],   // yellow with red petals
      ],
      // On the upper face of each leaf, where the short raceme lies.
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        return lepLayout().stems.filter(() => r() < 0.75).map((s) => {
          const p = s.top.clone().addScaledVector(s.dir, 0.45 * s.len).addScaledVector(s.nrm, 0.06), f = s.nrm.clone().addScaledVector(s.dir, 0.3).normalize();
          return [p.x, p.y, p.z, f.x, f.y, f.z, 0.9 + r() * 0.2];
        });
      },
      translucent: 0.5, daily: null,
      cycle: { budDays: 10, openDays: 7, fadeDays: 2, restDays: 20, season: 'any', minLight: 0.1, minHumidity: 80 },
      after: null,
    },
  },

  cuthbertsonii: {
    name: 'Dendrobium cuthbertsonii', habitat: 'wall|land', humidity: [75, 100], light: 0.4, size: 4, tall: 0.03, wallTilt: 0.6, wallSpin: 0.4,
    note: 'A thumb-sized New Guinea orchid whose flowers, bigger than its leaves, last for months. Cool, bright, never dry.',
    build() {
      const b = new Builder(), L = cuthLayout();
      for (const B of L.bulbs) {
        tube(b, [B.p, B.p.clone().addScaledVector(B.lean, B.h * 0.45), B.top], [0.13, 0.2, 0.08], { sides: 3, color: (t) => lc(0x4a3e26, 0x46622c, t * 1.3), sway: () => 0 });
        // lanceolate-elliptic, dark green; some flushed red-brown at the base and margins (the warty dots: leaf texture, T1)
        for (const l of B.leaves) sheet(b, { base: B.top, dir: l.dir, face: UP, len: l.len, width: l.width, outline: ORCHID_LEAF.cuthbertsonii.env, nu: 2, rows: ORCHID_LEAF.cuthbertsonii.rows, cup: 0.3, droop: 0.12,
          color: (u, t) => lc(lc(0x183616, 0x234c22, t), 0x5a2a1c, l.red < 0.45 ? 0.4 * Math.abs(u) + 0.25 * (1 - t) : 0.12 * Math.abs(u)), sway: (t) => 0.3 + 0.7 * t });
      }
      for (const s of L.stalks) tube(b, s.pts, [0.045, 0.035], { sides: 3, color: (t) => lc(0x5a6a30, 0x8a4a3a, t) });
      return b.build();
    },
    get material() { return CUTH_MAT(); },
    flower: {
      build(b) {
        // (F3) A smooth 3D trumpet (photos 1-3). The head's origin is the back of the chin, so a bud folds forward along +Y
        // (nothing behind the origin to swing through the flower). Five broad tepals rise from a narrow tube on the axis
        // (z = ZA) and flare out to rounded tips; the lateral sepals start lower, over a rounded chin (mentum) that runs back
        // and down to the origin; a narrow rolled tongue lip lies in the lower throat, its tip orange-red (centre). Tips
        // accent (the white form's pink tips), the throat the centre colour (cream to orange, never dark).
        const ZA = 0.45, fr = { o: V(0, 0, ZA), X: V(1, 0, 0), Y: V(0, 1, 0), Z: V(0, 0, 1) };
        const tint = (a0) => (u, t) => { const a = a0 * sstep(0.7, 1, t), thr = 0.45 * (1 - sstep(0.05, 0.4, t)); return M((1 - a) * (1 - thr), a, thr); };
        bellTepal(b, { th: 0, y0: 0.8, r0: 0.2, len: 1.9, width: 1.25, a0: 0.18, a1: 1.45, base: 0.5, cup: [0.6, 0.1], fr, col: tint(0.8) });      // dorsal sepal
        for (const s of [-1, 1]) {
          bellTepal(b, { th: s * 1.22, y0: 0.8, r0: 0.2, len: 1.8, width: 1.35, a0: 0.24, a1: 1.5, base: 0.45, cup: [0.55, 0.08], fr, col: tint(0.8) });   // broad petals
          bellTepal(b, { th: s * 2.5, y0: 0.55, r0: 0.3, len: 2.0, width: 1.4, a0: 0.3, a1: 1.4, base: 0.5, cup: [0.6, 0.12], fr, col: tint(0.6) });      // lateral sepals
        }
        // the chin: a rounded sac from the origin (back, below the axis) up into the tube under the lateral sepals
        const ring = (y, z, rx, rz) => Array.from({ length: 5 }, (_, j) => { const q = (j / 5) * Math.PI * 2; return V(Math.cos(q) * rx, y, z + Math.sin(q) * rz); });
        surf(b, [ring(0.02, 0.02, 0.05, 0.05), ring(0.25, 0.1, 0.2, 0.18), ring(0.55, 0.25, 0.3, 0.27), ring(0.88, 0.4, 0.33, 0.3)], { wrap: true, leaf: (i) => [0, 0.05 * i], col: () => M(1, 0, 0), sway: () => 0 });
        // the tongue lip: narrow, rolled, along the lower throat and out of the mouth, its tip orange-red
        bellTepal(b, { th: Math.PI, y0: 0.85, r0: 0.1, len: 1.75, width: 0.42, a0: 0.1, a1: 0.6, base: 0.65, cup: [0.9, 0.5], nu: 2, rows: [0, 0.4, 0.75, 0.97], fr,
          col: (u, t) => { const c = sstep(0.55, 0.92, t); return M(0.25 * (1 - c), 0.75 * (1 - c), c); } });
      },
      // [main, accent (tips, lip), centre (lip tip, throat), 4 SPARKLE: the crystalline sheen]
      palettes: [
        [0xe0221a, 0xf0581c, 0xf5901c, 4, 2],   // scarlet, orange lip (photo 1)
        [0xe878b8, 0xf6e8d2, 0xf08a2a, 4, 2],   // pink with a lavender sheen, cream lip tipped orange (photo 2)
        [0xfaf6f4, 0xf088b0, 0xf05a1e, 4, 2],   // white with pink tips, red-orange lip tip (photo 3)
        [0xf2701a, 0xf8a040, 0xe8401a, 4, 2],   // orange
        [0xf6d424, 0xf8e890, 0xf07a1a, 4, 2],   // yellow
        [0x9a2c8c, 0xf2c83a, 0xf07020, 4, 2],   // purple tipped yellow (bicolour)
      ],
      // (F5) Eight, at the tips of the stalks round the lower front of the clump (cuthLayout), facing out.
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        return cuthLayout().stalks.map((s) => [s.tip.x, s.tip.y, s.tip.z, s.face.x, s.face.y, s.face.z, (0.82 + 0.26 * s.age) * (0.95 + r() * 0.1)]);   // every stalk of the body ends in a flower; younger ones smaller
      },
      translucent: 0.15, daily: null,
      cycle: { budDays: 45, openDays: 150, fadeDays: 10, restDays: 60, season: 'any', minLight: 0.3, minHumidity: 75 },
      after: null,
    },
  },

  neoregelia: {
    name: 'Mini neoregelia', habitat: 'wall|land', humidity: [55, 100], light: 0.5, size: 7, tall: 0.1, wallTilt: 0.8,
    note: 'Miniature tubular bromeliads on runners: tiny cups of water for frogs and tadpoles; the heart blushes when they bloom.',
    phytotelma: true,
    build() {
      const b = new Builder(), { ros } = neoLayout();
      for (const R of ros.slice(1)) tube(b, [V(0, 0.15, 0), ros[0].c.clone().lerp(R.c, 0.5).add(V(0, 0.35, 0)), R.c.clone().add(V(0, 0.15, 0))], [0.09, 0.09, 0.09], { sides: 3, color: 0x7a6a3a, sway: () => 0 });
      for (const R of ros) {
        for (const l of R.leaves) {
          sheet(b, { base: R.c.clone().add(V(Math.cos(l.a) * 0.25 * R.s, 0, Math.sin(l.a) * 0.25 * R.s)), dir: l.dir, face: V(-Math.cos(l.a), 0.3, -Math.sin(l.a)), len: l.len, width: l.width, outline: STRAP, nu: 1, nv: 4, droop: 0.12, twist: l.twist,
            color: (u, t) => (t < 0.3 ? lc(0xa8b47a, 0x3f6e2a, t / 0.3) : lc(0x3f6e2a, 0x7a2a3a, ((t - 0.3) / 0.7) * 0.85)) });
        }
      }
      return b.build();
    },
    material: BROM_MAT,
    flower: {
      build(b) { blushNest(b, { bracts: 6, blen: 3, bw: 0.75, flowers: 3, ring: 0.2, fy: 1.1, plen: 0.3 }); },
      palettes: [
        [0xc8102e, 0x6a4ac8, 0xf4f0f8],   // red blush
        [0xe0407a, 0x5a50c8, 0xf8f0f0],   // pink
        [0x8a1a4a, 0x7060d8, 0xf0f0f0],   // wine purple
        [0xf05a20, 0x6050c0, 0xf8f0e8],   // orange
      ],
      // One in the heart of each rosette (the small ones smaller).
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.6) return [];
        return neoLayout().ros.filter((R, i) => i === 0 || r() < 0.5).map((R) => [R.c.x, R.c.y + 0.5 * R.s, R.c.z, 0, 1, 0, R.s * (0.95 + r() * 0.1)]);
      },
      translucent: 0, daily: null,
      cycle: { budDays: 30, openDays: 90, fadeDays: 30, restDays: 300, season: 'any', minLight: 0.4, minHumidity: 55 },
      after: 'pup',
    },
  },

  guzmania: {
    name: 'Guzmania', habitat: 'wall|land', humidity: [55, 100], light: 0.35, size: 14, tall: 0.14, wallTilt: 0.8,
    note: 'Bromeliad of the Central and South American rainforest: a rosette of glossy leaves and a star of coloured bracts that lasts months.',
    phytotelma: true,
    build() {
      const b = new Builder();
      for (const l of guzLayout().leaves) {
        sheet(b, { base: V(Math.cos(l.a) * 0.3, 0, Math.sin(l.a) * 0.3), dir: l.dir, face: V(-Math.cos(l.a), 0.6, -Math.sin(l.a)), len: l.len, width: l.width, outline: STRAP, nu: l.outer ? 2 : 1, nv: 4, cup: l.outer ? 0.2 : 0, droop: l.droop,
          color: (u, t) => (t < 0.2 ? lc(0xa8b878, 0x3c7a2c, t / 0.2) : lc(0x3c7a2c, 0x5a9a3a, (t - 0.2) / 0.8)) });
      }
      return b.build();
    },
    material: BROM_MAT,
    flower: {
      build(b) {
        // The scape, clothed in bracts, then three whorls of bright bracts in a star, the inner ones shorter and more upright,
        // and the small white flowers peeping out at the top.
        tube(b, [V(0, 0, 0), V(0, 3, 0), V(0, 5.4, 0)], [0.35, 0.3, 0.25], { sides: 4, color: () => M(1, 0, 0), sway: (t) => t * 0.5 });
        for (const [y, n, out, len, w, a0, acc] of [[3.6, 6, 1, 4.4, 1.3, 0, 0], [4.5, 6, 0.8, 3.3, 1.1, 0.5, 0.15], [5.2, 5, 0.45, 2, 0.8, 0.2, 0.35]]) {
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + a0;
            sheet(b, { base: V(Math.cos(a) * 0.25, y, Math.sin(a) * 0.25), dir: V(Math.cos(a) * out, 0.6 + (1 - out), Math.sin(a) * out), face: V(-Math.cos(a), 0.6, -Math.sin(a)), len, width: w, outline: STRAP, nu: 1, rows: [0, 0.5, 1], curl: -0.15 * out,
              color: (u, t) => M(1 - acc - 0.6 * sstep(0.6, 1, t) * (1 - acc), acc + 0.6 * sstep(0.6, 1, t) * (1 - acc), 0) });
          }
        }
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2, c = V(Math.cos(a) * 0.15, 5.2, Math.sin(a) * 0.15);
          tube(b, [c, V(Math.cos(a) * 0.35, 6, Math.sin(a) * 0.35)], [0.1, 0.12], { sides: 3, color: () => M(0, 0, 1) });
        }
      },
      palettes: [
        [0xd01428, 0xe8301a, 0xf6f0c0],   // red (G. lingulata, the wild form)
        [0xf06010, 0xf8a020, 0xf8f0c8],   // orange
        [0xf4c818, 0xf8e040, 0xf8f8e0],   // yellow
        [0xd02070, 0xf05a9a, 0xf8f0f0],   // magenta-pink
        [0xd81828, 0xf4c020, 0xf8f0c0],   // red tipped yellow
      ],
      // In the heart of the rosette. The head includes the scape (the stalk grows only when it blooms).
      heads(r, grown) { r = warm(r); return grown < 0.6 ? [] : [[0, 0.4, 0, 0, 1, 0, 0.95 + r() * 0.1]]; },
      translucent: 0, daily: null,
      cycle: { budDays: 30, openDays: 90, fadeDays: 30, restDays: 330, season: 'any', minLight: 0.3, minHumidity: 60 },
      after: 'pup',
    },
  },

  tillandsia: {
    name: 'Air plant', habitat: 'wall|land', humidity: [40, 95], light: 0.6, size: 5, tall: 0.04, wallTilt: 0.8,
    note: 'Tillandsia ionantha: a silvery rosette that needs no soil, drinking from the air. Blushes red and sends out violet flowers.',
    soilMin: 0,
    build() {
      const b = new Builder();
      for (const l of tillLayout().leaves) {
        sheet(b, { base: V(Math.cos(l.a) * 0.12, 0, Math.sin(l.a) * 0.12), dir: l.dir, face: V(-Math.cos(l.a), 0.4, -Math.sin(l.a)), len: l.len, width: l.width, outline: TRI, nu: 1, nv: 3, curl: 0.22,
          color: (u, t) => (t < 0.3 ? lc(0xc8d0b0, 0x8aa088, t / 0.3) : lc(0x8aa088, 0xa8b8a0, (t - 0.3) / 0.7)) });
      }
      return b.build();
    },
    material: BROM_MAT,
    flower: {
      build(b) {
        // The inner leaves blush; three long tubular violet flowers stand out of the heart, each with its yellow stamens.
        for (let k = 0; k < 8; k++) {
          const a = k * 2.4;
          sheet(b, { base: V(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08), dir: V(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), face: V(-Math.cos(a), 0.4, -Math.sin(a)), len: 2.4, width: 0.5, outline: TRI, nu: 1, rows: [0, 0.5, 1], curl: 0.2, color: () => M(1, 0, 0) });
        }
        for (let f = 0; f < 3; f++) {
          const a = (f / 3) * Math.PI * 2 + 0.4, o = V(Math.cos(a), 0, Math.sin(a));
          const p0 = o.clone().multiplyScalar(0.15).add(V(0, 0.9, 0)), p1 = o.clone().multiplyScalar(0.4).add(V(0, 2.3, 0)), p2 = o.clone().multiplyScalar(0.65).add(V(0, 3.2, 0));
          tube(b, [p0, p1, p2], [0.11, 0.13, 0.15], { sides: 3, color: () => M(0, 1, 0) });
          for (let p = 0; p < 3; p++) {
            const pa = (p / 3) * Math.PI * 2 + f;
            sheet(b, { base: p2, dir: V(Math.cos(pa) + o.x * 0.5, 0.8, Math.sin(pa) + o.z * 0.5), face: UP, len: 0.4, width: 0.25, outline: ROUND, nu: 1, nv: 1, color: () => M(0, 1, 0) });
          }
          tube(b, [p2, p2.clone().addScaledVector(o, 0.15).add(V(0, 0.7, 0))], [0.04, 0.05], { sides: 3, color: () => M(0, 0, 1) });
        }
      },
      palettes: [
        [0xd8243a, 0x6a3ab8, 0xf6e040],   // the type: red blush, violet flowers
        [0xf0301a, 0x7040c0, 0xf8e040],   // 'Fuego', fiery red
        [0xe8d850, 0xf4f4f8, 0xf8e870],   // 'Druid': gold blush, white flowers
        [0xf09a80, 0x7a50c8, 0xf6e050],   // 'Peach'
        [0xe86090, 0x6838b0, 0xf8e050],   // Guatemalan pink
      ],
      heads(r, grown) { r = warm(r); return grown < 0.6 ? [] : [[0, 0.3, 0, 0, 1, 0, 0.95 + r() * 0.1]]; },
      translucent: 0.1, daily: null,
      cycle: { budDays: 14, openDays: 21, fadeDays: 14, restDays: 300, season: 'dry', minLight: 0.5, minHumidity: 40 },
      after: 'pup',
    },
  },

  sinningia: {
    name: 'Miniature sinningia', habitat: 'land|wall', humidity: [60, 100], light: 0.3, size: 4, tall: 0.03, wallTilt: 0.6,
    note: 'Sinningia pusilla and its micro-hybrids: velvety leaves the size of a coin and slipper flowers almost all year. Seeds itself.',
    build() {
      const b = new Builder(), L = sinnLayout();
      for (const l of L.leaves) {
        sheet(b, { base: V(Math.cos(l.a) * 0.15, 0.05, Math.sin(l.a) * 0.15), dir: V(Math.cos(l.a), 0.22, Math.sin(l.a)), face: UP, len: l.len, width: l.width, outline: OVAL, nu: 2, rows: [0, 0.35, 0.7, 1], cup: 0.2, droop: 0.12,
          color: (u, t) => lc(0x3a6a30, 0x4a7a38, t) });
      }
      for (const s of L.stalks) tube(b, s.pts, [0.05, 0.045, 0.04], { sides: 3, color: (t) => lc(0x6a6a3a, 0x8a5a4a, t) });
      return b.build();
    },
    material: DICOT_MAT,
    flower: {
      build(b) {
        // A slipper-shaped corolla tube opening into five rounded lobes (the lower ones larger), lined at the throat.
        tube(b, [V(0, 0, 0), V(0, 0.6, 0.05), V(0, 1.1, 0.08)], [0.12, 0.28, 0.34], { sides: 5, color: (t) => M(1 - 0.35 * t, 0, 0.35 * t), sway: () => 0 });
        for (let k = 0; k < 5; k++) {
          const th = (k / 5) * Math.PI * 2, low = Math.cos(th) < 0;
          sheet(b, { base: V(Math.sin(th) * 0.3, 1.1, 0.08 + Math.cos(th) * 0.3), dir: V(Math.sin(th), 0.25, Math.cos(th)), face: V(-Math.sin(th) * 0.2, 1, -Math.cos(th) * 0.2), len: low ? 0.58 : 0.48, width: 0.55, outline: ROUND, nu: 2, rows: [0, 0.45, 1], cup: 0.1,
            color: (u, t) => { const thr = 1 - sstep(0.1, 0.35, t), line = Math.abs(u) < 0.4 && t < 0.6 ? 0.45 : 0; return M((1 - thr) * (1 - line), line * (1 - thr), thr); } });
        }
      },
      palettes: [
        [0xa880d8, 0x6a3aa0, 0xf6f0f8],   // S. pusilla: lavender, purple lines, white throat
        [0xf8f6f8, 0xe0d0e8, 0xf6e8a0],   // 'White Sprite'
        [0xf080b0, 0xc04080, 0xf8e8f0],   // pink hybrid
        [0x7a2a9a, 0x4a1060, 0xf0e0f0],   // deep purple hybrid
        [0xd02a3a, 0x8a1020, 0xf8e0c0],   // red hybrid
      ],
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        const S = sinnLayout().stalks, n = (r(), S.length);   // every stalk of the body ends in a flower (no bare stalks)
        return S.slice(0, n).map((s) => [s.tip.x, s.tip.y, s.tip.z, s.face.x, s.face.y, s.face.z, 0.9 + r() * 0.2]);
      },
      translucent: 0.5, daily: null,
      cycle: { budDays: 10, openDays: 10, fadeDays: 3, restDays: 10, season: 'any', minLight: 0.2, minHumidity: 60 },
      after: 'seed',
    },
  },

  columnea: {
    name: 'Goldfish vine', habitat: 'wall|land', humidity: [55, 100], light: 0.4, size: 8, tall: 0.12, wallTilt: 0.4,
    note: 'Columnea: an epiphytic trailing gesneriad with small leathery leaves and hooded red-orange flowers that hummingbirds visit.',
    build() {
      const b = new Builder(), { stems } = colLayout();
      for (const s of stems) {
        const side = new THREE.Vector3().crossVectors(UP, s.out).normalize();
        b.ribbon(s.pts, s.pts.map((_, i) => 0.2 - i * 0.015), side, { color: (t) => lc(0x5a4a2a, 0x4a6a2c, t) });
        for (let i = 1; i < s.pts.length; i++) {
          const { p, t: tg } = along(s.pts, i / (s.pts.length - 1)), ll = 1.45 - i * 0.06;
          for (const sd of [-1, 1]) {
            sheet(b, { base: p, dir: side.clone().multiplyScalar(sd).addScaledVector(tg, 0.45).add(V(0, 0.45, 0)), face: UP, len: ll, width: ll * 0.62, outline: OVAL, nu: 1, rows: [0, 0.5, 1], cup: 0.15,
              color: (u, t) => lc(0x284c22, 0x35602a, t), sway: (t) => (i / 6) * (0.8 + 0.2 * t) });
          }
        }
      }
      return b.build();
    },
    material: DICOT_MAT,
    flower: {
      build(b) {
        // A long tube curving up into a hooded upper lip (four lobes fused into a helmet), two side lobes, a narrow lower lobe,
        // and the stamens and style held under the hood.
        tube(b, [V(0, 0, 0), V(0, 1.2, 0.15), V(0, 2.2, 0.35)], [0.12, 0.26, 0.36], { sides: 4, color: (t) => M(1, 0.15 * t, 0), sway: () => 0 });
        sheet(b, { base: V(0, 2.1, 0.3), dir: V(0, 0.8, 0.6), face: V(0, 0.2, -1), len: 1.4, width: 1.1, outline: OVATE, nu: 2, rows: [0, 0.4, 0.75, 1], cup: 0.5, curl: 0.35,
          color: (u, t) => { const s = 0.6 * (1 - sstep(0.1, 0.4, t)) * (1 - Math.abs(u)); return M(1 - s, s, 0); } });
        for (const s of [-1, 1]) sheet(b, { base: V(s * 0.25, 2.15, 0.1), dir: V(s, 0.6, -0.2), len: 0.8, width: 0.45, outline: OVATE, nu: 1, rows: [0, 0.5, 1], color: (u, t) => M(1, 0.2 * (1 - t), 0) });
        sheet(b, { base: V(0, 2.1, -0.15), dir: V(0, 0.55, -1), face: V(0, 1, 0.3), len: 0.75, width: 0.35, outline: OVATE, nu: 1, nv: 2, color: (u, t) => M(0.6 + 0.4 * t, 0.4 * (1 - t), 0) });
        tube(b, [V(0, 1.8, 0.25), V(0, 2.9, 0.65)], [0.04, 0.05], { sides: 3, color: () => M(0, 0, 1) });
      },
      palettes: [
        [0xe0301a, 0xf6c020, 0xf8e080],   // C. microphylla: scarlet, yellow throat
        [0xf88a10, 0xf8d030, 0xfff0a0],   // orange ('Early Bird' type)
        [0xc8141a, 0xe8a020, 0xf0d060],   // deep red (C. gloriosa)
        [0xf0c418, 0xd08010, 0xfff0b0],   // yellow
      ],
      // From the leaf axils along the trailing stems, held out sideways.
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        const F = colLayout().flowers, n = 3 + Math.floor(r() * (F.length - 2));
        return F.slice(0, n).map((f) => { const d = f.out.clone().multiplyScalar(0.85).add(V(0, 0.5, 0)).normalize(); return [f.p.x, f.p.y + 0.15, f.p.z, d.x, d.y, d.z, 0.9 + r() * 0.2]; });
      },
      translucent: 0.3, daily: null,
      cycle: { budDays: 14, openDays: 14, fadeDays: 4, restDays: 45, season: 'any', minLight: 0.35, minHumidity: 60 },
      after: 'berry',
    },
  },

  begonia: {
    name: 'Fern-leaf begonia', habitat: 'land|wall', humidity: [60, 100], light: 0.3, size: 9, tall: 0.1, wallTilt: 0.5,
    note: 'Begonia foliosa: arching stems with two rows of tiny glossy leaves and small nodding flowers, white, pink or red.',
    build() {
      const b = new Builder(), { stems } = begLayout();
      for (const s of stems) {
        const side = new THREE.Vector3().crossVectors(UP, s.out).normalize();
        b.ribbon(s.pts, s.pts.map((_, i) => 0.16 - i * 0.015), side, { color: (t) => lc(0x8a4a3a, 0x6a5a30, t) });
        for (let k = 0; k < 9; k++) {
          const u = 0.12 + (k / 8) * 0.85, { p, t: tg } = along(s.pts, u), sd = k % 2 ? 1 : -1, ll = 1.15 - 0.35 * u;
          sheet(b, { base: p, dir: side.clone().multiplyScalar(sd * 0.9).addScaledVector(tg, 0.55).add(V(0, 0.15, 0)), face: UP, len: ll, width: ll * 0.6, outline: OVATE, nu: 1, rows: [0, 0.5, 1], cup: 0.1,
            color: (uu, t) => lc(0x2f6a2a, 0x3f7a30, t), sway: (t) => u * (0.8 + 0.2 * t) });
        }
      }
      return b.build();
    },
    material: DICOT_MAT,
    flower: {
      build(b) {
        // A male flower: two broad round tepals (top and bottom) and two narrow ones (the sides) around a ball of yellow stamens.
        for (const th of [0, Math.PI]) sheet(b, { base: V(Math.sin(th) * 0.08, 0.1, Math.cos(th) * 0.08), dir: V(Math.sin(th), 0.35, Math.cos(th)), face: V(0, 1, 0), len: 0.65, width: 0.6, outline: ROUND, nu: 2, rows: [0, 0.5, 1], cup: 0.25,
          color: (u, t) => M(1 - 0.35 * Math.abs(u) * t, 0.35 * Math.abs(u) * t, 0) });
        for (const th of [Math.PI / 2, -Math.PI / 2]) sheet(b, { base: V(Math.sin(th) * 0.08, 0.1, 0), dir: V(Math.sin(th), 0.35, 0), face: V(0, 1, 0), len: 0.45, width: 0.28, outline: OVATE, nu: 1, rows: [0, 0.5, 1], color: (u, t) => M(1 - 0.2 * t, 0.2 * t, 0) });
        tube(b, [V(0, 0, 0), V(0, 0.2, 0), V(0, 0.32, 0)], [0.1, 0.17, 0.02], { sides: 4, color: () => M(0, 0, 1), sway: () => 0 });
      },
      palettes: [
        [0xf8f2f0, 0xf0c0cc, 0xf2d020],   // white flushed pink (B. foliosa)
        [0xf2a0b8, 0xe06a90, 0xf2d020],   // pink
        [0xd8203a, 0xa01020, 0xf2d020],   // red (var. miniata, the "fuchsia begonia")
      ],
      // Near the tip of each stem, nodding.
      heads(r, grown) {
        r = warm(r);
        if (grown < 0.5) return [];
        return begLayout().stems.filter(() => r() < 0.85).map((s) => {
          const { p } = along(s.pts, 0.85), d = s.out.clone().multiplyScalar(0.5).add(V(0, -0.8, 0)).normalize();
          return [p.x, p.y - 0.15, p.z, d.x, d.y, d.z, 0.9 + r() * 0.2];
        });
      },
      translucent: 0.6, daily: null,
      cycle: { budDays: 10, openDays: 10, fadeDays: 3, restDays: 20, season: 'any', minLight: 0.25, minHumidity: 60 },
      after: 'seed',
    },
  },
};

// A static preview: the plant's body with its flowers merged in, one copy per colour form side by side along x (or only
// `palette`), all heads open. For the probes (tools/steps/flowering-look.mjs) and the tests, not the game: the flower
// renderer draws the real thing.
export function previewGeometry(def, { palette = null, grown = 1, seed = 5 } = {}) {
  const f = def.flower, body = def.build();
  const head = new Builder();
  f.build(head, rng(seed));
  let hs = [];
  for (let k = 0; k < 12; k++) { const h = f.heads(rng(seed + k), grown); if (h.length > hs.length) hs = h; }      // every head open
  if (!body.boundingBox) body.computeBoundingBox();
  const bb = body.boundingBox, span = Math.max(bb.max.x - bb.min.x, 4) * 1.15;
  const pals = palette == null ? f.palettes.map((_, k) => k) : [palette];
  const out = new Builder();
  const bp = body.attributes.position, bn = body.attributes.normal, bc = body.attributes.color, bs = body.attributes.sway, bl = body.attributes.leaf;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), cols = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  pals.forEach((k, idx) => {
    const off = (idx - (pals.length - 1) / 2) * span;
    for (let i = 0; i < bp.count; i++) {
      out.pos.push(bp.getX(i) + off, bp.getY(i), bp.getZ(i)); out.nor.push(bn.getX(i), bn.getY(i), bn.getZ(i));
      out.col.push(bc.getX(i), bc.getY(i), bc.getZ(i)); out.sway.push(bs.getX(i));
      if (bl) out.leaf.push(bl.getX(i), bl.getY(i)); else out.leaf.push(0, -1);
    }
    f.palettes[k].slice(0, 3).forEach((hex, j) => cols[j].setHex(hex));
    for (const h of hs) {
      const m = headMatrix(h), nm = new THREE.Matrix3().getNormalMatrix(m);
      for (let i = 0; i < head.pos.length / 3; i++) {
        p.set(head.pos[i * 3], head.pos[i * 3 + 1], head.pos[i * 3 + 2]).applyMatrix4(m);
        n.set(head.nor[i * 3], head.nor[i * 3 + 1], head.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
        out.pos.push(p.x + off, p.y, p.z); out.nor.push(n.x, n.y, n.z);
        const w = head.col.slice(i * 3, i * 3 + 3);
        out.col.push(...[0, 1, 2].map((c) => w[0] * cols[0].toArray()[c] + w[1] * cols[1].toArray()[c] + w[2] * cols[2].toArray()[c]));
        out.sway.push(0); out.leaf.push(0, -1);
      }
    }
  });
  return out.build();
}
