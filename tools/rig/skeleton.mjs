// A skeleton for a scanned animal (tools/bake-creature.mjs jobs with `skeleton`): bones measured on the scan, the skin bound to
// them, and poses made by turning the joints, so a pose bends the body where the real animal bends instead of moving vertices by
// a guess. Every new animal is to be built this way (the project's rule: bones, then muscles and skin on top).
//
//   bones     [{ name, parent, head: [x, y, z], tail: [x, y, z], limb }], in the scan's units after rotY (the frame the rig is
//             made in). `head` is the joint the bone turns about; `limb` the leg id of the rig (0: a bone of the body).
//   bind      bindSkin(pos, bones, rig): up to four bones per vertex, weighted by distance to each bone (soft at the joints).
//             A limb's skin only binds to that limb's bones and, close to the body, to the bone the limb hangs from; the
//             body's skin only to the body's bones. So a hand never pulls the chest along, nor a thigh the flank beside it.
//   pose      { bone: [x, y, z] } where the bone's tail should point to (in the same frame, the animal in its scan pose): each
//             bone is turned, by the shortest arc, so it points from its (posed) head toward the target; its length is kept.
//             Bones not named keep their scan direction relative to their parent. `mirror: true` copies every named bone of
//             one side (suffix 'R', x > 0) to the other ('L', x mirrored) unless that one is named too.
//   skin      skin(pos, nor, bind, mats): linear blend skinning of positions and normals.
import * as THREE from 'three';
import { PLANS, jointLimit, limitDir, bendAngle, muscleBulge } from '../../src/util/bodyplan.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function segDist(p, h, t) {
  const ux = t[0] - h[0], uy = t[1] - h[1], uz = t[2] - h[2], L2 = ux * ux + uy * uy + uz * uz || 1e-12;
  const k = Math.max(0, Math.min(1, ((p[0] - h[0]) * ux + (p[1] - h[1]) * uy + (p[2] - h[2]) * uz) / L2));
  return Math.hypot(p[0] - h[0] - ux * k, p[1] - h[1] - uy * k, p[2] - h[2] - uz * k);
}

