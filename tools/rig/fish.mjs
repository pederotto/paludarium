// A fish's rig for the baked path (tools/bake-creature.mjs, jobs with rig: 'fish'): a Meshy fish whose texture is a patchwork of charts that
// no decimation can keep (tools/import-creatures.mjs smears it) is re-meshed, unwrapped afresh and painted from the original's texture, as the
// panther crab is. A fish has no legs; what the file must carry is which vertices are a fin's membrane: they get material id 2 (the game
// shades them see-through, lit from behind, with a passive flutter; `finish.finOpacity` says how dense), the rest is skin (job.matId).
// The fins are known from the same model run through art-src/meshy/mark_fins.py, which splits its faces into a "skin" and a "fin" material
// (art-src/meshy/build_fish.sh writes it to art-src/meshy/work/): each vertex takes the kind of the nearest face of that file.
//   rigOpt: { finsFrom: 'art-src/meshy/work/hillloach_fin.glb', finId: 2 }
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export async function fishRig(pos, idx, { finsFrom, finId = 2 } = {}) {
  const n = pos.length / 3;
  const leg = new Uint8Array(n), legT = new Float32Array(n), part = new Array(n).fill('body'), matId = new Uint8Array(n);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k]); hi[k] = Math.max(hi[k], pos[i * 3 + k]); }
  if (finsFrom) {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(finsFrom);
    // centroids of the marked file's faces, with their kind
    const C = [], K = [];
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const isFin = /fin/i.test(p.getMaterial()?.getName() ?? ''), P = p.getAttribute('POSITION').getArray(), I = p.getIndices().getArray();
      for (let t = 0; t < I.length; t += 3) {
        C.push((P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3, (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3, (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3);
        K.push(isFin ? 1 : 0);
      }
    }
    const m = K.length, cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 80;
    const D = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / cell) + 2);
    const cellOf = (x, k) => Math.max(0, Math.min(D[k] - 1, Math.floor((x - lo[k]) / cell)));
    const key = (a, b, c) => (a * D[1] + b) * D[2] + c, grid = new Map();
    for (let t = 0; t < m; t++) { const kk = key(cellOf(C[t * 3], 0), cellOf(C[t * 3 + 1], 1), cellOf(C[t * 3 + 2], 2)); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push(t); }
    const kind = (x, y, z) => {
      const c = [cellOf(x, 0), cellOf(y, 1), cellOf(z, 2)]; let best = -1, bd = Infinity;
      for (let r = 0; r < 10 && !(best >= 0 && bd <= ((r - 1) * cell) ** 2); r++) {
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
          const l = grid.get(key(c[0] + dx, c[1] + dy, c[2] + dz)); if (!l) continue;
          for (const t of l) { const d = (C[t * 3] - x) ** 2 + (C[t * 3 + 1] - y) ** 2 + (C[t * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = t; } }
        }
      }
      return best >= 0 ? K[best] : 0;
    };
    let fins = 0;
    for (let i = 0; i < n; i++) if (kind(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) { matId[i] = finId; part[i] = 'fin'; fins++; }
    console.log(`  fish rig: ${fins} of ${n} vertices are fin membrane (material ${finId})`);
  }
  return { leg, legT, part, matId, length: { z0: lo[2], z1: hi[2], x0: lo[0], x1: hi[0] }, counts: { fish: 1 } };
}
