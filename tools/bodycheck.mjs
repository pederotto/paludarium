// Meshes body definitions at both detail levels and prints triangle counts, size, timing and sanity checks
// (no NaN in positions / normals / colours / rig, rig values in range, colours finite and >= 0).
//   node tools/bodycheck.mjs <id> [<id> …]      (no ids: every body)
import { BODIES } from '../src/render/creatures/bodies/index.js';
import { bodyArrays } from '../src/render/creatures/shape.js';

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const keys = ids.length ? ids : Object.keys(BODIES);
let bad = 0;
for (const id of keys) {
  if (!BODIES[id]) { console.log(`${id}: NOT REGISTERED`); bad++; continue; }
  const row = [id.padEnd(16)];
  for (const detail of ['lo', 'hi']) {
    const t = performance.now();
    const def = BODIES[id]();
    const a = bodyArrays(def, detail);
    const ms = performance.now() - t;
    const P = a.position, n = a.verts, tris = a.index.length / 3;
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    const issues = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (!Number.isFinite(v)) { issues.push('pos NaN'); break; } mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v); }
    for (const v of a.normal) if (!Number.isFinite(v)) { issues.push('normal NaN'); break; }
    for (const v of a.color) if (!Number.isFinite(v) || v < 0) { issues.push('colour bad'); break; }
    const legs = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const s = a.rig[i * 4], l = a.rig[i * 4 + 1], lt = a.rig[i * 4 + 2], m = a.rig[i * 4 + 3];
      if (!(s >= 0 && s <= 1)) { issues.push(`spine ${s}`); break; }
      if (!(l >= 0 && l <= 4 && Number.isInteger(l))) { issues.push(`leg ${l}`); break; }
      if (!(lt >= 0 && lt <= 1.0001)) { issues.push(`legT ${lt}`); break; }
      if (!(m >= 0 && m <= 7 && Number.isInteger(m))) { issues.push(`mat ${m}`); break; }
      legs[l]++;
    }
    for (let k = 0; k < 3; k++) { if (mn[k] <= def.lo[k] + 1e-6 || mx[k] >= def.hi[k] - 1e-6) issues.push(`touches box axis ${'xyz'[k]}`); }
    if (issues.length) bad++;
    row.push(`${detail}: ${String(tris).padStart(6)} tris ${String(n).padStart(6)} v ${ms.toFixed(0).padStart(5)} ms`);
    if (detail === 'lo') row.push(`size ${(mx[0] - mn[0]).toFixed(2)} x ${(mx[1] - mn[1]).toFixed(2)} x ${(mx[2] - mn[2]).toFixed(2)} cm  [y ${mn[1].toFixed(2)}..${mx[1].toFixed(2)}] legs ${legs.slice(1).join('/')}`);
    if (issues.length) row.push('ISSUES: ' + [...new Set(issues)].join(', '));
  }
  console.log(row.join(' | '));
}
process.exit(bad ? 1 : 0);
