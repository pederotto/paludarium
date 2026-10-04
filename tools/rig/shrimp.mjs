// A dwarf shrimp's rig, baked from its scan (tools/bake-creature.mjs, jobs with rig: 'shrimp'). Input: positions in the scan's own
// units, head towards +z, up +y, standing on its legs (art-src/raw/shrimp_mesh.glb, about 2 units long). Output per vertex, for the
// `invert` rig of render/creatures/instanced.js:
//   leg   15 / 16  the front pair with the little pincers (left / right): they pick at the ground and carry to the mouth
//         1 … 4    the walking legs, numbered so the two sides are half a cycle apart (left 1, 3, 1; right 2, 4, 2; the rig steps
//                  them in a wave from tail to head)
//         7 / 8    the antennae and antennules (left / right): they sweep and dip
//         10       the swimmerets under the abdomen: they beat in a wave while it swims, and fan slowly while it stands
//         0        the body, the eyes, the mouthparts and the tail fan (the tail flick curls the whole abdomen: invert.curl)
//   legT  0 at the base … the limb's tip, scaled per kind so the rig's motions have the right size in centimetres
//   part  'body' | 'leg' | 'claw' | 'antenna' | 'eye' | 'tail' | 'swimmeret' for the paint
// The scan's antennae are stubs and it has no swimmerets: both are added as geometry (`extra`), long thin whips curving out and
// forward as on a living shrimp, and five pairs of small paddles under the abdomen.
// Also: `length` (the body's extent along z without the whips: the shrimp is scaled by its body length), `spine` (0 at the rostrum
// … 1 at the telson, for the leg wave), `eyes` (the two eye balls, for the analytic eye shader) and `curl` (the tail flick's pivot).
import { segment } from './appendages.mjs';

