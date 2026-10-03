// Small numeric helpers shared by every layer. No scene and no DOM: the simulation and its tests run these under Node.

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Smoothstep from 0 at a to 1 at b.
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// A repeatable pseudo-random number in 0..1 from three coordinates (no state, so the same place always gives the same value).
export function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Deterministic PRNG so generated scenes and plants are repeatable.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// The closest points of segments P0-P1 and Q0-Q1 in a plane: [px, pz, qx, qz].
export function closestOnSegments(p0x, p0z, p1x, p1z, q0x, q0z, q1x, q1z) {
  const ux = p1x - p0x, uz = p1z - p0z, vx = q1x - q0x, vz = q1z - q0z, wx = p0x - q0x, wz = p0z - q0z;
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz, d = ux * wx + uz * wz, e = vx * wx + vz * wz;
  const den = a * c - b * b;
  let s = a < 1e-9 ? 0 : den > 1e-9 ? clamp((b * e - c * d) / den, 0, 1) : 0;
  let t = c < 1e-9 ? 0 : (b * s + e) / c;
  if (t < 0) { t = 0; s = a < 1e-9 ? 0 : clamp(-d / a, 0, 1); } else if (t > 1) { t = 1; s = a < 1e-9 ? 0 : clamp((b - d) / a, 0, 1); }
  return [p0x + ux * s, p0z + uz * s, q0x + vx * t, q0z + vz * t];
}
