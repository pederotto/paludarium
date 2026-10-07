// Measures guppy bodies against their targets (docs/GENETICS_SPEC.md "guppy" table): standard length, body depth, stalk depth, eye,
// tail length and spread, as fractions of SL. Reads the low mesh's vertices by material (skin vs fin): numbers, not a render.
//   node tools/steps/guppy-measure.mjs [look …]
import { BODIES } from '../../src/render/creatures/bodies/index.js';
import { bodyArrays } from '../../src/render/creatures/shape.js';
import { parseGuppyLook } from '../../src/content/guppy.js';

const looks = process.argv.slice(2).length ? process.argv.slice(2) : ['red', 'red_round', 'red_doublesword', 'blue_lyre', 'female_red', 'female_red_gravid', 'juv'];
const rows = [];
for (const look of looks) {
  const def = BODIES[`guppy:${look}`]();
  const a = bodyArrays(def, 'lo');
  const P = a.position, R = a.rig, n = a.verts;
  let zMax = -1e9, zMin = 1e9;
  for (let i = 0; i < n; i++) { zMax = Math.max(zMax, P[i * 3 + 2]); zMin = Math.min(zMin, P[i * 3 + 2]); }
  // body skin vertices (material 0) by z slice: depth = max y - min y
  const slices = new Map();
  for (let i = 0; i < n; i++) {
    if (Math.round(R[i * 4 + 3]) !== 0) continue;
    const k = Math.round(P[i * 3 + 2] / 0.05);
    const s = slices.get(k) ?? [1e9, -1e9]; s[0] = Math.min(s[0], P[i * 3 + 1]); s[1] = Math.max(s[1], P[i * 3 + 1]); slices.set(k, s);
  }
  const p = parseGuppyLook(look), SL = p.sex === 'male' ? 2.2 : 3.2;
  const zs = zMax, zRoot = zs - SL;
  let depth = 0, stalk = 1e9;
  for (const [k, [lo, hi]] of slices) {
    const z = k * 0.05, s = (zs - z) / SL;
    if (s > 0.25 && s < 0.42) depth = Math.max(depth, hi - lo);
    if (s > 0.85 && s < 0.97) stalk = Math.min(stalk, hi - lo);
  }
  // tail: fin vertices behind the root
  let tLen = 0, tH = 0;
  for (let i = 0; i < n; i++) if (P[i * 3 + 2] < zRoot - 0.05) { tLen = Math.max(tLen, zRoot - P[i * 3 + 2]); tH = Math.max(tH, Math.abs(P[i * 3 + 1])); }
  const eye = def.finish.eyes[0];
  rows.push({ look, SL, total: +(zMax - zMin).toFixed(2), depthPct: +(100 * depth / SL).toFixed(1), stalkPct: +(100 * stalk / SL).toFixed(1), eyePct: +(100 * 2 * eye.r / SL).toFixed(1), tailLenPct: +(100 * tLen / SL).toFixed(0), tailHeightPct: +(100 * 2 * tH / SL).toFixed(0), verts: n });
}
console.table(rows);
