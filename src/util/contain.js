// Keeping a whole body where it may be: inside the glass, clear of a surface, on the plane under its feet, with a frame that turns
// smoothly while it climbs. Pure numbers (no three.js), so tests/contain.test.mjs runs them under Node.
//
// A body is drawn as Animals.draw puts it: UP turned onto the surface normal n by the shortest arc, then turned by its heading
// (yaw) about that normal. In its own frame it faces +z with its feet on y = 0, and its drawn box is x in [-X, X] (the widest point,
// legs included), z in [z0, z1] (tail to snout) and y in [0, H].

// The body's forward, right and up axes in the world for normal (nx, ny, nz) (unit) and heading yaw.
// out = [fx, fy, fz, rx, ry, rz, ux, uy, uz] (up is the normal).
export function surfaceFrame(nx, ny, nz, yaw, out = new Array(9)) {
  // R v = c v + a × v + (a · v) / (1 + c) a, with a = UP × n = (nz, 0, -nx) and c = UP · n = ny (Rodrigues for the shortest arc).
  const c = ny, k = 1 / Math.max(1e-6, 1 + c), ax = nz, az = -nx;
  const rot = (vx, vy, vz, o) => {
    const d = (ax * vx + az * vz) * k;
    out[o] = c * vx + (-az * vy) + d * ax;
    out[o + 1] = c * vy + (az * vx - ax * vz);
    out[o + 2] = c * vz + (ax * vy) + d * az;
  };
  const s = Math.sin(yaw), co = Math.cos(yaw);
  rot(s, 0, co, 0);          // forward: +z turned by the heading about UP, then onto the normal
  rot(co, 0, -s, 3);         // right:   +x likewise
  out[6] = nx; out[7] = ny; out[8] = nz;
  return out;
}

// The same for a body drawn by heading and pitch (Euler 'YXZ', no roll: a frog going up a stem, a hop, a swimmer).
export function pitchFrame(pitch, yaw, out = new Array(9)) {
  const sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  out[0] = cp * sy; out[1] = -sp; out[2] = cp * cy;
  out[3] = cy; out[4] = 0; out[5] = -sy;
  out[6] = sp * sy; out[7] = cp; out[8] = sp * cy;
  return out;
}

// The shift (dx, dy, dz) that brings a body at (px, py, pz) wholly inside the glass: |x| <= hx - m, |z| <= hz - m, y <= top - m.
// f: surfaceFrame or pitchFrame, body: { X, z0, z1, H } (cm, at its drawn size). The floor is the ground's business, so the box is
// only closed above. out = [dx, dy, dz]; zero when it is inside already.
export function glassPush(px, py, pz, f, body, hx, hz, top, m = 0.1, out = [0, 0, 0]) {
  const { X, z0, z1, H } = body, zc = (z0 + z1) / 2, zh = (z1 - z0) / 2, hc = H / 2, nx = f[6], ny = f[7], nz = f[8];
  // the body box's centre and its half extent along each world axis
  const cx = px + f[0] * zc + nx * hc, cy = py + f[1] * zc + ny * hc, cz = pz + f[2] * zc + nz * hc;
  const ex = Math.abs(f[0]) * zh + Math.abs(f[3]) * X + Math.abs(nx) * hc;
  const ey = Math.abs(f[1]) * zh + Math.abs(f[4]) * X + Math.abs(ny) * hc;
  const ez = Math.abs(f[2]) * zh + Math.abs(f[5]) * X + Math.abs(nz) * hc;
  // (a body wider than the room is centred in it)
  const fit = (c, e, lo, hi) => (2 * e > hi - lo ? (lo + hi) / 2 - c : c - e < lo ? lo - (c - e) : c + e > hi ? hi - (c + e) : 0);
  out[0] = fit(cx, ex, -hx + m, hx - m);
  out[1] = cy + ey > top - m ? -(cy + ey - (top - m)) : 0;
  out[2] = fit(cz, ez, -hz + m, hz - m);
  return out;
}

// The plane through the surface under four feet (fore F, hind B, right R, left L: [x, y, z] each): its unit normal, turned to the
// side `toward` (a unit vector, e.g. out of the background), and its point under the middle of the four. null when degenerate.
export function feetPlane(F, B, R, L, toward) {
  const t1x = F[0] - B[0], t1y = F[1] - B[1], t1z = F[2] - B[2];
  const t2x = R[0] - L[0], t2y = R[1] - L[1], t2z = R[2] - L[2];
  let nx = t1y * t2z - t1z * t2y, ny = t1z * t2x - t1x * t2z, nz = t1x * t2y - t1y * t2x;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return null;
  nx /= l; ny /= l; nz /= l;
  if (nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return { n: [nx, ny, nz], p: [(F[0] + B[0] + R[0] + L[0]) / 4, (F[1] + B[1] + R[1] + L[1]) / 4, (F[2] + B[2] + R[2] + L[2]) / 4] };
}

// A climber's surface normal with hysteresis: the target only moves when the new one differs by more than `band` radians (relief
// noise under a still gecko does not rock it), and the normal turns toward the target by at most `rate` rad/s, easing in the last
// part (a step onto the wall is a turn of a quarter second, not one frame). prev, want: unit [x, y, z]. Returns the new state
// { n, target }; prev null starts at `want`.
export function steadyNormal(state, want, dt, band = 0.12, rate = 5, ease = 12) {
  if (!state) return { n: [...want], target: [...want] };
  const t = state.target;
  if (angleOf(t, want) > band) { t[0] = want[0]; t[1] = want[1]; t[2] = want[2]; }
  const ang = angleOf(state.n, t);
  if (ang < 1e-5) return state;
  state.n = slerpUnit(state.n, t, easeAngle(ang, dt, rate, ease) / ang);
  return state;
}

// How far a frame may turn in one tick of dt seconds toward one `ang` radians away: easing (ease /s), at most `rate` rad/s.
export const easeAngle = (ang, dt, rate = 5, ease = 12) => Math.min(ang, ang * (1 - Math.exp(-dt * ease)), rate * dt);

export function angleOf(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

function slerpUnit(a, b, t) {
  const ang = angleOf(a, b);
  if (ang < 1e-6) return [...b];
  const s = Math.sin(ang);
  if (s < 1e-6) {                                    // (opposite: turn about any axis at right angles)
    const px = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ax = [a[1] * px[2] - a[2] * px[1], a[2] * px[0] - a[0] * px[2], a[0] * px[1] - a[1] * px[0]];
    const l = Math.hypot(...ax), th = ang * t;
    return a.map((v, i) => v * Math.cos(th) + (ax[i] / l) * Math.sin(th));
  }
  const wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
  const r = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb], l = Math.hypot(...r);
  return [r[0] / l, r[1] / l, r[2] / l];
}
