// School separation by BODY (R7, 8 Oct 2026). The old rule kept neighbours apart by CENTRE distance (0.7 of the body length), which ignores the length and the
// heading: a 9.6 cm rainbowfish at 5.6 cm in line lay 4 cm inside its neighbour, and two side by side lay inside each other when 3 cm apart. Here the gap is the
// closest distance between the two BODY AXES (tail end to snout end along the heading), so the push acts on the part of the body that is inside the other.
// Pure and allocation free (the caller owns `out`); unit-tested in tests/schoolsep.test.mjs.
export const SCHOOLSEP_REV = 'r7-2';
if (typeof globalThis !== 'undefined') globalThis.__SCHOOLSEP = SCHOOLSEP_REV;   // (the probes print it: a number only this code can produce)
export const SCHOOL_MARGIN = 2.0;     // the gap wanted between axes, in half-widths (2.0 = flanks just touching; the probe counts 1.0 as overlap; r7-1 used 1.6 and left 16% of bedotia samples overlapping)
export const SOFT_CAP = 0.25;         // cm: the most a fish is moved by the correction in one call (never a pop; as glassease.js)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Closest distance between the body axes of A and B, and the unit vector from B's closest point to A's (out.nx/ny/nz). Axes are horizontal segments
// P + (sin yaw, 0, cos yaw) * z, z from z0 (tail) to z1 (snout), as Animals.bodyBox gives them. `tie` (+1/-1) breaks a perfect tie (axes lying on each other).
export function axisGap(out, ax, ay, az, yawA, a0, a1, bx, by, bz, yawB, b0, b1, tie = 1) {
  const sa = Math.sin(yawA), ca = Math.cos(yawA), sb = Math.sin(yawB), cb = Math.cos(yawB);
  const px = ax + sa * a0, pz = az + ca * a0, qx = bx + sb * b0, qz = bz + cb * b0;
  const d1x = sa * (a1 - a0), d1z = ca * (a1 - a0), d2x = sb * (b1 - b0), d2z = cb * (b1 - b0);
  const rx = px - qx, ry = ay - by, rz = pz - qz;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz, c = d1x * rx + d1z * rz, b = d1x * d2x + d1z * d2z;
  const EPS = 1e-9;
  let s = 0, t = 0;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) t = clamp01(f / e);
  else if (e <= EPS) s = clamp01(-c / a);
  else {
    const den = a * e - b * b;
    s = den > EPS ? clamp01((b * f - c * e) / den) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  }
  const vx = rx + d1x * s - d2x * t, vy = ry, vz = rz + d1z * s - d2z * t, d = Math.hypot(vx, vy, vz);
  out.d = d;
  if (d > 1e-3) { out.nx = vx / d; out.ny = vy / d; out.nz = vz / d; return out; }
  // axes on each other (one fish in line inside the other, or exactly stacked): part them along the line of the centres, else sideways
  const cx = ax - bx, cz = az - bz, cl = Math.hypot(cx, cz);
  if (cl > 1e-3) { out.nx = cx / cl; out.ny = 0; out.nz = cz / cl; } else { out.nx = ca * tie; out.ny = 0; out.nz = -sa * tie; }
  return out;
}

// The push (a multiple of the fish's speed) for a penetration depth in 0..1 (1 - gap / limit): gentle at the edge, beating the cohesion (0.35) and alignment (0.6) at depth.
export const pushMag = (depth) => (depth <= 0 ? 0 : 2 * depth + 6 * depth * depth);

// The position correction (cm) for one neighbour: zero unless the gap is under HALF the limit (deep), then up to SOFT_CAP.
export const softStep = (gap, limit) => (gap >= 0.5 * limit ? 0 : Math.min(SOFT_CAP, 0.5 * (0.5 * limit - gap)));

// Limit a vector's length to `cap` (the sum of the neighbours' corrections is still one bounded step per call).
export function capLen(out, x, y, z, cap = SOFT_CAP) {
  const m = Math.hypot(x, y, z), k = m > cap ? cap / m : 1;
  out.x = x * k; out.y = y * k; out.z = z * k;
  return out;
}
