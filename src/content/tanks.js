// The enclosures you can build in, smallest to grandest. Career mode unlocks
// them with reputation and funds; sandbox mode has them all.

export const TANKS = {
  jar: {
    id: 'jar', name: 'Moss jar', w: 34, d: 26, h: 38, closed: true, cellsPerCm: 1.7, level: 1, price: 0,
    blurb: 'A sealed glass jar: a miniature closed ecosystem. Water evaporates, condenses on the glass and rains back down, so it can run for years on its own if it is balanced.',
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
};

export const TANK_ORDER = ['jar', 'nano', 'standard', 'grand'];
