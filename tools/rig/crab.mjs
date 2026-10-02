// The vampire crab's rig, baked from its scan (tools/bake-creature.mjs, job "crab"). Input: positions in the scan's own
// units, head (eyes, claws) towards +z, up +y. Output per vertex, for render/creatures/instanced.js:
//   leg   1 … 4 walking legs, alternating front to back so neighbours on one side are out of phase and each leg is out of
//         phase with the one opposite it (left 1, 3, 1, 3; right 2, 4, 2, 4: the alternating tetrapod gait of a crab),
//         5 left claw, 6 right claw, 0 shell and eye stalks (rigid)
//   legT  0 at the hip … 1 at the tip
//   part  'shell' | 'leg' | 'claw' | 'eye' for the paint
// plus the shell's centre and width (to scale the crab by its carapace) and the two eyes (for the analytic eye shader).
import { segment } from './appendages.mjs';

const legId = (i, left) => (left ? (i % 2 ? 3 : 1) : (i % 2 ? 4 : 2));

export function crabRig(pos, idx) {
  const seg = segment(pos, idx, { thin: 0.22, eyeMax: 150, distal: 0.15 });
  const n = pos.length / 3;
  if (seg.limbs.length !== 10) throw new Error(`crab rig: expected 8 legs and 2 claws, found ${seg.limbs.length} limbs`);
  if (seg.eyes.length !== 2) throw new Error(`crab rig: expected 2 eye stalks, found ${seg.eyes.length}`);
  // Per side: the limb nearest the midline is the claw, the others are walking legs, numbered front to back.
  const ids = new Int8Array(seg.limbs.length);
  for (const left of [true, false]) {
    const side = seg.limbs.filter((L) => (L.c[0] < 0) === left);
    if (side.length !== 5) throw new Error(`crab rig: ${side.length} limbs on the ${left ? 'left' : 'right'}`);
    side.sort((a, b) => Math.abs(a.c[0]) - Math.abs(b.c[0]));
    ids[side[0].k] = left ? 5 : 6;
    side.slice(1).sort((a, b) => b.c[2] - a.c[2]).forEach((L, i) => { ids[L.k] = legId(i, left); });
  }
  const leg = new Uint8Array(n), part = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = seg.limb[i];
    leg[i] = k >= 0 ? ids[k] : 0;
    part[i] = seg.part[i] === 2 ? 'eye' : k < 0 ? 'shell' : leg[i] >= 5 ? 'claw' : 'leg';
  }
  // The shell: its plan-view extent sets the crab's scale and centre (the scan's bounding box is set by the legs).
  const xs = seg.body.map((i) => pos[i * 3]).sort((a, b) => a - b), zs = seg.body.map((i) => pos[i * 3 + 2]).sort((a, b) => a - b);
  const q = (a, f) => a[Math.floor(f * (a.length - 1))];
  const shell = { x0: q(xs, 0.005), x1: q(xs, 0.995), z0: q(zs, 0.005), z1: q(zs, 0.995) };
  // Eyes: the ball is the far end of each stalk (the 35% of its vertices farthest from its foot).
  const eyes = seg.eyes.map((c) => {
    const base = mean(pos, [...c].sort((a, b) => pos[a * 3 + 1] - pos[b * 3 + 1]).slice(0, Math.max(3, Math.round(c.length * 0.2))));   // the stalks stand up
    const d = (i) => Math.hypot(pos[i * 3] - base[0], pos[i * 3 + 1] - base[1], pos[i * 3 + 2] - base[2]);
    const tipV = [...c].sort((a, b) => d(b) - d(a)).slice(0, Math.max(4, Math.round(c.length * 0.35)));
    const ball = mean(pos, tipV);
    const r = tipV.reduce((s, i) => s + Math.hypot(pos[i * 3] - ball[0], pos[i * 3 + 1] - ball[1], pos[i * 3 + 2] - ball[2]), 0) / tipV.length;
    return { c: ball, r, base };
  });
  return { leg, legT: seg.legT, part, shell, eyes };
}

function mean(pos, ids) {
  const m = [0, 0, 0];
  for (const i of ids) for (let a = 0; a < 3; a++) m[a] += pos[i * 3 + a] / ids.length;
  return m;
}
