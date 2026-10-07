// Bakes a lizard's model (art-src/raw/<id>_mesh.glb) into game assets with its skeleton: public/assets/creatures/<id>.glb and
// <id>.lo.glb. The frog bakes are the template (tools/bake-frogpose.mjs, tools/bake-creature.mjs); unlike them the model keeps its own
// UVs and colour texture (it came textured). Steps:
//   1. the original copied in untouched, once (cfg.source -> cfg.raw), then welded
//   2. the joints measured on the mesh (tools/rig/lizard-<id>.mjs), the midline put on x = 0 and the soles on y = 0
//   3. the tail straightened behind the body along its own length (tools/rig/lizard.mjs straightenTail: length and girth as modelled)
//   4. the skin bound to the bones (tools/rig/lizard.mjs bindLizard on tools/rig/skeleton.mjs bindCapsules): `_RIG` and `_SKIN` as the
//      frog's (render/creatures/glb.js), every vertex on two bones whose weights sum to 1
//   5. scaled to the species' real snout-to-vent length (metres in the file, like the frog bakes), the rest in the model's proportions
//   6. simplified to two levels keeping the UVs (meshoptimizer simplifyWithAttributes: the least error that reaches the budget)
//   7. written with the model's 1024 WebP base colour, no metal-rough map, metal 0 / rough 0.6, and the skeleton (cm, the bones' rest
//      axes head -> tail and radius `r`, as the frog's manifest entry) and the measures in the mesh's extras. The manifest entry
//      (CONTRACTS.md "Lizard bone list") is written when the game draws the model with its bones (block B), not here.
//
//   node tools/bake-lizard.mjs [gecko|skink|firesal] [--no-fans]        (--no-fans: the 21-bone list, digits bound to the hand and foot)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { skinFour, SKIN_PASSES } from './rig/skeleton.mjs';
import { fitMouth, addMouth } from './rig/firesal-mouth.mjs';
import { lizardBones, bindLizard, straightenTail, nearestBones, rigAttributes, smoothNormals } from './rig/lizard.mjs';

const OUT = 'public/assets/creatures';
const SPECIES = {
  gecko: async () => { const m = await import('./rig/lizard-gecko.mjs'); return { cfg: m.GECKO, measure: m.measureGecko, readRaw: m.readRaw }; },
  // (the skink's readRaw levels its sloping tail in the side view first: tools/rig/lizard-skink.mjs; nothing else differs here)
  skink: async () => { const m = await import('./rig/lizard-skink.mjs'); return { cfg: m.SKINK, measure: m.measureSkink, readRaw: m.readRaw }; },
  // (R2: the fire salamander's scan has no UVs: painted per vertex by tools/paint/firesal.mjs, the hind knees bent in the bake)
  firesal: async () => { const m = await import('./rig/lizard-firesal.mjs'); return { cfg: m.FIRESAL, measure: m.measureFiresal, readRaw: m.readRaw }; },
};
const args = process.argv.slice(2), fans = !args.includes('--no-fans'), ids = args.filter((a) => !a.startsWith('--'));
await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const r3 = (v) => Math.round(v * 1000) / 1000;

// The least error (of a few) whose simplification reaches the triangle budget, or where it stops getting smaller (the UV seams are
// kept, so a model cut into many UV islands stops above a small budget); `from` maps each kept vertex to its source vertex.
function simplified(pos, uv, idx, targetTris) {
  let out = idx, err = 0, used = 0;
  for (const e of [0.002, 0.005, 0.01, 0.02, 0.04, 0.08]) {
    const [o, r] = uv ? MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uv, 2, [0.5, 0.5], null, Math.floor(targetTris * 3), e, [])
      : MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(targetTris * 3), e, []);
    if (out !== idx && o.length > out.length * 0.98) continue;   // (no smaller: keep the lesser error)
    out = o; err = r; used = e;
    if (out.length / 3 <= targetTris * 1.02) break;
  }
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const from = new Uint32Array(count);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) from[remap[i]] = i;
  return { idx: out, from, err, used };
}

