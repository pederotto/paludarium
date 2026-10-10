// The Matano shrimp's rig, baked from the owner's Meshy model (tools/bake-creature.mjs, job "matanoshrimp"). The same output as
// tools/rig/shrimp.mjs (leg 15 / 16 the pincers, 1 … 4 the walking legs, 7 / 8 the antennae, 10 the swimmerets, 14 the eggs, 0 the body; legT; part;
// curl, eggs, length, eyes) for the `invert` rig of render/creatures/instanced.js, but labelled by the model's own pieces: its legs, swimmeret
// strips and the long antennae are each a separate connected piece of mesh beside the body, so no thickness test is needed for them. The
// body piece (carapace, abdomen, tail fan, eyes, and the long antennae that grow out of the head) is split by tools/rig/appendages.mjs `segment`
// run on that piece alone: the thin whips are the antennae, the thin lobes behind are the tail fan, the two small pieces on the carapace are the eyes.
// Scan units, head +z, up +y, outward winding (the model as Meshy wrote it: the Blender-textured copy has its faces turned inside out).
// opt: { thin, distal, swimY (a piece whose centre is lower than this is a leg), minTris }.
import { segment } from './appendages.mjs';
import { pieces, rootAndReach } from './pieces.mjs';

export function meshyshrimpRig(pos, idx, opt = {}) {
  const n = pos.length / 3, swimY = opt.swimY ?? -0.09, minTris = opt.minTris ?? 30;
  const P = pieces(pos, idx), main = P.list[0];
  const leg = new Uint8Array(n), legT = new Float32Array(n), part = new Array(n).fill('body');
  const near = main.v.filter((_, i) => i % 3 === 0);
  // 1. The loose pieces: legs (low), swimmeret strips (under the abdomen, behind the legs), antennae (the rest).
  const legs = [], swims = [], ants = [];
  for (const pc of P.list.slice(1)) {
    if (pc.tris < minTris) continue;
    if (pc.c[1] < swimY) legs.push(pc);
    else if (pc.hi[2] < 0 && pc.ext[2] > 0.2 && pc.ext[0] < 0.08) swims.push(pc);
    else ants.push(pc);
  }
  // legs per side, front to back (at equal depth the one nearer the midline first): the first is the pincer pair, the rest walk
  const legId = new Map();
  for (const left of [true, false]) {
    const side = legs.filter((pc) => (pc.c[0] < 0) === left).sort((a, b) => (Math.abs(b.c[2] - a.c[2]) < 0.02 ? Math.abs(a.c[0]) - Math.abs(b.c[0]) : b.c[2] - a.c[2]));
    side.forEach((pc, i) => legId.set(pc, i === 0 ? (left ? 15 : 16) : left ? ((i - 1) % 2 ? 3 : 1) : ((i - 1) % 2 ? 4 : 2)));
  }
  for (const pc of legs) {
    const id = legId.get(pc), { d, reach } = rootAndReach(pos, idx, pc, near), claw = id >= 15;
    for (const i of pc.v) { leg[i] = id; legT[i] = (d.get(i) ?? 0) / reach * (claw ? 0.35 : 1); part[i] = claw ? 'claw' : 'leg'; }
  }
  for (const pc of ants) {
    const id = pc.c[0] < 0 ? 7 : 8, { d, reach } = rootAndReach(pos, idx, pc, near);
    for (const i of pc.v) { leg[i] = id; legT[i] = (d.get(i) ?? 0) / reach * 0.62; part[i] = 'antenna'; }
  }
  for (const pc of swims) for (const i of pc.v) { leg[i] = 10; legT[i] = 0.12 * Math.max(0, Math.min(1, (pc.hi[1] - pos[i * 3 + 1]) / Math.max(1e-6, pc.ext[1]))); part[i] = 'swimmeret'; }

  // 2. The body piece, alone: its thin whips and lobes and its eyes.
  const inMain = new Map(main.v.map((v, k) => [v, k]));
  const mp = new Float32Array(main.v.length * 3), mi = [];
  main.v.forEach((v, k) => { mp.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], k * 3); });
  for (let t = 0; t < idx.length; t += 3) if (inMain.has(idx[t])) mi.push(inMain.get(idx[t]), inMain.get(idx[t + 1]), inMain.get(idx[t + 2]));
  const seg = segment(mp, Uint32Array.from(mi), { thin: opt.thin ?? 0.02, eyeMax: 40, distal: opt.distal ?? 0.04, minLimb: 6 });
  const kind = new Map();
  for (const L of seg.limbs) kind.set(L.k, L.c[2] < -0.3 ? 'tail' : L.c[2] > 0.2 && L.reach > 0.2 ? 'antenna' : 'body');
  const eyes = [];
  for (const e of seg.eyes) {
    const c = [0, 1, 2].map((a) => e.reduce((s, k) => s + mp[k * 3 + a], 0) / e.length);
    if (c[2] > 0.1 && c[1] > -0.05 && Math.abs(c[0]) > 0.015) eyes.push({ ids: e, c });
  }
  for (let k = 0; k < main.v.length; k++) {
    const v = main.v[k], L = seg.limb[k];
    if (L >= 0 && kind.get(L) === 'antenna') {
      leg[v] = pos[v * 3] < 0 ? 7 : 8; part[v] = 'antenna';
      legT[v] = Math.min(0.62, (seg.legT[k] * 0.5) + 0.0);          // (the whip's root is on the head: 0 there, 0.5 at its tip; the loose antennae go to 0.62)
    } else if (L >= 0 && kind.get(L) === 'tail') part[v] = 'tail';
  }
  for (const e of eyes) for (const k of e.ids) part[main.v[k]] = 'eye';
  const bodyIds = main.v.filter((v) => part[v] !== 'antenna');
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const i of bodyIds) {
    bx0 = Math.min(bx0, pos[i * 3]); bx1 = Math.max(bx1, pos[i * 3]); by0 = Math.min(by0, pos[i * 3 + 1]); by1 = Math.max(by1, pos[i * 3 + 1]);
    bz0 = Math.min(bz0, pos[i * 3 + 2]); bz1 = Math.max(bz1, pos[i * 3 + 2]);
  }
  const L = bz1 - bz0, H = by1 - by0;
  // The tail fan is spread wide on the model: folded to a bit over half its span (as the first shrimp's), the fold growing from where the fan leaves the abdomen.
  const fanZ = bz0 + (opt.fanLen ?? 0.14) * L;
  for (const i of bodyIds) if (pos[i * 3 + 2] < fanZ) pos[i * 3] *= 1 - 0.42 * Math.min(1, (fanZ - pos[i * 3 + 2]) / (0.5 * (fanZ - bz0)));
  // The walking legs sprawl; a dwarf shrimp stands with them more under it: drawn in toward the midline, most at the tips.
  for (let i = 0; i < n; i++) if (part[i] === 'leg') pos[i * 3] *= 1 - 0.22 * Math.min(1, legT[i] * 1.4);
  const eyeBalls = eyes.map((e) => {
    const r = e.ids.reduce((s, k) => s + Math.hypot(mp[k * 3] - e.c[0], mp[k * 3 + 1] - e.c[1], mp[k * 3 + 2] - e.c[2]), 0) / e.ids.length;
    return { c: e.c, r: Math.max(r, 0.025 * L), base: [e.c[0] * 0.45, e.c[1] - 0.025 * L, e.c[2] - 0.02 * L] };
  });

  // 3. Added geometry: the egg clutch (about twenty eggs in rows between the swimmerets, leg id 14: the rig folds them to a point inside the
  // abdomen unless the shrimp is berried: instanced.js invert.eggs and the `spread` channel).
  const E = { pos: [], idx: [], leg: [], legT: [], part: [] };
  const lowAt = (z, x) => {
    let y = Infinity;
    for (const i of bodyIds) if (Math.abs(pos[i * 3 + 2] - z) < 0.03 * L && Math.abs(Math.abs(pos[i * 3]) - x) < 0.05 * L) y = Math.min(y, pos[i * 3 + 1]);
    return y;
  };
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
  const legZ = legs.length ? Math.min(...legs.map((pc) => pc.c[2])) : bz0 + 0.5 * L;
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
  const curl = { z0: bz0 + 0.55 * L, y0: by0 + 0.35 * H, len: 0.6 * L };
  const eggs = { y: eggC[1] + 0.07 * L, z: eggC[2] };
  const cnt = (id) => new Set(legs.filter((pc) => (legId.get(pc) ?? -1) === id)).size;
  return { leg, legT, part, extra, length: { z0: bz0, z1: bz1, x0: bx0, x1: bx1 }, eyes: eyeBalls, curl, eggs,
    counts: { legs: legs.length, swimmerets: swims.length, antennaePieces: ants.length, antennaeOnBody: seg.limbs.filter((l) => kind.get(l.k) === 'antenna').length, eyes: eyeBalls.length, pincers: cnt(15) + cnt(16), eggs: eggN } };
}
