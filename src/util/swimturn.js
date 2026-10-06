// How a swimming frog's legs move its body: yaw, push and the other intents come out of the stroke clock (util/gait.js swimStep),
// never from the sim writing a heading or a position. Pure arithmetic; the state lives on the stroke state `st`.
//
// MEASURED (one clip, one pool frog, 5 Oct 2026, refs/STEER.md): a one-leg steering stroke turns the torso 15-45 deg (+45 over the
// diamond hold to the kick, 1.8 s) at about 25 deg/s mean, peak about 30 deg/s. Stroke cycle about 3.8 s. Nothing else here is measured.
// GUESSED (no clip): the shape of the yaw inside a cycle (kept flat over the active stroke so the peak holds 30 deg/s at game
// kick rates; the clip's turn-out is probably front-loaded), the dead zone, spin, back, side, the push release window.

const DEG = Math.PI / 180;
export const YAW_MAX = 30 * DEG;      // rad/s, the clip's peak, at a full one-leg steer
export const STEER_DEAD = 0.15;       // legs this close to equal drive straight (guess)
export const KICK_WIN = [0.08, 0.26];   // phase window of the kick: gait.js STROKE_KEYS 'kick' to 'glide' (util imports no util: kept in step by hand)
export const SPIN_YAW = 50 * DEG;     // rad of yaw a spin cycle turns the body (guess, in the clips' range of 35-55 deg a stroke, refs/MOVES.md)
export const SPIN_CYCLE = 1.5;        // s a spin cycle lasts at an urgency of 0.5 (guess, in the clips' range: a turn is 1-1.5 s)
export const spinHz = (urgency = 0.5) => (0.75 + 0.5 * urgency) / SPIN_CYCLE;   // cycles a second: shorter the more urgent, as the stroke clock
const SPIN_SLOPE = 0.52, SPIN_NORM = (KICK_WIN[1] - KICK_WIN[0]) * 2 / Math.PI / SPIN_SLOPE;   // (a leg's thrust weight summed over a cycle of the spin clock, see below)
const spinW = (q) => (q >= KICK_WIN[0] && q < KICK_WIN[1] ? Math.sin(Math.PI * (q - KICK_WIN[0]) / (KICK_WIN[1] - KICK_WIN[0])) : 0);
export const DRIFT_MAX = 2;           // cm/s a floating or sitting body is carried by its neighbour or the water, no stroke (guess)
export const PUSH_CAP = 3;            // cm a body may have queued
const frac = (x) => x - Math.floor(x);

// Queue a push (cm) from a neighbour or a nudge: it is released by the next kick, never written to the position.
export function queuePush(st, dx, dz) {
  const q = (st.pq ??= { x: 0, z: 0 });
  q.x += dx; q.z += dz;
  const m = Math.hypot(q.x, q.z);
  if (m > PUSH_CAP) { q.x *= PUSH_CAP / m; q.z *= PUSH_CAP / m; }
}
export const pushPending = (st) => (st.pq ? Math.hypot(st.pq.x, st.pq.z) : 0);

// One tick, after swimStep. intent: 'forward' (steer by the legs' asymmetry), 'spin' (the legs' thrust of the spin movement) | 'back' | 'side' (guesses, dir +-1).
// Returns { dyaw (rad), fwd, side (cm/s in the body frame), px, pz (cm released from the push queue this tick) }.
export function swimMotion(st, prof, { intent = 'forward', dir = 1 } = {}, dt) {
  const out = { dyaw: 0, fwd: st.v, side: 0, px: 0, pz: 0 };
  if (intent === 'spin') {      // the yaw is the legs' thrust (st.sp, gait.js spinStep): each leg turns the body while it is in its kick window
    const S = st.sp; out.fwd = 0;
    if (!S || !st.act) return out;
    const n = S.style === 'opposed' ? 2 : 1, w = spinW(S.pK) + (S.style === 'opposed' ? spinW(S.pO) : 0);
    out.dyaw = S.dir * SPIN_YAW * w * S.dp / (SPIN_NORM * n);
    // the spin's kicks release a push queued on the body like any other (each kicking leg's phase window, gait.js spinStep S.k)
    const q = st.pq;
    if (q && (q.x || q.z)) for (const [p0, p1] of S.style === 'opposed' ? [[S.k[0], S.k[1]], [S.k[2], S.k[3]]] : [[S.k[0], S.k[1]]]) {
      if (p0 < KICK_WIN[1] && p1 >= KICK_WIN[0] && p1 > p0) {
        const f = Math.min(1, (p1 - p0) / Math.max(KICK_WIN[1] - Math.max(p0, KICK_WIN[0]), p1 - p0));
        const dx = q.x * f, dz = q.z * f; out.px += dx; out.pz += dz; q.x -= dx; q.z -= dz;
      }
    }
    return out;
  }
  const q0 = st.pq;
  if (!st.act) {                                                      // hold, glide, rest, floating, sitting: the legs do not turn it
    if (q0 && (q0.x || q0.z) && ((st.fl ?? 0) > 0.5 || (st.sit ?? 0) > 0.5)) {   // no stroke to push with: a passive drift, never a wake
      const m = Math.hypot(q0.x, q0.z), f = Math.min(1, DRIFT_MAX * dt / m);
      out.px = q0.x * f; out.pz = q0.z * f; q0.x -= out.px; q0.z -= out.pz;
    }
    return out;
  }
  const steer = st.steer ?? 0, s = Math.max(0, (Math.abs(steer) - STEER_DEAD) / (1 - STEER_DEAD)) * Math.sign(steer);
  if (intent === 'forward') out.dyaw = YAW_MAX * s * dt;
  else if (intent === 'back') out.fwd = -0.5 * Math.abs(st.v);                     // (guess)
  else if (intent === 'side') { out.fwd = 0; out.side = 0.5 * Math.abs(st.v) * dir; }   // (guess)
  const q = st.pq;
  if (q && (q.x || q.z)) {                                            // a kick releases what was pushed on it
    const p1 = frac(st.phase), p0 = p1 - (st.dph ?? 0);
    if (p0 < KICK_WIN[1] && p1 >= KICK_WIN[0]) {
      const f = Math.min(1, (st.dph || dt) / Math.max(KICK_WIN[1] - Math.max(p0, KICK_WIN[0]), st.dph || dt));
      out.px = q.x * f; out.pz = q.z * f; q.x -= out.px; q.z -= out.pz;
    }
  }
  return out;
}
