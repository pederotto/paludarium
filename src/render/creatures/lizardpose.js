// Lizard skeletons at run time (geckos, skinks: util/bodyplan.js PLANS.lizard; the bone list in docs/agents/lizards/CONTRACTS.md,
// "Lizard bone list"): the rig made from a baked skeleton (tools/bake-lizard.mjs, manifest `skeleton` with plan 'lizard') and its
// pose each frame. render/creatures/skeleton.js hands a lizard skeleton here (skeletonRig) and calls `rig.pose` from poseBones. The
// frog's own helpers come in as `deps` (musclesOf, writeBones, footOffset): the muscles swell exactly as a frog's do (the plan's
// bellies with their joint's flexion, applied as the bones are written), and this module imports nothing from skeleton.js.
//
// The pose (G1b). Three parts, each its own function, so the lizard gait (G4, util/lizardgait.js) can replace `legs` alone:
//   axial  the channels the vertex rig drew the gecko with (render/creatures/instanced.js rig2: head yaw and pitch, the body's C-bend,
//          the tail's swing and lift; util/gait.js rig2Pack) as yaw and pitch of the spine, neck, head and tail joints, each held to
//          its range (PLANS.lizard.rom). A bend that moved a point d cm from the pivot by k d² in the vertex rig is a curvature 2k
//          spread over the joints by their bones' lengths, so the skinned body takes the same curve.
//   legs   each foot's (hand's) tip goes where the vertex rig put it (skeleton.js footOffset: the walk's lift and sweep, the turn's
//          swing round the pivot), the limb turned as a whole about the shoulder
//          (hip) and its elbow (knee) opened or closed for the reach. With the legs still (calm 1) every bone is exactly at rest.
//   cut    a gecko that dropped its tail: the tail bones past the cut collapse onto it (the stump); the dropped piece itself (another
//          instance, `piece` > 0) shows only the tail bones past its cut.
// The muscles (G2, util/lizardmuscles.js): the plan's bellies swell through the frog's writeBones (one a bone a frame, the strongest);
// channels in `st`: tailBase (rad, the tail base's yaw with the hind legs), peel (0 … 1, a number or [foreL, foreR, hindL, hindR]),
// jaw and throat (0 … 1).
import { PLANS, bendAngle } from '../../util/bodyplan.js';
import { lizardMuscles, swellOf, peelAxis, toePeel, headSwell } from '../../content/lizardmuscles.js';
import { GAIT, neutralFeet, openFeet, axialAt, bellyDrop, reachFit } from '../../util/lizardgait.js';
import { strideFor } from '../../util/gait.js';
// the most the trunk is lowered toward the sheet's belly-down sprawl (cm, model): the skin-stretch limit's (G4a)
export const DROP_MAX = 0.16;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// 3 x 3 matrices as 9 numbers, row-major (as skeleton.js)
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mm = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };     // + turns +z toward +x
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };     // + turns +z toward -y
const RAD = Math.PI / 180;
const TAILS = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];

// The runtime form of a lizard skeleton, or null when a bone it needs is missing. `anim`: the species' rig numbers and its turning
// frame, as skeletonRig takes them.
// N6b: the part of a foot's rest height above the lowest foot (cm) that is left as it is (see buildRig)
const PLANT_DEAD = 0.15;
const FOLD = 0.8;   // the elbow / knee fold's range in legs(), rad either way (the reach guard's spans use it too)

