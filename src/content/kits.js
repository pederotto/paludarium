// Prefab aquascape compositions ("kits") you drop on the tank with one click.
//
// Plain data with no imports from the simulation (only the price tables), so
// the prices and unlock ranks can be unit tested under Node
// (tests/kits.test.mjs). The builder that turns a kit into real pieces is
// sim/kits.js.
//
// Distances are centimetres for a reference tank 90 cm wide (the standard
// paludarium); the builder scales them to the tank you are building in.
//
//   pieces  [{ type, dx, dz, size, ... }] relative to the point you click.
//           type   a Hardscape piece id (sim/decor.js PIECES)
//           dx, dz offset from the click, size the largest dimension (cm)
//           variants  which of the model's variants to draw from
//           rot    fixed yaw (radians); left out, the builder picks one
//           scale  [sx, sy, sz] squash/stretch; lean  tilt range (radians)
//           width  spire only: base width (cm), size is then the height
//           stack  sit on whatever is under it (not on the bare ground)
//           atTop  i: sit on the highest point of piece i (dx, dz are ignored)
//           bridge [i, j] lie across the tops of pieces i and j
//   banks   [{ ring, width, height, moss }] a raised ring of ground
//   outlet  { on } a pump outlet on the top of piece `on`, pouring down
//   spin    how far (radians) the whole layout may turn per placement
//   teaches the composition rule the kit demonstrates
//
// A kit costs the sum of its pieces (economy.js) and unlocks with the rank of
// its priciest piece.

import { entry, bulkFactor } from './economy.js';

const BIG = [6, 7, 8, 10, 11, 12];        // the rounder boulder variants

// A curved row of stones from big to small: each is placed one step further
// along a gently bending line, with a small gap between neighbours.
function row(sizes, { bend = 0.55, gap = 1.7 } = {}) {
  let x = 0, z = 0, h = -bend / 2;
  const pts = sizes.map((size, i) => {
    if (i) {
      const d = (sizes[i - 1] + size) / 2 + gap;
      h += (bend / (sizes.length - 1)) * (1 + 0.15 * Math.sin(i * 2.1));
      x += Math.cos(h) * d; z += Math.sin(h) * d;
    }
    return { x, z, size };
  });
  const cx = (pts[0].x + pts[pts.length - 1].x) / 2, cz = (pts[0].z + pts[pts.length - 1].z) / 2;
  return pts.map((p) => ({ type: 'boulder', dx: +(p.x - cx).toFixed(2), dz: +(p.z - cz).toFixed(2), size: p.size, variants: BIG }));
}

export const KITS = [
  {
    id: 'waterfall', name: 'Waterfall cliff',
    blurb: 'A cliff face with a boulder stacked on top and a pump outlet at the summit, pouring down into the tank.',
    teaches: 'Build height at the back and keep the fall off-centre: the eye settles on a focal point about a third of the way across.',
    spin: 0.12,
    pieces: [
      { type: 'cliff', dx: 0, dz: 0, size: 28, rot: 0, scale: [1.1, 1, 1] },
      { type: 'boulder', dx: 0, dz: 0, size: 10, variants: BIG, stack: true, atTop: 0 },
      { type: 'boulder', dx: -14, dz: 8, size: 9, variants: BIG },
      { type: 'boulder', dx: 12, dz: 9, size: 6, variants: BIG },
    ],
    outlet: { on: 1 },
  },
  {
    id: 'arch', name: 'Root arch',
    blurb: 'A log bridged across two stones, with roots draped over the larger one.',
    teaches: 'Let wood and roots cross the stones so they look grown together, and leave a gap you can see through for depth.',
    spin: 0.5,
    pieces: [
      { type: 'boulder', dx: -12, dz: 0, size: 13, variants: BIG },
      { type: 'boulder', dx: 12, dz: 3, size: 9, variants: BIG },
      { type: 'wood', dx: 0, dz: 1.5, size: 30, rot: 0, scale: [1, 1.5, 1.5], lean: 0.06, bridge: [0, 1] },
      { type: 'roots', dx: -12, dz: 0, size: 20, stack: true },
      { type: 'boulder', dx: 3, dz: 10, size: 5.5, variants: BIG },
    ],
  },
  {
    id: 'steps', name: 'Stepping stones',
    blurb: 'Seven boulders in a curved row, graded from big to small, like a path across a stream.',
    teaches: 'Grade the sizes from large to small and keep the gaps uneven: the row leads the eye along a curve.',
    spin: 0.7,
    pieces: row([13, 10.5, 9, 7.5, 6, 5, 4]),
  },
  {
    id: 'spires', name: 'Spire cluster',
    blurb: 'Five stone spires of different heights leaning together, tallest first.',
    teaches: 'Use an odd number and grade the heights, tall, medium, small. Put the tallest slightly off the centre of the tank.',
    spin: Math.PI,
    pieces: [
      { type: 'spire', dx: 0, dz: 0, size: 34, width: 11, lean: 0.1 },
      { type: 'spire', dx: -9.5, dz: 2.5, size: 25, width: 8.5, lean: 0.14 },
      { type: 'spire', dx: 8.5, dz: 4, size: 19, width: 7.5, lean: 0.14 },
      { type: 'spire', dx: -3, dz: 10, size: 13, width: 6, lean: 0.14 },
      { type: 'spire', dx: 15, dz: -3, size: 9, width: 5, lean: 0.14 },
    ],
  },
  {
    id: 'island', name: 'Mossy island',
    blurb: 'A raised, mossy bank ring with a stump at its heart and three boulders. Flood the tank around it to make an island.',
    teaches: 'A focal point sits off-centre; ring it with lower shapes so the eye circles in, and use three stones, not two or four.',
    spin: Math.PI,
    banks: [{ ring: 15, width: 2.8, height: 2.6, moss: true }],
    pieces: [
      { type: 'stump', dx: -3, dz: -3, size: 15 },
      { type: 'boulder', dx: 13.5, dz: -6, size: 9, variants: BIG },
      { type: 'boulder', dx: -6, dz: 6, size: 7.5, variants: BIG },
      { type: 'boulder', dx: 5, dz: 6.5, size: 5, variants: BIG },
    ],
  },
];

// --- Prices and unlocks ---------------------------------------------------------------------

// How many of each piece type the kit uses: { boulder: 4, cliff: 1 }.
export function kitCounts(kit) {
  const c = {};
  for (const p of kit.pieces) c[p.type] = (c[p.type] ?? 0) + 1;
  return c;
}

// The career price: the sum of the piece prices, with the same bulk discount as buying
// them one type at a time (game/career.js cost()).
export function kitPrice(kit) {
  let sum = 0;
  for (const [type, n] of Object.entries(kitCounts(kit))) {
    const e = entry('piece', type);
    sum += Math.ceil(e.price * n * bulkFactor(n));
  }
  return sum;
}

// The rank that unlocks the kit: the rank of its priciest piece.
export function kitRank(kit) {
  let best = null;
  for (const p of kit.pieces) {
    const e = entry('piece', p.type);
    if (!best || e.price > best.price) best = e;
  }
  return best.rank;
}

// Half the width of the kit's footprint (reference cm), for the placement ring.
export function kitReach(kit) {
  let r = 0;
  for (const p of kit.pieces) r = Math.max(r, Math.hypot(p.dx, p.dz) + (p.width ?? p.size) / 2);
  for (const b of kit.banks ?? []) r = Math.max(r, b.ring + b.width);
  return r;
}

export const kitById = (id) => KITS.find((k) => k.id === id) ?? null;
