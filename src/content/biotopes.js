// Real habitats to copy. Each says what the place is like (temperature and
// humidity targets from field data), who lives there (animals and plants the
// game has), and which features make it recognisable. The Curator scores a
// tank against its chosen biotope; commissions ask for them by name.

export const BIOTOPES = {
  suriname: {
    id: 'suriname', name: 'Suriname forest island', country: 'Suriname', level: 4,
    animals: ['dartfrog', 'springtail', 'isopod', 'fly'], plants: ['bromeliad', 'fernph', 'fern', 'pothos', 'grass'],
    climate: { temp: [23, 28], humidity: [80, 97] },
    features: ['bromeliad2', 'leaflitter', 'shallowpool'],
    blurb: 'Islands of forest in open savanna. Days are warm and humid, nights cooler, and there is a clear wet and dry season. The blue poison frog lives among the roots and leaf litter of these islands and its tadpoles grow in bromeliad cups.',
    facts: ['The savanna between the forest islands is dry and bright, so each island is a pocket of moisture the frogs cannot leave.', 'Each island holds its own small frog population, which is why so many local colour forms exist.'],
    hint: 'Dense plants and moss on the ground, bromeliads above the waterline, a shallow pool, 80%+ humidity.',
  },
  bocas: {
    id: 'bocas', name: 'Bocas del Toro lowland forest', country: 'Panama', level: 5,
    animals: ['strawberry', 'springtail', 'isopod', 'fly'], plants: ['bromeliad', 'fern', 'fernph', 'grass', 'pothos'],
    climate: { temp: [24, 29], humidity: [85, 100] },
    features: ['bromeliad3', 'moss15', 'stream'],
    blurb: 'Rain falls on more than 200 days a year on the Caribbean coast of Panama. Strawberry poison frogs live in leaf litter and low bromeliads. Each island has its own colour, from red with blue legs to green, orange and white.',
    facts: ['Females feed their tadpoles unfertilised eggs, one tadpole per bromeliad.', 'The frogs are tiny: an adult is under 2.5 cm long.'],
    hint: 'Constant humidity, lots of moss and litter, three or more bromeliads, and a small stream.',
  },
  blackwater: {
    id: 'blackwater', name: 'Rio Negro blackwater', country: 'Brazil', level: 4,
    animals: ['cardinal', 'neon', 'cory', 'shrimp'], plants: ['sword', 'javafern', 'vallisneria'],
    climate: { temp: [24, 29], humidity: [70, 100] },
    features: ['wood', 'deep', 'cycled'],
    blurb: 'The Rio Negro is stained the colour of tea by tannins from the forest. The water is acidic and nearly sterile. Fish here live among fallen wood, leaf litter and the trunks of trees that flood every year.',
    facts: ['Blackwater has almost no nutrients, so few aquatic plants can grow in it. Most of the food comes from the forest.', 'The tannins stain light, so the river looks black from above.'],
    hint: 'A deep lagoon, driftwood, a school of small tetras, and clean cycled water.',
  },
  korea: {
    id: 'korea', name: 'Korean mountain stream', country: 'South Korea', level: 6,
    animals: ['toad', 'springtail', 'isopod', 'fly'], plants: ['grass', 'fernph', 'weed', 'bilberry'],
    climate: { temp: [16, 24], humidity: [60, 90] },
    features: ['stream', 'shallowpool', 'moss15'],
    blurb: 'Cool hills with slow streams and rice paddies. The fire-bellied toad lives in ponds and stream margins where the water is shallow and the temperature rarely rises above the low twenties.',
    facts: ['It hibernates in winter, and the cold snap helps trigger breeding in spring.', 'It is common enough to be found in paddies.'],
    hint: 'Cool: keep it under 24 °C with a fan or a cooling unit; ferns and grass, a slow stream, a shallow pool.',
  },
  china: {
    id: 'china', name: 'Chinese mountain torrent', country: 'China', level: 7,
    animals: ['newt', 'shrimp', 'springtail'], plants: ['javafern', 'fernph', 'weed'],
    climate: { temp: [14, 23], humidity: [70, 95] },
    features: ['falls', 'oxygen', 'stones'],
    blurb: 'Cool, shaded, fast streams under mixed forest. The paddle-tailed newt clings to the bottom under stones in fast, well-oxygenated water.',
    facts: ['Oxygen dissolves better in cold, turbulent water.', 'Many of these streams are shrinking as forests are cleared.'],
    hint: 'A waterfall for oxygen, cool water (under 23 °C), lots of stones.',
  },
  java: {
    id: 'java', name: 'Javan stream bank', country: 'Indonesia', level: 5,
    animals: ['crab', 'shrimp', 'isopod', 'springtail'], plants: ['fern', 'fernph', 'pothos', 'weed'],
    climate: { temp: [24, 29], humidity: [80, 98] },
    features: ['shallowpool', 'moss15', 'stones'],
    blurb: 'On the forest floor of Java, small streams run over volcanic rock. Vampire crabs live on the banks: half on land, half in water, and breed on land.',
    facts: ['They dig burrows in the wet soil beside streams.', 'The young are miniature crabs that skip the swimming larval stage.'],
    hint: 'Damp soil, stones, shallow water and land beside it; a lid.',
  },
  xochimilco: {
    id: 'xochimilco', name: 'Xochimilco canals', country: 'Mexico', level: 8,
    animals: ['axolotl', 'shrimp'], plants: ['vallisneria', 'javafern', 'frogbit'],
    climate: { temp: [14, 20], humidity: [50, 95] },
    features: ['deep', 'cycled', 'cool'],
    blurb: 'A network of canals in the south of Mexico City: the last home of the axolotl. Cool, shallow water beside floating gardens, at 2,200 metres above sea level.',
    facts: ['Introduced carp and tilapia eat axolotls and their eggs, and pollution threatens the water.', 'Local farmers build reed-fenced refuges to protect the animals.'],
    hint: 'Cold water (under 20 °C): needs a cooling unit. Clean, planted and cool.',
  },
  pacific: {
    id: 'pacific', name: 'Pacific palm grove', country: 'Fiji', level: 5,
    animals: ['gecko', 'fly', 'springtail'], plants: ['pothos', 'bromeliad', 'grass', 'fern'],
    climate: { temp: [23, 30], humidity: [55, 85] },
    features: ['tall4', 'basking'],
    blurb: 'On Pacific islands mourning geckos live in palms, on walls and roofs, and hunt around lamps at night. They favour warm, humid but airy places, with plenty to climb.',
    facts: ['They colonised islands across the Pacific by rafting on floating debris.', 'They call with a soft chirp.'],
    hint: 'Vertical plants and a basking spot; less soggy than a frog tank.',
  },
};

export const BIOTOPE_ORDER = ['suriname', 'blackwater', 'bocas', 'java', 'pacific', 'korea', 'china', 'xochimilco'];
