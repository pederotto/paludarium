// How much the runtime skinning stretches a model's skin (render/creatures/skeleton.js + the bake's `_SKIN` binding), on the CPU
// with the shader's arithmetic: per pose, the share of triangles whose longest edge grows past 1.5x and 2x its rest length, and the
// 95th percentile and the worst one. A fused fold of the scan (a sitting frog's shin pressed on its foot) shows up here as a web. The same poses drawn by
// the vertex rig (render/creatures/instanced.js: the leg's vertices shifted by legT x the foot's offset) for comparison.
//
//   node tools/rig/skin-stretch.mjs [id ...]        (default: every manifest model with a skeleton)
//   --muscles: a model with a muscle binding (_MUSC/_MUSU, tools/rig/muscles.mjs) is also measured with its bellies, as the shader
//   moves them (render/creatures/skin.js skinVertex), at the motion's activations (render/creatures/muscles.js)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseBones, poseStroke, footOffset, ROW_FLOATS, MUSCLE_TEXEL0 } from '../../src/render/creatures/skeleton.js';
import { leapPose, hopLegs } from '../../src/util/gait.js';
import { hopPlan, hopFrame, svlOf } from '../../src/util/hop.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const DIR = process.env.CREATURES ?? 'public/assets/creatures/';          // (CREATURES=<folder with manifest.json and the glb>/ measures a bake made elsewhere)
const man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'));
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--')), MUSC = process.argv.includes('--muscles');
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
  const RG = read(prim.getAttribute('_RIG')), SX = prim.getAttribute('_SKINX') && read(prim.getAttribute('_SKINX'));   // (four bones: SK1)
  const MC = MUSC && prim.getAttribute('_MUSC') && read(prim.getAttribute('_MUSC')), MU = MC && read(prim.getAttribute('_MUSU')), NR = MC && read(prim.getAttribute('NORMAL'));
  if (!S) { console.log(id, 'no _SKIN'); continue; }
  // (a quantised file keeps its positions normalised, the node's matrix scales them back: applied, then metres to cm, as the game loads it)
  const M = doc.getRoot().listNodes().find((nd) => nd.getMesh())?.getWorldMatrix() ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < P.length; i += 3) { const [x, y, z] = [P[i], P[i + 1], P[i + 2]]; for (let r = 0; r < 3; r++) P[i + r] = (M[r] * x + M[4 + r] * y + M[8 + r] * z + M[12 + r]) * 100; }
  const rig = skeletonRig(man[id].skeleton, { legLift: 0.3, legStride: 0.35, limb: 1, turn: { pz: man[id].skeleton.bones[3].head[2], R: 2.2 }, muscles: !!MC });
  // (the swimming body: its stroke, and the hop as the game draws it near the camera, a 3 cm hop: the launch with the feet planted and
  // the flight; util/hop.js, util/gait.js leapPose)
  const drawnHop = (ts) => {
    const B = man[id].skeleton.bones, hip = (sd) => B.find((b) => b.name === 'thigh' + sd).head, pivot = [0, 1, 2].map((i) => (hip('L')[i] + hip('R')[i]) / 2);
    const hop = { d: 3, rise: 0 }; hop.plan = hopPlan(hop, svlOf(1.4, 1), [0.8, 0.9]);
    return ts.map((t) => { const fr = hopFrame(t, hop, 1.4, 1, pivot), st = leapPose(hop.plan, fr.at); st.frames = { f0: hopFrame(0, hop, 1.4, 1, pivot), ft: fr }; return st; });
  };
  const poses = rig.stroke ? { swim: [0, 0.08, 0.16, 0.3, 0.6, 0.8].map((p) => ({ pL: p, pR: p, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.5 })),
    launch: drawnHop([0.05, 0.1, 0.15, 0.2, 0.25, 0.3]), flight: drawnHop([0.4, 0.55, 0.7]) } : POSES;
  // the normals as the bake stored them, in the same frame as the positions (rotation only)
  if (NR) for (let i = 0; i < NR.length; i += 3) { const [x, y, z] = [NR[i], NR[i + 1], NR[i + 2]]; const l = Math.hypot(x, y, z) || 1; NR[i] = x / l; NR[i + 1] = y / l; NR[i + 2] = z / l; }
  const prof = (u) => { const v = Math.sin(Math.PI * Math.min(1, Math.max(0, u))); return v * v; };
  const row = new Float32Array(ROW_FLOATS), n = P.length / 3, Q = new Float32Array(P.length);
  const out = [];
  // the hip: triangles with a vertex held by a thigh and by the pelvis or spine together (each at least 15 %), where the owner saw the
  // skin bunch in the launch (5 Oct, "the hips and first half of the leg")
  const B = man[id].skeleton.bones, isThigh = (b) => /^thigh/.test(B[b]?.name ?? ''), isTrunk = (b) => /^(pelvis|spine)$/.test(B[b]?.name ?? '');
  const hipV = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const w0 = S[i * 4 + 2], bs = [S[i * 4], S[i * 4 + 1], ...(SX ? [SX[i * 4], SX[i * 4 + 1]] : [])].map((x) => Math.round(x * 32));
    const ws = SX ? [w0, Math.max(0, 1 - w0 - SX[i * 4 + 2] - SX[i * 4 + 3]), SX[i * 4 + 2], SX[i * 4 + 3]] : [w0, 1 - w0];
    const on = bs.filter((b, k) => ws[k] >= 0.15);
    hipV[i] = on.some(isThigh) && on.some(isTrunk) ? 1 : 0;
  }
  for (const mode of ['rig', 'skin', ...(MC ? ['muscles'] : [])]) for (const [name, states] of Object.entries(poses)) {
    if (mode === 'rig' && rig.stroke) continue;
    let s15 = 0, s20 = 0, worst = 1, hT = 0, h15 = 0, hPinch = 0, hWorst = 1;
    const G = [];     // every triangle's stretch, for the 95th percentile
    for (const st of states) {
      if (rig.stroke) poseStroke(rig, st, row); else poseBones(rig, st, row);
      if (mode === 'rig') {
        // the vertex rig's legs (no turn sweep: tau only mixes it in for the turn; walk and hop as the shader does them)
        for (let i = 0; i < n; i++) {
          const leg = Math.round(RG[i * 4 + 1] * 8), t = RG[i * 4 + 2], hind = leg === 3 || leg === 4, walk = leg >= 1 && leg <= 4;
          const f = walk ? footOffset(rig, leg, P[i * 3] < 0 ? -1 : 1, st.phase, 0, st.calm, st.hop, 0) : null;
          Q[i * 3] = P[i * 3]; Q[i * 3 + 1] = P[i * 3 + 1] + (walk ? t * f.gait[1] : 0) - (hind ? st.hop * t * 0.4 : 0);
          Q[i * 3 + 2] = P[i * 3 + 2] + (walk ? t * f.gait[2] : 0) - (hind ? st.hop * t * 1.6 : 0);
        }
      } else for (let i = 0; i < n; i++) {
        // (with --muscles: the bellies push the rest skin along its normal first, as skin.js skinVertex does)
        let px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
        if (mode === 'muscles') {
          let d = 0;
          for (const k of [0, 1]) {
            const slot = Math.round(MC[i * 4 + k] * 32), w = MC[i * 4 + 2 + k], R0 = MU[i * 4 + 2 + k], u = MU[i * 4 + k];
            if (!w) continue;
            const q = (MUSCLE_TEXEL0 + slot) * 4;
            d += w * R0 * ((1 + row[q]) * prof(u - row[q + 1]) - prof(u));
          }
          px += NR[i * 3] * d; py += NR[i * 3 + 1] * d; pz += NR[i * 3 + 2] * d;
        }
        const w0 = S[i * 4 + 2], bs = [S[i * 4], S[i * 4 + 1], ...(SX ? [SX[i * 4], SX[i * 4 + 1]] : [])].map((x) => Math.round(x * 32));
        const ws = SX ? [w0, Math.max(0, 1 - w0 - SX[i * 4 + 2] - SX[i * 4 + 3]), SX[i * 4 + 2], SX[i * 4 + 3]] : [w0, 1 - w0];
        for (let r = 0; r < 3; r++) {
          const m = (k) => row[k] * px + row[k + 1] * py + row[k + 2] * pz + row[k + 3];
          Q[i * 3 + r] = bs.reduce((a, b, j) => a + ws[j] * m(b * 12 + r * 4), 0);
        }
      }
      for (let t = 0; t < idx.length; t += 3) {
        let g = 0, c = Infinity;
        for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
          const l0 = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) || 1e-6;
          const l1 = Math.hypot(Q[a * 3] - Q[b * 3], Q[a * 3 + 1] - Q[b * 3 + 1], Q[a * 3 + 2] - Q[b * 3 + 2]);
          g = Math.max(g, l1 / l0); c = Math.min(c, l1 / l0);
        }
        if (g > 1.5) s15++; if (g > 2) s20++; worst = Math.max(worst, g); G.push(g);
        if (hipV[idx[t]] || hipV[idx[t + 1]] || hipV[idx[t + 2]]) { hT++; if (g > 1.5) h15++; if (c < 0.5) hPinch++; hWorst = Math.max(hWorst, g); }
      }
    }
    const T = (idx.length / 3) * states.length;
    G.sort((a, b) => a - b);
    out.push(`${mode} ${name}: >1.5x ${((100 * s15) / T).toFixed(2)} %, >2x ${((100 * s20) / T).toFixed(2)} %, p95 ${G[Math.floor(G.length * 0.95)].toFixed(2)}x, worst ${worst.toFixed(1)}x | hip: >1.5x ${hT ? ((100 * h15) / hT).toFixed(2) : '-'} %, pinched <0.5x ${hT ? ((100 * hPinch) / hT).toFixed(2) : '-'} %, worst ${hWorst.toFixed(1)}x`);
  }
  console.log(`${id} (${n} verts, ${SX ? 4 : 2} bones a vertex)\n  ${out.join('\n  ')}`);
}
