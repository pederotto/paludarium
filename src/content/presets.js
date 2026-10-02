// Ready-made terrariums the generator can build (src/sim/generator.js).
// This file is only data and names, so the menus can list presets without
// pulling in the simulation. Each preset says which tank sizes it suits, the
// real habitat it copies (a key of content/biotopes.js) and what to expect.

export const PRESETS = {
  streambank: {
    id: 'streambank', name: 'Crocodile skink creek', biotope: 'newguinea',
    blurb: 'A New Guinea creek bank: mostly land, deep litter, roots and logs, a shallow pool, a warm spot and a low UVB tube, with a red-eyed crocodile skink and a clean-up crew.',
    tiers: ['standard', 'long', 'wide', 'grand', 'show'], tags: ['skink', 'bioactive', 'humid', 'reptile'],
    adjectives: ['Dusky', 'Hidden', 'Rooted', 'Leafy', 'Quiet', 'Sago'], noun: 'Creek',
  },
  reedpool: {
    id: 'reedpool', name: 'Reed frog marsh', biotope: 'madagascar',
    blurb: 'A Madagascar marsh: mostly water under reeds, sedges and wall bromeliads for starry night reed frogs to perch on, with pearl danios and blue shrimp below.',
    tiers: ['tall', 'standard', 'long', 'wide', 'grand', 'show'], tags: ['reed frogs', 'deep water', 'false bottom', 'shrimp'],
    adjectives: ['Starry', 'Reedy', 'Warm', 'Tall', 'Glinting'], noun: 'Marsh',
  },
  matano: {
    id: 'matano', name: 'Lake Matano shore', biotope: 'matano',
    blurb: 'A deep, hard-water lake shore of stones, roots and wood that reach out of the water, with a panther crab and snails, and a canister filter.',
    tiers: ['standard', 'long', 'wide', 'grand', 'show'], tags: ['crab', 'deep water', 'hard water', 'canister'],
    adjectives: ['Clear', 'Ancient', 'Stony', 'Deep', 'Blue'], noun: 'Shore',
  },
  everglades: {
    id: 'everglades', name: 'Pygmy sunfish swamp', biotope: 'everglades',
    blurb: 'A still, weedy Everglades margin with floating plants and reeds, pygmy sunfish in the water and a crew on the hummocks.',
    tiers: ['nano', 'standard', 'long', 'wide', 'grand'], tags: ['fish', 'still water', 'reeds', 'bioactive'],
    adjectives: ['Still', 'Weedy', 'Sunlit', 'Glinting', 'Southern'], noun: 'Swamp',
  },
  cascade: {
    id: 'cascade', name: 'Cascade canyon', biotope: 'china',
    blurb: 'A rock gorge with a tall stepped waterfall into a clear lagoon, and a stream winding in from the back.',
    tiers: ['cube', 'nano', 'tall', 'standard', 'long', 'wide', 'grand', 'show'], tags: ['waterfall', 'showpiece', 'cool water', 'newts'],
    adjectives: ['Mossy', 'Misty', 'Hidden', 'Emerald', 'Silver', 'Tiered', 'Whispering', 'Cool'],
    noun: 'Cascade',
  },
  suriname: {
    id: 'suriname', name: 'Suriname forest island', biotope: 'suriname',
    blurb: 'A mossy island of roots and stump with bromeliads on the wall, a shallow pool, blue dart frogs and a springtail crew.',
    tiers: ['nano', 'tall', 'standard', 'long', 'wide', 'grand', 'show'], tags: ['dart frogs', 'bromeliads', 'bioactive', 'humid'],
    adjectives: ['Blue Frog', 'Bromeliad', 'Dripping', 'Sunlit', 'Quiet', 'Green', 'Old-growth'],
    noun: 'Island',
  },
  blackwater: {
    id: 'blackwater', name: 'Blackwater lagoon', biotope: 'blackwater',
    blurb: 'A deep tea-dark lagoon of driftwood and roots, planted, with a school of tetras, corydoras and shrimp.',
    tiers: ['nano', 'tall', 'standard', 'long', 'wide', 'grand', 'show'], tags: ['fish', 'deep water', 'driftwood', 'planted'],
    adjectives: ['Tea-dark', 'Drowned', 'Amber', 'Still', 'Rio Negro', 'Twilight', 'Sunken'],
    noun: 'Lagoon',
  },
  stream: {
    id: 'stream', name: 'Mountain stream', biotope: 'korea',
    blurb: 'A cool mountain stream that steps through two or three pools between ferns and mossy stones, with fire-bellied toads.',
    tiers: ['nano', 'tall', 'standard', 'wide', 'grand'], tags: ['stream', 'cool water', 'ferns', 'toads'],
    adjectives: ['Mossy', 'Bubbling', 'Shaded', 'Winding', 'Clear', 'Fern', 'Upland'],
    noun: 'Stream',
  },
  jar: {
    id: 'jar', name: 'Moss jar', biotope: 'java',
    blurb: 'A sealed glass jar of moss, small hills, a stone and ferns, kept clean by springtails and isopods. Almost no open water.',
    tiers: ['jar'], tags: ['sealed', 'moss', 'low maintenance', 'bioactive'],
    adjectives: ['Little', 'Emerald', 'Dewy', 'Velvet', 'Tiny', 'Forest', 'Green'],
    noun: 'Moss Jar',
  },
  karst: {
    id: 'karst', name: 'Karst towers', biotope: 'pacific',
    blurb: 'Tall stone spires rising from shallow pools and reeds, with a mourning gecko on the wall.',
    tiers: ['cube', 'nano', 'tall', 'standard', 'long', 'wide', 'grand', 'show'], tags: ['spires', 'shallow pools', 'gecko', 'reeds'],
    adjectives: ['Misty', 'Jade', 'Ancient', 'Silent', 'Rising', 'Grey', 'Hidden'],
    noun: 'Karst',
  },
  swamp: {
    id: 'swamp', name: 'Lowland swamp', biotope: 'java',
    blurb: 'Low and wet: ponds, cattails and sedges, moss hummocks and a few vampire crabs.',
    tiers: ['cube', 'nano', 'tall', 'standard', 'long', 'wide', 'grand', 'show'], tags: ['ponds', 'cattails', 'wetland', 'crabs'],
    adjectives: ['Reedy', 'Sleepy', 'Lush', 'Brackish', 'Green', 'Misty', 'Quiet'],
    noun: 'Swamp',
  },
};

export const PRESET_ORDER = ['cascade', 'suriname', 'blackwater', 'stream', 'karst', 'swamp', 'streambank', 'reedpool', 'matano', 'everglades', 'jar'];

// Presets that suit a tank size, in menu order.
export function presetsForTier(tier) {
  return PRESET_ORDER.map((id) => PRESETS[id]).filter((p) => p.tiers.includes(tier));
}

export function defaultPreset(tier) {
  return tier === 'jar' ? 'jar' : 'cascade';
}

// A small deterministic hash, so a name only depends on (preset, seed).
function hash(str, seed) {
  let h = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}

// A generated name like "Mossy Cascade No. 4127". Same preset and seed always give the same name.
export function describePreset(preset, seed = 1) {
  const p = PRESETS[preset];
  if (!p) return `Terrarium No. ${Math.abs(seed | 0) % 10000}`;
  const s = seed >>> 0;
  const adj = p.adjectives[hash(preset, s) % p.adjectives.length];
  const num = s < 10000 ? s : hash('no', s) % 10000;
  return `${adj} ${p.noun} No. ${num}`;
}
