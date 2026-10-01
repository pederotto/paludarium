// The one table of rules for the game's modes (pure data and small functions, no DOM).
//
// Three ways to play the same tank:
//   kids       the Kids' corner (src/app/kids.js, src/ui/kids): pictures, a gentle guardian, nothing dies.
//   explorer   intermediate: smart one-tap placement, auto-managed water, plain-language chips and coach.
//   naturalist full realism: every number, every precise tool, strict consequences.
// Sandbox and Career are the game flow and work in every mode.
//
// `sim` is copied to world.realism (see src/app/modes-runtime.js) and read by the simulation through
// small guarded reads: erosion.scale/slump (sim/erosion.js), support (sim/support.js), mould and harm
// (sim/sim.js), valve/bypass sanity (sim/hydro.js). A missing knob means "as it always was".

export const MODE_IDS = ['kids', 'explorer', 'naturalist'];
export const ADULT_MODES = ['explorer', 'naturalist'];
export const DEFAULT_MODE = 'naturalist';

export const MODES = {
  kids: {
    id: 'kids',
    name: 'Kids',
    tag: 'Pictures and a helper',
    blurb: 'Tap pictures to build a little world. Pets never get sick.',
    sim: { erosion: null, slump: 1, support: 'full', mould: 1, harm: 1, mercy: false, events: false, eventRate: 0.11, flow: 'manual', chem: 'numbers', autoWater: false },
    hud: { numbers: false, chips: true, flowPanel: false, lab: false, fieldGuide: true, careDock: false, waterTools: ['channel', 'basin', 'bank', 'outlet'], toolOptions: 'kids' },
    coach: 'kids',
    placement: 'kids',
  },
  explorer: {
    id: 'explorer',
    name: 'Explorer',
    tag: 'Build in a few taps',
    blurb: 'One tap places things correctly. Water looks after itself, pets get sick slowly and you are warned first.',
    sim: {
      erosion: 0.5,         // multiplier of the user's erosion strength (null: leave the Settings value alone)
      slump: 0.5,           // slumping rate of steep loose ground
      support: 'gentle',    // hardscape settles only when a lot of ground has gone from under it
      mould: 0.5,           // mould grows at half speed
      harm: 0.4,            // stress costs health at 40 percent
      mercy: true,          // each animal is pulled back from the brink once
      events: true, eventRate: 0.06,
      flow: 'auto',         // pump, valves and top-up looked after
      chem: 'chips',        // per-pond chemistry shown as clean / needs attention
      autoWater: true,
    },
    hud: { numbers: false, chips: true, flowPanel: false, lab: false, fieldGuide: true, careDock: true, waterTools: ['channel', 'basin', 'bank', 'outlet'], toolOptions: 'simple', hideTools: ['gear'], toolNames: { rock: 'Rocks', plant: 'Plants', animal: 'Animals' } },
    coach: 'plain',
    placement: 'smart',
  },
  naturalist: {
    id: 'naturalist',
    name: 'Naturalist',
    tag: 'Full realism',
    blurb: 'Every number, every precise tool, strict consequences. Erosion, structure, per-pond chemistry and flow balance are all on.',
    sim: { erosion: null, slump: 1, support: 'full', mould: 1, harm: 1, mercy: false, events: true, eventRate: 0.11, flow: 'manual', chem: 'numbers', autoWater: false },
    hud: { numbers: true, chips: false, flowPanel: true, lab: true, fieldGuide: true, careDock: true, waterTools: ['channel', 'basin', 'bank', 'outlet', 'fill', 'pump'], toolOptions: 'full' },
    coach: 'full',
    placement: 'precise',
  },
};

export function normalizeMode(id) { return MODES[id] ? id : DEFAULT_MODE; }
export function rules(id) { return MODES[normalizeMode(id)]; }
export const isSmart = (id, smartToggle = false) => rules(id).placement === 'smart' || (smartToggle && rules(id).placement === 'precise');

// The knobs the simulation reads, as a fresh plain object (world.realism).
export function realismFor(id) { return { ...rules(id).sim, mode: normalizeMode(id) }; }

// Which parts of the tank's chemistry are "fine" (for the chips of the Explorer HUD).
export function chemChip(env) {
  const bad = [];
  if (env.ammonia > 0.25) bad.push('ammonia');
  if (env.nitrite > 0.3) bad.push('nitrite');
  if (env.nitrate > 60) bad.push('nitrate');
  if (env.oxygen != null && env.oxygen < 4.5) bad.push('oxygen');
  if (!bad.length) return { ok: true, text: 'Water is clean', why: '' };
  return { ok: false, text: 'Water needs attention', why: bad.join(', ') };
}

