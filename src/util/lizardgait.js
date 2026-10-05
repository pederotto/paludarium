// The lizard gait (G4; geckos now, skinks on the same code): from the body's speed and turn rate, the phase of each leg, its
// stance and swing, where each foot goes, the trunk's S-bend, the head held steady against it, the tail's counter-sway, the
// toes' attach and peel, and starting, stopping and standing still. Pure numbers (no three.js, no world), so
// tests/lizardgait.test.mjs runs it under Node. The API is in docs/agents/lizards/CONTRACTS.md ("lizardgait API").
//
// Units: cm, s, rad. Leg ids 1 front-left, 2 front-right, 3 hind-left, 4 hind-right (util/gait.js TROT). The body frame is
// util/contain.js surfaceFrame's: +z forward, +x right, +y the surface normal, origin at the body's place on the surface (a.pos).
// Foot targets for the pose are in the model's own centimetres (body cm / draw scale). A leg's cycle u runs 0 … 1 from touchdown:
// stance while u < duty, then the swing.
//
// Where every number comes from (docs/agents/lizards/MOTION_gecko.md line; P published, E estimated from the frames, G a guess
// made here, on no sheet): see the profile below. Speeds in the game: herp.js PROFILES.gecko (creep 1.6, walk 4.5, dash 13 cm/s).

const TAU = Math.PI * 2, RAD = Math.PI / 180;
const frac = (x) => x - Math.floor(x);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (q) => q * q * (3 - 2 * q);

export const GAIT = {
  gecko: {
    svl: 4.4,                          // cm snout to vent (CONTRACTS bone list: the lead's literature figure)
    strideMin: 0.45, strideMax: 1.2,   // stride (body travel per cycle) in SVL: :60/:68 P (from v/f)
    fMax: 13.6,                        // Hz: :68 P (12.5 Hz scaled by sqrt(4.4 / 5.2)); slower speeds keep the shortest stride
    duty: [0.65, 0.5], vSlow: 4.5, vFast: 13,   // duty 0.5 at a dash :59 P, above 0.6 slow :32 E; eased between walk and dash: G
    off: { 1: 0, 2: 0.5, 3: 0.43, 4: 0.93 },     // cycle offsets: diagonals in phase 0.93, same side 0.45 :58 P (hind lag sign: G)
    wave: { spine: 10 * RAD, neck: 7 * RAD },    // S-bend: +-10 deg mid-trunk, +-15-20 at the shoulders :36 E; timing :65 P
    tailGain: 0.5, tailMax: 10 * RAD, tailLag: 0.05, tailBones: 5,   // lateral <= 10 deg :36 E, passive :66 P; gain, lag: G
    lift: 0.04,                        // swing height in SVL: G (G1c measured 0.14-0.36 cm today)
    belly: { ground: 0.03, wall: 0.01 },          // cm: < 0.05 body depth :24 E; belly in contact on bark :27 E
    attach: 0.13, peel: 0.36,          // pad attach and toe peel, fractions of stance :61 P
    settle: 0.3, vMin: 0.05,           // s for the wave to die out, cm/s below which it stands: G
    sprawl: { fore: [0.7, 0.35], hind: [0.75, 0] },   // knuckle from shoulder (hip), lateral and forward, in limb reaches :24 E
    restFeet: true,                    // stand where the baked rest pose has its feet (its tips already 0.88-0.94 reach out: G4a)
  },
};

// The gait for speed v (cm/s), turn rate w (rad/s) and the feet's mean distance from the body's middle `reach` (cm): turning on
// the spot steps as fast as the feet travel. A body drawn at `scale` takes strides that much shorter.
export function gaitAt(P, v, w = 0, reach = 0, scale = 1, out = {}) {
  const veff = Math.max(Math.abs(v), Math.abs(w) * reach);
  const stride = clamp(veff / P.fMax, P.strideMin * P.svl * scale, P.strideMax * P.svl * scale);
  const t = clamp((veff - P.vSlow) / (P.vFast - P.vSlow || 1), 0, 1);
  out.veff = veff; out.stride = stride; out.f = veff / stride; out.rate = TAU / stride;
  out.duty = P.duty[0] + (P.duty[1] - P.duty[0]) * t;
  return out;
}

