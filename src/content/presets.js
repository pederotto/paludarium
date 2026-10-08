// Ready-made terrariums the generator can build (src/sim/generator.js).
// This file is only data and names, so the menus can list presets without
// pulling in the simulation. Each preset says which tank sizes it suits, the
// real habitat it copies (a key of content/biotopes.js) and what to expect.

import { SHOWCASE_LAYOUTS, SHOWCASE_SETS } from './presets-showcase.js';

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
    featured: ['pygmy'], place: 'Everglades slough margin, Florida', ref: 'standard', water: 0.7, climate: { temp: [18, 24], rh: [65, 95] },
    plants: ['cattail', 'grass', 'fern', 'lily', 'fissidens'], swap: { fernph: 'fern' }, animals: ['pygmy', 'springtail', 'isopod'],
    flora: [['cattail', 6, 'edge'], ['lily', 3, 'deep:6'], ['fissidens', 4, 'deep:4'], ['grass', 5, 'bank'], ['fern', 3, 'flat']],
    stock: [['isopod', 8, 'land'], ['springtail', 20, 'land']],
    needs: ['Limnobium spongia'],
  },
};
for (const [id, s] of Object.entries(SETS)) Object.assign(PRESETS[id], s);


// --- New sets (N15 batch 2): one per species not featured above. Each reuses a layout builder (`layout`) and lists its
// place's own plants and animals; `tiers` default to the layout's.
const NEW_SETS = {
  canopypool: {
    name: 'Tortuguero canopy pool', biotope: 'costarica', layout: 'reedpool', featured: ['redeye'], ref: 'tall',
    place: 'Caribbean lowland rainforest, Tortuguero, Costa Rica', water: 0.6, climate: { temp: [24, 28], rh: [80, 90] }, env: { setpoint: 26 },
    blurb: 'A forest pool on the Caribbean coast of Costa Rica under monstera, columnea and bromeliads, where red-eyed tree frogs sleep on leaves above the water.',
    plants: ['monstera', 'columnea', 'guzmania', 'tillandsia', 'bromeliad', 'fern', 'grass', 'frogbit', 'sword'], swap: { pothos: 'monstera', fernph: 'fern' },
    flora: [['monstera', 4, 'flat'], ['fern', 4, 'flat'], ['guzmania', 3, 'wall'], ['columnea', 3, 'wall'], ['tillandsia', 2, 'wall'], ['frogbit', 4, 'deep:4'], ['sword', 2, 'deep:6']],
    animals: ['redeye', 'springtail', 'isopod', 'fly'], stock: [['redeye', 3, 'bank'], ['isopod', 8, 'land']],
    needs: ['Heliconia'], tags: ['tree frogs', 'tall', 'pool', 'bromeliads'], adjectives: ['Green', 'Rainy', 'Leafy', 'Caribbean', 'Night'], noun: 'Pool',
  },
  bocasslope: {
    name: 'Bastimentos bromeliad slope', biotope: 'bocas', layout: 'suriname', featured: ['strawberry'], ref: 'nano',
    place: 'Isla Bastimentos, Bocas del Toro, Panama', water: 0.03, climate: { temp: [24, 29], rh: [85, 100] }, env: { setpoint: 26 },
    blurb: 'A wet forest slope on an island off Panama: litter, roots and a wall of bromeliads, orchids and columnea for strawberry poison frogs.',
    plants: ['guzmania', 'bromeliad', 'columnea', 'pleurothallis', 'lepanthes', 'fern', 'grass', 'monstera'], swap: { pothos: 'monstera', fernph: 'fern' },
    flora: [['columnea', 3, 'wall'], ['pleurothallis', 2, 'wall'], ['lepanthes', 2, 'wall'], ['guzmania', 2, 'wall']],
    animals: ['strawberry', 'springtail', 'isopod', 'fly'], stock: [['strawberry', 3, 'land']],
    tags: ['dart frogs', 'bromeliads', 'orchids', 'humid'], adjectives: ['Red', 'Island', 'Rainy', 'Mossy', 'Bright'], noun: 'Slope',
  },
  cacaogrove: {
    name: 'Cacao grove floor', biotope: 'cacao', layout: 'suriname', featured: ['auratus'], ref: 'nano',
    place: 'Shaded cacao plantation, Bocas del Toro, Panama', water: 0.08, climate: { temp: [22, 28], rh: [80, 100] }, env: { setpoint: 25 },
    blurb: 'The leaf-littered floor of a shaded cacao grove in Panama, where green and black poison frogs hunt among roots and low plants.',
    plants: ['monstera', 'columnea', 'guzmania', 'bromeliad', 'fern', 'grass'], swap: { pothos: 'monstera', fernph: 'fern' },
    flora: [['monstera', 3, 'flat'], ['columnea', 2, 'wall']],
    animals: ['auratus', 'springtail', 'isopod', 'fly'], stock: [['auratus', 3, 'land']],
    needs: ['cacao seedling'], tags: ['dart frogs', 'leaf litter', 'bioactive'], adjectives: ['Shaded', 'Green', 'Quiet', 'Leafy'], noun: 'Grove',
  },
  boulderforest: {
    name: 'Guiana boulder forest', biotope: 'bolivar', layout: 'suriname', featured: ['leucomelas'], ref: 'tall',
    place: 'Granite boulder forest, Bolívar state, Venezuela', water: 0.05, climate: { temp: [22, 27], rh: [70, 95] }, env: { setpoint: 24 },
    blurb: 'Forest among granite boulders in southern Venezuela, wet in the rains and drier between them: home of the yellow-banded poison frog.',
    plants: ['bromeliad', 'guzmania', 'fern', 'grass'], swap: { fernph: 'fern' },
    flora: [['guzmania', 2, 'wall'], ['fern', 3, 'flat']],
    animals: ['leucomelas', 'springtail', 'isopod', 'fly'], stock: [['leucomelas', 3, 'land']],
    tags: ['dart frogs', 'boulders', 'seasonal'], adjectives: ['Granite', 'Golden', 'Sunlit', 'Old'], noun: 'Forest',
  },
  sierrapools: {
    name: 'Sierra rain pools', biotope: 'cordoba', layout: 'stream', featured: ['bumblebee'], ref: 'standard',
    place: 'Grassland of the Sierras de Córdoba, Argentina', water: 0.15, climate: { temp: [20, 24], rh: [60, 85] }, env: { setpoint: 22 },
    blurb: 'Rocky hill grassland in central Argentina with shallow rain pools, where bumblebee toads walk among the tussocks.',
    plants: ['grass'], flora: [['grass', 10, 'bank'], ['grass', 8, 'flat']],
    animals: ['bumblebee', 'springtail', 'isopod'], stock: [['bumblebee', 3, 'bank']],
    needs: ['bunchgrass', 'Dyckia'], tags: ['toads', 'grassland', 'shallow pools'], adjectives: ['Windy', 'Stony', 'Golden', 'High'], noun: 'Pools',
  },
  beechseep: {
    name: 'Beech-wood spring seep', biotope: 'teutoburg', layout: 'stream', featured: ['firesal'], ref: 'wide',
    place: 'Beech wood of the Teutoburg Forest, Germany', water: 0.08, climate: { temp: [12, 18], rh: [75, 95] }, env: { setpoint: 16 },
    blurb: 'A cool spring seeping through a German beech wood: ferns, bilberry and creeping jenny over litter and logs, with a fire salamander.',
    plants: ['fernph', 'weed', 'bilberry', 'grass'], swap: { fern: 'fernph' },
    animals: ['firesal', 'springtail', 'isopod'], stock: [['firesal', 2, 'land']],
    blockedBy: ['N9'], needs: ["hart's-tongue fern", 'European forest moss', 'wood sorrel'], tags: ['salamander', 'cool', 'ferns'], adjectives: ['Cool', 'Beech', 'Shaded', 'Mossy'], noun: 'Seep',
  },
  frogpond: {
    name: 'Woodland frog pond', biotope: 'teutoburg', layout: 'blackwater', featured: ['commonfrog'], ref: 'wide',
    place: 'Pond in a beech wood, Teutoburg Forest, Germany', water: 0.4, climate: { temp: [12, 18], rh: [75, 95] }, env: { setpoint: 16 },
    blurb: 'A cool pond in a German beech wood, ferns and bilberry on the damp bank: common frogs hunt on the litter and swim out into the water.',
    plants: ['fernph', 'weed', 'bilberry', 'grass', 'hartstongue'], swap: { fern: 'fernph' },
    animals: ['commonfrog', 'springtail', 'isopod'], stock: [['commonfrog', 2, 'bank'], ['isopod', 8, 'land'], ['springtail', 20, 'land']],
    tags: ['frogs', 'pond', 'cool'], adjectives: ['Cool', 'Beech', 'Shaded', 'Still'], noun: 'Pond',
  },
  oakpond: {
    name: 'Oak-wood pond', biotope: 'galicia', layout: 'blackwater', featured: ['marbled'], ref: 'standard',
    place: 'Pond in an oak wood, Galicia, Spain', water: 0.5, climate: { temp: [14, 21], rh: [70, 95] }, env: { setpoint: 18 },
    blurb: 'A clear woodland pond in north-west Spain with reedmace, water lilies and ferns on the bank, and marbled newts.',
    plants: ['cattail', 'lily', 'weed', 'fernph', 'grass', 'vallisneria'], swap: { fern: 'fernph' },
    flora: [['cattail', 5, 'edge'], ['lily', 3, 'deep:8'], ['weed', 4, 'flat'], ['fernph', 3, 'flat']],
    animals: ['marbled', 'springtail', 'isopod'], stock: [['marbled', 2, 'bank'], ['isopod', 8, 'land'], ['springtail', 20, 'land']],
    blockedBy: ['N16'], needs: ['water crowfoot'], tags: ['newts', 'pond', 'cool'], adjectives: ['Clear', 'Oak', 'Spring', 'Green'], noun: 'Pond',
  },
  chinampa: {
    name: 'Chinampa canal', biotope: 'xochimilco', layout: 'blackwater', featured: ['axolotl'], ref: 'long',
    place: 'Canals of Xochimilco, Mexico City', water: 0.9, climate: { temp: [14, 20], rh: [50, 95] }, env: { setpoint: 17 },
    blurb: 'A cool, slow canal beside the floating gardens of Xochimilco, with eelgrass, frogbit and lilies, and axolotls on the bottom.',
    plants: ['vallisneria', 'frogbit', 'lily', 'grass'], flora: [['lily', 3, 'deep:8'], ['grass', 4, 'bank']],
    animals: ['axolotl'], stock: [['axolotl', 2, 'deep:6']],
    needs: ['Cambarellus montezumae', 'ahuejote willow'], tags: ['axolotl', 'cold water', 'deep'], adjectives: ['Cool', 'Ancient', 'Still', 'Floating'], noun: 'Canal',
  },
  riverbank: {
    name: 'Batang Hari riverbank', biotope: 'sumatra', layout: 'blackwater', featured: ['loach'], ref: 'show',
    place: 'Batang Hari river, Sumatra, Indonesia', water: 0.85, climate: { temp: [24, 30], rh: [70, 100] }, env: { setpoint: 27 },
    blurb: 'A Sumatran riverbank of roots and wood over a deep, flowing channel, with young clown loaches and java fern on the wood.',
    plants: ['javafern', 'javamoss', 'fern', 'grass'], swap: { fernph: 'fern' }, flora: [['javafern', 6, 'deep:6']],
    animals: ['loach'], stock: [['loach', 5, 'deep:8']],
    needs: ['Cryptocoryne', 'Bucephalandra'], tags: ['fish', 'river', 'deep water'], adjectives: ['Brown', 'Rooted', 'Wide', 'Flowing'], noun: 'Riverbank',
  },
  klong: {
    name: 'Klong margin', biotope: 'thai', layout: 'blackwater', featured: ['betta'], ref: 'nano',
    place: 'Klong margin on the Chao Phraya plain, Thailand', water: 0.85, climate: { temp: [24, 30], rh: [70, 90] }, env: { setpoint: 27 },
    blurb: 'The still, plant-choked edge of a canal on the central plain of Thailand: lilies, reedmace and rotala, and a betta at the surface.',
    plants: ['lily', 'cattail', 'rotala', 'grass', 'javafern', 'fern'], swap: { fernph: 'fern' },
    flora: [['lily', 3, 'deep:6'], ['cattail', 4, 'edge'], ['rotala', 5, 'deep:6']],
    animals: ['betta'], stock: [['betta', 1, 'deep:3']],
    needs: ['Cryptocoryne', 'rice'], tags: ['fish', 'still water', 'floating plants'], adjectives: ['Still', 'Warm', 'Lily', 'Golden'], noun: 'Klong',
  },
  shanpond: {
    name: 'Shan spring pond', biotope: 'shan', layout: 'blackwater', featured: ['cpd'], ref: 'nano',
    place: 'Spring pond near Hopong, Shan Plateau, Myanmar', water: 0.8, climate: { temp: [22, 26], rh: [60, 90] }, env: { setpoint: 24 },
    blurb: 'A shallow, weedy spring pond in the hills of Myanmar where celestial pearl danios hide among the stems.',
    plants: ['grass', 'rotala'], flora: [['rotala', 8, 'deep:5'], ['grass', 8, 'bank'], ['grass', 6, 'flat']],
    animals: ['cpd'], stock: [['cpd', 8, 'deep:3']],
    needs: ['Blyxa'], tags: ['fish', 'weedy', 'spring'], adjectives: ['Clear', 'Weedy', 'Highland', 'Quiet'], noun: 'Pond',
  },
  mosspool: {
    name: 'Taiwan mossy pool', biotope: 'taiwan', layout: 'blackwater', featured: ['blueshrimp'], ref: 'column',
    place: 'Hill-stream pool, Hsinchu, Taiwan (wild Neocaridina; blue is a cultivar)', water: 0.85, climate: { temp: [20, 26], rh: [70, 95] }, env: { setpoint: 22 },
    blurb: 'A small, mossy pool below a trickle in the hills of Taiwan, full of grazing shrimp.',
    plants: ['javafern', 'javamoss', 'fern', 'grass', 'pothos', 'vallisneria'], swap: { fernph: 'fern' },
    flora: [['javafern', 4, 'deep:4'], ['vallisneria', 4, 'deep:7'], ['fern', 3, 'flat']],
    animals: ['blueshrimp', 'springtail', 'isopod'], stock: [['blueshrimp', 10, 'deep:2'], ['springtail', 15, 'land']],
    tags: ['shrimp', 'moss', 'small'], adjectives: ['Mossy', 'Little', 'Cool', 'Green'], noun: 'Pool',
  },
  moonlake: {
    name: 'Sun Moon Lake inlet', biotope: 'taiwan', layout: 'blackwater', featured: ['shrimp'], ref: 'nano',
    place: 'Inlet of Sun Moon Lake, Taiwan', water: 0.7, climate: { temp: [18, 26], rh: [70, 95] }, env: { setpoint: 22 },
    blurb: 'A planted inlet of a mountain lake in Taiwan, where the wild ancestors of cherry shrimp graze on wood and stone.',
    plants: ['javafern', 'javamoss', 'fern', 'grass', 'pothos', 'vallisneria'], swap: { fernph: 'fern' }, flora: [['vallisneria', 6, 'deep:7']],
    animals: ['shrimp'], stock: [['shrimp', 10, 'deep:2']],
    tags: ['shrimp', 'lake', 'planted'], adjectives: ['Misty', 'Blue', 'Calm', 'Mountain'], noun: 'Inlet',
  },
  putumayo: {
    name: 'Putumayo forest creek', biotope: 'putumayo', layout: 'blackwater', featured: ['neon'], ref: 'standard',
    place: 'Forest creek of the Río Putumayo, Peru and Colombia', water: 0.75, climate: { temp: [21, 26], rh: [70, 100] }, env: { setpoint: 24 },
    blurb: 'A shaded, soft-water forest creek in the upper Amazon, with sword plants, frogbit and a school of neon tetras.',
    plants: ['sword', 'frogbit', 'fern', 'grass', 'monstera', 'bromeliad'], swap: { pothos: 'monstera', fernph: 'fern' },
    animals: ['neon'], stock: [['neon', 10, 'deep:5']],
    tags: ['fish', 'soft water', 'school'], adjectives: ['Shaded', 'Soft', 'Amazon', 'Glinting'], noun: 'Creek',
  },
  araguaia: {
    name: 'Araguaia backwater', biotope: 'araguaia', layout: 'blackwater', featured: ['ember'], ref: 'nano',
    place: 'Backwater of the Rio das Mortes, Mato Grosso, Brazil', water: 0.75, climate: { temp: [23, 29], rh: [65, 95] }, env: { setpoint: 27 },
    blurb: 'A warm, still backwater of the Araguaia basin with sword plants, frogbit and lilies, and a glowing school of ember tetras.',
    plants: ['sword', 'frogbit', 'lily', 'grass'], flora: [['lily', 2, 'deep:6'], ['sword', 3, 'deep:6'], ['frogbit', 4, 'deep:4'], ['grass', 4, 'bank']],
    animals: ['ember'], stock: [['ember', 10, 'deep:4']],
    tags: ['fish', 'still water', 'school'], adjectives: ['Warm', 'Amber', 'Still', 'Glowing'], noun: 'Backwater',
  },
  aripo: {
    name: 'Aripo hill stream', biotope: 'trinidad', layout: 'stream', featured: ['guppy'], ref: 'standard',
    place: 'Aripo River, Northern Range, Trinidad', water: 0.6, climate: { temp: [22, 28], rh: [70, 95] }, env: { setpoint: 25 },
    blurb: 'A clear stream stepping down through the Northern Range of Trinidad, where wild guppies live in the pools.',
    plants: ['grass', 'fern', 'bromeliad', 'guzmania'], swap: { fernph: 'fern' }, flora: [['fern', 4, 'flat'], ['guzmania', 2, 'wall']],
    animals: ['guppy', 'springtail', 'isopod'], stock: [['guppy', 8, 'deep:3']],
    needs: ['Heliconia'], tags: ['fish', 'stream', 'wild guppies'], adjectives: ['Clear', 'Rocky', 'Sunlit', 'Island'], noun: 'Stream',
  },
  sandbank: {
    name: 'Clearwater sandbank', biotope: 'tapajos', layout: 'blackwater', featured: ['cory'], ref: 'wide',
    place: 'Sandbank of the Rio Tapajós, Pará, Brazil (the game\'s corydoras stands for the genus)', water: 0.8, climate: { temp: [24, 29], rh: [65, 95] }, env: { setpoint: 26 },
    blurb: 'A clear-water sandbank of the Tapajós with sword plants and sunken wood, where corydoras sift the sand in groups.',
    plants: ['sword', 'vallisneria', 'grass', 'fern'], swap: { fernph: 'fern' }, flora: [['sword', 4, 'deep:6'], ['grass', 4, 'bank']],
    animals: ['cory'], stock: [['cory', 6, 'deep:4']],
    tags: ['fish', 'sand', 'clear water'], adjectives: ['Clear', 'Sandy', 'Bright', 'Wide'], noun: 'Sandbank',
  },
  atlantic: {
    name: 'Mata Atlântica creek', biotope: 'mataatlantica', layout: 'blackwater', featured: ['oto'], ref: 'nano',
    place: 'Coastal forest creek, Rio de Janeiro state, Brazil', water: 0.6, climate: { temp: [22, 27], rh: [75, 100] }, env: { setpoint: 24 },
    blurb: 'A small creek of the Atlantic rainforest of Brazil: sword plants in the water, miniature gloxinias and tube bromeliads on wet rock, otocinclus grazing.',
    plants: ['sword', 'sinningia', 'neoregelia', 'fern', 'grass'], swap: { fernph: 'fern' },
    flora: [['sword', 3, 'deep:6'], ['sinningia', 3, 'wall'], ['neoregelia', 3, 'wall'], ['fern', 3, 'flat']],
    animals: ['oto'], stock: [['oto', 5, 'deep:3']],
    tags: ['fish', 'algae grazers', 'bromeliads'], adjectives: ['Green', 'Coastal', 'Mossy', 'Clear'], noun: 'Creek',
  },
  keralapool: {
    name: 'Kerala paddy pool', biotope: 'kerala', layout: 'blackwater', featured: ['snail'], ref: 'nano',
    place: 'Laterite paddy pool, Kerala, India (native range of the trumpet snail)', water: 0.7, climate: { temp: [22, 30], rh: [70, 95] }, env: { setpoint: 26 },
    blurb: 'A warm pool at the edge of a paddy in Kerala with lilies and rotala, where trumpet snails dig through the mud at night.',
    plants: ['rotala', 'lily', 'grass'], flora: [['rotala', 6, 'deep:5'], ['lily', 3, 'deep:6'], ['grass', 6, 'bank']],
    animals: ['snail'], stock: [['snail', 10, 'deep:2']],
    needs: ['Cryptocoryne'], tags: ['snails', 'paddy', 'warm'], adjectives: ['Warm', 'Red-earth', 'Still', 'Monsoon'], noun: 'Pool',
  },
  cavemouth: {
    name: 'Limestone cave mouth', biotope: 'thaicave', layout: 'cascade', featured: ['pandaking', 'springsea'], ref: 'cube',
    place: 'Cave mouth with a seep, limestone hills of Thailand (Cubaris sp.; seashore springtail origin not verified)', water: 0.2, climate: { temp: [24, 28], rh: [80, 95] }, env: { setpoint: 25 },
    blurb: 'The damp, mossy mouth of a limestone cave with a seep and a pool: panda king isopods on the rock, springtails on the water film.',
    plants: ['javamoss', 'javafern', 'fern'], swap: { fernph: 'fern' },
    animals: ['pandaking', 'springsea'], stock: [['pandaking', 6, 'ledge'], ['springsea', 20, 'edge']],
    tags: ['isopods', 'springtails', 'crew', 'limestone'], adjectives: ['Dripping', 'Dark', 'Mossy', 'Stony'], noun: 'Cave',
  },
};
for (const [id, s] of Object.entries(NEW_SETS)) PRESETS[id] = { id, tiers: [...PRESETS[s.layout].tiers].filter((t) => t !== 'jar'), ...s };

