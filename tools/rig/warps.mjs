// Shape warps that turn the one frog scan into related species (tools/bake-creature.mjs jobs with `warp`).
// Each export is make(pos, rig) -> (p, v) => p': `pos` the baked positions in metres (head +z, feet on y = 0), `rig` the frog rig
// (tools/rig/frog.mjs); p a point in cm, v = { leg, legT, part }. The bake then stands the result back on y = 0.
//
// Limbs are scaled about their own root (the mean of the vertices where they leave the body), so a longer leg stays attached and
// keeps its fold; the scale fades in over the first part of the limb so the seam does not tear.

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function frame(pos, rig) {
  const n = pos.length / 3, root = {}, cnt = {};
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] * 100, y = pos[i * 3 + 1] * 100, z = pos[i * 3 + 2] * 100;
    if (!rig.leg[i]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const l = rig.leg[i];
    if (l && rig.legT[i] < 0.08) { root[l] ??= [0, 0, 0]; root[l][0] += x; root[l][1] += y; root[l][2] += z; cnt[l] = (cnt[l] ?? 0) + 1; }
  }
  for (const l in root) root[l] = root[l].map((v) => v / cnt[l]);
  // The limb's centre line: the mean of its vertices in NB slices of legT. A vertex is its slice's centre plus an offset across
  // the limb, so a limb can be lengthened (the centre line scaled about the root) without growing thicker.
  const NB = 48, core = {};
  for (let i = 0; i < n; i++) {
    const l = rig.leg[i]; if (!l) continue;
    const b = Math.min(NB - 1, Math.floor(rig.legT[i] * NB));
    core[l] ??= Array.from({ length: NB }, () => [0, 0, 0, 0]);
    const c = core[l][b]; c[0] += pos[i * 3] * 100; c[1] += pos[i * 3 + 1] * 100; c[2] += pos[i * 3 + 2] * 100; c[3]++;
  }
  for (const l in core) {
    let last = root[l];
    core[l] = core[l].map((c) => (c[3] ? (last = [c[0] / c[3], c[1] / c[3], c[2] / c[3]]) : last));
  }
  const coreAt = (l, t) => {
    const f = Math.max(0, Math.min(NB - 1.001, t * NB - 0.5)), i = Math.floor(f), a = f - i, A = core[l][i], B = core[l][Math.min(NB - 1, i + 1)];
    return [A[0] + (B[0] - A[0]) * a, A[1] + (B[1] - A[1]) * a, A[2] + (B[2] - A[2]) * a];
  };
  return { root, coreAt, body: { x0, x1, y0, y1, z0, z1, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2 } };
}

// k: { body: [sx, sy, sz] about the body's centre, head: extra width of the head (x, front 40 %), hump: lift of the back's middle
// (cm), snout: extra length of the snout (cm), fore / hind: limb length factors, foot: extra scale of hands and feet about their
// own root, disc: toe tip swell (handled in paint/finish, unused here) }
function make(k) {
  return (pos, rig) => {
    const { root, coreAt, body: B } = frame(pos, rig);
    const [sx, sy, sz] = k.body ?? [1, 1, 1];
    const len = B.z1 - B.z0, ht = B.y1 - B.y0;
    const bodyAt = ([x, y, z]) => {
      const u = (z - B.z0) / len;                        // 0 vent … 1 snout
      let X = x * sx, Y = B.y0 + (y - B.y0) * sy, Z = B.cz + (z - B.cz) * sz;
      const headW = 1 + (k.head ?? 0) * sstep(0.55, 0.85, u);
      X *= headW;
      const top = sstep(0.35, 0.95, (y - B.y0) / ht);
      Y += (k.hump ?? 0) * Math.sin(Math.PI * Math.max(0, Math.min(1, (u - 0.1) / 0.75))) * top;
      Z += (k.snout ?? 0) * sstep(0.8, 1, u);
      if (k.flatBack) Y -= k.flatBack * top * top * ht * 0.2;
      return [X, Y, Z];
    };
    return (p, v) => {
      if (!v.leg) return bodyAt(p);
      const r = root[v.leg], fore = v.leg <= 2;
      const f = fore ? k.fore ?? 1 : k.hind ?? 1;
      const w = sstep(0, 0.25, v.legT);
      const s = 1 + (f - 1) * w;
      // the centre line scaled about the root, the offset across the limb kept (times `thick`)
      const c = coreAt(v.leg, v.legT), th = 1 + ((k.thick ?? 1) - 1) * w;
      let q = [0, 1, 2].map((a) => r[a] + (c[a] - r[a]) * s + (p[a] - c[a]) * th);
      // hands and feet a little larger (or smaller), spread about the wrist / ankle, for wider toe pads or a toad's short toes
      if (k.foot) {
        const t = sstep(0.62, 0.85, v.legT), a = 1 + (k.foot - 1) * t;
        const wr = coreAt(v.leg, 0.62), ws = [0, 1, 2].map((i) => r[i] + (wr[i] - r[i]) * s);
        q = [ws[0] + (q[0] - ws[0]) * a, q[1], ws[2] + (q[2] - ws[2]) * a];
      }
      // the limb follows its root as the body warps
      const r2 = bodyAt(r);
      const d = [r2[0] - r[0], r2[1] - r[1], r2[2] - r[2]];
      const hold = 1 - sstep(0.4, 0.9, v.legT) * (k.plant ?? 1);          // the feet stay on the ground
      return [q[0] + d[0], q[1] + d[1] * hold, q[2] + d[2]];
    };
  };
}

// Dendrobates tinctorius "azureus": the dart frog's hunched back and big build.
export const azureus = make({ body: [1.04, 1.04, 1.0], hump: 0.12, fore: 1.04, hind: 1.02 });
// Dendrobates auratus: a slimmer, longer-limbed dart frog with a slightly longer snout.
export const auratus = make({ body: [0.93, 0.96, 1.04], snout: 0.05, fore: 1.1, hind: 1.1 });
// Bombina orientalis: flat, broad, flat-backed, a wide head and shorter, thicker-looking limbs with small toes.
export const bombina = make({ body: [1.16, 0.7, 1.02], head: 0.12, flatBack: 0.8, fore: 0.92, hind: 0.92, thick: 1.08, foot: 0.9 });
// Melanophryniscus: a small round walking toad with short limbs and a pointed snout.
export const melano = make({ body: [0.98, 0.94, 1.0], snout: 0.07, fore: 0.9, hind: 0.86, foot: 0.9 });
// Heterixalus: a slender reed frog, long limbs, bigger hands and feet for the toe discs.
export const heterixalus = make({ body: [0.86, 0.88, 1.06], snout: 0.03, fore: 1.1, hind: 1.16, thick: 0.88, foot: 1.12 });
