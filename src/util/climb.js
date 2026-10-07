// A frog's climb as a body movement (owner's Movement rule, CLAUDE.md): the pulses of its four limbs, and the advance and the yaw that come out
// of them, never the sim writing a position or a heading. Pure arithmetic; the state lives on `st` (climbState). The sim only asks for an intent
// (`go`, `steer`); the render layer draws the limbs through render/creatures/skeleton.js poseStroke from `climbPose`, and the muscles get their
// activation from the same phases (`climbMove`: content/anuranmuscles.js moveExcitation mode 'climb', windows swing 0-0.25 of a limb's cycle,
// placing to 0.45, the stretch 0.45-0.60, then stance).
//
// READ OFF THE OWNER'S CLIPS (.agents/refs/walk-climb-turn-1006, reports/W1.md, W2.md, A3.md; ONE OR TWO EVENTS EACH: every number is inconclusive):
//   a dart frog up a wall (clip 2): a PULSE, fore right, fore left, hind right, hind left, 0.07-0.1 s apart, each limb's swing 0.07-0.13 s, then a
//   hold of 3 s or more; the torso bends 10-20 deg toward the reaching hand; the body advances 0.25-0.5 of its length a pulse.
//   a tiger-striped tree frog up a branch (clip 1): slow single-limb steps (a fore swing 0.5-0.6 s), a fore pair then a hind pair, the hand
//   peeled wrist first and the toes spread before it lands.
//   a green tree frog up a wall (clip 3, reports/W2.md and the 12 fps sheets): NOT a pulse: a continuous crawl of about 1.15 s a cycle, the long hind legs
//   hanging fully stretched below it, one planted while the other folds up out to the side and is placed again, a hand reaching a body length above the
//   head each cycle on the side opposite the leg that pushes, swing 0.25-0.3 s and stance about 0.85 s (a duty of 0.75: three limbs on the wall), the body
//   rolling and bending from side to side with the steps (2 cycles in the clip: inconclusive). This is the walk of an arboreal frog, "very different from
//   other frogs" (the owner, 6 Oct 2026): the gait 'crawl' below, for the species that perch (red-eyed tree frog, reed frog); the dart frog's is the pulse.
// GUESSED (no clip): the hold between pulses of a game frog (shorter than the clips' 3 s), the share of the advance each limb gives, the yaw a pulse
// turns the body, the head leading the trunk, the poses between the key poses.

// (util imports nothing from src, util included: the key poses are copied from gait.js HIND and FORE, and tests/climb.test.mjs keeps them in step)
const HIND = { cock: [105, -25, 80, 85, -14, 16, -22, -22, 0], open: [36, 24, 34, 40, -5, 0, -8, -5, 35], turn: [95, -25, 45, 55, -12, 14, -10, -12, 30] };
const FORE = { spread: [76, 109, 119, 10, -9, -2], reach: [150, 165, 172, -38, -48, -12] };
export const CLIMB_KEYS = { HIND, FORE };

const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