export const legU = (P, phase, leg) => frac(phase / TAU - P.off[leg]);
export const stanceOf = (u, duty) => (u < duty ? u / duty : -1);
// 1 = toes flat and stuck; they uncurl onto the surface over the first `attach` of the stance and peel tip first over the last `peel`
export const peelOf = (P, s) => (s < 0 ? 0 : clamp(Math.min(s / P.attach, (1 - s) / P.peel), 0, 1));

// the cycle at which the second diagonal pair (hind-left + front-right) lands
const landC = (P) => frac(P.off[3] + (frac(P.off[2] - P.off[3] + 0.5) - 0.5) / 2);

// The axial wave: joint yaw (rad, + turns the front toward +x) of spine and neck; head = -(spine + neck), so the head keeps its
// heading; tail[i] = the lateral swing of tail bone i (+ toward +x), against the front's and later down the tail. The trunk is
// convex right (front turned toward -x) as hind-left + front-right land, straight at mid-stance, convex left at the other pair.
export function axialAt(P, phase, calm = 0, out = {}) {
  const k = 1 - clamp(calm, 0, 1), n = P.tailBones, t = (out.tail ??= new Array(n).fill(0));
  if (k <= 0) { out.spine = 0; out.neck = 0; out.head = 0; t.fill(0); return out; }
  const c = phase / TAU - landC(P), b = -Math.cos(TAU * c) * k;
  out.spine = P.wave.spine * b; out.neck = P.wave.neck * b; out.head = -(out.spine + out.neck);
  const A = (Math.min(P.tailMax, P.tailGain * (P.wave.spine + P.wave.neck)) / n) * k;
  for (let i = 0; i < n; i++) t[i] = A * Math.cos(TAU * (c - P.tailLag * (i + 1)));
  return out;
}

// The four feet's rest places (the digit knuckle on the surface, y = 0, model cm, index leg - 1) in the sheet's sprawl, from the
// limb chains (lizardpose.js lizardRig: limb, side, A = shoulder or hip, reach = its rest distance to the knuckle).
export function neutralFeet(P, chains) {
  const out = [null, null, null, null];
  for (const c of chains) {
    if (P.restFeet && c.T) { out[c.limb - 1] = [c.T[0], 0, c.T[2]]; continue; }
    const [lat, fwd] = c.limb <= 2 ? P.sprawl.fore : P.sprawl.hind;
    out[c.limb - 1] = [c.A[0] + c.side * lat * c.reach, 0, c.A[2] + fwd * c.reach];
  }
  return out;
}
const reachOf = (feet0) => feet0.reduce((m, p) => m + Math.hypot(p[0], p[2]), 0) / 4;

// where a point fixed on the surface that is at (nx, nz) at the middle of its stance is `tau` s before that, for a body going
// forward at v and turning at w
function place(nx, nz, tau, v, w, out) {
  const a = w * tau, c = Math.cos(a), s = Math.sin(a);
  out[0] = nx * c + nz * s; out[1] = 0; out[2] = -nx * s + nz * c + v * tau;
  return out;
}

