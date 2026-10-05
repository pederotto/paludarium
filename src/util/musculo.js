// Muscle mechanics shared by every body plan (docs/MUSCLES.md): a muscle-tendon unit (MTU) is a path of points fixed on bones (origin,
// via-points, insertion); its length and moment arms follow the pose; a Hill-type belly in series with an elastic tendon gives the
// fibres' length and the force for an activation; the belly keeps its volume, so it thickens as its fibres shorten. Pure functions on
// plain arrays (no imports: tests/architecture.test.mjs), used by content/anuranmuscles.js, the runtime (render/creatures/muscles.js),
// the bake (tools/rig/muscles.mjs) and the tests.
//
// Units: cm, g, s, N; angles in radians unless named `deg`.
//   frame     { o: [x, y, z] (the bone's head), a (unit, head to tail), L (length), r (the flesh radius about the bone), post, dors,
//             out (unit directions across the bone) }: built from a skeleton by the plan's content module
//   landmark  { t (along the bone, in bone lengths from the head), post, dors, out (across it, in flesh radii) }
//   muscle    the plan's record (content/anuranmuscles.js ANURAN_MUSCLES); here only what the mechanics need:
//             { lopt (optimal fibre length, cm), lts (tendon slack length, cm), alpha (pennation at lopt, rad), F0 (N), e0 (tendon
//             strain at F0) }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const vec = { sub, add, mul, dot, cross, len, norm };

// `d` with its component along unit `a` removed, normalised (the side of a bone a direction points to); `fallback` when `d` lies along `a`.
export function across(d, a, fallback = null) {
  const v = sub(d, mul(a, dot(d, a)));
  if (len(v) > 1e-6) return norm(v);
  return fallback ? across(fallback, a) : norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
}

// A landmark's position in the rest pose: along the bone from its head, then across it in flesh radii.
export function framePoint(F, lm) {
  const r = F.r;
  let p = add(F.o, mul(F.a, (lm.t ?? 0) * F.L));
  if (lm.post) p = add(p, mul(F.post, lm.post * r));
  if (lm.dors) p = add(p, mul(F.dors, lm.dors * r));
  if (lm.out && F.out) p = add(p, mul(F.out, lm.out * r));
  return p;
}

// The length of a path of points (an MTU from origin through its via-points to its insertion).
export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1]));
  return s;
}

// A tendon wrapping over a hinge (the knee aponeurosis over the knee, the plantaris tendon over the heel): the shortest path from P
// to Q that stays out of a cylinder of radius `rho` about the hinge axis (unit `n` through `C`) and goes round its outer side (away
// from `avoid`, the inside of the fold). Straight when the straight line already clears the cylinder on the outer side, or when either
// end lies inside it. Measured in the plane across the axis, the along-axis offset added as a helix. Returns its length.
export function wrapLength(P, Q, C, n, rho, avoid) {
  const p3 = sub(P, C), q3 = sub(Q, C), zp = dot(p3, n), zq = dot(q3, n);
  const e1 = across(avoid, n), e2 = cross(n, e1);
  const p = [dot(p3, e1), dot(p3, e2)], q = [dot(q3, e1), dot(q3, e2)];      // (+e1 is the inside of the fold)
  const dp = Math.hypot(p[0], p[1]), dq = Math.hypot(q[0], q[1]), dz = zq - zp;
  const straight = Math.hypot(q[0] - p[0], q[1] - p[1], dz);
  if (dp <= rho || dq <= rho) return straight;
  // the straight line's nearest point to the axis: clear of the cylinder and on the outer side means no wrap
  const ux = q[0] - p[0], uy = q[1] - p[1], uu = ux * ux + uy * uy || 1e-12;
  const k = clamp(-(p[0] * ux + p[1] * uy) / uu, 0, 1), cx = p[0] + ux * k, cy = p[1] + uy * k;
  if (Math.hypot(cx, cy) >= rho && cx <= 0) return straight;
  // round the outer side: of the two senses, the one whose arc stays on the -e1 side at its middle (the shorter if both do)
  const tp0 = Math.atan2(p[1], p[0]), tq0 = Math.atan2(q[1], q[0]), ap = Math.acos(rho / dp), aq = Math.acos(rho / dq);
  let best = Infinity;
  for (const s of [1, -1]) {
    const tp = tp0 + s * ap, tq = tq0 - s * aq;
    let arc = (s * (tq - tp)) % (2 * Math.PI);
    if (arc < 0) arc += 2 * Math.PI;
    const mid = tp + (s * arc) / 2;
    if (Math.cos(mid) > 0.2) continue;          // through the inside of the fold: not this way
    const L = Math.sqrt(dp * dp - rho * rho) + rho * arc + Math.sqrt(dq * dq - rho * rho);
    if (L < best) best = L;
  }
  return best === Infinity ? straight : Math.hypot(best, dz);
}