export const CLIMB = {
  limbDur: 0.4,                      // s one limb's cycle lasts: a swing of 0.1 s is a quarter of it (clip 2: 0.07-0.13 s)
  // each limb starts this long after the pulse began, the lead side's fore first (clip 2: R fore, L fore, R hind, L hind, 0.07-0.1 s apart)
  stagger: { foreLead: 0, foreOther: 0.08, hindLead: 0.20, hindOther: 0.28 },
  stride: 0.4,                       // body lengths a pulse advances (clip 2: 0.25-0.5)
  share: { fore: 0.15, hind: 0.35 }, // of a pulse's advance each fore and each hind leg gives (guess: the hind legs push, the fore pull)
  stretch: [0.45, 0.60],             // a hind leg's own phase window of the stretch that drives the body (anuranmuscles.js moveExcitation, W2 clip 3)
  pull: [0.45, 0.80],                // a fore leg's, the hand planted and the body drawn up to it
  yawPulse: 35 * DEG,                // rad a pulse at full steer turns the body (guess: clip 4's 105 deg in 0.65 s was fore steps and legs together)
  trunkYaw: 12,                      // deg the torso bends toward the reaching hand (clip 2: 10-20), and 25 more at full steer (rom spine 25)
  headLead: 1.5,                     // the head turns this much more than the torso, and a little before it (clip 4: the head leads the hips by 20-30 deg)
  period: [2.4, 1.0],                // s between the starts of two pulses, at urgency 0 and 1 (guess: the clips hold 3 s; a game frog climbs to a perch)
};
const PULSE_LEN = CLIMB.stagger.hindOther + CLIMB.limbDur;
// The crawl (clip 3): a DIAGONAL-sequence walk, each limb its own phase 0 ... 1 a cycle (swing 0-0.25, placing to 0.45, the stretch 0.45-0.60, then the leg
// hangs stretched), a hind leg first and the fore leg of the OTHER side a quarter later (right hind, left fore, left hind, right fore): the hand of one side
// reaches while the hind leg of the other pushes (clip 3, reports/W2.md). The order is the arboreal frogs' (Manzano, Abdala & Herrel 2008, J Anat 213: Phyllomedusa
// bicolor, the red-eye's own subfamily, and Litoria caerulea "use a diagonal sequence gait typical of primates and other arboreal mammals"); the first version here was a
// lateral sequence (hind, then the fore of its own side), a guess the clip's blur could not settle (6 Oct 2026).
export const CRAWL = {
  cycle: [1.6, 0.9],                 // s a cycle lasts at urgency 0 and 1 (clip 3: 1.15)
  offset: { hR: 0, fL: 0.25, hL: 0.5, fR: 0.75 },
  stride: 0.5,                       // body lengths a cycle advances (guess: the clip pans, 2 cycles)
  share: { fore: 0.15, hind: 0.35 },
  drive: [0.30, 0.80],               // the part of a limb's own cycle that moves the body: its stance, the leg extending and the hand drawing it up
  yawCycle: 40 * DEG,                // rad a cycle at full steer turns the body (guess)
  sway: 10, roll: 10,                // deg the torso bends toward the reaching hand and rolls about its length with the steps (clip 3: it turns side to dorsal view; guess)
};

export const climbState = (rnd = Math.random, gait = 'pulse', set = 'default') => ({
  gait, set,                         // gait: 'pulse' (a dart frog: bursts and holds) | 'crawl' (an arboreal frog: a continuous four-beat walk); set: the crawl's key tables (CRAWL_SETS)
  clock: 0,                          // the crawl's cycle clock (cycles)
  t: -1,                             // the pulse clock (s); < 0 between pulses
  hold: 0.3 + rnd() * 0.5,           // s until the next pulse
  lead: rnd() < 0.5 ? -1 : 1,        // the side whose fore leg starts the pulse (+1 the right)
  fL: 0, fR: 0, hL: 0, hR: 0,        // each limb's own phase 0 ... 1 (0 and 1: held)
  act: 0,                            // 1 while any limb is moving
  steer: 0, pulses: 0,
  trunk: new Float32Array(6),        // the torso's and the head's channels as poseStroke reads them: [spine yaw, pitch, twist, head yaw, pitch, twist] (deg)
});

const win = (p, [a, b]) => clamp01((p - a) / (b - a));         // 0 before the window, 1 after it
const wind = (p0, p1, w) => smooth(win(p1, w)) - smooth(win(p0, w));   // how much of a window's work an advance of phase p0 -> p1 does