export function shrimpRig(pos, idx, { thin = 0.1, distal = 0.05 } = {}) {
  const n = pos.length / 3;
  const seg = segment(pos, idx, { thin, eyeMax: 60, distal, minLimb: 8 });
  // The body without its appendages: its extent sets the frame.
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const i of seg.body) {
    bx0 = Math.min(bx0, pos[i * 3]); bx1 = Math.max(bx1, pos[i * 3]); by0 = Math.min(by0, pos[i * 3 + 1]); by1 = Math.max(by1, pos[i * 3 + 1]);
    bz0 = Math.min(bz0, pos[i * 3 + 2]); bz1 = Math.max(bz1, pos[i * 3 + 2]);
  }
  const L = bz1 - bz0, H = by1 - by0, yUpper = by0 + 0.45 * H;
  // Classify the limbs (see the header).
  const kind = new Map();
  const upper = [], lower = [];
  for (const Lm of seg.limbs) {
    if (Lm.c[2] < bz0 + 0.22 * L) kind.set(Lm.k, 'tail');
    else if (Lm.c[1] > yUpper) upper.push(Lm);
    else lower.push(Lm);
  }
  // Eyes: per side, the small upper piece farthest from the midline; other small upper pieces are mouthparts (body); the long ones
  // are antennae.
  const eyes = [];
  for (const left of [true, false]) {
    const small = upper.filter((Lm) => Lm.reach < 0.2 && (Lm.c[0] < 0) === left && Lm.c[2] > bz0 + 0.6 * L);
    small.sort((a, b) => Math.abs(b.c[0]) - Math.abs(a.c[0]));
    if (small[0]) { kind.set(small[0].k, 'eye'); eyes.push(small[0]); }
    for (const s of small.slice(1)) kind.set(s.k, 'body');
  }
  for (const Lm of upper) if (!kind.has(Lm.k)) kind.set(Lm.k, Lm.reach >= 0.22 ? 'antenna' : 'body');
  // Legs: per side, front to back; the frontmost is the pincer pair (on this scan the two pincer pairs came out as one piece).
  const legOf = new Map();
  for (const left of [true, false]) {
    const side = lower.filter((Lm) => (Lm.c[0] < 0) === left).sort((a, b) => b.c[2] - a.c[2]);
    side.forEach((Lm, i) => {
      if (i === 0) { kind.set(Lm.k, 'claw'); legOf.set(Lm.k, left ? 15 : 16); }
      else { kind.set(Lm.k, 'leg'); legOf.set(Lm.k, left ? ((i - 1) % 2 ? 3 : 1) : ((i - 1) % 2 ? 4 : 2)); }
    });
  }
  const leg = new Uint8Array(n), legT = new Float32Array(n), part = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = seg.limb[i];
    const kd = seg.part[i] === 2 ? 'mouth' : k >= 0 ? kind.get(k) : 'body';
    if (kd === 'claw') { leg[i] = legOf.get(k); legT[i] = seg.legT[i] * 0.35; part[i] = 'claw'; }
    else if (kd === 'leg') { leg[i] = legOf.get(k); legT[i] = seg.legT[i]; part[i] = 'leg'; }
    else if (kd === 'antenna') { leg[i] = pos[i * 3] < 0 ? 7 : 8; legT[i] = seg.legT[i] * 0.12; part[i] = 'antenna'; }
    else if (kd === 'eye') part[i] = 'eye';
    else if (kd === 'tail') part[i] = 'tail';
    else part[i] = pos[i * 3 + 2] < bz0 + 0.18 * L ? 'tail' : 'body';
  }
  // The tail fan: the scan has it spread wide, as a shrimp holds it only in a turn or a flick; folded to about 60 % of its span (the
  // fold grows from where the fan leaves the body, so the seam does not tear).
  for (let i = 0; i < n; i++) if (part[i] === 'tail' && seg.limb[i] >= 0) pos[i * 3] *= 1 - 0.42 * Math.min(1, seg.legT[i] * 2.5);
  // The walking legs: the scan sprawls them like a spider's; a dwarf shrimp stands with them more under it. Drawn in toward the
  // midline, most at the tips.
  for (let i = 0; i < n; i++) if (part[i] === 'leg') pos[i * 3] *= 1 - 0.32 * Math.min(1, seg.legT[i] * 1.4);
  // Eye balls: the far end of each eye piece.
  const eyeBalls = eyes.map((Lm) => {
    const ids = []; for (let i = 0; i < n; i++) if (seg.limb[i] === Lm.k) ids.push(i);
    const base = Lm.c, d = (i) => Math.hypot(pos[i * 3] - base[0], pos[i * 3 + 1] - base[1], pos[i * 3 + 2] - base[2]);
    const tip = ids.sort((a, b) => d(b) - d(a)).slice(0, Math.max(4, Math.round(ids.length * 0.5)));
    const c = [0, 1, 2].map((a) => tip.reduce((s, i) => s + pos[i * 3 + a], 0) / tip.length);
    const r = tip.reduce((s, i) => s + Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]), 0) / tip.length;
    return { c, r: Math.max(r, 0.025 * L), base };
  });

  // --- Added geometry: antennae whips and swimmerets ---------------------------------------------------------------------
  const E = { pos: [], idx: [], leg: [], legT: [], part: [] };
  // A tapered tube through points P with radii R; legT runs t0 … t1 along it.
  const tube = (P, R, id, t0, t1, prt, sides = 6) => {
    const base = (pos.length + E.pos.length) / 3, m = P.length;
    for (let s = 0; s < m; s++) {
      const a = P[Math.max(0, s - 1)], b = P[Math.min(m - 1, s + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let ux = -tz, uy = 0, uz = tx;                                                         // t x up: a side vector across the tube
      if (Math.hypot(ux, uy, uz) < 1e-3) { ux = 1; uy = 0; uz = 0; }
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2, cs = Math.cos(ang) * R[s], sn = Math.sin(ang) * R[s];
        E.pos.push(P[s][0] + ux * cs + vx * sn, P[s][1] + uy * cs + vy * sn, P[s][2] + uz * cs + vz * sn);
        E.leg.push(id); E.legT.push(t0 + (t1 - t0) * (s / (m - 1))); E.part.push(prt);
      }
    }
    for (let s = 0; s < m - 1; s++) for (let k = 0; k < sides; k++) {
      const a = base + s * sides + k, b = base + s * sides + (k + 1) % sides, c = a + sides, d = b + sides;
      E.idx.push(a, c, b, b, c, d);
    }
    // cap the tip
    const tipC = (pos.length + E.pos.length) / 3;
    E.pos.push(...P[m - 1]); E.leg.push(id); E.legT.push(t1); E.part.push(prt);
    for (let k = 0; k < sides; k++) E.idx.push(base + (m - 1) * sides + k, tipC, base + (m - 1) * sides + (k + 1) % sides);
  };
  // A curve from `a` along `dir`, bending by `bend` (per unit length, a vector added to the heading) over `len`, in `seg` steps.
  const whip = (a, dir, bend, len, steps) => {
    const P = [a.slice()]; let d = dir.slice(), p = a.slice();
    for (let s = 1; s <= steps; s++) {
      const st = len / steps;
      d = d.map((v, i) => v + bend[i] * st); const dl = Math.hypot(...d); d = d.map((v) => v / dl);
      p = p.map((v, i) => v + d[i] * st); P.push(p.slice());
    }
    return P;
  };
  // The whips start at the tips of the antenna stubs, the same on both sides (the mean of the two, mirrored).
  const ant = [...seg.limbs].filter((Lm) => kind.get(Lm.k) === 'antenna');
  const tipsAbs = ant.map((Lm) => [Math.abs(Lm.tip[0]), Lm.tip[1], Lm.tip[2]]);
  const meanTip = tipsAbs.length ? [0, 1, 2].map((a) => tipsAbs.reduce((s, t) => s + t[a], 0) / tipsAbs.length) : [0.15 * L, by1, bz1];
  for (const sx of [-1, 1]) {
    const id = sx < 0 ? 7 : 8;
    // the antenna: as long as the body, out and forward, drooping as it goes and curling back at the end
    const a0 = [meanTip[0] * sx, meanTip[1], meanTip[2]];
    tube(whip(a0, [0.26 * sx, 0.2, 0.94], [0.3 * sx, -0.45, -0.5], 1.1 * L, 16), Array.from({ length: 17 }, (_, s) => 0.011 * L / 1.8 * (1 - s / 17 * 0.65)), id, 0.12, 0.62, 'antenna');
    // the antennule: a short forked whip above it, forward and up
    const b0 = [meanTip[0] * 0.55 * sx, meanTip[1] + 0.02 * L, meanTip[2] - 0.02 * L];
    tube(whip(b0, [0.15 * sx, 0.35, 0.92], [0.1 * sx, -0.3, 0], 0.32 * L, 7), Array.from({ length: 8 }, (_, s) => 0.008 * L / 1.8 * (1 - s / 8 * 0.5)), id, 0.05, 0.2, 'antenna', 5);
    tube(whip(b0, [0.3 * sx, 0.25, 0.92], [0.2 * sx, -0.2, 0], 0.26 * L, 6), Array.from({ length: 7 }, (_, s) => 0.007 * L / 1.8 * (1 - s / 7 * 0.5)), id, 0.05, 0.18, 'antenna', 5);
  }
  // Swimmerets: five pairs of paddles under the abdomen, from just behind the last walking legs to the tail fan.
  const lowAt = (z, x) => {
    let y = Infinity;
    for (const i of seg.body) if (Math.abs(pos[i * 3 + 2] - z) < 0.03 * L && Math.abs(Math.abs(pos[i * 3]) - x) < 0.05 * L) y = Math.min(y, pos[i * 3 + 1]);
    return y;
  };
  const legZ = Math.min(...lower.map((Lm) => Lm.c[2])), tailZ = bz0 + 0.24 * L;
  for (let k = 0; k < 5; k++) {
    const z = legZ - 0.04 * L - (k / 4) * (legZ - 0.04 * L - tailZ);
    for (const sx of [-1, 1]) {
      const x = 0.035 * L, y = lowAt(z, x);
      if (!Number.isFinite(y)) continue;
      const a = [x * sx, y + 0.01 * L, z], b = [x * 1.25 * sx, y - 0.05 * L, z - 0.035 * L], c = [x * 1.4 * sx, y - 0.085 * L, z - 0.07 * L];
      tube([a, b, c], [0.016 * L / 1.8, 0.014 * L / 1.8, 0.008 * L / 1.8], 10, 0.02, 0.12, 'swimmeret', 5);
    }
  }
  // The egg clutch: about twenty eggs (1 mm) in rows between the swimmerets, leg id 14. The rig folds them to a point inside the
  // abdomen unless the shrimp is berried (render/creatures/instanced.js, invert.eggs and the `spread` channel).
  const ball = (c, r) => {
    const base = (pos.length + E.pos.length) / 3, LON = 6, LAT = 4;
    for (let i = 0; i <= LAT; i++) for (let j = 0; j < LON; j++) {
      const th = (i / LAT) * Math.PI, ph = (j / LON) * Math.PI * 2;
      E.pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph));
      E.leg.push(14); E.legT.push(0); E.part.push('egg');
    }
    for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
      const a = base + i * LON + j, b = base + i * LON + (j + 1) % LON, c2 = a + LON, d = b + LON;
      E.idx.push(a, b, c2, b, d, c2);
    }
  };
  const eggZ0 = legZ - 0.05 * L, eggZ1 = legZ - 0.33 * L, er = 0.022 * L;
  let eggN = 0, eggC = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const z = eggZ0 + (eggZ1 - eggZ0) * (k / 7);
    for (const sx of [-1, 0, 1]) {
      if (sx === 0 && (k === 0 || k === 7)) continue;
      const y = lowAt(z, 0.03 * L);
      if (!Number.isFinite(y)) continue;
      const c = [sx * 0.03 * L, y - er * (sx === 0 ? 1.4 : 0.8), z + (sx === 0 ? er : 0)];
      ball(c, er); eggN++; eggC = eggC.map((v, i) => v + c[i]);
    }
  }
  eggC = eggC.map((v) => v / Math.max(1, eggN));
  const extra = { pos: Float32Array.from(E.pos), idx: Uint32Array.from(E.idx), leg: Uint8Array.from(E.leg), legT: Float32Array.from(E.legT), part: E.part };
  // The tail flick's pivot (where the abdomen meets the carapace, at the belly line) and its length, in scan units.
  const curl = { z0: bz0 + 0.55 * L, y0: by0 + 0.35 * H, len: 0.6 * L };
  // (where the eggs fold to when hidden: inside the abdomen above the clutch)
  const eggs = { y: eggC[1] + 0.07 * L, z: eggC[2] };
  return { leg, legT, part, extra, length: { z0: bz0, z1: bz1, x0: bx0, x1: bx1 }, eyes: eyeBalls, curl, eggs,
    counts: { limbs: seg.limbs.length, claws: [...kind.values()].filter((v) => v === 'claw').length, legs: [...kind.values()].filter((v) => v === 'leg').length, antennae: ant.length, eyes: eyeBalls.length, tail: [...kind.values()].filter((v) => v === 'tail').length } };
}