async function writeGlb(file, name, a, tex0, extras) {
  const doc = new Document(), buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  let prim;
  if (a.col) {   // (vertex colours, no texture: a scan without UVs)
    prim = doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', a.pos)).setAttribute('NORMAL', acc('VEC3', a.nor)).setAttribute('COLOR_0', acc('VEC3', a.col))
      .setAttribute('_RIG', acc('VEC4', a.rig)).setAttribute('_SKIN', acc('VEC4', a.skin)).setIndices(acc('SCALAR', a.idx))
      .setMaterial(doc.createMaterial(name).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.6));
  } else {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const tex = doc.createTexture(name).setImage(tex0.getImage()).setMimeType(tex0.getMimeType());
  prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', a.pos)).setAttribute('NORMAL', acc('VEC3', a.nor)).setAttribute('TEXCOORD_0', acc('VEC2', a.uv))
    .setAttribute('_RIG', acc('VEC4', a.rig)).setAttribute('_SKIN', acc('VEC4', a.skin)).setIndices(acc('SCALAR', a.idx))
    .setMaterial(doc.createMaterial(name).setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(0.6));
  }
  if (a.skinx) prim.setAttribute('_SKINX', acc('VEC4', a.skinx));
  doc.createScene().addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim).setExtras(extras)));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeGeneric: 12, ...(a.col ? { quantizeColor: 8 } : {}) }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  return fs.statSync(file).size;
}

