// The test lab's bug radar, as pure checks: one animal, one sample at a time, in the units of the sim (cm, seconds of animal time).
// It sees what an animal is DOING (where it is, how it moved since the last sample, whether a drive is getting it anywhere); the
// engine's own repairs (relocate, unstick) are reported by the lab's wiring (src/lab/radar.js), which wraps those methods.
// Pure so the unit tests (tests/labradar.test.mjs) can feed it made-up animals.
//
// Each check returns { kind, msg, sev } where sev is 'bad' (a bug on its face) or 'warn' (worth a look).

export const T = {
  teleportMin: 3,          // cm: a jump of at least this in one sample ...
  teleportSpeed: 45,       // ... and faster than this cm/s (a frog's hop peaks near 15, a gecko's dash at 25)
  spin: 9,                 // rad/s of heading change that no body does (a hop's twist is excused: it is over in a fraction of a second)
  flip: 1.2,               // rad of pitch on level ground
  jitterFlips: 6,          // heading reversals ...
  jitterWindow: 2,         // ... within this many seconds
  stuckWindow: 6,          // s with a goal and no headway ...
  stuckMove: 0.5,          // ... less than this cm (plus a tenth of the body)
  under: 0.6,              // cm below the ground before an animal on land counts as under it
};

const TAU = Math.PI * 2;
const angDiff = (to, from) => ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;

export function newState() {
  return { x: null, y: 0, z: 0, yaw: 0, flips: [], lastSign: 0, win: null, notArriving: false };
}

// a: { pos: {x,y,z}, yaw, pitch, hop, swimming, onWall, wallMode, stranded, lab: { drive, goal, stats } }
// c: { dt, t, size, swim (a fish or a swimming animal), air, ground: height under it, bounds: { hw, hd, h }, tol }
export function check(s, a, c) {
  const out = [];
  const { x, y, z } = a.pos;
  if (![x, y, z, a.yaw ?? 0, a.pitch ?? 0].every(Number.isFinite)) {
    out.push({ kind: 'nan', msg: 'its position or heading is not a number', sev: 'bad' });
    s.x = null;
    return out;
  }
  const b = c.bounds;
  if (Math.abs(x) > b.hw + 0.5 || Math.abs(z) > b.hd + 0.5 || y < -0.5 || y > b.h + 0.5) out.push({ kind: 'outside', msg: `outside the tank (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`, sev: 'bad' });
  const grounded = !c.swim && !c.air && !a.onWall && !a.wallMode && !a.hop;
  if (grounded && y < c.ground - T.under) out.push({ kind: 'underground', msg: `${(c.ground - y).toFixed(1)} cm under the ground`, sev: 'bad' });
  else if (c.swim && y < c.ground - 0.3) out.push({ kind: 'underground', msg: `${(c.ground - y).toFixed(1)} cm under the floor`, sev: 'bad' });
  if (!c.swim && !a.hop && !a.onWall && !a.wallMode && Math.abs(a.pitch ?? 0) > T.flip) out.push({ kind: 'flip', msg: `tipped ${(((a.pitch ?? 0) * 180) / Math.PI).toFixed(0)}° nose up or down`, sev: 'warn' });
  if (a.stranded) out.push({ kind: 'stranded', msg: 'stranded: not enough water to swim in', sev: 'warn' });

  if (s.x != null && c.dt > 0) {
    const step = Math.hypot(x - s.x, y - s.y, z - s.z);
    if (step >= T.teleportMin && step / c.dt > T.teleportSpeed) out.push({ kind: 'teleport', msg: `jumped ${step.toFixed(1)} cm in one step (${(step / c.dt).toFixed(0)} cm/s)`, sev: 'bad' });
    const dy = angDiff(a.yaw ?? 0, s.yaw);
    if (!c.swim && !a.hop && !a.onWall && !a.wallMode) {
      if (Math.abs(dy) / c.dt > T.spin) out.push({ kind: 'spin', msg: `turned ${((Math.abs(dy) * 180) / Math.PI).toFixed(0)}° in one step`, sev: 'warn' });
      // The heading reversing again and again: a shiver, not a turn.
      if (Math.abs(dy) > 0.08) {
        const sign = Math.sign(dy);
        if (s.lastSign && sign !== s.lastSign) s.flips.push(c.t);
        s.lastSign = sign;
      }
      while (s.flips.length && c.t - s.flips[0] > T.jitterWindow) s.flips.shift();
      if (s.flips.length >= T.jitterFlips) { out.push({ kind: 'jitter', msg: `heading reversed ${s.flips.length} times in ${T.jitterWindow} s`, sev: 'warn' }); s.flips.length = 0; }
    }
  }
  s.x = x; s.y = y; s.z = z; s.yaw = a.yaw ?? 0;

  // A drive that is not getting anywhere.
  const L = a.lab, g = L?.goal;
  if (L?.drive && g) {
    const far = Math.hypot(g.x - x, g.z - z) > (c.tol ?? 1.5) + 1;
    if (!s.win || !far) s.win = { t: c.t, x, z };
    else if (c.t - s.win.t >= T.stuckWindow) {
      if (Math.hypot(x - s.win.x, z - s.win.z) < T.stuckMove + 0.1 * (c.size ?? 1)) out.push({ kind: 'stuck', msg: `no headway toward its goal for ${T.stuckWindow} s`, sev: 'warn' });
      s.win = { t: c.t, x, z };
    }
  } else s.win = null;
  const D = L?.drive;
  if (D?.type === 'goto' && !D.done && L.stats && !s.notArriving) {
    const budget = 25 + (D.d0 ?? 0) / Math.max(0.3, c.tableSpeed * 0.25);
    if (L.stats.t > budget) { s.notArriving = true; out.push({ kind: 'notarriving', msg: `has not arrived after ${L.stats.t.toFixed(0)} s`, sev: 'warn' }); }
  }
  return out;
}

// Two bodies whose centres are closer than `share` of their radii together: inside each other. a, b: { pos, r }.
export function overlapping(a, b, share = 0.45) {
  const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
  return d < share * (a.r + b.r) ? d : null;
}
