// B3: fingerprint of the axolotl body (vertex count, bounding box, hash of positions and colours), to prove that
// parametrising axolotlShape left the axolotl unchanged.   node docs/agents/lizards/tools/b3-axo-print.mjs [lo|hi] [id]
import crypto from 'node:crypto';
import { BODIES } from '../../../../src/render/creatures/bodies/index.js';
import { bodyArrays } from '../../../../src/render/creatures/shape.js';
const detail = process.argv[2] ?? 'lo', id = process.argv[3] ?? 'axolotl';
const t0 = Date.now(), a = bodyArrays(BODIES[id](), detail), P = a.position;
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
const h = crypto.createHash('sha256').update(Buffer.from(P.buffer)).update(Buffer.from(new Float32Array(a.color).buffer)).digest('hex').slice(0, 16);
console.log(JSON.stringify({ id, detail, verts: a.verts, tris: a.index.length / 3, lo: lo.map((v) => +v.toFixed(4)), hi: hi.map((v) => +v.toFixed(4)), hash: h, ms: Date.now() - t0 }));