// A point moved by a bone's pose: R (3 x 3, row-major) about the bone's rest head `h0`, which goes to `h1`.
export function movePoint(R, h0, h1, p) {
  const d = sub(p, h0);
  return [h1[0] + R[0] * d[0] + R[1] * d[1] + R[2] * d[2], h1[1] + R[3] * d[0] + R[4] * d[1] + R[5] * d[2], h1[2] + R[6] * d[0] + R[7] * d[1] + R[8] * d[2]];
}

// Rotation by angle t about unit axis n (Rodrigues), row-major 3 x 3.
export function rotAxis(n, t) {
  const c = Math.cos(t), s = Math.sin(t), k = 1 - c, [x, y, z] = n;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}

// Moment arm by the virtual-work rule: r = -dL/dθ (cm), central difference with step h (rad). `lengthAt(θ)` gives the MTU length with
// the joint turned θ from the pose; positive r: the muscle shortens as θ grows, so pulling it turns the joint the + way.
export function momentArm(lengthAt, h = 0.01) {
  return -(lengthAt(h) - lengthAt(-h)) / (2 * h);
}

// --- Hill-type muscle and series tendon -------------------------------------------------------------------------------------------
// Normalised curves (fibre length over lopt, velocity over vmax, + shortening). Standard forms (Zajac 1989; Thelen 2003): active force-
// length a Gaussian of width `W`, passive an exponential from lopt, force-velocity Hill's hyperbola (a/F0 = `K`) shortening and a
// plateau at 1.5 F0 lengthening; tendon force rises from its slack length to F0 at strain e0 (quadratic toe, then linear).
export const HILL = { W: 0.45, KPE: 4, E0M: 0.6, K: 0.25, ECC: 1.5, tag: 'scaled: Thelen 2003 (W, KPE, E0M; mammalian, not frog), K and ECC guesses' };
// (exp(-(l - 1)² / W), Thelen 2003; until 5 Oct the code squared (l - 1) / W, a curve half as wide: FL(0.5) 0.29 for 0.57, C1b round 3)
export const forceLength = (l) => Math.exp(-((l - 1) ** 2) / HILL.W);
export const passiveForce = (l) => (l <= 1 ? 0 : (Math.exp((HILL.KPE * (l - 1)) / HILL.E0M) - 1) / (Math.exp(HILL.KPE) - 1));
export function forceVelocity(v) {
  if (v >= 1) return 0;
  if (v >= 0) return (1 - v) / (1 + v / HILL.K);
  // lengthening: up to ECC x F0, leaving 1 with the same steepness the shortening side has (1 + 1 / K)
  const s = (HILL.ECC - 1) / (1 + 1 / HILL.K);
  return HILL.ECC - (HILL.ECC - 1) * Math.exp(v / s);
}
// Tendon force over F0 at strain e (e0: the strain at F0): a quadratic toe up to e0 / 3, linear above, continuous with its slope.
export function tendonForce(e, e0) {
  if (e <= 0) return 0;
  const et = e0 / 3, k = 1 / (e0 - et / 2);       // linear slope chosen so f(e0) = 1 with a toe that meets it smoothly
  return e < et ? (k / (2 * et)) * e * e : k * (e - et / 2);
}
// Elastic energy (J, with F0 in N and lengths in cm) a tendon of slack length lts holds at strain e.
export function tendonEnergy(e, e0, F0, lts) {
  if (e <= 0) return 0;
  const n = 32, de = e / n;
  let w = 0;
  for (let i = 0; i < n; i++) w += tendonForce((i + 0.5) * de, e0) * de;
  return w * F0 * lts * 0.01;
}