// sigma: how wide the blend across a joint is (scan units). attachT: how far down a limb (legT) its skin may still follow the
// body bone it hangs from.
export function bindSkin(pos, bones, rig, { sigma = 0.05, attachT = 0.12 } = {}) {
  const n = pos.length / 3, idx = new Uint8Array(n * 4), w = new Float32Array(n * 4);
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const bodyBones = bones.map((b, i) => (b.limb ? -1 : i)).filter((i) => i >= 0);
  const limbBones = {};
  for (const [i, b] of bones.entries()) if (b.limb) (limbBones[b.limb] ??= []).push(i);
  // the body bone each limb hangs from: the parent of its first bone
  const attach = {};
  for (const [l, list] of Object.entries(limbBones)) { const first = list.find((i) => !bones[byName[bones[i].parent]]?.limb); attach[l] = byName[bones[first].parent]; }
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = pos[i * 3]; p[1] = pos[i * 3 + 1]; p[2] = pos[i * 3 + 2];
    const l = rig.leg[i];
    let cand = l && limbBones[l] ? [...limbBones[l]] : bodyBones;
    if (l && limbBones[l] && rig.legT[i] < attachT && attach[l] != null) cand = [...cand, attach[l]];
    const d = cand.map((b) => segDist(p, bones[b].head, bones[b].tail));
    const dmin = Math.min(...d);
    const ws = cand.map((b, k) => [b, Math.exp(-(d[k] - dmin) / sigma)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((s, x) => s + x[1], 0);
    for (let k = 0; k < 4; k++) { idx[i * 4 + k] = ws[k]?.[0] ?? 0; w[i * 4 + k] = ws[k] ? ws[k][1] / sum : 0; }
  }
  return { idx, w };
}

// The binding the game skins with at run time (render/creatures/skin.js): TWO bones a vertex (enough for limbs, half the shader
// cost of four), each bone a capsule of radius `r` (scan units, `radius` by bone name without the side suffix): a vertex goes to the
// bones whose surface it is nearest (distance to the bone less its radius), blended over `sigma` across a joint. A limb bone only
// takes vertices on its own side (L: x < 0, R: x > 0); where the rig is sure a vertex is a hand or a foot (legT past `distalT`)
// only that limb's bones. Unlike bindSkin it does not trust the rig's body / limb split near the body: on a sitting frog's scan
// the folded thigh lies against the flank and the rig's segmentation of that lobe is patchy, which would tear the leg from the
// body as it moves. The second bone is always one across a joint from the first (its parent or a child): where the scan's folds
// press unrelated parts together (a sitting frog's foot under its thigh), a vertex blended between them would be left halfway as
// they part, a web of stretched skin. (A limb's root bone may pair with any body bone.) Returns { idx: Uint8Array(n * 2), w: Float32Array(n) } (the first bone's weight; the second
// has 1 - w).
// `tris` + `smooth` (iterations): the weights are then smoothed over the mesh's edges, so where the scan's folds fuse parts that move
// apart (the frog's heel against its vent), the skin between them stretches over a band instead of tearing along one row of
// triangles.
export function bindCapsules(pos, bones, { radius = {}, rig = null, sigma = 0.025, distalT = 0.3, mid = 0.02, tris = null, smooth = 0 } = {}) {
  const n = pos.length / 3, idx = new Uint8Array(n * 2), w = new Float32Array(n);
  const side = bones.map((b) => (!b.limb ? 0 : /L$/.test(b.name) ? -1 : 1));
  const rad = bones.map((b) => radius[b.name] ?? radius[b.name.replace(/[LR]$/, '')] ?? 0.05);
  const byLimb = {};
  for (const [i, b] of bones.entries()) if (b.limb) (byLimb[b.limb] ??= []).push(i);
  const p = [0, 0, 0], d = new Float32Array(bones.length);
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const par = bones.map((b) => (b.parent != null ? byName[b.parent] ?? -1 : -1));
  // (a limb's root bone may blend with any body bone: the flank beside a thigh, the chest beside an arm)
  const root = bones.map((b, i) => !!b.limb && !bones[par[i]]?.limb);
  const adj = (a, b) => par[a] === b || par[b] === a || (root[a] && !bones[b].limb) || (root[b] && !bones[a].limb);
  for (let i = 0; i < n; i++) {
    p[0] = pos[i * 3]; p[1] = pos[i * 3 + 1]; p[2] = pos[i * 3 + 2];
    const s = p[0] < -mid ? -1 : p[0] > mid ? 1 : 0;
    const l = rig?.leg?.[i], sure = l && byLimb[l] && rig.legT[i] > distalT;
    // (past half way down the limb not its first bone either, and on its last part (the hand or foot) only the hand's or foot's
    // bones: a sitting frog's toes lie under its thigh and knee)
    const far = !sure ? 0 : rig.legT[i] > 0.6 ? 2 : rig.legT[i] > 0.5 ? 1 : 0;
    let b0 = -1, b1 = -1;
    for (let b = 0; b < bones.length; b++) {
      d[b] = Infinity;
      if (sure ? bones[b].limb !== l || byLimb[l].indexOf(b) < far : side[b] && side[b] !== s) continue;
      d[b] = segDist(p, bones[b].head, bones[b].tail) - rad[b];
      if (b0 < 0 || d[b] < d[b0]) b0 = b;
    }
    for (let b = 0; b < bones.length; b++) if (d[b] < Infinity && adj(b, b0) && (b1 < 0 || d[b] < d[b1])) b1 = b;
    if (b1 < 0) b1 = b0;
    const e = Math.exp(-(d[b1] - d[b0]) / sigma);
    idx[i * 2] = b0; idx[i * 2 + 1] = b1; w[i] = b1 === b0 ? 1 : 1 / (1 + e);
  }
  if (!tris || !smooth) return { idx, w };
  // smoothing: full weight vectors, averaged with the neighbours' (half and half) `smooth` times, then the two strongest bones that
  // share a joint again
  const nb = bones.length, W = new Float32Array(n * nb), W2 = new Float32Array(n * nb);
  for (let i = 0; i < n; i++) { W[i * nb + idx[i * 2]] += w[i]; W[i * nb + idx[i * 2 + 1]] += 1 - w[i]; }
  const nbr = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) for (const [a, b] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) { nbr[a].add(b); nbr[b].add(a); }
  const N = nbr.map((S) => [...S]);
  for (let it = 0; it < smooth; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * nb, k = N[i].length;
      for (let b = 0; b < nb; b++) W2[o + b] = W[o + b] * 0.5;
      if (!k) { for (let b = 0; b < nb; b++) W2[o + b] = W[o + b]; continue; }
      for (const j of N[i]) for (let b = 0; b < nb; b++) W2[o + b] += (W[j * nb + b] * 0.5) / k;
    }
    W.set(W2);
  }
  for (let i = 0; i < n; i++) {
    const o = i * nb, s = pos[i * 3] < -mid ? -1 : pos[i * 3] > mid ? 1 : 0;
    const l = rig?.leg?.[i], sure = l && byLimb[l] && rig.legT[i] > distalT, far = !sure ? 0 : rig.legT[i] > 0.6 ? 2 : rig.legT[i] > 0.5 ? 1 : 0;
    const ok = (b) => (sure ? bones[b].limb === l && byLimb[l].indexOf(b) >= far : !side[b] || side[b] === s);
    for (let b = 0; b < nb; b++) if (!ok(b)) W[o + b] = 0;
    let b0 = -1, b1 = -1;
    for (let b = 0; b < nb; b++) { if (!ok(b)) continue; if (b0 < 0 || W[o + b] > W[o + b0]) b0 = b; }
    for (let b = 0; b < nb; b++) if (b !== b0 && adj(b, b0) && (b1 < 0 || W[o + b] > W[o + b1])) b1 = b;
    const w0 = W[o + b0], w1 = b1 >= 0 ? W[o + b1] : 0;
    idx[i * 2] = b0; idx[i * 2 + 1] = b1 >= 0 && w1 > 0 ? b1 : b0; w[i] = w1 > 0 ? w0 / (w0 + w1) : 1;
  }
  return { idx, w };
}

