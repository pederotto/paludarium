// The muscle layer on a frog's baked model (docs/MUSCLES.md): the mass budget against the scan (body mass from its volume, the
// muscles' volume against each segment's skin volume), and the skin's binding to the visible bellies, `_MUSC` = (slot 0 / 32, slot 1 / 32,
// w0, w1) and `_MUSU` = (u0, u1: where along each belly, 0 … 1), for the shader (render/creatures/skin.js) to swell and slide them.
//
//   node tools/rig/muscles.mjs [id ...]            the budget and the binding's numbers (default: the frogs with a skeleton)
//   node tools/rig/muscles.mjs [id ...] --write    also writes _MUSC/_MUSU into the model (every other accessor checked unchanged)
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { anuranMuscleSet, muscleUnit, ANURAN_WHOLE, MUSCLES_SCHEMA, visibleSlots } from '../../src/content/anuranmuscles.js';
import { bellyRadius, RHO } from '../../src/util/musculo.js';

const DIR = fileURLToPath(new URL('../../public/assets/creatures/', import.meta.url));

// --- geometry -----------------------------------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Volume (cm³) of a closed mesh, and per bone the volume of the fan from the bone's middle over the triangles it owns (its skin).
export function volumes(P, idx, owner, bones) {
  let V = 0;
  const per = new Float64Array(bones.length);
  const mid = bones.map((b) => b.head.map((h, k) => (h + b.tail[k]) / 2));
  for (let t = 0; t < idx.length; t += 3) {
    const a = [P[idx[t] * 3], P[idx[t] * 3 + 1], P[idx[t] * 3 + 2]], b = [P[idx[t + 1] * 3], P[idx[t + 1] * 3 + 1], P[idx[t + 1] * 3 + 2]], c = [P[idx[t + 2] * 3], P[idx[t + 2] * 3 + 1], P[idx[t + 2] * 3 + 2]];
    V += dot(a, cross(b, c)) / 6;
    const o = owner[idx[t]], m = mid[o];
    per[o] += dot(sub(a, m), cross(sub(b, m), sub(c, m))) / 6;
  }
  return { V: Math.abs(V), per: [...per].map(Math.abs) };
}

// Each muscle's mass (g) and its belly at rest: the line its belly lies along (the rest path between belly[0] and belly[1]), its
// length and its radius from its volume.
export function muscleBodies(skel, bodyMassG, W = ANURAN_WHOLE) {
  const set = anuranMuscleSet(skel), hl = bodyMassG * W.hindlimbOfBody.value / 2;      // a side
  return set.map((mu) => {
    const mass = mu.def.seg === 'trunk' ? (bodyMassG * W.longissimus.value / 2) * mu.def.share : hl * W.segOfHindlimb[mu.def.seg] * mu.def.share;   // (the trunk's: its own share of the body, a side)
    const u = muscleUnit(mu, skel, mass, W.sigma.value);
    const pts = mu.pts.map((q) => q.p), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
    const L = cum[cum.length - 1], s0 = mu.def.belly[0] * L, s1 = mu.def.belly[1] * L;
    return { mu, mass, unit: u, pts, cum, L, s0, s1, R: bellyRadius(mass / RHO, s1 - s0) };
  });
}
// The nearest point of a belly's line to p: its distance and where along the belly (0 … 1, unclamped).
function onBelly(m, p) {
  let best = Infinity, s = 0;
  for (let i = 1; i < m.pts.length; i++) {
    const a = m.pts[i - 1], d = sub(m.pts[i], a), L2 = dot(d, d) || 1e-12, k = Math.max(0, Math.min(1, dot(sub(p, a), d) / L2));
    const q = [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k], dd = Math.hypot(...sub(p, q));
    if (dd < best) { best = dd; s = m.cum[i - 1] + k * Math.sqrt(L2); }
  }
  return { d: best, u: (s - m.s0) / (m.s1 - m.s0) };
}