// The fibres' state for an MTU of length `lmtu` at activation `a` (0 … 1), the belly in equilibrium with its tendon and moving at
// `vf` (fibre velocity over vmax, + shortening; 0 for a static pose). Pennation by the constant-thickness rule: lf sin α = lopt sin α0.
// Returns { lf (cm), ln (lf / lopt), alpha, F (N, along the tendon), e (tendon strain), lt (tendon length, cm), clamped (no equilibrium
// inside the bracket: the MTU too short or too long for the muscle; the edge is returned) }. Bisection on the fibre
// length: robust for any MTU length; `steps` halvings of a 2 lopt bracket (24: 1e-7 lopt; the runtime's 14: 1e-4 lopt, far below a
// visible change).
export function fibreState(m, lmtu, a, vf = 0, steps = 24) {
  const h = m.lopt * Math.sin(m.alpha ?? 0), fv = forceVelocity(vf);
  const fm = (lf) => {
    const ln = lf / m.lopt, cosA = h > 0 ? Math.sqrt(Math.max(0, 1 - (h / lf) ** 2)) : 1;
    return { ln, cosA, f: (a * forceLength(ln) * fv + passiveForce(ln)) * cosA };
  };
  let lo = Math.max(h * 1.0001, 0.2 * m.lopt), hi = 2.2 * m.lopt;
  const lo0 = lo, hi0 = hi, edge = 1e-3 * m.lopt;
  let s = null;
  for (let i = 0; i < steps; i++) {
    const lf = (lo + hi) / 2, q = fm(lf);
    const lt = lmtu - lf * q.cosA, e = lt / m.lts - 1, ft = tendonForce(e, m.e0);
    // muscle force too high for the tendon's stretch: the fibres are too long (passive) or too strong; longer fibres leave less tendon
    if (q.f > ft) hi = lf; else lo = lf;
    s = { lf, q, lt, e };
  }
  const q = s.q;
  return { lf: s.lf, ln: q.ln, alpha: Math.acos(q.cosA), F: tendonForce(s.e, m.e0) * m.F0, e: Math.max(0, s.e), lt: s.lt, clamped: s.lf - lo0 < edge || hi0 - s.lf < edge };
}

// --- Mass, force, the belly's shape ------------------------------------------------------------------------------------------------
export const RHO = 1.06;                 // g/cm³, muscle (Mendez & Keys 1960)
// Physiological cross-section (cm²) from mass (g), optimal fibre length (cm) and pennation (rad); maximum force (N) at a specific
// tension `sigma` (N/cm²).
export const pcsaOf = (massG, lopt, alpha = 0) => (massG * Math.cos(alpha)) / (RHO * lopt);
export const forceOf = (pcsa, sigma) => pcsa * sigma;

// A belly as a spindle along its line: radius R x sin(πu) at u = 0 … 1 of its length lb, so its volume is π R² lb / 2.
export const bellyRadius = (volume, lb) => Math.sqrt((2 * volume) / (Math.PI * Math.max(1e-6, lb)));
export const bellyProfile = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);
// The belly's change as its fibres go from lf0 to lf (volume kept): its length changes by the fibres' change along the line of pull,
// its radius by the square root of the inverse; it bunches toward its origin (the end held by the shorter tendon), so its middle
// slides by half the change. Returns { dR (cm at the peak), slide (in belly lengths, + toward the insertion), lb (cm) }.
export function bellyChange(R0, lb0, lf0, lf, cosA = 1) {
  const lb = Math.max(0.25 * lb0, lb0 + (lf - lf0) * cosA);
  return { dR: R0 * (Math.sqrt(lb0 / lb) - 1), slide: (lb - lb0) / (2 * lb0), lb };
}

// First-order activation dynamics: excitation u to activation a, faster up (tauA) than down (tauD), s.
export function activationStep(a, u, dt, tauA = 0.01, tauD = 0.04) {
  const tau = u > a ? tauA : tauD;
  return a + (u - a) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