const arrays = (out) => {
  out.feet ??= [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  out.lift ??= [0, 0, 0, 0]; out.peel ??= [0, 0, 0, 0]; out.stance ??= [0, 0, 0, 0];
  return out;
};
const _g = {}, _a = [0, 0, 0], _c = [0, 0, 0];

// Foot targets without state (a far lizard, or a test): the closed form of a steady walk at the gait's phase. Model cm.
// `stride` (model cm per cycle, optional): a caller whose phase runs at that stride gets stance feet that do not slide at it.
export function openFeet(P, feet0, phase, v, w, scale = 1, out = {}, stride = 0) {
  arrays(out);
  const g = gaitAt(P, v, w, reachOf(feet0) * scale, scale, _g), Tst = g.f > 0 ? g.duty / g.f : 0;
  const vm = stride > 0 && Tst > 0 ? (stride * g.duty) / Tst : v / scale;
  for (let k = 0; k < 4; k++) {
    const n = feet0[k], u = legU(P, phase, k + 1), s = stanceOf(u, g.duty), o = out.feet[k];
    if (s >= 0) {
      place(n[0], n[2], (0.5 - s) * Tst, vm, w, o); o[1] = n[1];
      out.lift[k] = 0; out.peel[k] = peelOf(P, s); out.stance[k] = 1;
    } else {
      const q = (u - g.duty) / (1 - g.duty), e = smooth(q), h = P.lift * P.svl * Math.sin(Math.PI * q);
      place(n[0], n[2], -Tst / 2, vm, w, _a); place(n[0], n[2], Tst / 2, vm, w, _c);
      o[0] = _a[0] + (_c[0] - _a[0]) * e; o[1] = n[1] + h; o[2] = _a[2] + (_c[2] - _a[2]) * e;
      out.lift[k] = h; out.peel[k] = 0; out.stance[k] = 0;
    }
  }
  return out;
}

// pose = { p: [x, y, z], f: surfaceFrame's 9 (forward, right, up) }: body frame <-> world
export function toWorld(pose, b, out = [0, 0, 0]) {
  const { p, f } = pose;
  for (let j = 0; j < 3; j++) out[j] = p[j] + b[0] * f[3 + j] + b[1] * f[6 + j] + b[2] * f[j];
  return out;
}
export function toBody(pose, w, out = [0, 0, 0]) {
  const { p, f } = pose, dx = w[0] - p[0], dy = w[1] - p[1], dz = w[2] - p[2];
  out[0] = dx * f[3] + dy * f[4] + dz * f[5]; out[1] = dx * f[6] + dy * f[7] + dz * f[8]; out[2] = dx * f[0] + dy * f[1] + dz * f[2];
  return out;
}

// One animal's planted feet. feet: per foot 12 floats = world point 3, surface normal 3, lift-off point 3, stance 1/0, lift (cm),
// stance fraction (-1 in the swing, 0.5 while it stands still).
export function lgNew(P, feet0) {
  return { phase: 0, calm: 1, f: 0, duty: P.duty[0], still: true, init: false, feet0, reach: reachOf(feet0), feet: new Float32Array(48), g: {} };
}

const _b = [0, 0, 0], _w = [0, 0, 0], _s = [0, 0, 0, 0, 0, 0], _up = [0, 1, 0];
function plant(F, o, s6) { for (let j = 0; j < 6; j++) F[o + j] = s6[j]; }

// At a start the pair whose feet stand further back (against the sprawl) lifts first: the phase at which its first leg lifts.
function startPhase(s, P, pose, duty, scale) {
  const F = s.feet, back = (k) => toBody(pose, [F[k * 12], F[k * 12 + 1], F[k * 12 + 2]], _b)[2] / scale - s.feet0[k][2];
  const [a, b] = back(0) + back(3) <= back(1) + back(2) ? [1, 4] : [2, 3];
  const ca = frac(P.off[a] + duty), cb = frac(P.off[b] + duty);
  return TAU * (frac(cb - ca) < 0.5 ? ca : cb);
}

// One step of dt s for a body at `pose` going at v (cm/s) and turning at w (rad/s). surf(x, y, z, n, out) puts a point onto the
// surface (out = [px, py, pz, nx, ny, nz]); it is called only where a foot lands. A stance foot's world point is never changed.
// Stopping: feet in the air finish their swing, none lifts again; then the phase stands still and the wave dies out.
export function lgStep(s, P, pose, v, w, dt, surf, scale = 1) {
  const F = s.feet, f = pose.f;
  _up[0] = f[6]; _up[1] = f[7]; _up[2] = f[8];
  const g = gaitAt(P, v, w, s.reach * scale, scale, s.g), moving = g.veff > P.vMin * scale;
  if (!s.init) {
    for (let k = 0; k < 4; k++) {
      const n = s.feet0[k], o = k * 12;
      toWorld(pose, [n[0] * scale, 0, n[2] * scale], _w);
      plant(F, o, surf(_w[0], _w[1], _w[2], _up, _s));
      F[o + 9] = 1; F[o + 10] = 0; F[o + 11] = 0.5;
    }
    s.init = true; s.still = true;
  }
  if (moving) {
    if (s.still) { s.still = false; s.phase = startPhase(s, P, pose, g.duty, scale); }
    s.f = g.f; s.duty = g.duty;
    s.phase = TAU * frac((s.phase + TAU * g.f * dt) / TAU);
  } else if (!s.still) {
    if (F[9] && F[21] && F[33] && F[45]) s.still = true;
    else s.phase = TAU * frac((s.phase + TAU * s.f * dt) / TAU);
  }
  s.calm += ((moving ? 0 : 1) - s.calm) * (1 - Math.exp((-3 * dt) / P.settle));
  const Tst = s.f > 0 ? s.duty / s.f : 0, Tsw = s.f > 0 ? (1 - s.duty) / s.f : 0;
  for (let k = 0; k < 4; k++) {
    const o = k * 12, n = s.feet0[k], u = legU(P, s.phase, k + 1), st = stanceOf(u, s.duty);
    const want = s.still || (!moving && F[o + 9] === 1) || st >= 0 ? 1 : 0;
    if (F[o + 9] === 1 && want === 0) { F[o + 6] = F[o]; F[o + 7] = F[o + 1]; F[o + 8] = F[o + 2]; F[o + 9] = 0; }
    if (F[o + 9] === 1) { F[o + 11] = moving && st >= 0 ? st : 0.5; continue; }
    // in the air: from the lift-off point toward where it will land, which moves with the body until it does
    const q = want ? 1 : clamp((u - s.duty) / (1 - s.duty), 0, 1);
    place(n[0] * scale, n[2] * scale, Tst / 2 + (1 - q) * Tsw, moving ? v : 0, moving ? w : 0, _b);
    toWorld(pose, _b, _w);
    if (want) {
      plant(F, o, surf(_w[0], _w[1], _w[2], _up, _s));
      F[o + 9] = 1; F[o + 10] = 0; F[o + 11] = moving && st >= 0 ? st : 0.5;
    } else {
      const e = smooth(q), h = P.lift * P.svl * scale * Math.sin(Math.PI * q);
      for (let j = 0; j < 3; j++) F[o + j] = F[o + 6 + j] + (_w[j] - F[o + 6 + j]) * e + _up[j] * h;
      F[o + 10] = h; F[o + 11] = -1;
    }
  }
  return s;
}

// The pose's inputs from the state: each foot's target in the body frame (model cm), its lift, its toe peel and stance flag.
export function lgFeet(s, P, pose, scale = 1, out = {}) {
  arrays(out);
  const F = s.feet;
  for (let k = 0; k < 4; k++) {
    const o = k * 12, b = out.feet[k];
    _a[0] = F[o]; _a[1] = F[o + 1]; _a[2] = F[o + 2];
    toBody(pose, _a, b);
    b[0] /= scale; b[1] /= scale; b[2] /= scale;
    out.lift[k] = F[o + 10] / scale; out.peel[k] = peelOf(P, F[o + 11]); out.stance[k] = F[o + 9];
  }
  return out;
}

// How far (cm) the body comes down along its normal from its rest belly height to the sheet's clearance ('ground' or 'wall';
// glass and bark are walls).
export const bellyDrop = (P, surface, restBelly) => Math.max(0, restBelly - (surface === 'ground' ? P.belly.ground : P.belly.wall));
