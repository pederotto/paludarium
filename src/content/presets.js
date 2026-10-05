// Ready-made terrariums the generator can build (src/sim/generator.js).
// This file is only data and names, so the menus can list presets without
// pulling in the simulation. Each preset says which tank sizes it suits, the
// real habitat it copies (a key of content/biotopes.js) and what to expect.

export const PRESETS = {
  streambank: {
    id: 'streambank', name: 'Crocodile skink creek', biotope: 'newguinea',
    blurb: 'A New Guinea creek bank: mostly land, deep litter, roots and logs, a shallow pool, a warm spot and a low UVB tube, with a red-eyed crocodile skink and a clean-up crew.',
    tiers: ['standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['skink', 'bioactive', 'humid', 'reptile'],
    adjectives: ['Dusky', 'Hidden', 'Rooted', 'Leafy', 'Quiet', 'Sago'], noun: 'Creek',
  },
  reedpool: {
    id: 'reedpool', name: 'Reed frog marsh', biotope: 'madagascar',
    blurb: 'A southern Madagascar marsh: mostly water under papyrus sedge, reedmace and grass for starry night reed frogs to perch on.',
    tiers: ['tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['reed frogs', 'deep water', 'false bottom', 'shrimp'],
    adjectives: ['Starry', 'Reedy', 'Warm', 'Tall', 'Glinting'], noun: 'Marsh',
  },
  matano: {
    id: 'matano', name: 'Lake Matano shore', biotope: 'matano',
    blurb: 'A deep, hard-water lake shore of stones, roots and wood that reach out of the water, with a panther crab and snails, and a canister filter.',
    tiers: ['standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['crab', 'deep water', 'hard water', 'canister'],
    adjectives: ['Clear', 'Ancient', 'Stony', 'Deep', 'Blue'], noun: 'Shore',
  },
  everglades: {
    id: 'everglades', name: 'Pygmy sunfish swamp', biotope: 'everglades',
    blurb: 'A still, weedy Everglades margin with floating plants and reeds, pygmy sunfish in the water and a crew on the hummocks.',
    tiers: ['nano', 'standard', 'long', 'tower', 'wide', 'grand'], tags: ['fish', 'still water', 'reeds', 'bioactive'],
    adjectives: ['Still', 'Weedy', 'Sunlit', 'Glinting', 'Southern'], noun: 'Swamp',
  },
  cascade: {
    id: 'cascade', name: 'Cascade canyon', biotope: 'china',
    blurb: 'A rock gorge with a tall stepped waterfall into a clear lagoon, and a stream winding in from the back.',
    tiers: ['cube', 'spire', 'nano', 'column', 'tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['waterfall', 'showpiece', 'cool water', 'newts'],
    adjectives: ['Mossy', 'Misty', 'Hidden', 'Emerald', 'Silver', 'Tiered', 'Whispering', 'Cool'],
    noun: 'Cascade',
  },
  suriname: {
    id: 'suriname', name: 'Suriname forest island', biotope: 'suriname',
    blurb: 'A mossy island of roots and stump with bromeliads on the wall, a shallow pool, blue dart frogs and a springtail crew.',
    tiers: ['nano', 'column', 'tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['dart frogs', 'bromeliads', 'bioactive', 'humid'],
    adjectives: ['Blue Frog', 'Bromeliad', 'Dripping', 'Sunlit', 'Quiet', 'Green', 'Old-growth'],
    noun: 'Island',
  },
  blackwater: {
    id: 'blackwater', name: 'Blackwater lagoon', biotope: 'blackwater',
    blurb: 'A deep tea-dark Rio Negro lagoon of driftwood and roots under floating plants, with a school of cardinal tetras and corydoras.',
    tiers: ['nano', 'column', 'tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['fish', 'deep water', 'driftwood', 'planted'],
    adjectives: ['Tea-dark', 'Drowned', 'Amber', 'Still', 'Rio Negro', 'Twilight', 'Sunken'],
    noun: 'Lagoon',
  },
  stream: {
    id: 'stream', name: 'Mountain stream', biotope: 'korea',
    blurb: 'A cool mountain stream that steps through two or three pools between ferns and mossy stones, with fire-bellied toads.',
    tiers: ['nano', 'column', 'tall', 'low', 'standard', 'wide', 'grand'], tags: ['stream', 'cool water', 'ferns', 'toads'],
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
    tiers: ['cube', 'spire', 'nano', 'column', 'tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['spires', 'shallow pools', 'gecko', 'reeds'],
    adjectives: ['Misty', 'Jade', 'Ancient', 'Silent', 'Rising', 'Grey', 'Hidden'],
    noun: 'Karst',
  },
  swamp: {
    id: 'swamp', name: 'Lowland swamp', biotope: 'java',
    blurb: 'Low and wet: ponds, cattails and sedges, moss hummocks and a few vampire crabs.',
    tiers: ['cube', 'spire', 'nano', 'column', 'tall', 'low', 'standard', 'long', 'tower', 'wide', 'grand', 'show'], tags: ['ponds', 'cattails', 'wetland', 'crabs'],
    adjectives: ['Reedy', 'Sleepy', 'Lush', 'Brackish', 'Green', 'Misty', 'Quiet'],
    noun: 'Swamp',
  },
};

// --- What each set is a copy of (N15) ---------------------------------------------------------------------------------
// featured: the animal(s) the set shows off (crew species in pairs); place: the real place; ref: the tank it is authored for;
// water: share of the floor under water; climate: air °C and RH % (species board, care sheets, habitats.js).
// plants / animals: everything the set may hold. The generator drops whatever a layout builder places that is not listed
// (Gen.allowPlant / allowAnimal), and `swap` turns a stand-in into the native plant, so nothing is passed off as real.
// flora / stock: [id, n per standard tank, zone] added after the layout builder (sim/generator.js Gen.stock).
// blockedBy: an open bug the set's check waits on. needs: missing assets (BB/ASSETS.md); hidden: cannot exist without them.
const SETS = {
  cascade: {
    featured: ['newt'], place: 'Guangdong hill torrent, southern China', ref: 'standard', water: 0.45, climate: { temp: [16, 22], rh: [70, 95] },
    plants: ['javafern', 'fernph', 'fern', 'grass', 'vallisneria', 'pothos', 'javamoss'], animals: ['newt', 'shrimp', 'isopod', 'springtail'],
    needs: ['Tanichthys albonubes'],
  },
  suriname: {
    featured: ['dartfrog'], place: 'Sipaliwini forest islands, Suriname', ref: 'tall', water: 0.05, climate: { temp: [21, 27], rh: [80, 100] },
    plants: ['bromeliad', 'guzmania', 'fern', 'grass', 'monstera'], swap: { pothos: 'monstera', fernph: 'fern' },
    animals: ['dartfrog', 'isopod', 'springtail', 'fly'],
  },
  blackwater: {
    featured: ['cardinal'], place: 'Rio Negro igapó, Brazil', ref: 'standard', water: 0.75, climate: { temp: [24, 29], rh: [70, 100] },
    plants: ['sword', 'frogbit', 'fern', 'grass', 'monstera', 'bromeliad'], swap: { pothos: 'monstera', fernph: 'fern' },
    animals: ['cardinal', 'cory'],
  },
  stream: {
    featured: ['toad'], place: 'Gyeonggi hill stream, South Korea', ref: 'standard', water: 0.3, climate: { temp: [16, 24], rh: [60, 90] },
    plants: ['fernph', 'grass', 'vallisneria'], swap: { fern: 'fernph' }, animals: ['toad', 'shrimp', 'isopod', 'springtail'],
  },
  jar: {
    featured: ['springtail', 'isopod'], place: 'Forest-floor moss cushion, western Java', ref: 'jar', water: 0, climate: { temp: [22, 26], rh: [85, 100] },
    plants: ['fern', 'grass', 'javamoss'], swap: { fernph: 'fern' }, animals: ['isopod', 'springtail'],
  },
  karst: {
    featured: ['gecko'], place: 'Coastal limestone of Viti Levu, Fiji', ref: 'tall', water: 0.15, climate: { temp: [23, 30], rh: [55, 85] },
    plants: ['cattail', 'grass', 'fern'], swap: { fernph: 'fern' }, animals: ['gecko', 'springtail', 'isopod', 'fly'],
    flora: [['fern', 5, 'flat'], ['grass', 4, 'bank']],
    blockedBy: ['N10'], needs: ['coconut palm seedling', "bird's-nest fern"],
  },
  swamp: {
    featured: ['crab'], place: 'Streamside forest of western Java', ref: 'standard', water: 0.35, climate: { temp: [24, 28], rh: [80, 90] },
    plants: ['fern', 'cattail', 'grass'], swap: { fernph: 'fern' }, animals: ['crab', 'isopod', 'springtail'],
    blockedBy: ['N11'],
  },
  streambank: {
    featured: ['skink'], place: 'Madang lowland creek bank, Papua New Guinea', ref: 'standard', water: 0.2, climate: { temp: [23, 27], rh: [80, 98] },
    plants: ['fern', 'cattail', 'grass'], swap: { fernph: 'fern' }, animals: ['skink', 'purpleiso', 'isopod', 'springtail'],
    needs: ['sago palm seedling'],
  },
  reedpool: {
    featured: ['reedfrog'], place: 'Marsh near Toliara, southern Madagascar', ref: 'tall', water: 0.65, climate: { temp: [24, 29], rh: [70, 90] },
    plants: ['cattail', 'bamboo', 'grass', 'lily'], animals: ['reedfrog', 'springtail', 'fly'],
    flora: [['bamboo', 6, 'edge'], ['cattail', 6, 'edge'], ['lily', 3, 'deep:8'], ['grass', 6, 'bank']],
    needs: ['Bedotia geayi', 'Aponogeton madagascariensis', 'Pandanus'],
  },
  matano: {
    featured: ['panther'], place: 'Shore of Lake Matano, Sulawesi', ref: 'standard', water: 0.8, climate: { temp: [26, 29], rh: [70, 100] },
    plants: ['vallisneria', 'grass'], animals: ['panther', 'snail'],
    needs: ['Tylomelania', 'Matano Caridina'],
  },
  everglades: {
    featured: ['pygmy'], place: 'Everglades slough margin, Florida', ref: 'nano', water: 0.7, climate: { temp: [18, 24], rh: [65, 95] },
    plants: ['cattail', 'grass', 'fern'], swap: { fernph: 'fern' }, animals: ['pygmy', 'springtail', 'isopod'],
    needs: ['Limnobium spongia'],
  },
};
for (const [id, s] of Object.entries(SETS)) Object.assign(PRESETS[id], s);

export const PRESET_ORDER = ['cascade', 'suriname', 'blackwater', 'stream', 'karst', 'swamp', 'streambank', 'reedpool', 'matano', 'everglades', 'jar'];

// Presets that suit a tank size, in menu order.
export function presetsForTier(tier) {
  return PRESET_ORDER.map((id) => PRESETS[id]).filter((p) => p.tiers.includes(tier) && !p.hidden);
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