// Four bones a vertex (SK1, owner 5 Oct): a level's two-bone `_SKIN` (bone 0 / 32, bone 1 / 32, bone 0's weight) diffused over that
// level's mesh `passes` times (vertices welded by position, so UV seams do not cut the band), then the four strongest bones. The
// wider band lets the skin at the groin, armpit and knee follow the girdle's turn instead of tearing along one row (skin-stretch:
// gecko walk at a 2.87 cm stride 0.87 -> 0.47 %, dart frog walk 1.51 -> 0.25 %, hop 7.4 -> 3.3 %). Returns the new `_SKIN`
// (bone 0 / 32, bone 1 / 32, w0, w1: an old two-bone reader still finds its strongest bone) and `_SKINX` (bone 2 / 32, bone 3 / 32,
// w2, w3; the four sum to 1), both in 0 … 1 so the 12-bit quantization keeps them. SKIN_PASSES: per body plan.
// (the skink keeps its two bones: 0 passes leaves the binding as it was; it stretched 0.03 % already and four bones moved its
// resting body 0.8 mm)
// The swimming bodies too (bake-frogpose.mjs): their gliding pose is far from the bind pose and moved 1.6-6 mm with four bones.
export const SKIN_PASSES = { anuran: 120, lizard: 40, skink: 0, swim: 0 };
export function skinFour(pos, tris, sk, passes) {
  const n = pos.length / 3, NB = 32;
  let W = new Float32Array(n * NB), W2 = new Float32Array(n * NB);
  for (let i = 0; i < n; i++) { const w = sk[i * 4 + 2]; W[i * NB + Math.round(sk[i * 4] * 32)] += w; W[i * NB + Math.round(sk[i * 4 + 1] * 32)] += 1 - w; }
  const key = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = `${pos[i * 3].toFixed(6)},${pos[i * 3 + 1].toFixed(6)},${pos[i * 3 + 2].toFixed(6)}`; if (!key.has(k)) key.set(k, i); weld[i] = key.get(k); }
  const nbr = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = weld[tris[t + a]], v = weld[tris[t + b]]; if (u !== v) { nbr[u].add(v); nbr[v].add(u); } }
  const N = nbr.map((s) => [...s]);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      if (weld[i] !== i) continue;
      const o = i * NB, L = N[i], k = 1 / (1 + L.length);
      for (let b = 0; b < NB; b++) { let s = W[o + b]; for (const j of L) s += W[j * NB + b]; W2[o + b] = s * k; }
    }
    for (let i = 0; i < n; i++) if (weld[i] !== i) W2.set(W2.subarray(weld[i] * NB, weld[i] * NB + NB), i * NB);
    [W, W2] = [W2, W];
  }
  const skin = new Float32Array(n * 4), skinx = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * NB, top = [...Array(NB).keys()].sort((a, b) => W[o + b] - W[o + a] || a - b).slice(0, 4);
    const s = top.reduce((a, b) => a + W[o + b], 0) || 1, w = top.map((b) => W[o + b] / s);
    for (let j = 1; j < 4; j++) if (w[j] <= 0) top[j] = top[0];
    skin[i * 4] = top[0] / 32; skin[i * 4 + 1] = top[1] / 32; skin[i * 4 + 2] = w[0]; skin[i * 4 + 3] = w[1];
    skinx[i * 4] = top[2] / 32; skinx[i * 4 + 1] = top[3] / 32; skinx[i * 4 + 2] = w[2]; skinx[i * 4 + 3] = w[3];
  }
  return { skin, skinx };
}

