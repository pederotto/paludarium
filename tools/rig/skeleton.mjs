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

// Bone matrices (THREE.Matrix4, bind frame to posed frame) for a pose of targets.
export function poseMatrices(bones, pose = {}) {
  const P = { ...pose };
  if (pose.mirror) for (const [k, v] of Object.entries(pose)) if (k.endsWith('R') && !(k.slice(0, -1) + 'L' in pose)) P[k.slice(0, -1) + 'L'] = [-v[0], v[1], v[2]];
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const world = new Array(bones.length), rot = new Array(bones.length);
  const done = new Set();
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
      const want = V(P[b.name]).sub(headNow).normalize();
      Rw = new THREE.Quaternion().setFromUnitVectors(dirNow, want).multiply(Rp);
    }
    // M = T(headNow) · Rw · T(-head): the bind head goes to where the parent put it, turned by the bone's world rotation
    world[i] = new THREE.Matrix4().makeTranslation(headNow.x, headNow.y, headNow.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(Rw)).multiply(new THREE.Matrix4().makeTranslation(-head.x, -head.y, -head.z));
    rot[i] = Rw;
    done.add(i);
  };
  for (let i = 0; i < bones.length; i++) solve(i);
  return { world, rot, byName };
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
    { name: 'spine', parent: 'pelvis', head: j.mid, tail: j.chest, limb: 0 },
    { name: 'head', parent: 'spine', head: j.neck, tail: j.snout, limb: 0 },
  ];
  for (const [s, hind, front] of [['L', 3, 1], ['R', 4, 2]]) {
    const J = (k) => j[k + s];
    B.push(
      { name: 'thigh' + s, parent: 'pelvis', head: J('hip'), tail: J('knee'), limb: hind },
      { name: 'shin' + s, parent: 'thigh' + s, head: J('knee'), tail: J('heel'), limb: hind },
      { name: 'foot' + s, parent: 'shin' + s, head: J('heel'), tail: J('ankle'), limb: hind },
      { name: 'toes' + s, parent: 'foot' + s, head: J('ankle'), tail: J('toe'), limb: hind },
      { name: 'arm' + s, parent: 'spine', head: J('shoulder'), tail: J('elbow'), limb: front },
      { name: 'forearm' + s, parent: 'arm' + s, head: J('elbow'), tail: J('wrist'), limb: front },
      { name: 'hand' + s, parent: 'forearm' + s, head: J('wrist'), tail: J('finger'), limb: front },
    );
  }
  return B;
}

// A point moved by a bone's matrix, a direction turned by its rotation (arrays in, arrays out).
export const moveBy = (m, p) => V(p).applyMatrix4(m).toArray();
export const turnBy = (q, d) => V(d).applyQuaternion(q).toArray();