// One tick. intent: `go` (0 | 1: climb), `steer` (-1 ... 1: the turn to make, + toward the right), `urgency` (0 ... 1). `bodyLen` (cm) sizes the stride.
// Returns { adv (cm along the heading), dyaw (rad) } this tick: nonzero only inside a pulse, from the limbs' own drive windows.
export function climbStep(st, { go = 1, steer = 0, urgency = 0.5, bodyLen = 3, rnd = Math.random } = {}, dt) {
  const out = { adv: 0, dyaw: 0 };
  st.steer = steer;
  if (st.gait === 'crawl') return crawlStep(st, out, { go, steer, urgency, bodyLen }, dt);
  if (st.t < 0) {                                                // between pulses: still
    st.act = 0; st.fL = st.fR = st.hL = st.hR = 0; st.trunk.fill(0);
    st.hold -= dt;
    if (go && st.hold <= 0) { st.t = 0; st.lead = steer > 0.15 ? 1 : steer < -0.15 ? -1 : -st.lead; st.pulses++; }
    else return out;
  }
  const t0 = st.t; st.t += dt;
  const S = CLIMB.stagger, lead = st.lead;
  // each limb's phase at a time t of the pulse, and the lead side's first
  const at = (t, off) => clamp01((t - off) / CLIMB.limbDur);
  const off = { fR: lead > 0 ? S.foreLead : S.foreOther, fL: lead > 0 ? S.foreOther : S.foreLead, hR: lead > 0 ? S.hindLead : S.hindOther, hL: lead > 0 ? S.hindOther : S.hindLead };
  let f = 0;                                                     // the share of the pulse's work done this tick
  for (const k of ['fR', 'fL']) { f += CLIMB.share.fore * wind(at(t0, off[k]), at(st.t, off[k]), CLIMB.pull); st[k] = at(st.t, off[k]); }
  for (const k of ['hR', 'hL']) { f += CLIMB.share.hind * wind(at(t0, off[k]), at(st.t, off[k]), CLIMB.stretch); st[k] = at(st.t, off[k]); }
  st.act = 1;
  out.adv = f * CLIMB.stride * bodyLen;
  out.dyaw = steer * CLIMB.yawPulse * f;                         // the turn comes with the drive: the legs' push, with the torso bent toward the way it goes
  // the torso toward the reaching hand (and the steer), the head ahead of it: a bump over the fore swings and the draw (the pulse's first 0.7)
  const u = clamp01(st.t / (PULSE_LEN * 0.9)), bump = Math.sin(Math.PI * u) ** 2;
  const yaw = (lead * CLIMB.trunkYaw + steer * 25) * bump;
  st.trunk[0] = yaw; st.trunk[3] = yaw * CLIMB.headLead * (1 + 0.2 * Math.cos(Math.PI * u));
  if (st.t >= PULSE_LEN) {                                       // the pulse is over: hold
    st.t = -1; st.fL = st.fR = st.hL = st.hR = 0; st.trunk.fill(0); st.act = 0;
    const [slow, fast] = CLIMB.period;
    st.hold = Math.max(0.15, slow + (fast - slow) * urgency - PULSE_LEN) * (0.8 + 0.4 * rnd());
  }
  return out;
}

// The crawl: the clock runs while it climbs, and after `go` ends only until no limb is in its swing (a foot is never left in the air); the advance and the
// yaw are the limbs' stance drive, as the pulse's are.
const eDrive = (p) => smooth(win(p, CRAWL.drive));
function crawlStep(st, out, { go, steer, urgency, bodyLen }, dt) {
  const [slow, fast] = CRAWL.cycle, T = slow + (fast - slow) * urgency, c0 = st.clock;
  let c1 = c0 + dt / T;
  // (the swings follow each other a quarter of a cycle apart, so asked to stop it runs on to the next quarter, where one limb has just landed and the next is
  // not yet lifted: three or four on the wall, none in the air)
  if (!go) { const target = Math.ceil(c0 * 4 - 1e-6) / 4; if (c0 >= target - 1e-6) { st.act = 0; st.trunk.fill(0); return out; } c1 = Math.min(c1, target); }
  st.clock = c1; st.act = 1;
  let f = 0;
  for (const k of ['hR', 'fR', 'hL', 'fL']) {
    const o = CRAWL.offset[k], u0 = c0 - o, u1 = st.clock - o, share = k[0] === 'h' ? CRAWL.share.hind : CRAWL.share.fore;
    f += share * ((Math.floor(u1) + eDrive(u1 - Math.floor(u1))) - (Math.floor(u0) + eDrive(u0 - Math.floor(u0))));
    st[k] = u1 - Math.floor(u1);
  }
  st.steer = steer; st.pulses = Math.floor(st.clock);
  out.adv = f * CRAWL.stride * bodyLen;
  out.dyaw = steer * CRAWL.yawCycle * f;
  // the torso bends toward the reaching hand (the left fore swings at 0.25-0.5 of the cycle, the right at 0.75-1.0) and rolls with the steps; the head leads it
  const c = st.clock, w = 2 * Math.PI, bend = -Math.sin(w * (c - 0.125)), roll = -Math.sin(w * (c - 0.375));
  const yaw = CRAWL.sway * bend + steer * 20;
  st.trunk[0] = yaw; st.trunk[2] = CRAWL.roll * roll; st.trunk[3] = yaw * CLIMB.headLead; st.trunk[5] = 0;
  return out;
}