// Plain-language rewrites of the stress reasons shown to an Explorer.
const PLAIN = {
  'too cold': 'It is too cold for it.', 'too hot': 'It is too warm for it.', 'air too dry': 'The air is too dry: mist or add water.',
  ammonia: 'The water is dirty: do a partial water change.', nitrite: 'The water is not settled yet: go easy on feeding.', nitrate: 'The water is stale: change some water.',
  'low oxygen': 'The water needs more movement or fewer fish.', 'out of water': 'It is out of the water.', hungry: 'It is hungry: feed it.', mould: 'Mould is spreading: add a fan or springtails.',
  'no water to swim in': 'It needs a pool to soak in.', 'no water': 'It needs some water.',
};
export const plainWhy = (w) => PLAIN[w] ?? w;

// --- Small deterministic helpers shared by the smart placement (src/tools/smart.js) ----------
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const seedOf = (x, z, n = 0) => ((Math.round(x * 100) * 73856093) ^ (Math.round(z * 100) * 19349663) ^ (n * 83492791)) >>> 0;

// Groups are odd (3 or 5), sizes graded from one anchor to the smallest.
export const groupCount = (n) => (n >= 5 ? 5 : 3);
export function gradedSizes(n, base, rnd = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    out.push(base * (1.15 - 0.6 * t) * (0.94 + rnd() * 0.12));      // the focal piece is largest, the others step down
  }
  return out;
}

// A cluster of n items around (cx, cz): the first is the focal piece (largest) at the centre of the
// group, the rest sit on a loose ring, nudged apart, never overlapping: each gets radius sizes[i] * 0.5 * fill.
// Returns [{ x, z, size }] with the group's centre pulled toward the nearest third of the tank width
// when `thirds` is set (rule of thirds: a focal point a third of the way across), and kept inside the tank.
export function groupLayout(n, cx, cz, base, { seed = 1, tank = { w: 90, d: 45 }, thirds = false, margin = 1.2, fill = 1 } = {}) {
  n = n >= 5 ? 5 : n >= 3 ? 3 : 1;
  const rnd = mulberry(seed);
  const sizes = gradedSizes(n, base, rnd);
  if (thirds) {
    const third = tank.w / 3, t = [-tank.w / 2 + third, -tank.w / 2 + 2 * third];
    const near = Math.abs(cx - t[0]) < Math.abs(cx - t[1]) ? t[0] : t[1];
    if (Math.abs(cx) < tank.w * 0.12) cx = near;        // a tap in the middle: shift to the nearest third
  }
  const pts = [{ x: cx, z: cz, size: sizes[0] }];
  const a0 = rnd() * Math.PI * 2;
  for (let i = 1; i < n; i++) {
    let best = null;
    for (let k = 0; k < 14; k++) {
      const ang = a0 + (i / (n - 1)) * Math.PI * 2 + (rnd() - 0.5) * 0.9;
      const r = (sizes[0] * 0.5 + sizes[i] * 0.5) * fill * (0.9 + rnd() * 0.5) + k * sizes[0] * 0.04;
      const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r * 0.8;
      if (pts.every((p) => Math.hypot(p.x - x, p.z - z) >= (p.size + sizes[i]) * 0.5 * fill * 0.9)) { best = { x, z, size: sizes[i] }; break; }
    }
    pts.push(best ?? { x: cx + (i * 0.9 + 1) * sizes[0] * 0.6, z: cz, size: sizes[i] });
  }
  const hw = tank.w / 2 - margin, hd = tank.d / 2 - margin;
  for (const p of pts) { p.x = Math.max(-hw, Math.min(hw, p.x)); p.z = Math.max(-hd, Math.min(hd, p.z)); }
  return pts;
}

// Finds a free spot near (x, z): `isFree(x, z)` is checked on a widening spiral. Deterministic for a seed.
// Returns { x, z } or null.
export function freeSpot(x, z, isFree, { seed = 1, step = 1.4, tries = 28 } = {}) {
  if (isFree(x, z)) return { x, z };
  const rnd = mulberry(seed), a0 = rnd() * Math.PI * 2;
  for (let k = 1; k <= tries; k++) {
    const r = step * (1 + k * 0.35), ang = a0 + k * 2.399963;     // golden angle
    const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
    if (isFree(px, pz)) return { x: px, z: pz };
  }
  return null;
}

// Plants painted with the brush: at most one per `spacing` cm, within `radius`, never on an occupied spot.
export function scatterSpots(cx, cz, radius, spacing, existing, { seed = 1, max = 4 } = {}) {
  const rnd = mulberry(seed), out = [];
  for (let k = 0; k < 14 && out.length < max; k++) {
    const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
    if ([...existing, ...out].every((p) => Math.hypot(p.x - x, p.z - z) >= spacing)) out.push({ x, z });
  }
  return out;
}

// What a mode's HUD shows, and what a tool offers. Used by ToolRail, ToolOptions and the water tool.
export const hudOf = (id) => rules(id).hud;
export const simplified = (id) => rules(id).hud.toolOptions !== 'full';

// The hint that replaces a long tool hint in Explorer.
export const EXPLORER_HINTS = {
  rock: 'Tap the tank: it places a rock for you. Then tap Another or Make a group of 3.',
  plant: 'Tap to plant one. Hold and drag to scatter a patch. Green light means it will thrive.',
  animal: 'Tap water or ground to release. The light shows if it will be happy there.',
};
