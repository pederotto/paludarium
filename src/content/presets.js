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
};
for (const [id, s] of Object.entries(NEW_SETS)) PRESETS[id] = { id, tiers: [...PRESETS[s.layout].tiers].filter((t) => t !== 'jar'), ...s };

export const PRESET_ORDER = ['cascade', 'suriname', 'blackwater', 'stream', 'karst', 'swamp', 'streambank', 'reedpool', 'matano', 'everglades', 'jar', ...Object.keys(NEW_SETS)];

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