// Joints carried into the baked frame (cm, after the bake's centring, scaling and the species' `warp`): a joint moves as the skin
// around it moved (the mean displacement of the `k` vertices nearest it), so a warped species' bones still sit inside its limbs.
// `from` / `to` are the same vertices before (scan units) and after (cm).
export function carryJoints(joints, from, to, k = 24) {
  const n = from.length / 3, out = {};
  for (const [name, J] of Object.entries(joints)) {
    const best = [];
    for (let i = 0; i < n; i++) {
      const dd = (from[i * 3] - J[0]) ** 2 + (from[i * 3 + 1] - J[1]) ** 2 + (from[i * 3 + 2] - J[2]) ** 2;
      if (best.length < k) { best.push([dd, i]); best.sort((a, b) => a[0] - b[0]); } else if (dd < best[k - 1][0]) { best[k - 1] = [dd, i]; best.sort((a, b) => a[0] - b[0]); }
    }
    // the scale between the two frames from the same vertices' spread (uniform: centring and scaling to cm)
    let sx = 0, sy = 0, sz = 0, tx = 0, ty = 0, tz = 0;
    for (const [, i] of best) { sx += from[i * 3]; sy += from[i * 3 + 1]; sz += from[i * 3 + 2]; tx += to[i * 3]; ty += to[i * 3 + 1]; tz += to[i * 3 + 2]; }
    const m = best.length, c0 = [sx / m, sy / m, sz / m], c1 = [tx / m, ty / m, tz / m];
    out[name] = [c0, c1];
  }
  // one scale for all (from the spread of the whole mesh), then each joint keeps its offset from its neighbours' centre
  let a = 0, b = 0;
  const m0 = [0, 0, 0], m1 = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { m0[c] += from[i * 3 + c] / n; m1[c] += to[i * 3 + c] / n; }
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { a += (from[i * 3 + c] - m0[c]) ** 2; b += (to[i * 3 + c] - m1[c]) ** 2; }
  const scale = Math.sqrt(b / a);
  const res = {};
  for (const [name, [c0, c1]] of Object.entries(out)) res[name] = [0, 1, 2].map((c) => +(c1[c] + (joints[name][c] - c0[c]) * scale).toFixed(4));
  return res;
}

