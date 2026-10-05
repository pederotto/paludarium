// The enclosures you can build in, smallest to grandest. Career mode unlocks
// them with reputation and funds; sandbox mode has them all.

export const TANKS = {
  jar: {
    id: 'jar', name: 'Moss jar', w: 34, d: 26, h: 38, closed: true, cellsPerCm: 1.7, level: 1, price: 0,
    blurb: 'A sealed glass jar: a miniature closed ecosystem. Water evaporates, condenses on the glass and rains back down, so it can run for years on its own if it is balanced. Room for moss, a crew and a frog or two at most.',
  },
  nano: {
    id: 'nano', name: 'Nano paludarium', w: 60, d: 36, h: 48, closed: false, cellsPerCm: 1.5, level: 3, price: 400,
    blurb: 'A 100-litre display with room for a small pond, a stream and a few small animals.',
  },
  standard: {
    id: 'standard', name: 'Standard paludarium', w: 90, d: 45, h: 60, closed: false, cellsPerCm: 1.33, level: 6, price: 1500,
    blurb: 'A 240-litre display: long enough for a proper waterfall, a lagoon and a rainforest floor.',
  },
  grand: {
    id: 'grand', name: 'Grand display', w: 130, d: 60, h: 80, closed: false, cellsPerCm: 1.1, level: 9, price: 5200,
    blurb: 'A 620-litre showpiece for exhibitions: cascades, a deep lagoon and a tall canopy.',
  },
  cube: {
    id: 'cube', name: 'Cube 30', w: 30, d: 30, h: 30, closed: false, cellsPerCm: 2.0, level: 2, price: 120,
    blurb: 'A 27-litre open cube for a desk: one rock, a pool the size of a saucer and a few plants. Small tanks swing fast, so keep an eye on them.',
  },
  tall: {
    id: 'tall', name: 'Tall rainforest', w: 60, d: 45, h: 90, closed: false, cellsPerCm: 1.4, level: 5, price: 1100,
    blurb: 'A 243-litre upright for a vertical rainforest: a tall wall, climbing plants and geckos, with a small pool at the bottom.',
  },
  long: {
    id: 'long', name: 'Long riparium', w: 150, d: 40, h: 50, closed: false, cellsPerCm: 1.0, level: 7, price: 2600,
    blurb: 'A 300-litre stream bank: long, shallow and low, made for a winding river with plants growing out of the water.',
  },
  wide: {
    id: 'wide', name: 'Wide corner', w: 120, d: 60, h: 60, closed: false, cellsPerCm: 1.15, level: 8, price: 3600,
    blurb: 'A 432-litre wide display with a deep front, room for an island, a lagoon and a waterfall in the corner.',
  },
  show: {
    id: 'show', name: 'Show tank', w: 180, d: 70, h: 90, closed: false, cellsPerCm: 0.85, level: 11, price: 9800,
    blurb: 'A 1,130-litre exhibition tank: a full river valley under a tall canopy. Slow to warm and steady: it takes about a day to settle, and it costs about three times as much as the standard tank to light, heat and filter.',
  },
  // Common glass-terrarium sizes (front-opening, 30-90 cm): more upright and low shapes for real variety. Names invented.
  spire: {
    id: 'spire', name: 'Nano column', w: 30, d: 30, h: 45, closed: false, cellsPerCm: 1.9, level: 2, price: 180,
    blurb: 'A 40-litre upright nano: half again as tall as it is wide, for a bromeliad wall, a vine and a pair of tiny frogs.',
  },
  column: {
    id: 'column', name: 'Cloud column', w: 45, d: 45, h: 60, closed: false, cellsPerCm: 1.6, level: 4, price: 700,
    blurb: 'A 122-litre square upright: a deep, tall background and a little pool, a classic home for a group of dart frogs.',
  },
  tower: {
    id: 'tower', name: 'Canopy tower', w: 90, d: 45, h: 90, closed: false, cellsPerCm: 1.25, level: 8, price: 3200,
    blurb: 'A 365-litre high display as tall as it is wide: a full tree-fern canopy over a stream, room for climbers at every height.',
  },
  low: {
    id: 'low', name: 'Low meadow', w: 90, d: 45, h: 45, closed: false, cellsPerCm: 1.33, level: 5, price: 1200,
    blurb: 'A 182-litre low, wide tank: twice as wide as it is high, a broad floor of moss, leaf litter and a shallow creek.',
  },
};

export const TANK_ORDER = ['jar', 'cube', 'spire', 'nano', 'column', 'tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'];

// --- Custom size (sandbox) ---------------------------------------------------------------------------------
// Safe limits for the sliders, in centimetres, and the largest volume the grid can take.
export const CUSTOM_LIMITS = { w: [25, 200], d: [20, 80], h: [25, 100], maxLitres: 1200 };

// Grid resolution that keeps the cell counts near those of the preset tanks (about 7,000 ground cells and at most
// about 12,000 wall cells), and never finer than 2 cells per cm or coarser than 0.8.
export function cellsFor(w, d, h) {
  const ground = Math.sqrt(7500 / (w * d)), wall = Math.sqrt(12000 / (w * h));
  return Math.round(Math.max(0.8, Math.min(2, ground, wall)) * 100) / 100;
}

export function clampCustom(w, d, h) {
  const L = CUSTOM_LIMITS;
  const c = (v, [lo, hi]) => Math.round(Math.max(lo, Math.min(hi, +v || lo)));
  let o = { w: c(w, L.w), d: c(d, L.d), h: c(h, L.h) };
  // Too big: shave a centimetre at a time off whichever side is furthest above its minimum.
  for (let n = 0; n < 400 && (o.w * o.d * o.h) / 1000 > L.maxLitres; n++) {
    const r = { w: o.w / L.w[0], d: o.d / L.d[0], h: o.h / L.h[0] };
    const k = Object.keys(r).sort((a, b) => r[b] - r[a])[0];
    o[k] -= 1;
  }
  return o;
}

// Registers (or updates) the 'custom' tank so game.loadTank('custom') builds it. The size you last chose is
// remembered across reloads for the size sliders; a SAVED tank carries its own size (app/saves.js stamps it,
// Game.loadTank restores it with remember:false), so reopening it never takes the slider's last size.
export function setCustomTank(w, d, h, { remember = true } = {}) {
  const s = clampCustom(w, d, h);
  const litres = Math.round(s.w * s.d * s.h / 1000);
  TANKS.custom = {
    id: 'custom', name: `Custom ${s.w}×${s.d}×${s.h}`, ...s, closed: false, cellsPerCm: cellsFor(s.w, s.d, s.h), level: 1, price: 0, custom: true,
    blurb: `A ${litres}-litre tank at the size you chose (sandbox only).`,
  };
  if (remember) try { localStorage.setItem('paludarium.custom', JSON.stringify(s)); } catch { /* private mode */ }
  return TANKS.custom;
}

try {
  const saved = JSON.parse(localStorage.getItem('paludarium.custom') ?? 'null');
  if (saved) setCustomTank(saved.w, saved.d, saved.h);
} catch { /* no saved size */ }
