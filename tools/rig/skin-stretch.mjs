// How much the runtime skinning stretches a model's skin (render/creatures/skeleton.js + the bake's `_SKIN` binding), on the CPU
// with the shader's arithmetic: per pose, the share of triangles whose longest edge grows past 1.5x and 2x its rest length, and the
// worst one. A fused fold of the scan (a sitting frog's shin pressed on its foot) shows up here as a web. The same poses drawn by
// the vertex rig (render/creatures/instanced.js: the leg's vertices shifted by legT x the foot's offset) for comparison.
//
//   node tools/rig/skin-stretch.mjs [id ...]        (default: every manifest model with a skeleton)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseBones, footOffset, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const DIR = 'public/assets/creatures/';
const man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'));
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = (ids.length ? ids : Object.keys(man).filter((k) => man[k].skeleton && !k.includes(':'))).filter((k) => man[k]?.skeleton);
const POSES = {
  walk: [0, 1, 2, 3, 4, 5].map((i) => ({ phase: (i / 6) * Math.PI * 2, tau: 0, hop: 0, calm: 0, pose: 0 })),
  turn: [0, 1, 2, 3, 4, 5].map((i) => ({ phase: (i / 6) * Math.PI * 2, tau: 1, hop: 0, calm: 0, pose: 0 })),
  hop: [0.3, 0.6, 1].map((h) => ({ phase: 0, tau: 0, hop: h, calm: 1, pose: 0 })),
};
const read = (a) => { const n = a.getCount(), k = a.getElementSize(), out = new Float32Array(n * k), el = []; for (let i = 0; i < n; i++) { a.getElement(i, el); for (let c = 0; c < k; c++) out[i * k + c] = el[c]; } return out; };
for (const id of list) {
  const doc = await io.read(DIR + man[id].file);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = read(prim.getAttribute('POSITION')), S = prim.getAttribute('_SKIN') && read(prim.getAttribute('_SKIN')), idx = prim.getIndices().getArray();
  const RG = read(prim.getAttribute('_RIG'));
  if (!S) { console.log(id, 'no _SKIN'); continue; }
  // (a quantised file keeps its positions normalised, the node's matrix scales them back: applied, then metres to cm, as the game loads it)
  const M = doc.getRoot().listNodes().find((nd) => nd.getMesh())?.getWorldMatrix() ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < P.length; i += 3) { const [x, y, z] = [P[i], P[i + 1], P[i + 2]]; for (let r = 0; r < 3; r++) P[i + r] = (M[r] * x + M[4 + r] * y + M[8 + r] * z + M[12 + r]) * 100; }
  const rig = skeletonRig(man[id].skeleton, { legLift: 0.3, legStride: 0.35, limb: 1, turn: { pz: man[id].skeleton.bones[3].head[2], R: 2.2 } });
  const row = new Float32Array(ROW_FLOATS), n = P.length / 3, Q = new Float32Array(P.length);
  const out = [];
  for (const mode of ['rig', 'skin']) for (const [name, states] of Object.entries(POSES)) {
    let s15 = 0, s20 = 0, worst = 1;
    for (const st of states) {
      poseBones(rig, st, row);
      if (mode === 'rig') {
        // the vertex rig's legs (no turn sweep: tau only mixes it in for the turn; walk and hop as the shader does them)
        for (let i = 0; i < n; i++) {
          const leg = Math.round(RG[i * 4 + 1] * 8), t = RG[i * 4 + 2], hind = leg === 3 || leg === 4, walk = leg >= 1 && leg <= 4;
          const f = walk ? footOffset(rig, leg, P[i * 3] < 0 ? -1 : 1, st.phase, 0, st.calm, st.hop, 0) : null;
          Q[i * 3] = P[i * 3]; Q[i * 3 + 1] = P[i * 3 + 1] + (walk ? t * f.gait[1] : 0) - (hind ? st.hop * t * 0.4 : 0);
          Q[i * 3 + 2] = P[i * 3 + 2] + (walk ? t * f.gait[2] : 0) - (hind ? st.hop * t * 1.6 : 0);
        }
      } else for (let i = 0; i < n; i++) {
        const b0 = Math.round(S[i * 4] * 32), b1 = Math.round(S[i * 4 + 1] * 32), w = S[i * 4 + 2];
        for (let r = 0; r < 3; r++) {
          const k0 = b0 * 12 + r * 4, k1 = b1 * 12 + r * 4;
          const m = (k) => row[k] * P[i * 3] + row[k + 1] * P[i * 3 + 1] + row[k + 2] * P[i * 3 + 2] + row[k + 3];
          Q[i * 3 + r] = w * m(k0) + (1 - w) * m(k1);
        }
      }
      for (let t = 0; t < idx.length; t += 3) {
        let g = 0;
        for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
          const l0 = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) || 1e-6;
          const l1 = Math.hypot(Q[a * 3] - Q[b * 3], Q[a * 3 + 1] - Q[b * 3 + 1], Q[a * 3 + 2] - Q[b * 3 + 2]);
          g = Math.max(g, l1 / l0);
        }
        if (g > 1.5) s15++; if (g > 2) s20++; worst = Math.max(worst, g);
      }
    }
    const T = (idx.length / 3) * states.length;
    out.push(`${mode} ${name}: >1.5x ${((100 * s15) / T).toFixed(2)} %, >2x ${((100 * s20) / T).toFixed(2)} %, worst ${worst.toFixed(1)}x`);
  }
  console.log(`${id} (${n} verts)\n  ${out.join('\n  ')}`);
}