// Bone matrices (THREE.Matrix4, bind frame to posed frame) for a pose of targets. `plan` (a body plan of src/util/bodyplan.js, by
// name) keeps every joint inside its anatomical range: a target that would bend a joint further than the animal can is brought
// back to the limit (in the plane of the bone and its parent), and the bone's name is listed in `clamped`.
export function poseMatrices(bones, pose = {}, { plan = null } = {}) {
  const P = { ...pose };
  if (pose.mirror) for (const [k, v] of Object.entries(pose)) if (k.endsWith('R') && !(k.slice(0, -1) + 'L' in pose)) P[k.slice(0, -1) + 'L'] = [-v[0], v[1], v[2]];
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const world = new Array(bones.length), rot = new Array(bones.length);
  const done = new Set(), clamped = [];
  const solve = (i) => {
    if (done.has(i)) return;
    const b = bones[i], pi = b.parent != null ? byName[b.parent] : null;
    if (pi != null) solve(pi);
    const Mp = pi != null ? world[pi] : new THREE.Matrix4(), Rp = pi != null ? rot[pi] : new THREE.Quaternion();
    const head = V(b.head), tail = V(b.tail);
    // the bone as its parent carries it: where its head is now and which way it points
    const headNow = head.clone().applyMatrix4(Mp), dirNow = tail.clone().sub(head).normalize().applyQuaternion(Rp);
    let Rw = Rp.clone();
    if (P[b.name]) {
      let want = V(P[b.name]).sub(headNow).normalize();
      const lim = plan && pi != null ? jointLimit(plan, b.name) : null;
      if (lim) {
        const pb = bones[pi], pd = V(pb.tail).sub(V(pb.head)).applyQuaternion(rot[pi]);
        const arr = want.toArray(), w2 = limitDir(pd.toArray(), arr, lim);
        if (w2 !== arr) { want = V(w2).normalize(); clamped.push(b.name); }
      }
      Rw = new THREE.Quaternion().setFromUnitVectors(dirNow, want).multiply(Rp);
    }
    // M = T(headNow) · Rw · T(-head): the bind head goes to where the parent put it, turned by the bone's world rotation
    world[i] = new THREE.Matrix4().makeTranslation(headNow.x, headNow.y, headNow.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(Rw)).multiply(new THREE.Matrix4().makeTranslation(-head.x, -head.y, -head.z));
    rot[i] = Rw;
    done.add(i);
  };
  for (let i = 0; i < bones.length; i++) solve(i);
  return { world, rot, byName, clamped };
}

// The bend of every joint in a pose (degrees between a bone and its parent, as bodyplan.js limits them): { bone: angle }.
export function poseAngles(bones, mats) {
  const out = {};
  const dir = (i) => V(bones[i].tail).sub(V(bones[i].head)).applyQuaternion(mats.rot[i]).toArray();
  for (const [i, b] of bones.entries()) if (b.parent != null) out[b.name] = bendAngle(dir(mats.byName[b.parent]), dir(i));
  return out;
}

// Muscles on a posed skin (bodyplan.js `muscles`): each belly swells along the posed normal as its joint bends, on the vertices
// bound mostly to its bone, between its `from` and `to` along the bone. `pos`/`nor` the skinned arrays (changed in place),
// `rest` the bind positions, `bind` from bindSkin. Returns how many vertices moved.
export function applyMuscles(pos, nor, rest, bind, bones, mats, plan) {
  const P = typeof plan === 'string' ? PLANS[plan] : plan;
  if (!P?.muscles?.length) return 0;
  const ang = poseAngles(bones, mats);
  let moved = 0;
  for (const m of P.muscles) {
    if (!m.gain || !m.joint) continue;
    for (const s of ['', 'L', 'R']) {
      const bi = mats.byName[m.bone + s], jb = m.joint + s;
      if (bi == null || ang[jb] == null) continue;
      const b = bones[bi], L = Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]) || 1;
      const lim = jointLimit(P, jb);
      for (let i = 0; i < rest.length / 3; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (bind.idx[i * 4 + k] === bi) w += bind.w[i * 4 + k];
        if (w < 0.5) continue;
        const t = ((rest[i * 3] - b.head[0]) * (b.tail[0] - b.head[0]) + (rest[i * 3 + 1] - b.head[1]) * (b.tail[1] - b.head[1]) + (rest[i * 3 + 2] - b.head[2]) * (b.tail[2] - b.head[2])) / (L * L);
        const d = muscleBulge(m, ang[jb], lim, t) * L * w;
        if (!d) continue;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] += nor[i * 3 + k] * d;
        moved++;
      }
    }
  }
  return moved;
}