// --- The limbs' angles through a pulse -----------------------------------------------------------------------------------------------
// A limb's key poses against its own phase 0 ... 1: [phase, pose]. Hold: the hind legs cocked, the arms out to the sides (the swimming scan's
// own spread: the frog is drawn on its swimming body against the wall, limbs apart). A hind leg swings forward with the foot peeled off the wall
// (ph +), plants, then stretches straight back (HIND.open) and relaxes; a fore leg lifts and reaches forward, plants with the hand toward the wall
// (ph -), and draws back as the body comes up to it.
const HIND_KEYS = [[0, HIND.cock], [0.14, [128, -34, 70, 80, 8, 20, -4, -4, 20]], [0.30, [124, -30, 66, 76, -10, 14, -14, -14, 10]], [0.45, [118, -24, 60, 70, -14, 10, -18, -18, 0]],
  [0.60, HIND.open], [0.80, HIND.turn], [1, HIND.cock]];
const FORE_KEYS = [[0, FORE.spread], [0.12, [112, 140, 150, 16, -6, -4]], [0.30, FORE.reach], [0.45, FORE.reach], [0.80, FORE.spread], [1, FORE.spread]];
// A crawling hind leg (the legs hang stretched, HIND.glide, at the end of the stance and at the lift-off): swing = fold up and out, peeled off the wall, place
// forward as a diamond, then extend back through the stance to hang straight again.
const GLIDE = [14, -4, 0, 2, -4, 3, 2, 0, 90];
const HIND_CRAWL = [[0, [30, 4, 10, 14, -4, 2, -2, -2, 60]], [0.12, [128, -34, 70, 80, 8, 20, -4, -4, 20]], [0.25, [118, -24, 60, 70, -14, 10, -18, -18, 0]],
  [0.45, [80, -6, 40, 48, -12, 4, -12, -10, 12]], [0.60, HIND.open], [0.80, GLIDE], [1, [30, 4, 10, 14, -4, 2, -2, -2, 60]]];
// (the crawl's hand: it reaches a body length above the head, higher than the pulse's)
const FORE_CRAWL = [[0, [96, 120, 126, 6, -8, -2]], [0.12, [124, 150, 160, 22, -4, -4]], [0.25, [158, 172, 176, -34, -44, -10]], [0.45, [150, 165, 172, -38, -48, -12]],
  [0.80, [96, 120, 126, 6, -8, -2]], [1, [96, 120, 126, 6, -8, -2]]];
// The red-eyed tree frog's own crawl (its walking scan, owner 6 Oct 2026; tools/rig/redeye-walk-joints.json read by tools/rig/neutral.mjs scanStroke): the keys are built around the
// angles measured on the scan, which is a frog mid-step. Its right hind leg is the GATHERED pose (thigh forward-out 122 deg, shin back, the tarsus forward again: the Z a swinging
// frog folds its leg into), its right arm the SUPPORT (the elbow out, the forearm down onto the wall) and its left arm the REACH (forward, the hand ahead); the leg's other end is the
// stretch of clip 3 (thigh, shin and foot in line, hanging). tests/redeye-bones.test.mjs keeps the anchors equal to the scan's own angles.
const RE_GATHER = [122, -32, 135, 108, -23, 27, -32, -17, 0];          // the scan's right hind leg
const RE_HANG = [30, 4, 10, 14, -4, 2, -2, -2, 20];                   // lift-off: the leg straight back (clip 3; the tiger-striped leaf frog's stretched leg is as long and straight)
const RE_PLACE = [96, -18, 96, 86, -18, 16, -26, -14, 0];             // reaching ahead to place the foot
const RE_PUSH = [60, 6, 40, 44, -10, 6, -12, -8, 10];                 // planted, the leg extending: the body is baked in this pose (bake `neutral`), so every pose is a half turn from it
const RE_OPEN = [36, 24, 34, 40, -5, 0, -8, -5, 20];                  // the stance's end: the leg open behind
const HIND_REDEYE = [[0, RE_HANG], [0.12, RE_GATHER], [0.25, RE_PLACE], [0.45, RE_PUSH], [0.60, RE_OPEN], [0.80, [14, -4, 0, 2, -4, 3, 2, 0, 20]], [1, RE_HANG]];
const RE_SUPPORT = [55, 0, 199, 14, -80, -18];                        // the scan's right arm (its hand -161 deg, written 199 so the blend to the reach turns the short way)
const RE_REACH = [103, 173, 170, -9, -30, -14];                       // the scan's left arm
const FORE_REDEYE = [[0, RE_SUPPORT], [0.12, RE_SUPPORT.map((v, i) => v + (RE_REACH[i] - v) * 0.4)], [0.25, RE_REACH], [0.45, RE_REACH.map((v, i) => v + (i === 4 ? -10 : 0))], [0.80, RE_SUPPORT], [1, RE_SUPPORT]];
export const CRAWL_SETS = { default: { hind: HIND_CRAWL, fore: FORE_CRAWL }, redeye: { hind: HIND_REDEYE, fore: FORE_REDEYE } };
function keyed(keys, p, out, o) {
  let i = 1; while (i < keys.length - 1 && p > keys[i][0]) i++;
  const [p0, A] = keys[i - 1], [p1, B] = keys[i], k = smooth((p - p0) / (p1 - p0 || 1));
  for (let j = 0; j < A.length; j++) out[o + j] = A[j] + (B[j] - A[j]) * k;
}