export function lizardRig(skel, { legLift = 0.25, legStride = 0.35, limb = 1, turn = null, reach = 0.85 } = {}, deps = {}) {
  const plan = PLANS.lizard, B = skel.bones, n = B.length, byName = Object.fromEntries(B.map((b, i) => [b.name, i]));
  const head = B.map((b) => b.head), tail = B.map((b) => b.tail);
  const dir = B.map((b) => norm(sub(b.tail, b.head))), L = B.map((b) => len(sub(b.tail, b.head)));
  const parent = B.map((b) => (b.parent != null ? byName[b.parent] ?? -1 : -1));
  if (['pelvis', 'spine', 'neck', 'head'].some((k) => byName[k] == null) || parent.some((p, b) => p >= b)) return null;   // (parents first)
  const chains = [];
  for (const [s, side, fore, hind] of [['L', -1, 1, 3], ['R', 1, 2, 4]]) {
    for (const [limbId, names] of [[hind, ['thigh', 'shin', 'foot', 'toes']], [fore, ['arm', 'forearm', 'hand', 'fingers']]]) {
      const ids = names.map((k) => byName[k + s]);
      if (ids.slice(0, 3).some((i) => i == null)) return null;
      const [u, w, ...ends] = ids.filter((i) => i != null);
      const A = head[u], K = head[w], E = head[ends[0]], T = tail[ends[ends.length - 1]];
      chains.push({ limb: limbId, side, u, w, ends, A, K, E, T,
        nk: planeNormal(K, A, E, [side, 0, 0]), reach0: len(sub(T, A)) });
    }
  }
  // N6b: each foot planted at its own rest height. A model posed with its feet at different heights (the skink's hind soles sit
  // ~0.35 cm above its fore soles, LZ/reports/S1a.md) would keep the higher feet floating: `plant` is how far the foot's lowest
  // bone point (head or tail of its hand / foot bones) sits above the lowest foot's at rest, taken off its target in legs().
  // Only the part past PLANT_DEAD is taken off: a rig with its feet near level (the gecko) is unchanged, and the hind leg reaches no
  // further down than the target needs (planting the whole 0.5 cm opened the knee: 0.15 % of edges past 2x against 0.07 %).
  for (const c of chains) c.low = Math.min(...c.ends.flatMap((e) => [head[e][1], tail[e][1]]));
  const low0 = Math.min(...chains.map((c) => c.low));
  for (const c of chains) c.plant = Math.max(0, c.low - low0 - PLANT_DEAD);
  const tails = TAILS.map((k) => byName[k]).filter((i) => i != null);
  // the vertex rig's spine fraction of each bone's head: 0 at the snout, 1 at the tail's tip (where a dropped tail is cut)
  const z0 = tail[byName.head][2], z1 = tails.length ? tail[tails[tails.length - 1]][2] : head[0][2];
  const sOf = head.map((h) => clamp((z0 - h[2]) / (z0 - z1 || 1), 0, 1));
  const rig = { n, B, byName, head, tail, dir, L, parent, chains, tails, plan, legLift, legStride, limb, turn, reach,
    front: ['spine', 'neck', 'head'].map((k) => byName[k]), len: Math.abs(z0 - z1) || 1, sOf, vent: tails.length ? sOf[tails[0]] : 1,
    limits: B.map((b) => plan.joints[b.name.replace(/[LR]$/, '').replace(/\d+$/, '')] ?? null),
    pose: poseLizard, write: deps.writeBones, foot: deps.footOffset, species: skel.species ?? 'gecko' };
  // the muscles (G2): every belly of the plan (`bellies`); `muscles` is what the last pose swells (one a bone)
  rig.bellies = lizardMuscles(B, byName, parent, dir, L, rig.species, plan);
  rig.muscles = rig.bellies; rig.active = []; rig.best = new Int32Array(n);
  // the fans' peel axes (rest frame, by bone) and the head's axes for the jaw (side) and the throat (up) swell
  rig.peelAxes = [];
  for (const c of chains) if (c.ends[1] != null) rig.peelAxes[c.ends[1]] = peelAxis(dir[c.ends[1]]);
  const dh = dir[byName.head], up = norm(sub([0, 1, 0], mul(dh, dh[1])));
  rig.headAxes = { up, side: norm(cross(up, dh)) };
  // the gait (G4, util/lizardgait.js): the feet's sprawled rest places (each limb's tip, from its shoulder or hip and its reach),
  // the trunk's lowest point at rest (bone axis minus radius, as tools/steps/lizard-cycle.mjs measures it) and its drop to the sheet's
  rig.gait = GAIT[rig.species] ?? GAIT.gecko;
  rig.feet0 = neutralFeet(rig.gait, chains.map((c) => ({ limb: c.limb, side: c.side, A: c.A, T: c.T, reach: c.reach0 })));
  // N7 reach guard: each foot's fore-aft span on its sole plane that the leg reaches with the fold in its range (legs(): +-FOLD rad),
  // then the stance centred on it and the stride capped to it (util/lizardgait.js reachFit; the planted feet, lgNew, use both).
  rig.spans = chains.map((c) => {
    let lo = Infinity, hi = 0;
    for (let p = -FOLD; p <= FOLD + 1e-9; p += FOLD / 40) { const r = len(sub(foldTip(c, p), c.A)); lo = Math.min(lo, r); hi = Math.max(hi, r); }
    const f = rig.feet0[c.limb - 1], y = c.T[1] - c.plant + f[1], ok = [];
    for (let dz = -3; dz <= 3 + 1e-9; dz += 0.025) { const D = len(sub([f[0], y, f[2] + dz], c.A)); if (D >= lo && D <= hi) ok.push(dz); }
    // the trunk's S-bend turns the girdle (+- wave.spine), moving the foot fore-aft against its shoulder (hip) by its lateral reach
    // times sin(wave): that much of each end is kept free
    const m = Math.abs(f[0] - c.A[0]) * Math.sin(rig.gait.wave.spine);
    return { limb: c.limb, span: ok.length && ok[ok.length - 1] - ok[0] > 2 * m ? [ok[0] + m, ok[ok.length - 1] - m] : [0, 0] };
  }).sort((a, b) => a.limb - b.limb).map((x) => x.span);
  const fit = reachFit(rig.feet0, rig.spans, rig.gait.duty[0]);
  // NOT YET SAFE TO DRAW WITH (N7, 5 Oct): posing on feetFit puts 0.44 % of the skin past 2x stretch (limit 0.2; shift <= 0.1 cm: 0.25 %).
  // The closed form below stays on feet0; geckoDraw (planted feet) uses these and must not be wired until the stretch is solved.
  rig.feetFit = fit.feet; rig.strideCap = fit.cap;
  rig.restBelly = Math.min(...['pelvis', 'spine'].map((k) => byName[k]).flatMap((b) => [head[b][1], tail[b][1]].map((y) => y - (B[b].r ?? 0))));
  rig.drop = Math.min(bellyDrop(rig.gait, 'ground', rig.restBelly), DROP_MAX);
  return rig;
}

