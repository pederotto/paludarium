import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const load = async (f) => { const d = await io.read(f), p = d.getRoot().listMeshes()[0].listPrimitives()[0], I = p.getIndices().getArray(), g = (nm) => { const a = p.getAttribute(nm); if (!a) return null; const o = [], e = []; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, e); o.push([...e]); } return o; }; return { I, P: g('POSITION'), N: g('NORMAL'), O: g('_ORIG') }; };
const cosOf = (m, X, t) => { const I = m.I, [a, b, c] = [X[I[t]], X[I[t + 1]], X[I[t + 2]]], e1 = b.map((v, k) => v - a[k]), e2 = c.map((v, k) => v - a[k]); const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], vn = [0, 1, 2].map((k) => m.N[I[t]][k] + m.N[I[t + 1]][k] + m.N[I[t + 2]][k]); return { cos: (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2]) / (Math.hypot(...fn) * Math.hypot(...vn) + 1e-15), area: Math.hypot(...fn) / 2 * 1e4 }; };
const A = await load(process.argv[2]), B = await load(process.argv[3]);
const keyO = (m, t) => [0, 1, 2].map((k) => [0, 1, 2].map((q) => ((m.O ?? m.P)[m.I[t + k]][q] * 100).toFixed(2)).join(',')).sort().join('|');
const old = new Set(); let na = 0; for (let t = 0; t < A.I.length; t += 3) if (cosOf(A, A.P, t).cos < 0) { old.add(keyO(A, t)); na++; }
let nb = 0, nn = 0, real = 0; for (let t = 0; t < B.I.length; t += 3) { const r = cosOf(B, B.P, t); if (r.cos >= 0) continue; nb++; if (old.has(keyO(B, t))) continue; nn++; if (r.area > 1e-5 * 1e4 * 0 + 1e-1 * 0 + 0.0001) real++; const c = [0, 1, 2].map((q) => ((B.P[B.I[t]][q] + B.P[B.I[t + 1]][q] + B.P[B.I[t + 2]][q]) / 3 * 100).toFixed(2)); console.log('  new fold at', c.join(','), 'cos', r.cos.toFixed(3), 'area', r.area.toExponential(1), 'cm2'); }
console.log(`  folded: original ${na}, cut ${nb}, new ${nn} (of them larger than 0.01 mm2: ${real})`);
