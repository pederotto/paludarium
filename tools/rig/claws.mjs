// A crab's pincers, fitted from its baked rig (tools/bake-creature.mjs, jobs with leg ids 5 left / 6 right claw): where the movable finger
// (the dactyl) hinges, which way it opens, and where a claw goes to feed. Written to the manifest as `finish.claws` and read by the
// vertex shader (render/creatures/instanced.js, "A crab's claws"): the dactyl's vertices turn about the hinge by `open` radians, and in
// the feeding cycle the claw's tip travels between `ground` (picking up) and `mouth` (the shell's front, low), each vertex by its legT.
// Everything in cm of the baked frame (x across, y up from the ground, z forward), `pos` in metres of it.
//   fitClaws(pos, rig) -> { claws: { 5: claw, 6: claw }, dact }, claw = { h: hinge, a: axis (unit; positive turns the dactyl away from the
//   fixed finger), shut: the angle (radians) that closes the dactyl's tip onto the fixed finger's, t0: legT where the fingers part, tip,
//   ground, mouth, len: shoulder to tip in cm }, and dact: per vertex 0 … 1, how much of the movable finger it is (0 off the claws). The
//   bake stores `dact` in the rig's spine channel (a crab has no body wave), so the shader needs no plane to tell the finger from the palm.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const mean = (pts) => mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / Math.max(1, pts.length));
const r3 = (a) => a.map((v) => +v.toFixed(3));

export function fitClaws(pos, rig, { dactyl = 'outer' } = {}) {
  const n = pos.length / 3, P = (i) => [pos[i * 3] * 100, pos[i * 3 + 1] * 100, pos[i * 3 + 2] * 100];
  // the shell's front: the mouth sits low on its front rim, on the midline
  let zf = -1e9, ymax = 0;
  for (let i = 0; i < n; i++) if (!rig.leg[i]) { zf = Math.max(zf, P(i)[2]); ymax = Math.max(ymax, P(i)[1]); }
  const mouth = [0, 0.32 * ymax, zf - 0.04];
  const out = {}, dact = new Float32Array(n), smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const id of [5, 6]) {
    const V = []; for (let i = 0; i < n; i++) if (rig.leg[i] === id) V.push(i);
    if (V.length < 60) throw new Error(`claws: claw ${id} has ${V.length} vertices`);
    const at = (lo, hi) => V.filter((i) => rig.legT[i] >= lo && rig.legT[i] <= hi).map(P);
    const tip = mean(at(0.95, 1)), root = mean(at(0, 0.08)), palm = mean(at(0.5, 0.65));
    const D = unit(sub(tip, palm));
    // the fingers: the points past 0.8 split in two by the direction across the claw in which they vary most
    const F = at(0.8, 1), fm = mean(F);
    const perp = (p) => { const r = sub(p, fm); return sub(r, mul(D, dot(r, D))); };
    let C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of F) { const q = perp(p); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += q[a] * q[b]; }
    let S0 = unit([1, 0.3, 0.2]);
    for (let it = 0; it < 30; it++) S0 = unit([0, 1, 2].map((a) => C[a][0] * S0[0] + C[a][1] * S0[1] + C[a][2] * S0[2]));
    const lo = F.filter((p) => dot(sub(p, fm), S0) < 0), hi = F.filter((p) => dot(sub(p, fm), S0) >= 0);
    if (lo.length < 5 || hi.length < 5) throw new Error(`claws: claw ${id}'s fingers did not split (${lo.length}/${hi.length})`);
    const mLo = mean(lo), mHi = mean(hi);
    // the movable finger: the outer one (further from the midline), or the upper one when they part up and down
    const vert = Math.abs(mHi[1] - mLo[1]) > Math.abs(mHi[0] - mLo[0]);
    const hiIsDactyl = dactyl === 'upper' || vert ? mHi[1] > mLo[1] : Math.abs(mHi[0]) > Math.abs(mLo[0]);
    const mD = hiIsDactyl ? mHi : mLo, mF = hiIsDactyl ? mLo : mHi;
    let S = sub(mD, mF); S = unit(sub(S, mul(D, dot(S, D))));
    const M0 = mul(add(mD, mF), 0.5), sep = len(sub(mD, mF));
    // where the fingers part: the first legT whose slab splits in two by half the tip's gap
    let t0 = 0.8;
    for (let t = 0.45; t < 0.95; t += 0.02) {
      const sl = at(t, t + 0.04); if (sl.length < 8) continue;
      const a = sl.filter((p) => dot(sub(p, M0), S) > 0), b = sl.filter((p) => dot(sub(p, M0), S) <= 0);
      if (a.length > 3 && b.length > 3 && dot(sub(mean(a), mean(b)), S) > 0.5 * sep) { t0 = t; break; }
    }
    // The two fingers' centre lines, a bin of legT at a time from where they part to the tip; a vertex is the dactyl's by which is nearer.
    const bins = [];
    for (let t = t0; t <= 1.0001; t += 0.04) {
      const sl = at(t - 0.02, t + 0.02), sm = mean(sl), a = sl.filter((p) => dot(sub(p, sm), S) > 0), b = sl.filter((p) => dot(sub(p, sm), S) <= 0);   // (halves about the slab's own centre: at the base the fingers are one blob)
      const prev = bins[bins.length - 1];
      bins.push({ t, d: a.length >= 3 ? mean(a) : prev?.d ?? mD, f: b.length >= 3 ? mean(b) : prev?.f ?? mF });
    }
    const H = bins[0].d;
    for (const i of V) {
      const t = rig.legT[i]; if (t < t0 - 0.02) continue;
      const bn = bins[Math.max(0, Math.min(bins.length - 1, Math.round((t - t0) / 0.04)))], p = P(i), dd = len(sub(p, bn.d)), df = len(sub(p, bn.f));
      if (Math.min(dd, df) > 0.9 * sep + 0.15) continue;
      dact[i] = smooth(0.35, 0.65, df / (dd + df || 1)) * smooth(t0, t0 + 0.1, t);
    }
    const Dn = unit(sub(mD, H)), A = unit(cross(Dn, S)), L = len(sub(tip, root));
    const u = unit(sub(mD, H)), v = unit(sub(mF, H));
    out[id] = { h: r3(H), a: r3(A), shut: +Math.max(0.05, Math.min(0.6, Math.acos(Math.max(-1, Math.min(1, dot(u, v)))))).toFixed(3), t0: +t0.toFixed(2), tip: r3(tip),
      ground: r3([tip[0] * 0.55, Math.max(0.04, tip[1] * 0.35), tip[2] + 0.28 * L]), mouth: r3(mouth), len: +L.toFixed(3) };
  }
  return { claws: out, dact };
}