for (const id of ids.length ? ids : Object.keys(SPECIES)) {
  const { cfg, measure, readRaw } = await SPECIES[id]();
  const fansS = fans && !cfg.noFans;     // (the fire salamander has no digit fans to peel: its jaw takes the bone slot)
  // 1. the original, copied in untouched (never overwritten)
  if (!fs.existsSync(cfg.raw)) fs.copyFileSync(cfg.source.replace(/^~/, os.homedir()), cfg.raw);
  const raw = await readRaw(cfg.raw), m = measure(raw.pos, cfg, raw.idx), n = raw.pos.length / 3;
  // 2. midline on x = 0, soles on y = 0 (model units)
  const sh = (p) => [p[0] - m.cx, p[1] - m.ySole, p[2]];
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = raw.pos[i * 3] - m.cx; pos[i * 3 + 1] = raw.pos[i * 3 + 1] - m.ySole; pos[i * 3 + 2] = raw.pos[i * 3 + 2]; }
  const J = Object.fromEntries(Object.entries(m.j).map(([k, v]) => [k, k === 'tail' ? v.map(sh) : sh(v)]));
  // 3. the tail: the vertices nearest a tail bone of the curved skeleton, straightened; its joints carried the same way
  const curved = lizardBones(J, { fans: fansS }), near = nearestBones(pos, curved, cfg.radius), sel = new Uint8Array(n);
  for (let i = 0; i < n; i++) sel[i] = curved[near.b[i]].name.startsWith('tail') ? 1 : 0;
  const st = straightenTail(pos, null, { pts: m.line.pts.map(sh), r: m.line.r }, { blend: 0.1, aim: 0 }), P0 = st.pos;
  J.tail = J.tail.map((p) => st.map(p));
  // the real size first (it is needed to place joints given in cm): model units a metre from the snout-to-vent length, origin at the middle of the length
  let zmax = -Infinity, zmin = Infinity;
  for (let i = 0; i < n; i++) { zmax = Math.max(zmax, P0[i * 3 + 2]); zmin = Math.min(zmin, P0[i * 3 + 2]); }
  const k = cfg.svlCm / 100 / (zmax - J.vent[2]), zc = (zmax + zmin) / 2;
  // joints read off the Blender grid views by eye (cfg.jointsCm, the baked frame in cm: x on the midline, soles at y 0): they replace the measured ones
  // (given at the scale of the bake they were read on, cfg.jointsSvlCm: a model baked smaller keeps them in proportion)
  const q = cfg.svlCm / (cfg.jointsSvlCm ?? cfg.svlCm);
  const fromCm = (v) => [(v[0] * q) / (k * 100), (v[1] * q) / (k * 100), (v[2] * q) / (k * 100) + zc];
  if (cfg.jointsCm) for (const [key, v] of Object.entries(cfg.jointsCm)) J[key] = Array.isArray(v[0]) ? v.map(fromCm) : fromCm(v);
  // 3b. girth (cfg.girth = [[t, g], ...], t 0 at the tail tip .. 1 at the snout): the trunk, tail and head slimmed about their own middle line, the limbs
  //     left as they are. The owner (6 Oct): the model is "waay over real": 83 cm3 (grams) against an adult's 16-26 g (56 g the most reported).
  if (cfg.girth) {
    const b0 = lizardBones(J, { fans: fansS }), w0 = bindLizard(P0, b0, raw.idx, { radius: cfg.radius }), axial = new Float32Array(n);
    for (let i = 0; i < n; i++) axial[i] = (b0[w0.idx[i * 2]].limb ? 0 : w0.w[i]) + (b0[w0.idx[i * 2 + 1]].limb ? 0 : 1 - w0.w[i]);
    const NB = 80, T = (z) => (z - zmin) / (zmax - zmin), ex = Array.from({ length: NB }, () => [Infinity, -Infinity, Infinity, -Infinity]);
    for (let i = 0; i < n; i++) if (axial[i] > 0.9) {
      const e = ex[Math.min(NB - 1, Math.max(0, Math.floor(T(P0[i * 3 + 2]) * NB)))];
      e[0] = Math.min(e[0], P0[i * 3]); e[1] = Math.max(e[1], P0[i * 3]); e[2] = Math.min(e[2], P0[i * 3 + 1]); e[3] = Math.max(e[3], P0[i * 3 + 1]);
    }
    const mid = ex.map((e) => (e[1] >= e[0] ? [(e[0] + e[1]) / 2, (e[2] + e[3]) / 2] : null));
    for (let b = 0; b < NB; b++) if (!mid[b]) { let d = 1; while (!mid[b] && d < NB) { mid[b] = mid[b - d] ?? mid[b + d] ?? null; d++; } }
    const C = mid.map((m, b) => [0, 1].map((c) => { let a = 0, t = 0; for (let d = -2; d <= 2; d++) { const m2 = mid[Math.min(NB - 1, Math.max(0, b + d))]; a += m2[c]; t++; } return a / t; }));
    const prof = (t) => { const G = cfg.girth; if (t <= G[0][0]) return G[0][1]; for (let g = 1; g < G.length; g++) if (t <= G[g][0]) return G[g - 1][1] + (G[g][1] - G[g - 1][1]) * (t - G[g - 1][0]) / (G[g][0] - G[g - 1][0]); return G[G.length - 1][1]; };
    const warp = (x, y, z, wgt) => {
      const t = T(z), f = Math.min(NB - 1.001, Math.max(0, t * NB - 0.5)), b = Math.floor(f), u = f - b;
      const cx = C[b][0] * (1 - u) + C[b + 1][0] * u, cy = C[b][1] * (1 - u) + C[b + 1][1] * u, s = 1 - wgt * (1 - prof(t));
      return [cx + (x - cx) * s, cy + (y - cy) * s, z];
    };
    for (let i = 0; i < n; i++) { const w = warp(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2], Math.min(1, axial[i])); P0[i * 3] = w[0]; P0[i * 3 + 1] = w[1]; }
    const AX = ['sacrum', 'mid', 'chest', 'nape', 'snout', 'vent', 'shoulderL', 'shoulderR', 'hipL', 'hipR'];
    for (const key of AX) if (J[key]) J[key] = warp(J[key][0], J[key][1], J[key][2], 1);
    J.tail = J.tail.map((p) => warp(p[0], p[1], p[2], 1));
    console.log(JSON.stringify({ girth: cfg.girth.length, axialVerts: axial.reduce((a, v) => a + (v > 0.9 ? 1 : 0), 0) }));
  }
  // 4. bones and binding
  const bones = lizardBones(J, { fans: fansS }), bind = bindLizard(P0, bones, raw.idx, { radius: cfg.radius });
  const { rig, skin } = rigAttributes(P0, bind, zmax, zmin);
  // 5. real size (k and zc above)
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { P[i * 3] = P0[i * 3] * k; P[i * 3 + 1] = P0[i * 3 + 1] * k; P[i * 3 + 2] = (P0[i * 3 + 2] - zc) * k; }
  const nor = smoothNormals(P, raw.idx), cm = (p) => [r3(p[0] * k * 100), r3(p[1] * k * 100), r3((p[2] - zc) * k * 100)];
  const rad = (b) => cfg.radius[b.name] ?? cfg.radius[b.name.replace(/[LR]$/, '')] ?? 0.05;
  const held = new Array(bones.length).fill(0);
  for (let i = 0; i < n; i++) held[bind.idx[i * 2]]++;
  let xmin = Infinity, xmax = -Infinity, ymax = 0;
  for (let i = 0; i < n; i++) { xmin = Math.min(xmin, P[i * 3]); xmax = Math.max(xmax, P[i * 3]); ymax = Math.max(ymax, P[i * 3 + 1]); }
  const mouth = cfg.mouth && !args.includes('--no-mouth') ? fitMouth(P, (zmax - zc) * k, cfg.mouth) : null;      // (the lip surface and hinge from the full mesh, shared by both levels)
  const skeleton = {
    plan: 'lizard', units: 'cm', fans: fansS,
    ...(cfg.species ? { species: cfg.species } : {}),     // a species with its own gait and muscle numbers (the runtime falls back to the gecko's)
    bones: bones.map((b) => ({ name: b.name, parent: b.parent, head: cm(b.head), tail: cm(b.tail), limb: b.limb, r: r3(rad(b) * k * 100) }))
      .concat(mouth ? [{ name: 'jaw', parent: 'head', head: mouth.hinge.map((v) => r3(v * 100)), tail: mouth.chin.map((v) => r3(v * 100)), limb: 0, r: cfg.mouth.jawR ?? 0.5 }] : []),
    joints: Object.fromEntries(Object.entries(J).map(([key, v]) => [key, key === 'tail' ? v.map(cm) : cm(v)])),
  };
  const measures = {
    svlCm: r3((zmax - J.vent[2]) * k * 100), totalCm: r3((zmax - zmin) * k * 100), tailCm: r3((J.vent[2] - zmin) * k * 100),
    sizeCm: [r3((xmax - xmin) * 100), r3(ymax * 100), r3((zmax - zmin) * k * 100)], modelRatio: r3(m.svl / m.total),
    ...(m.legReach ? { restLegs: m.legReach(m.restJ, k * 100), legs: m.legReach(J, k * 100), bend: m.bend, tailLevel: raw.level } : {}),
    asymPct: m.asym, vertsPerBone: Object.fromEntries(bones.map((b, i) => [b.name, held[i]])),
  };
  // (no UVs: per-vertex paint in the frame of tools/bake-creature.mjs build(): cm, u snout 0 ... tail 1, h, s, the legs by position)
  let col = null;
  if (!raw.uv && cfg.paint) {
    const { paint } = await import(`./paint/${cfg.paint}.mjs`);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i*3]); x1 = Math.max(x1, P[i*3]); y0 = Math.min(y0, P[i*3+1]); y1 = Math.max(y1, P[i*3+1]); z0 = Math.min(z0, P[i*3+2]); z1 = Math.max(z1, P[i*3+2]); }
    const hw = Math.max(x1, -x0), zmid = (z0 + z1) / 2, xFrac = 0.32, yFrac = 0.62;
    col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const h = (P[i*3+1] - y0) / (y1 - y0), s = Math.abs(P[i*3]) / hw, isLeg = cfg.legs && s > xFrac && h < yFrac;
      const leg = isLeg ? (P[i*3+2] > zmid ? 1 : 3) + (P[i*3] > 0 ? 1 : 0) : 0, legT = isLeg ? Math.min(1, (s - xFrac) / (1 - xFrac)) : 0;
      const c = paint({ u: (z1 - P[i*3+2]) / (z1 - z0), x: P[i*3] * 100, y: P[i*3+1] * 100, z: P[i*3+2] * 100, s, h, leg, legT, n: [nor[i*3], nor[i*3+1], nor[i*3+2]] });
      col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
    }
  }
  // 6-7. two levels of detail
  const tex0 = raw.uv ? raw.doc.getRoot().listMaterials()[0].getBaseColorTexture() : null, report = { id, ...measures, levels: {} };
  for (const [level, target] of [['hi', cfg.tris[0]], ['lo', cfg.tris[1]]]) {
    const g = simplified(P, raw.uv, raw.idx, target), c = g.from.length;
    const a = { idx: g.idx, pos: new Float32Array(c * 3), nor: new Float32Array(c * 3), uv: new Float32Array(c * 2), rig: new Float32Array(c * 4), skin: new Float32Array(c * 4) };
    if (col) { a.col = new Float32Array(c * 3); for (let i = 0; i < c; i++) for (let q = 0; q < 3; q++) a.col[i * 3 + q] = col[g.from[i] * 3 + q]; }
    for (let i = 0; i < c; i++) {
      const o = g.from[i];
      for (let q = 0; q < 3; q++) { a.pos[i * 3 + q] = P[o * 3 + q]; a.nor[i * 3 + q] = nor[o * 3 + q]; }
      if (raw.uv) for (let q = 0; q < 2; q++) a.uv[i * 2 + q] = raw.uv[o * 2 + q];
      for (let q = 0; q < 4; q++) { a.rig[i * 4 + q] = rig[o * 4 + q]; a.skin[i * 4 + q] = skin[o * 4 + q]; }
    }
    ({ skin: a.skin, skinx: a.skinx } = skinFour(a.pos, a.idx, a.skin, SKIN_PASSES[id] ?? SKIN_PASSES.lizard));   // (SK1: four bones a vertex)
    const A = mouth ? addMouth(a, mouth, bones.length) : a;
    if (mouth) report.levels[level + 'Mouth'] = A.info;
    const file = path.join(OUT, level === 'hi' ? `${id}.glb` : `${id}.lo.glb`);
    const bytes = await writeGlb(file, id, A, tex0, { skeleton, measures });
    report.levels[level] = { tris: A.idx.length / 3, verts: c, error: +g.err.toFixed(4), bound: g.used, kb: Math.round(bytes / 1024) };
  }
  console.log(JSON.stringify(report));
}