// the normal of the limb's plane (root, knee, ankle), or `fallback` for a limb laid out straight
function planeNormal(A, K, E, fallback) {
  const c = cross(sub(E, A), sub(K, A));
  return len(c) > 1e-9 ? norm(c) : norm(fallback);
}

// One instance's bones for `st` = { phase, tau, calm (the gait's), yaw, pitch (head, rad), bend, tail, lift (fractions of the body's
// length), tailF (0 … 1 of the tail left), piece (the cut of a dropped piece) }: writes 12 floats a bone into `out` from `o`.
// Returns `info` (if given) with each limb's reached tip ({ tips }).
export function poseLizard(rig, st, out, o = 0, info = null) {
  const { n, head, parent } = rig;
  const Lr = new Array(n).fill(null);           // each bone's turn against its parent, in the rest frame about its head
  // the trunk lowered toward the surface (st.drop, model cm; by default the sheet's belly height while it walks, none at rest)
  const drop = st.drop ?? rig.drop * (1 - clamp(st.calm ?? 0, 0, 1));
  axial(rig, st, Lr);
  const R = new Array(n), H = new Array(n);    // world (model) rotation of each bone and where its head is
  for (let b = 0; b < n; b++) {
    const p = parent[b];
    if (p < 0) { R[b] = Lr[b] ?? I3(); H[b] = drop ? [head[b][0], head[b][1] - drop, head[b][2]] : head[b]; continue; }
    R[b] = Lr[b] ? mm(R[p], Lr[b]) : R[p];
    H[b] = addv(H[p], mv(R[p], sub(head[b], head[p])));
  }
  if (info) info.tips = {};
  legs(rig, st, R, H, info);
  peel(rig, st, R);
  swellHead(rig, st, R);
  cut(rig, st, R, H);
  rig.muscles = active(rig, R);
  rig.write(rig, R, H, out, o);
  return info;
}

// The toe channel (G2): st.peel, one number for all four feet or [foreL, foreR, hindL, hindR], 0 attached flat … 1 peeled: each fan
// (toes, fingers) turns about its knuckle so its tip goes up and back toward the heel (util/lizardmuscles.js toePeel, peelAxis).
function peel(rig, st, R) {
  const p = st.peel;
  if (!p) return;
  for (const c of rig.chains) {
    const f = c.ends[1], v = typeof p === 'number' ? p : p[c.limb - 1] ?? 0;
    const a = f == null ? 0 : toePeel(v, c.limb >= 3 ? 'toes' : 'fingers', rig.plan);
    if (a > 0) R[f] = mm(R[f], rotAxis(rig.peelAxes[f], a));
  }
}