// S1 (audit 7 Oct): the repairs of every set, applied over the recipes above (a field replaces; `plus` adds to the lists; stock and
// flora merge by id). Generator knobs (sim/generator.js): level (water height as a share of the tank's), pool (size of the pool or
// lagoon), rate (pump flow), bed (sand, soil = mud, gravel), rocks (stones on the bed), sparse (fewer logs), gear and env (a chiller
// for a cool set). Removed: tideline (hidden, empty, needs mangrove and brackish water that do not exist), fernjar (merged into jar).
const COOL = (t) => ({ env: { setpoint: t, chill: 1, coolSet: t }, gear: ['chiller'] });
const S1 = {
  cascade: { level: 0.3, featured: ['newt', 'tanichthys', 'hillloach'], plus: { plants: ['bamboo', 'crypt', 'nidus', 'miscanthus'], animals: ['tanichthys', 'hillloach'], flora: [['javamoss', 4, 'edge'], ['bamboo', 3, 'edge'], ['pothos', 4, 'wall'], ['nidus', 2, 'flat'], ['miscanthus', 2, 'bank'], ['crypt', 5, 'deep:5']], stock: [['tanichthys', 10, 'deep:4'], ['hillloach', 3, 'deep:3']] } },
  suriname: { plus: { plants: ['tillandsia'], flora: [['tillandsia', 3, 'wall'], ['guzmania', 3, 'wall']], stock: [['dartfrog', 5, 'land']] } },
  blackwater: { plus: { stock: [['cardinal', 12, 'deep:6'], ['cory', 6, 'deep:4']] } },
  stream: { water: 0.75, level: 0.42, pool: 1.6, featured: ['toad', 'zacco'], animals: ['toad', 'zacco', 'isopod', 'springtail'], plus: { plants: ['cattail', 'javamoss', 'miscanthus'], flora: [['cattail', 3, 'edge'], ['javamoss', 4, 'edge'], ['miscanthus', 3, 'bank'], ['grass', 4, 'bank']], stock: [['toad', 5, 'bank'], ['zacco', 6, 'deep:3']] } },
  karst: { plus: { plants: ['pothos', 'nidus'], flora: [['pothos', 5, 'wall'], ['nidus', 3, 'flat']] } },
  swamp: { level: 0.18, pool: 1.2, plus: { plants: ['javamoss', 'bamboo', 'pothos', 'nidus'], flora: [['javamoss', 4, 'edge'], ['bamboo', 3, 'edge'], ['pothos', 4, 'wall'], ['nidus', 2, 'flat']], stock: [['crab', 4, 'bank']] } },
  streambank: { plus: { plants: ['pothos', 'nidus'], flora: [['pothos', 4, 'wall'], ['nidus', 2, 'flat']] } },
  reedpool: { plus: { plants: ['fern', 'vallisneria'], flora: [['vallisneria', 6, 'deep:8'], ['fern', 3, 'flat']] } },
  matano: { animals: ['panther'], plus: { plants: ['javafern', 'pothos'], flora: [['javafern', 5, 'deep:5'], ['pothos', 4, 'wall']] } },
  everglades: { ref: 'wide' },
  canopypool: { plus: { stock: [['redeye', 4, 'bank']] } },
  bocasslope: { ref: 'standard', env: { setpoint: 26, fogger: 0.8 }, plus: { plants: ['tillandsia'], flora: [['tillandsia', 2, 'wall'], ['columnea', 3, 'wall']], stock: [['strawberry', 4, 'land']] } },
  cacaogrove: { ref: 'standard', plus: { flora: [['guzmania', 2, 'wall'], ['bromeliad', 3, 'wall'], ['fern', 3, 'flat']], stock: [['auratus', 4, 'land']] } },
  boulderforest: { plus: { plants: ['tillandsia'], flora: [['tillandsia', 3, 'wall'], ['bromeliad', 3, 'wall'], ['grass', 3, 'bank']], stock: [['leucomelas', 4, 'land']] } },
  sierrapools: { plus: { plants: ['bromeliad', 'tillandsia', 'fern'], flora: [['bromeliad', 3, 'flat'], ['tillandsia', 3, 'wall'], ['fern', 2, 'flat']], stock: [['bumblebee', 5, 'bank']] } },
  beechseep: { ...COOL(18), env: { setpoint: 18, chill: 1, coolSet: 18, fogger: 0.5 }, gear: ['chiller', 'fogger'], pool: 0.5, plus: { plants: ['hartstongue'], flora: [['weed', 5, 'flat'], ['bilberry', 3, 'flat'], ['fernph', 4, 'flat'], ['hartstongue', 4, 'flat']] } },
  oakpond: { ...COOL(18), plus: { stock: [['marbled', 3, 'bank']] } },
  frogpond: { ...COOL(18), pool: 1.0 },
  chinampa: { ...COOL(17), level: 0.5, pool: 1.2, rate: 60, bed: 'soil', plus: { plants: ['cattail'], flora: [['cattail', 4, 'edge'], ['frogbit', 6, 'deep:4'], ['vallisneria', 8, 'deep:8']] } },
  riverbank: { level: 0.45, rate: 420, rocks: 6, bed: 'gravel', plus: { plants: ['pothos', 'rotala', 'vallisneria', 'crypt'], flora: [['pothos', 6, 'wall'], ['vallisneria', 8, 'deep:8'], ['javamoss', 5, 'edge'], ['rotala', 6, 'deep:6'], ['crypt', 6, 'deep:6']] } },
  klong: { rate: 50, bed: 'soil', plus: { plants: ['pothos', 'vallisneria', 'crypt', 'javamoss'], flora: [['vallisneria', 6, 'deep:6'], ['javamoss', 4, 'edge'], ['pothos', 3, 'wall'], ['fern', 3, 'flat'], ['crypt', 5, 'deep:6']] } },
  shanpond: { plus: { plants: ['javamoss', 'vallisneria', 'crypt'], flora: [['javamoss', 5, 'edge'], ['vallisneria', 5, 'deep:5'], ['crypt', 4, 'deep:5']] } },
  mosspool: { rate: 300, rocks: 5, bed: 'gravel', plus: { plants: ['nidus'], flora: [['javamoss', 6, 'edge'], ['nidus', 2, 'flat']] } },
  moonlake: { bed: 'gravel', plus: { flora: [['javamoss', 5, 'edge'], ['pothos', 3, 'wall'], ['javafern', 4, 'deep:4']] } },
  putumayo: { rate: 260, rocks: 4, plus: { flora: [['sword', 4, 'deep:6'], ['bromeliad', 3, 'wall'], ['monstera', 3, 'wall'], ['frogbit', 6, 'deep:4']], stock: [['neon', 14, 'deep:5']] } },
  araguaia: { ref: 'standard', plus: { plants: ['vallisneria', 'fern'], flora: [['vallisneria', 6, 'deep:8'], ['fern', 3, 'flat']], stock: [['ember', 10, 'deep:4']] } },
  aripo: { water: 0.5, level: 0.24, pool: 1.5, plus: { plants: ['monstera', 'tillandsia'], flora: [['monstera', 3, 'wall'], ['guzmania', 3, 'wall'], ['tillandsia', 2, 'wall']], stock: [['guppy', 8, 'deep:3']] } },
  sandbank: { rate: 220, plus: { plants: ['frogbit'], flora: [['vallisneria', 10, 'deep:8'], ['sword', 5, 'deep:6'], ['frogbit', 5, 'deep:4']], stock: [['cory', 8, 'deep:4']] } },
  atlantic: { ref: 'standard', rate: 200, rocks: 4, plus: { plants: ['tillandsia', 'columnea'], flora: [['tillandsia', 3, 'wall'], ['columnea', 3, 'wall']], stock: [['oto', 8, 'deep:3']] } },
  keralapool: { rate: 40, bed: 'soil', plus: { plants: ['cattail', 'vallisneria', 'crypt'], flora: [['cattail', 4, 'edge'], ['vallisneria', 5, 'deep:5'], ['crypt', 5, 'deep:5']], stock: [['snail', 12, 'deep:2']] } },
  cavemouth: { plus: { plants: ['pothos', 'nidus'], flora: [['javamoss', 8, 'edge'], ['pothos', 3, 'wall'], ['nidus', 2, 'flat']], stock: [['pandaking', 10, 'ledge']] } },
  jar: { biotope: 'litterjar', featured: ['springtail', 'isopod', 'purpleiso', 'springpink'], animals: ['isopod', 'springtail', 'purpleiso', 'springpink'], stock: [['purpleiso', 10, 'land'], ['springpink', 40, 'land']], blurb: 'A sealed glass jar of moss, small hills, a stone and ferns, kept clean by springtails and isopods (dwarf purple isopods and pink springtails among them). Almost no open water.' },
};
const mergeBy = (a = [], b = []) => [...a.filter((x) => !b.some((y) => y[0] === x[0])), ...b];
const applyS1 = (tbl) => {
for (const [id, { plus = {}, ...o }] of Object.entries(tbl)) {
  const P = PRESETS[id];
  Object.assign(P, o);
  if (plus.plants) P.plants = [...P.plants, ...plus.plants.filter((x) => !P.plants.includes(x))];
  if (plus.animals) P.animals = [...P.animals, ...plus.animals.filter((x) => !P.animals.includes(x))];
  if (plus.flora) P.flora = mergeBy(P.flora, plus.flora);
  if (plus.stock) P.stock = mergeBy(P.stock, plus.stock);
  if (P.tiers && !P.tiers.includes(P.ref)) P.tiers.push(P.ref);
}
};
applyS1(S1);
// S1 leg 2: the priority-B species and plants of S2 (bedotia, tylomelania, matanoshrimp, cambarellus; heliconia, aponogeton, pandanus,
// limnobium, sago, tussock) in the sets whose `needs` they answer. The panther really eats the Matano shrimp: a colony of 24 and a check.
applyS1({
  reedpool: { featured: ['reedfrog', 'bedotia'], needs: [], plus: { animals: ['bedotia'], plants: ['aponogeton', 'pandanus'], flora: [['aponogeton', 4, 'deep:8'], ['pandanus', 2, 'edge']], stock: [['bedotia', 8, 'deep:5']] } },
  matano: { env: { setpoint: 28 }, animals: ['panther', 'matanoshrimp', 'tylomelania'], featured: ['panther', 'tylomelania', 'matanoshrimp'], needs: [], plus: { stock: [['matanoshrimp', 24, 'deep:3'], ['tylomelania', 4, 'deep:5']] } },
  chinampa: { featured: ['axolotl', 'cambarellus'], animals: ['axolotl', 'cambarellus'], needs: ['ahuejote willow'], plus: { stock: [['cambarellus', 1, 'deep:4']] } },
  canopypool: { needs: [], plus: { plants: ['heliconia'], flora: [['heliconia', 2, 'flat']] } },
  aripo: { needs: [], plus: { plants: ['heliconia'], flora: [['heliconia', 2, 'flat']] } },
  everglades: { needs: [], plus: { plants: ['limnobium'], flora: [['limnobium', 6, 'deep:4']] } },
  streambank: { needs: [], plus: { plants: ['sago', 'pandanus'], flora: [['sago', 2, 'flat'], ['pandanus', 1, 'flat']] } },
  sierrapools: { needs: ['Dyckia'], plus: { plants: ['tussock'], flora: [['tussock', 10, 'flat']] } },
});