// The pose of a climbing frog as a stroke for the swimming body (render/creatures/skeleton.js poseStroke): `out` is reused between calls.
// { legA (18: left hind then right), armA (12: left then right), trunk (6), move (the muscles' mode and each hind leg's own phase) }
export function climbPose(st, out = {}) {
  out.legA ??= new Float32Array(18); out.armA ??= new Float32Array(12);
  const crawl = st.gait === 'crawl', K = CRAWL_SETS[st.set] ?? CRAWL_SETS.default, HK = crawl ? K.hind : HIND_KEYS, FK = crawl ? K.fore : FORE_KEYS;
  keyed(HK, st.hL, out.legA, 0); keyed(HK, st.hR, out.legA, 9);
  // (the fore keys are [th x3, ph x3] a side)
  keyed(FK, st.fL, out.armA, 0); keyed(FK, st.fR, out.armA, 6);
  out.trunk = st.trunk;
  // the girdle and the fingers (a 22-bone frog; ignored by the others): the reaching side's shoulder lifts and swings forward through the fore leg's swing and
  // placing and settles as the body is drawn up; the fingers peel (curl) as the hand lifts off and lie flat, the discs pressed, once it is placed
  const reach = (p) => smooth(win(p, [0, 0.25])) * (1 - smooth(win(p, [0.45, 0.8]))), peel = (p) => Math.sin(Math.PI * clamp01(p / 0.3));
  const rL = reach(st.fL), rR = reach(st.fR), sc = out.scap ??= [0, 0, 0, 0], fc = out.fcurl ??= [0, 0];
  sc[0] = 12 * rL; sc[1] = 22 * rL; sc[2] = 12 * rR; sc[3] = 22 * rR;
  fc[0] = 30 * peel(st.fL); fc[1] = 30 * peel(st.fR);
  out.move = climbMove(st, out.move);
  return out;
}

// What the muscle layer reads (render/creatures/muscles.js motionOf): the mode, each hind leg's own phase and its strength.
export function climbMove(st, out = {}) {
  out.mode = 'climb'; out.pL = st.hL; out.pR = st.hR; out.ampL = st.act ? 1 : 0; out.ampR = st.act ? 1 : 0;
  return out;
}

// The pose a baked body rests in (tools/bake-frogpose.mjs `neutral`: the scan is posed into it through its skeleton once, so the runtime's poses are small turns from it): each hind
// leg and each arm at a point of the crawl's own cycle (`hind`, `arm`: 0 ... 1), the trunk straight, no scapula or finger channel.
export function neutralStroke(hind = 0.45, arm = 0.3, set = 'default') {
  const out = { legA: new Float32Array(18), armA: new Float32Array(12), trunk: new Float32Array(6), scap: [0, 0, 0, 0], fcurl: [0, 0] }, K = CRAWL_SETS[set] ?? CRAWL_SETS.default;
  keyed(K.hind, hind, out.legA, 0); keyed(K.hind, hind, out.legA, 9); keyed(K.fore, arm, out.armA, 0); keyed(K.fore, arm, out.armA, 6);
  return out;
}