// The jaw and throat channels (G2): st.jaw (0 … 1, the adductors clenched) widens the head, st.throat (0 … 1, the gular pump; at rest
// util/lizardmuscles.js throatFlutter) deepens it: the head bone swollen about its axis, S = I + jaw s sᵀ + throat u uᵀ.
function swellHead(rig, st, R) {
  if (!st.jaw && !st.throat) return;
  const { jaw, throat } = headSwell(st.jaw ?? 0, st.throat ?? 0, rig.species), { up: u, side: s } = rig.headAxes, hd = rig.front[2];
  const S = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (r === c ? 1 : 0) + jaw * s[r] * s[c] + throat * u[r] * u[c]));
  R[hd] = mm(R[hd], S);
}

// The bellies this pose swells. The frog's writeBones swells a bone by one belly (the last it meets), so of a bone's bellies (the
// hip's swing and push, the tail base pulled by either leg) it gets the strongest one shortening, else the most stretched.
function active(rig, R) {
  const { bellies, parent, dir, best } = rig, act = rig.active;
  act.length = 0; best.fill(-1);
  for (const m of bellies) {
    const pj = parent[m.j];
    if (R[m.j] === ZERO || R[pj] === ZERO) continue;          // a bone of a dropped tail's piece
    const k = swellOf(m, bendAngle(mv(R[pj], rig.dir[pj]), mv(R[m.j], dir[m.j])));
    if (Math.abs(k) < 1e-4) continue;
    const i = best[m.b];
    if (i < 0) { best[m.b] = act.length; act.push(m); m.now = k; }
    else if (k > 0 ? k > act[i].now : act[i].now < 0 && k < act[i].now) { act[i] = m; m.now = k; }
  }
  return act;
}

// The trunk, neck, head and tail: the rig2 channels as joint yaw and pitch, each inside its range.
function axial(rig, st, Lr) {
  const { L, parent } = rig, rom = rig.plan.rom ?? {};
  const lim = (k, axis, v) => { const r = rom[k]?.[axis]; return r ? clamp(v, r[0] * RAD, r[1] * RAD) : v; };
  const kB = (2 * (st.bend ?? 0)) / rig.len, kT = (8 * (st.tail ?? 0)) / rig.len, kL = (8 * (st.lift ?? 0)) / rig.len;
  // the head's yaw and pitch shared by the neck and the head: the neck takes half, the head the rest, the neck again what the head cannot
  const share = (v, axis) => {
    let a = lim('neck', axis, v * 0.5);
    const h = lim('head', axis, v - a);
    a = lim('neck', axis, v - h);
    return [a, h];
  };
  const [yN, yH] = share(st.yaw ?? 0, 'yaw'), [pN, pH] = share(st.pitch ?? 0, 'pitch');
  const [sp, nk, hd] = rig.front;
  // the gait's S-bend, the head turned back against it, the tail's counter-sway (util/lizardgait.js axialAt; none at calm 1)
  const ax = axialAt(rig.gait, st.phase ?? 0, st.calm ?? 0, (rig._ax ??= {}));
  Lr[sp] = rotY(lim('spine', 'yaw', kB * L[sp] + ax.spine));
  Lr[nk] = mm(rotY(lim('neck', 'yaw', kB * L[nk] + yN + ax.neck)), rotX(-pN));
  Lr[hd] = mm(rotY(lim('head', 'yaw', kB * L[hd] + yH + ax.head)), rotX(-pH));
  // the tail points back (-z): a swing toward +x is a negative yaw; the swing and the lift grow from mid-body (spine 0.5)
  for (const t of rig.tails) {
    const arcB = L[parent[t]], arcT = t === rig.tails[0] ? Math.max(0, rig.vent - 0.5) * rig.len : L[parent[t]];
    // the tail base's swing with the hind legs (lizardmuscles.js tailBaseSwing) when the caller drives it, else the gait's sway
    const i = rig.tails.indexOf(t), base = i === 0 && st.tailBase != null ? st.tailBase : -(ax.tail[i] ?? 0);
    Lr[t] = mm(rotY(lim('tail', 'yaw', base - (kB * arcB + kT * arcT))), rotX(lim('tail', 'pitch', kL * arcT)));
  }
}