// S1 leg 2: the look of each place on the shared "lagoon" layout (BUILDERS.blackwater) and its relatives: back wall (style, moss, rock,
// relief), what the hardscape is made of (mix: logs, roots, boulders), stones on the bed (rocks), bed, ground bands and `clump`
// (plants grow in groups of that size). A canister filter in the two sets whose fish need a current (flowMin, measured 0.3 before).
const LOOK = {
  blackwater: { clump: 4 },
  riverbank: { wall: { style: 'strata', moss: 0.75, rock: 0.35 }, mix: { logs: 1, roots: 4, boulders: 1 }, rocks: 3, bed: 'sand', ground: { gravelBand: 0.8 }, clump: 5 },
  klong: { env: { filterKind: 'matten' }, gear: ['filterMatten'], wall: { style: 'blocks', relief: 0.3, moss: 0.7, rock: 0.8 }, mix: { logs: 0, roots: 0, boulders: 0 }, bed: 'soil', level: 0.4, clump: 6 },
  shanpond: { env: { filterKind: 'matten' }, gear: ['filterMatten'], wall: { style: 'crag', relief: 0.55, moss: 0.45, rock: 0.6 }, mix: { logs: 0, roots: 0, boulders: 2 }, bed: 'gravel', level: 0.3, ground: { gravelBand: 2.5 }, clump: 6 },
  mosspool: { wall: { style: 'boulders', relief: 1.2, moss: 0.3, rock: 0.4 }, mix: { logs: 0, roots: 0, boulders: 3 }, rocks: 7, clump: 5 },
  moonlake: { wall: { style: 'strata', moss: 0.35, rock: 0.5 }, mix: { logs: 0, roots: 0, boulders: 3 }, rocks: 4, clump: 5 },
  putumayo: { wall: { style: 'crag', moss: 0.95, rock: 0.5 }, mix: { logs: 3, roots: 2, boulders: 0 }, rocks: 0, bed: 'sand', clump: 4 },
  araguaia: { wall: { style: 'strata', moss: 1.2, rock: 0.3, relief: 0.8 }, mix: { logs: 1, roots: 1, boulders: 2 }, bed: 'sand', ground: { gravelBand: 0.2 }, clump: 5 },
  sandbank: { wall: { style: 'crag', moss: 1.3, rock: 0.8, relief: 0.5 }, mix: { logs: 2, roots: 0, boulders: 0 }, bed: 'sand', clump: 8 },
  atlantic: { wall: { style: 'crag', relief: 1.3, moss: 0.45, rock: 0.45 }, mix: { logs: 0, roots: 0, boulders: 3 }, rocks: 5, clump: 3 },
  keralapool: { wall: { style: 'blocks', relief: 0.25, moss: 1.2, rock: 0.9 }, mix: { logs: 0, roots: 0, boulders: 0 }, bed: 'soil', level: 0.3, ground: { moss: 0.3, gravelBand: 0.3 }, clump: 6 },
  oakpond: { env: { filterKind: 'matten' }, gear: ['filterMatten'], wall: { style: 'boulders', moss: 0.55, rock: 0.4 }, mix: { logs: 2, roots: 1, boulders: 1 }, bed: 'soil', clump: 4 },
  frogpond: { env: { filterKind: 'matten' }, gear: ['filterMatten'], wall: { style: 'boulders', moss: 0.6, rock: 0.4 }, mix: { logs: 3, roots: 1, boulders: 1 }, bed: 'soil', clump: 4 },
  chinampa: { env: { filterKind: 'matten' }, gear: ['filterMatten'], wall: { style: 'blocks', relief: 0.25, moss: 0.5, rock: 0.5 }, mix: { logs: 0, roots: 3, boulders: 0 }, bed: 'soil', clump: 8 },
  matano: { wall: { style: 'strata', moss: 1.1, rock: 0.3 }, mix: { logs: 1, roots: 0, boulders: 3 }, rocks: 7, bed: 'gravel', clump: 4 },
  everglades: { wall: { style: 'crag', relief: 0.4, moss: 0.6 }, mix: { logs: 1, roots: 2, boulders: 0 }, bed: 'soil', clump: 5 },
  reedpool: { wall: { style: 'blocks', relief: 0.4, moss: 0.8 }, mix: { logs: 1, roots: 1, boulders: 0 }, bed: 'soil', clump: 5 },
  canopypool: { wall: { style: 'crag', moss: 0.9 }, mix: { logs: 2, roots: 2, boulders: 0 } },
  cascade: { env: { filterKind: 'canister' }, gear: ['filterCanister'] },
  stream: { env: { filterKind: 'canister' }, gear: ['filterCanister'] },
};
for (const [id, o] of Object.entries(LOOK)) { const P = PRESETS[id]; Object.assign(P, o, o.env ? { env: { ...(P.env ?? {}), ...o.env } } : {}, o.gear ? { gear: [...(P.gear ?? []), ...o.gear] } : {}); }


// Showcase sets (run "sets", S3): a long-flow canyon and a highland with streams (src/content/presets-showcase.js).
Object.assign(PRESETS, SHOWCASE_LAYOUTS);
for (const [id, s] of Object.entries(SHOWCASE_SETS)) Object.assign(PRESETS[id], s);

export const PRESET_ORDER = ['cascade', 'suriname', 'blackwater', 'stream', 'karst', 'swamp', 'streambank', 'reedpool', 'matano', 'everglades', 'jar', ...Object.keys(NEW_SETS), 'canyon', 'highland'];

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
