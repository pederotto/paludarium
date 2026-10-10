// The Mexican dwarf crayfish's rig, baked from the owner's Meshy model (tools/bake-creature.mjs, job "cambarellus"). The crayfish moves with the
// shrimp rig of render/creatures/instanced.js (the `invert` rig, species with `shrimp: true`): leg 15 / 16 the two big claws (they dip to the ground
// and carry food to the mouth, and pinch: finish.claws, tools/rig/claws.mjs), 1 … 4 the walking legs (left 1, 3, 1; right 2, 4, 2: neighbours out of
// phase), 7 / 8 the antennae and the horn-like antennules, 0 the carapace, abdomen and eyes; the tail fan (the uropods and telson) is `part: 'tail'`
// and the tail flick curls the whole abdomen about `curl` (a crayfish's escape: the abdomen snaps under). Labelled by the model's own pieces: its
// claws, legs, antennae and tail fan are each a separate connected piece next to the body (tools/rig/pieces.mjs).
// Scan units, head +z, up +y, outward winding. opt: { tailZ (a piece centred behind this is the tail fan), junction (the carapace / abdomen joint, z) }.
import { pieces, rootAndReach } from './pieces.mjs';

export function meshycrayRig(pos, idx, opt = {}) {
  const n = pos.length / 3, tailZ = opt.tailZ ?? -0.38;
  const P = pieces(pos, idx), main = P.list[0], M = main.tris;           // (piece sizes are shares of the body's: the model may have been subdivided)
  const leg = new Uint8Array(n), legT = new Float32Array(n), part = new Array(n).fill('body');
  const near = main.v;
  const claws = [], legs = [], ants = [], tail = [];
  for (const pc of P.list.slice(1)) {
    if (pc.tris < 0.01 * M) continue;
    if (pc.c[2] < tailZ) tail.push(pc);
    else if (pc.tris >= 0.25 * M) claws.push(pc);                   // the two biggest loose pieces
    else if (pc.c[1] < -0.06 && pc.tris >= 0.08 * M) legs.push(pc);  // low, a tenth of the body
    else ants.push(pc);                                             // thin and high: antennae, antennules, eye stalks
  }
  if (claws.length !== 2) throw new Error(`cray rig: expected 2 claws, found ${claws.length}`);
  for (const pc of claws) {
    const id = pc.c[0] < 0 ? 15 : 16, { d, reach } = rootAndReach(pos, idx, pc, near);
    for (const i of pc.v) { leg[i] = id; legT[i] = (d.get(i) ?? 0) / reach; part[i] = 'claw'; }
  }
  for (const left of [true, false]) {
    const side = legs.filter((pc) => (pc.c[0] < 0) === left).sort((a, b) => b.c[2] - a.c[2]);
    side.forEach((pc, i) => {
      const id = left ? (i % 2 ? 3 : 1) : (i % 2 ? 4 : 2), { d, reach } = rootAndReach(pos, idx, pc, near);
      for (const v of pc.v) { leg[v] = id; legT[v] = (d.get(v) ?? 0) / reach; part[v] = 'leg'; }
    });
  }
  for (const pc of ants) {
    const id = pc.c[0] < 0 ? 7 : 8, { d, reach } = rootAndReach(pos, idx, pc, near);
    for (const v of pc.v) { leg[v] = id; legT[v] = (d.get(v) ?? 0) / reach * 0.4; part[v] = 'antenna'; }
  }
  for (const pc of tail) for (const v of pc.v) part[v] = 'tail';
  // Extent of the body (carapace, abdomen, tail fan: the length is measured without claws and antennae).
  const bodyIds = [...main.v, ...tail.flatMap((pc) => pc.v)];
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const i of bodyIds) {
    bx0 = Math.min(bx0, pos[i * 3]); bx1 = Math.max(bx1, pos[i * 3]); by0 = Math.min(by0, pos[i * 3 + 1]); by1 = Math.max(by1, pos[i * 3 + 1]);
    bz0 = Math.min(bz0, pos[i * 3 + 2]); bz1 = Math.max(bz1, pos[i * 3 + 2]);
  }
  const L = bz1 - bz0, H = by1 - by0, jz = opt.junction ?? -0.15;
  // The legs sprawl like a spider's on the model; a crayfish carries them more under it: drawn in toward the midline, most at the tips.
  for (let i = 0; i < n; i++) if (part[i] === 'leg') pos[i * 3] *= 1 - 0.18 * Math.min(1, legT[i] * 1.4);
  const curl = { z0: jz, y0: by0 + 0.35 * H, len: jz - bz0 };
  // The model's tail fan (the telson and the two uropods) stands up on end, its plates about 50 degrees from the horizontal; a crayfish carries it flat,
  // spread behind the abdomen. The bake turns the fan about the abdomen's tip after painting (`post`), so the colour is still read from where the
  // fan is on the original: about the x axis through the abdomen's last rings, `fanTurn` degrees (the plates' normal comes to point up).
  let mz0 = 1e9; for (const i of main.v) mz0 = Math.min(mz0, pos[i * 3 + 2]);
  const tip = main.v.filter((i) => pos[i * 3 + 2] < mz0 + 0.06);          // (the abdomen's last rings: it curves down, the fan hangs from its end)
  const pivot = [tip.reduce((s, i) => s + pos[i * 3 + 1], 0) / tip.length, tip.reduce((s, i) => s + pos[i * 3 + 2], 0) / tip.length];
  const post = tail.length ? { part: 'tail', pivot, angle: (opt.fanTurn ?? 45) * Math.PI / 180 } : null;
  return { leg, legT, part, length: { z0: bz0, z1: bz1, x0: bx0, x1: bx1 }, curl, post,
    counts: { claws: claws.length, legs: legs.length, antennae: ants.length, tailPieces: tail.length } };
}