// The legs: today's gait (the vertex rig's foot offsets), G4 replaces this with the lizard gait. A limb moves as a whole, as the
// vertex rig's leg does: its elbow (knee) opens or closes until the tip is as far from the shoulder (hip) as its target, then the
// limb turns about the shoulder to point the tip at it. (A two-bone IK with the foot held flat bent the ankle and the shoulder far
// more for the same step: 0.56 % of triangles past 2x stretch in the walk against 0.2 % allowed.)
function legs(rig, st, R, H, info) {
  // the feet: st.feet (planted, util/lizardgait.js lgFeet) or the gait's closed form at the phase's stride (rig.legStride, as
  // animals.js advances the phase), each the limb tip's place on the surface in the model frame (soles on y = 0)
  const calm = st.feet ? 0 : clamp(st.calm ?? 0, 0, 1);
  const F = st.feet ?? openFeet(rig.gait, rig.feet0, st.phase ?? 0, rig.gait.vSlow, 0, 1, (rig._open ??= {}), strideFor(rig.legStride)).feet;
  for (const c of rig.chains) {
    const pR = R[rig.parent[c.u]], A = H[c.u], f = F[c.limb - 1];
    const rest = addv(A, mv(pR, sub(c.T, c.A))), goal = [f[0], c.T[1] - c.plant + f[1], f[2]];
    rest[1] -= c.plant;
    const Tg = calm ? addv(mul(goal, 1 - calm), mul(rest, calm)) : goal;
    // the fold p (rad, + opens the elbow / knee) that puts the tip at the target's distance (secant steps, as the frog's hind leg)
    const D = len(sub(Tg, A)), reach = (p) => len(sub(foldTip(c, p), c.A));
    let p1 = 0;
    if (Math.abs(D - c.reach0) > 1e-6) {
      let p0 = 0, r0 = c.reach0 - D, r1;
      p1 = 0.15; r1 = reach(p1) - D;
      for (let it = 0; it < 6 && Math.abs(r1) > 1e-4; it++) {
        const p2 = clamp(p1 - (r1 * (p1 - p0)) / (r1 - r0 || 1e-9), -FOLD, FOLD);
        p0 = p1; r0 = r1; p1 = p2; r1 = reach(p1) - D;
      }
    }
    const Rk = rotAxis(c.nk, -p1), Tp = foldTip(c, p1);
    // N7: how far the tip stays off its target (model cm) once the fold is at its limit: the reach guard keeps this ~0 (lizard-cycle prints it)
    (rig._miss ??= [0, 0, 0, 0])[c.limb - 1] = Math.abs(len(sub(Tp, c.A)) - D);
    const Rl = mm(arc(norm(mv(pR, sub(Tp, c.A))), norm(sub(Tg, A))), pR), Rlow = mm(Rl, Rk);
    R[c.u] = Rl;
    R[c.w] = Rlow; H[c.w] = addv(A, mv(Rl, sub(c.K, c.A)));
    for (const e of c.ends) { R[e] = Rlow; H[e] = addv(H[c.w], mv(Rlow, sub(rig.head[e], c.K))); }
    if (info) info.tips[c.limb] = addv(A, mv(Rl, sub(Tp, c.A)));
  }
}
// the limb's tip in the rest frame with the elbow (knee) opened by p about its hinge
const foldTip = (c, p) => addv(c.K, mv(rotAxis(c.nk, -p), sub(c.T, c.K)));
// rotation by angle t about unit axis n, and the shortest arc turning unit a onto unit b (Rodrigues; as skeleton.js)
function rotAxis(n, t) {
  const c = Math.cos(t), s = Math.sin(t), k = 1 - c, [x, y, z] = n;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}
function arc(a, b) {
  const v = cross(a, b), c = dot(a, b), k = 1 / (1 + Math.max(c, -0.999999));
  return [c + v[0] * v[0] * k, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], c + v[1] * v[1] * k, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], c + v[2] * v[2] * k];
}

// A dropped tail: the bones past the cut collapse onto it (a zero matrix puts every vertex of the bone at its head).
function cut(rig, st, R, H) {
  const tailF = st.tailF ?? 1, piece = st.piece ?? 0;
  if (tailF >= 0.999 && piece < 0.01) return;
  const hide = (b, at) => { R[b] = ZERO; H[b] = at; };
  if (piece >= 0.01) {
    const keep = rig.tails.filter((t) => rig.sOf[t] >= piece - 0.02), at = H[keep[0] ?? rig.tails[rig.tails.length - 1]];
    for (let b = 0; b < rig.n; b++) if (!keep.includes(b)) hide(b, at);
    return;
  }
  const sCut = rig.vent + (1 - rig.vent) * clamp(tailF, 0, 1), gone = rig.tails.filter((t) => rig.sOf[t] >= sCut);
  for (const t of gone) hide(t, H[gone[0]]);
}