// The binding: a skin vertex takes the visible bellies of its side whose surface it lies over (distance to the belly's line less its
// radius, within `reach` cm), the nearer ones more (`sigma`), only bellies along a bone its skin follows; weights smoothed over the
// mesh `passes` times so neighbouring bellies blend without a seam; the two strongest kept.
export function bindMuscles(P, idx, skinBones, bodies, slots, { reach = 0.12, sigma = 0.03, passes = 6 } = {}) {
  const n = P.length / 3, S = slots.length, W = new Float32Array(n * S), U = new Float32Array(n * S);
  const bySlot = slots.map((k) => bodies.find((b) => `${b.mu.id}${b.mu.side}` === k));
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], own = skinBones[i];
    for (let s = 0; s < S; s++) {
      const m = bySlot[s];
      if (!m || !m.mu.pts.some((q) => own.has(q.bone))) continue;
      const o = onBelly(m, p);
      if (o.u <= 0 || o.u >= 1) continue;
      const gap = o.d - m.R;
      if (gap > reach) continue;
      W[i * S + s] = Math.exp(-Math.max(0, gap) / sigma) * Math.sin(Math.PI * o.u);
      U[i * S + s] = o.u;
    }
  }
  // (neighbours over the mesh's edges, welded by position so seams in the UVs do not cut the blend)
  const key = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`; if (!key.has(k)) key.set(k, i); weld[i] = key.get(k); }
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = weld[idx[t + a]], v = weld[idx[t + b]]; if (u !== v) { nb[u].add(v); nb[v].add(u); } }
  const N = nb.map((x) => [...x]);
  let A = W, B = new Float32Array(n * S);
  for (let it = 0; it < passes; it++) {
    for (let i = 0; i < n; i++) {
      if (weld[i] !== i) continue;
      const L = N[i], k = 1 / (1 + L.length);
      for (let s = 0; s < S; s++) { let v = A[i * S + s]; for (const j of L) v += A[j * S + s]; B[i * S + s] = v * k; }
    }
    for (let i = 0; i < n; i++) if (weld[i] !== i) B.set(B.subarray(weld[i] * S, weld[i] * S + S), i * S);
    [A, B] = [B, A];
  }
  const musc = new Float32Array(n * 4), musu = new Float32Array(n * 4);
  let bound = 0;
  for (let i = 0; i < n; i++) {
    const o = i * S, j = weld[i] * S;
    let s0 = -1, s1 = -1;
    for (let s = 0; s < S; s++) { if (s0 < 0 || A[o + s] > A[o + s0]) { s1 = s0; s0 = s; } else if (s1 < 0 || A[o + s] > A[o + s1]) s1 = s; }
    const w0 = Math.min(1, A[o + s0]), w1 = s1 >= 0 ? Math.min(1 - w0, A[o + s1]) : 0;
    // (u where the vertex itself had none: its welded twin's, else the belly's middle; the weight there is small anyway)
    const u0 = U[o + s0] || U[j + s0] || 0.5, u1 = s1 >= 0 ? U[o + s1] || U[j + s1] || 0.5 : 0.5;
    musc[i * 4] = s0 / 32; musc[i * 4 + 1] = Math.max(0, s1) / 32; musc[i * 4 + 2] = w0 > 1e-3 ? w0 : 0; musc[i * 4 + 3] = w1 > 1e-3 ? w1 : 0;
    musu[i * 4] = u0; musu[i * 4 + 1] = u1;
    // (each belly's rest radius in cm: the shader's displacement is the weight times it; 5 Oct: left out at first, so nothing moved)
    musu[i * 4 + 2] = bySlot[s0]?.R ?? 0; musu[i * 4 + 3] = s1 >= 0 ? bySlot[s1]?.R ?? 0 : 0;
    if (w0 > 0.05) bound++;
  }
  return { musc, musu, bound };
}

// --- the models -------------------------------------------------------------------------------------------------------------------
// A frog's model read for the budget and the binding: its points in cm, triangles, which bones each vertex follows, its volume, its
// body mass, its muscles' bodies and, per leg segment, the muscles' volume against two estimates of the segment's (tests/anuran-
// muscles.test.mjs checks the budget with it). null for a model without bones.
export async function loadFrog(io, man, id) {
  const e = man[id], skel = e.skeleton, file = DIR + e.file;
  const doc = await io.read(file);
  const node = doc.getRoot().listNodes().find((nd) => nd.getMesh()), prim = node.getMesh().listPrimitives()[0];
  const M = node.getWorldMatrix();
  const get = (name) => { const a = prim.getAttribute(name); if (!a) return null; const k = a.getElementSize(), c = a.getCount(), out = new Float32Array(c * k), el = []; for (let i = 0; i < c; i++) { a.getElement(i, el); for (let j = 0; j < k; j++) out[i * k + j] = el[j]; } return out; };
  const P0 = get('POSITION'), n = P0.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const [x, y, z] = [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]; for (let r = 0; r < 3; r++) P[i * 3 + r] = (M[r] * x + M[4 + r] * y + M[8 + r] * z + M[12 + r]) * 100; }
  const idx = prim.getIndices().getArray(), SK = get('_SKIN'), SX = get('_SKINX');
  if (!SK) return null;
  // a vertex's bones: those carrying at least 15 % of its skin; its owner the strongest
  const owner = new Int32Array(n), skinBones = new Array(n);
  for (let i = 0; i < n; i++) {
    const w0 = SK[i * 4 + 2], bs = [SK[i * 4], SK[i * 4 + 1], ...(SX ? [SX[i * 4], SX[i * 4 + 1]] : [])].map((x) => Math.round(x * 32));
    const ws = SX ? [w0, Math.max(0, 1 - w0 - SX[i * 4 + 2] - SX[i * 4 + 3]), SX[i * 4 + 2], SX[i * 4 + 3]] : [w0, 1 - w0];
    let best = 0; for (let k = 1; k < ws.length; k++) if (ws[k] > ws[best]) best = k;
    owner[i] = bs[best]; skinBones[i] = new Set(bs.filter((b, k) => ws[k] >= 0.15));
  }
  const { V, per } = volumes(P, idx, owner, skel.bones);
  const BM = V * ANURAN_WHOLE.density.value, bodies = muscleBodies(skel, BM);
  const segVol = (seg, s) => per[skel.bones.findIndex((b) => b.name === (seg === 'thigh' ? 'thigh' : 'shin') + s)];
  const segs = [];
  for (const seg of ['thigh', 'shank']) for (const s of ['L', 'R']) {
    const mv = bodies.filter((b) => b.mu.side === s && b.mu.def.seg === seg).reduce((t, b) => t + b.mass / RHO, 0), sv = segVol(seg, s);
    const bone = skel.bones.find((x) => x.name === (seg === 'thigh' ? 'thigh' : 'shin') + s), cap = Math.PI * bone.r ** 2 * Math.hypot(...sub(bone.tail, bone.head));
    // two estimates of the segment's volume: the fan over the skin the bone owns (low where the scan fuses the leg to the body) and
    // the capsule of the bone's measured flesh radius
    segs.push({ seg, side: s, muscle: mv, fan: sv, capsule: cap });
  }
  return { doc, prim, P, idx, n, skinBones, skel, file, V, BM, bodies, segs };
}

async function main() {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'));
  const args = process.argv.slice(2), write = args.includes('--write');
  const ids = args.filter((a) => !a.startsWith('--'));
  const list = (ids.length ? ids : Object.keys(man).filter((k) => man[k].skeleton && (man[k].skeleton.plan ?? 'anuran') === 'anuran' && !k.endsWith('.sleep')));
  const slots = visibleSlots();
  console.log(`muscles.mjs MUSCLES_SCHEMA ${MUSCLES_SCHEMA}: ${slots.length} visible slots; body density ${ANURAN_WHOLE.density.value} g/cm3 (${ANURAN_WHOLE.density.tag}), hind-limb muscle ${ANURAN_WHOLE.hindlimbOfBody.value * 100} % of body mass (${ANURAN_WHOLE.hindlimbOfBody.tag})`);
  for (const id of list) {
    const file = DIR + man[id].file;
    const F = await loadFrog(io, man, id);
    if (!F) { console.log(`${id}: no _SKIN, skipped`); continue; }
    const { doc, prim, P, idx, n, skinBones, V, BM, bodies, segs } = F;
    const rows = segs.map((g) => `${g.seg} ${g.side}: muscle ${g.muscle.toFixed(3)} cm3 = ${(100 * g.muscle / g.fan).toFixed(0)} % of skin fan ${g.fan.toFixed(3)}, ${(100 * g.muscle / g.capsule).toFixed(0)} % of capsule ${g.capsule.toFixed(3)}`);
    const bind = bindMuscles(P, idx, skinBones, bodies, slots);
    console.log(`${id}: volume ${V.toFixed(2)} cm3, body ${BM.toFixed(2)} g (guess density), hind-limb muscle ${(BM * ANURAN_WHOLE.hindlimbOfBody.value).toFixed(2)} g | ${rows.join(' | ')} | skin over a belly: ${bind.bound} of ${n} vertices`);
    const thick = bodies.filter((b) => b.mu.side === 'L' && b.mu.def.visible).map((b) => `${b.mu.id} R ${(b.R * 10).toFixed(2)} mm`).join(', ');
    console.log(`  bellies (left, visible): ${thick}`);
    if (write) {
      // the mesh before: every vertex as one record of all its attributes, and every triangle as its three records (meshopt reorders
      // vertices on each write, so the check is on the sets, not the order)
      // (a binding written before is replaced, not compared: with it in the record every rewrite failed the check)
      const sem = prim.listSemantics().filter((k) => k !== '_MUSC' && k !== '_MUSU').sort(), snap = (pr) => {
        const A = sem.map((k) => { const a = pr.getAttribute(k), out = [], el = []; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, el); out.push(el.map((v) => v.toFixed(5)).join(',')); } return out; });
        const rec = A[0].map((_, i) => A.map((x) => x[i]).join('|')), ix = pr.getIndices().getArray(), tri = [];
        for (let t = 0; t < ix.length; t += 3) tri.push([rec[ix[t]], rec[ix[t + 1]], rec[ix[t + 2]]].sort().join('#'));
        return { rec: [...rec].sort().join('\n'), tri: tri.sort().join('\n'), m: JSON.stringify(doc.getRoot().listNodes().find((nd) => nd.getMesh()).getMatrix()) };
      };
      const before = snap(prim);
      const buf = doc.getRoot().listBuffers()[0];
      prim.setAttribute('_MUSC', doc.createAccessor().setType('VEC4').setArray(bind.musc).setBuffer(buf));
      prim.setAttribute('_MUSU', doc.createAccessor().setType('VEC4').setArray(bind.musu).setBuffer(buf));
      doc.getRoot().setExtras({ ...(doc.getRoot().getExtras() ?? {}), musclesSchema: MUSCLES_SCHEMA });
      await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 16, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const tmp = file + '.tmp.glb';
      await io.write(tmp, doc);
      const d2 = await io.read(tmp), p2 = d2.getRoot().listNodes().find((nd) => nd.getMesh()).getMesh().listPrimitives()[0];
      const after = (() => { const keep = p2.listSemantics(); for (const k of keep) if (!sem.includes(k)) p2.setAttribute(k, null); const r = snap(p2); return r; })();
      if (before.rec !== after.rec || before.tri !== after.tri) { fs.unlinkSync(tmp); throw new Error(`${id}: rewriting changed the existing vertices or triangles; not written`); }
      fs.renameSync(tmp, file);
      console.log(`  wrote _MUSC/_MUSU into ${file} (${fs.statSync(file).size} bytes; existing attributes unchanged)`);
    }
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
