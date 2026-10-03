// The size of an animal as it is drawn, read off its mesh: what the separation, the footing and the contact shadow use, so an
// animal is kept apart by the body you see rather than by a number per kind (a 6 cm vampire crab was a 0.6 cm circle, a 2.5 cm
// trumpet snail a 0.5 cm one, so they walked through each other).
//
// `P`: vertex positions (x, y, z, …) in the mesh's own units, facing +z with the feet on y = 0. `R`: the rig attribute
// (spine, leg id, leg t, material; 4 per vertex) or null: leg id 0 is the trunk, 1 … 4 the walking legs, 5 and 6 a crab's claws.
//
// Returns, in mesh units:
//   tw, tl, tc   the trunk as a capsule along z: half width, half length, centre. The trunk is the part of the body at least a
//                third as wide as its widest point, so antennae, whiskers, a shrimp's rostrum and the thin end of a tail do not
//                stretch it; a newt's tail does count.
//   hh           the height of the trunk's top
//   span         half the leg span (or the trunk's half width when the legs are tucked in)
//   hw, hlen, zc the older whole-body numbers the footing and the contact shadow were tuned on: 0.6 of the widest point (legs
//                included), half the full length and its centre.
export function bodyFootprint(P, R = null) {
  const n = P.length / 3;
  if (!n) return null;
  let z0 = Infinity, z1 = -Infinity, az0 = Infinity, az1 = -Infinity, hh = 0, legX = 0, allX = 0, trunk = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.abs(P[i * 3]), y = P[i * 3 + 1], z = P[i * 3 + 2];
    allX = Math.max(allX, x); az0 = Math.min(az0, z); az1 = Math.max(az1, z);
    if (R && R[i * 4 + 1] > 0.5) { legX = Math.max(legX, x); continue; }
    trunk++;
    z0 = Math.min(z0, z); z1 = Math.max(z1, z); hh = Math.max(hh, y);
  }
  if (!trunk) { z0 = az0; z1 = az1; }
  const NB = 32, w = new Float64Array(NB), len = Math.max(z1 - z0, 1e-6);
  for (let i = 0; i < n; i++) {
    if (trunk && R && R[i * 4 + 1] > 0.5) continue;
    const b = Math.min(NB - 1, Math.floor(((P[i * 3 + 2] - z0) / len) * NB));
    w[b] = Math.max(w[b], Math.abs(P[i * 3]));
  }
  let wmax = 0;
  for (let b = 0; b < NB; b++) wmax = Math.max(wmax, w[b]);
  let b0 = 0, b1 = NB - 1;
  while (b0 < NB - 1 && w[b0] < wmax / 3) b0++;
  while (b1 > b0 && w[b1] < wmax / 3) b1--;
  const t0 = z0 + (b0 / NB) * len, t1 = z0 + ((b1 + 1) / NB) * len;
  return {
    tw: wmax * 0.92, tl: (t1 - t0) / 2, tc: (t0 + t1) / 2, hh, span: Math.max(legX, wmax),
    hw: allX * 0.6, hlen: (az1 - az0) / 2, zc: (az0 + az1) / 2,
  };
}
