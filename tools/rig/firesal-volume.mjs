// Volume of the baked fire salamander (cm^3 = grams at the density of water, about 1.0-1.05 for a salamander) and its main extents, to test its size
// against the real animal (total 14-25 cm, common field 14-17 cm; weight 16-26 g on average, 56 g at most).
//   node tools/rig/firesal-volume.mjs [plain glb]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const glb = process.argv[2] ?? '../firesal/blender/firesal_hi.glb';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glb);
const node = doc.getRoot().listNodes().find((n) => n.getMesh()), s = node.getScale(), t = node.getTranslation();
const prim = node.getMesh().listPrimitives()[0], pos = prim.getAttribute('POSITION'), idx = prim.getIndices().getArray();
const P = []; for (let i = 0; i < pos.getCount(); i++) { const v = pos.getElement(i, []); P.push([(v[0] * s[0] + t[0]) * 100, (v[1] * s[1] + t[1]) * 100, (v[2] * s[2] + t[2]) * 100]); }
let V = 0, A = 0;
for (let i = 0; i < idx.length; i += 3) { const a = P[idx[i]], b = P[idx[i + 1]], c = P[idx[i + 2]]; V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
// boundary edges (open mesh makes the volume unreliable)
const E = new Map(); for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) { const a = idx[i + e], b = idx[i + (e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a; E.set(k, (E.get(k) ?? 0) + 1); }
const open = [...E.values()].filter((c) => c !== 2).length;
// trunk section between the girdles (z 0.8 .. 4.8 cm): width, depth, and the area of the cross-section by slices of the convex-ish extents
const trunk = P.filter((p) => p[2] > 0.8 && p[2] < 4.8 && Math.abs(p[0]) < 2.2);
const mm = (S, k) => [Math.min(...S.map((p) => p[k])), Math.max(...S.map((p) => p[k]))];
const [x0, x1] = mm(trunk, 0), [y0, y1] = mm(trunk, 1);
console.log(JSON.stringify({ volumeCm3: +Math.abs(V).toFixed(1), openEdges: open, totalLenCm: +(mm(P, 2)[1] - mm(P, 2)[0]).toFixed(2), trunkWidthCm: +(x1 - x0).toFixed(2), trunkDepthCm: +(y1 - y0).toFixed(2), heightCm: +(mm(P, 1)[1] - mm(P, 1)[0]).toFixed(2) }));
for (const L of [14, 16, 17, 18.77, 20]) console.log(`uniform scale to ${L} cm: volume ${(Math.abs(V) * (L / (mm(P, 2)[1] - mm(P, 2)[0])) ** 3).toFixed(1)} cm3`);