export function skin(pos, nor, bind, mats) {
  const n = pos.length / 3, P = new Float32Array(pos.length), N = new Float32Array(pos.length);
  const e = mats.world.map((m) => m.elements);
  const r = mats.rot.map((q) => new THREE.Matrix4().makeRotationFromQuaternion(q).elements);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    let X = 0, Y = 0, Z = 0, A = 0, B = 0, C = 0;
    for (let k = 0; k < 4; k++) {
      const wk = bind.w[i * 4 + k];
      if (!wk) continue;
      const m = e[bind.idx[i * 4 + k]], q = r[bind.idx[i * 4 + k]];
      X += wk * (m[0] * x + m[4] * y + m[8] * z + m[12]); Y += wk * (m[1] * x + m[5] * y + m[9] * z + m[13]); Z += wk * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      A += wk * (q[0] * nx + q[4] * ny + q[8] * nz); B += wk * (q[1] * nx + q[5] * ny + q[9] * nz); C += wk * (q[2] * nx + q[6] * ny + q[10] * nz);
    }
    const l = Math.hypot(A, B, C) || 1;
    P[i * 3] = X; P[i * 3 + 1] = Y; P[i * 3 + 2] = Z; N[i * 3] = A / l; N[i * 3 + 1] = B / l; N[i * 3 + 2] = C / l;
  }
  return { pos: P, nor: N };
}

// A frog's bones from its joints (scan units): pelvis, spine and head along the body; per side (L x < 0, R x > 0) thigh, shin,
// foot and toes (hind legs, rig ids 3 / 4) and upper arm, forearm and hand (front legs, 1 / 2).
export function frogBones(j) {
  const B = [
    { name: 'pelvis', parent: null, head: j.vent, tail: j.mid, limb: 0 },
    { name: 'spine', parent: 'pelvis', head: j.mid, tail: j.mid2 ?? j.chest, limb: 0 },
    ...(j.mid2 ? [{ name: 'spineB', parent: 'spine', head: j.mid2, tail: j.chest, limb: 0 }] : []),   // (T4: the trunk split in two, the swim toad's 18th bone; head and arms hang from it)
    { name: 'head', parent: j.mid2 ? 'spineB' : 'spine', head: j.neck, tail: j.snout, limb: 0 },
  ];
  for (const [s, hind, front] of [['L', 3, 1], ['R', 4, 2]]) {
    const J = (k) => j[k + s];
    B.push(
      { name: 'thigh' + s, parent: 'pelvis', head: J('hip'), tail: J('knee'), limb: hind },
      { name: 'shin' + s, parent: 'thigh' + s, head: J('knee'), tail: J('heel'), limb: hind },
      { name: 'foot' + s, parent: 'shin' + s, head: J('heel'), tail: J('ankle'), limb: hind },
      { name: 'toes' + s, parent: 'foot' + s, head: J('ankle'), tail: J('toe'), limb: hind },
      { name: 'arm' + s, parent: j.mid2 ? 'spineB' : 'spine', head: J('shoulder'), tail: J('elbow'), limb: front },
      { name: 'forearm' + s, parent: 'arm' + s, head: J('elbow'), tail: J('wrist'), limb: front },
      { name: 'hand' + s, parent: 'forearm' + s, head: J('wrist'), tail: J('finger'), limb: front },
    );
  }
  return B;
}

// T4: the share of the old spine's weight that goes to spineB at a vertex, by its place t along the old spine (0 at its head 'mid', 1 at
// its tail 'chest'): a linear ramp, 1 in front, 0 behind, over +-0.198 of t about t = 0.5 (the owner's Blender test: the toad's spine is
// 1.26 cm, split at 0.51 cm, ramp +-0.25 cm: 0.25 / 1.26 = 0.198).
export const SPLIT_T = 0.5, SPLIT_HALF = 0.198;
export const spineRamp = (t) => Math.min(1, Math.max(0, (t - SPLIT_T) / (2 * SPLIT_HALF) + 0.5));

// A point moved by a bone's matrix, a direction turned by its rotation (arrays in, arrays out).
export const moveBy = (m, p) => V(p).applyMatrix4(m).toArray();
export const turnBy = (q, d) => V(d).applyQuaternion(q).toArray();
