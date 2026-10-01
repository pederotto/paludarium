// Field-guide entries for every animal: real natural history, real care.
// (Game numbers such as price and unlock rank live in economy.js; the ranges
// the simulation enforces live with each species in sim/animals.js.)
//
//   sci      scientific name         status   IUCN Red List category (or 'captive-bred')
//   region   where it lives          habitat  what its home is like
//   facts    natural history         care     what a keeper needs to do
//   lesson   a concept card this animal illustrates (content/concepts.js)

export const ANIMAL_INFO = {
  neon: {
    sci: 'Paracheirodon innesi', family: 'Characidae', status: 'Least Concern', region: 'Upper Amazon: Peru, Colombia, Brazil',
    habitat: 'Slow, shaded forest streams and flooded forest with soft, slightly acidic, tea-coloured water.',
    facts: [
      'The blue-green stripe is not pigment. It is stacked guanine crystals that interfere with light, like a soap bubble, and it shimmers as the fish turns. At night it fades to a dull grey while the fish rests.',
      'Neons live in shoals: a group is safer than a fish alone, because a predator finds it hard to pick out one target from a blur of stripes.',
      'They eat tiny crustaceans, insect larvae and algae, and in a home tank can live five years or more.',
    ],
    care: ['Keep six or more.', 'Add them only to a fully cycled tank: they are small enough that a little ammonia is deadly.', 'Prefer 22–26 °C. Warm water holds less oxygen.'],
    lesson: 'nitrogen-cycle',
  },
  cardinal: {
    sci: 'Paracheirodon axelrodi', family: 'Characidae', status: 'Least Concern', region: 'Rio Negro and Orinoco basins',
    habitat: 'Blackwater rivers stained by tannins from leaf litter; the water is soft and acidic (pH 4.5–6).',
    facts: ['Unlike a neon, the red stripe runs the whole length of its body.', 'Most cardinals sold are still wild-caught, and the trade supports river communities that depend on keeping the forest standing.'],
    care: ['Needs softer, warmer water than a neon: 24–28 °C.', 'Leaf litter and driftwood tint the water and lower its pH, as at home.'],
    lesson: 'biotope',
  },
  ember: {
    sci: 'Hyphessobrycon amandae', family: 'Characidae', status: '', region: 'Araguaia basin, Brazil',
    habitat: 'Clear, slow, vegetated streams.',
    facts: ['Barely 2 cm long, glowing orange-red: one of the smallest aquarium tetras.', 'Their red comes from carotenoids in their food: fish cannot make orange pigment, they have to eat it.'],
    care: ['A nano fish: fine in small tanks, but needs peaceful company.', 'Feeds on very small food.'],
    lesson: 'carrying-capacity',
  },
  guppy: {
    sci: 'Poecilia reticulata', family: 'Poeciliidae', status: 'Least Concern', region: 'Venezuela, Guyana, Trinidad and Barbados',
    habitat: 'Small streams, ditches and pools; tolerant of a wide range of water.',
    facts: [
      'Guppies give birth to live young. A female can store sperm for months and have several broods from one mating.',
      'In Trinidad, biologist John Endler found that guppies in streams with many predators are drab, while guppies in safe streams are gaudy: females prefer bright males, and predators prefer to eat them. Evolution can be seen in a single stream.',
      'Guppies eat mosquito larvae, and have been released in many countries to fight malaria, sometimes becoming an invasive species.',
    ],
    care: ['They breed without help. In a small tank, control the population by feeding little.', 'Fine at 22–28 °C.'],
    lesson: 'carrying-capacity',
    lesson2: 'genetics',
  },
  cory: {
    sci: 'Corydoras aeneus', family: 'Callichthyidae', status: 'Least Concern', region: 'South America east of the Andes',
    habitat: 'Slow, sandy-bottomed streams and pools.',
    facts: [
      'Corydoras wear armour: two rows of overlapping bony plates instead of scales.',
      'If oxygen is low they dash to the surface, gulp air and absorb oxygen through their intestine, a trick called intestinal air-breathing.',
      'The barbels around the mouth are packed with taste receptors: they sift sand to find food. Sharp gravel wears them away.',
    ],
    care: ['Keep six or more, on soft sand.', 'They clean up leftovers, but they are not a cleaning crew: they need their own food.'],
    lesson: 'oxygen',
  },
  shrimp: {
    sci: 'Neocaridina davidi', family: 'Atyidae', status: 'Captive-bred red form of a common wild shrimp', region: 'Streams of Taiwan, south China and Vietnam',
    habitat: 'Clean, shallow streams with plants, moss and stones to graze.',
    facts: [
      'The bright red "cherry" is a captive-bred colour. Wild shrimp are a camouflaged brown-green.',
      'Shrimp grow by moulting their exoskeleton; a pale ghost of a shrimp on the floor is usually a shed skin, not a corpse.',
      'They graze biofilm, the film of bacteria and algae on every surface, and eat tiny amounts constantly: a colony can keep algae in check.',
    ],
    care: ['Copper, even in tiny amounts, kills them: it is in some plant fertilisers and medicines.', 'Sensitive to sudden changes in water chemistry.'],
    lesson: 'algae',
    lesson2: 'genetics',
  },
  crab: {
    sci: 'Geosesarma sp. ("vampire crab")', family: 'Sesarmidae', status: '', region: 'Streams and forest floors of Java, Indonesia',
    habitat: 'Damp forest beside streams: the crabs live on land and in the splash zone.',
    facts: [
      'The name is a marketing joke: yellow eyes and a purple shell.',
      'Most crabs release swimming larvae into the sea. Geosesarma skipped that stage: the female carries her eggs, and young hatch as tiny crabs. That lets them live far from salt water.',
    ],
    care: ['A crab tank needs land and shallow water, and a lid: they climb.', 'They will eat small shrimp.'],
    lesson: 'microclimate',
  },
  isopod: {
    sci: 'Trichorhina tomentosa ("dwarf white")', family: 'Platyarthridae', status: 'Not assessed (cosmopolitan)', region: 'Native to Central and South America, now worldwide',
    habitat: 'Leaf litter, rotting wood and soil.',
    facts: [
      'Isopods are crustaceans, more closely related to shrimp than to insects. They still breathe with gill-like structures, which is why they need damp air.',
      'Dwarf whites reproduce without males (parthenogenesis), so a handful can become a colony.',
      'They eat dead plant material, waste and mould, and recycle it into soil.',
    ],
    care: ['Provide leaf litter and cork bark to hide under.', 'Keep the substrate damp but not soaked.'],
    lesson: 'bioactive',
  },
  springtail: {
    sci: 'Collembola (e.g. Folsomia candida)', family: 'Isotomidae', status: 'Not assessed', region: 'Worldwide, in soil and leaf litter',
    habitat: 'Damp soil, moss and litter. Up to 100,000 per square metre in a healthy forest floor.',
    facts: [
      'Springtails are not insects. They are among the oldest land animals, over 400 million years old.',
      'Under the abdomen is a spring-loaded tail, the furcula. When threatened it snaps against the ground and flings the animal many times its own length.',
      'They eat mould, fungal threads and decaying matter, and are the first line of defence against mould in a wet tank.',
    ],
    care: ['A springtail culture is the first thing to add to a bioactive tank.', 'They need moisture: a dry substrate wipes them out.'],
    lesson: 'bioactive',
  },
  fly: {
    sci: 'Drosophila melanogaster / D. hydei (flightless strains)', family: 'Drosophilidae', status: 'Not assessed', region: 'Worldwide',
    habitat: 'Fermenting fruit.',
    facts: [
      'The fruit fly has been a model animal for genetics for over a century, and its study has earned several Nobel Prizes.',
      'At 25 °C an egg becomes an adult in about ten days, which makes flightless mutants a renewable frog food.',
    ],
    care: ['Keep a culture going, or you will run out of food.', 'Flies that escape into the tank die out within days.'],
    lesson: 'carrying-capacity',
  },
  dartfrog: {
    sci: 'Dendrobates tinctorius "azureus"', family: 'Dendrobatidae', status: 'CITES Appendix II (as are all poison frogs)', region: 'Sipaliwini savanna, southern Suriname',
    habitat: 'Small islands of forest in savanna. Warm, humid days and cool nights, with a distinct wet and dry season.',
    facts: [
      'The bright blue warns predators. In the wild the frog\'s skin carries alkaloid toxins that it collects from its diet of ants and mites. Captive frogs fed on flies never make them: their toxicity is a diet, not a gene.',
      'A male calls to a female from a leaf, then guards the eggs laid on land. When they hatch, the tadpoles wriggle onto his back and he carries them to a tiny pool of water, often held in a bromeliad or a hollow tree.',
      'They can live for 10–15 years in captivity.',
    ],
    care: ['Needs humidity of 80% or more, with a drier spot to rest.', 'Cannot swim well: give it land and a clean shallow pool or a bromeliad.', 'Wants live food every day or two.'],
    lesson: 'parental-care',
    lesson2: 'genetics',
  },
  strawberry: {
    sci: 'Oophaga pumilio', family: 'Dendrobatidae', status: 'Least Concern', region: 'Nicaragua, Costa Rica and Panama, Caribbean lowlands',
    habitat: 'Lowland rainforest floor and low vegetation, with leaf litter and bromeliads.',
    facts: [
      'One of the most devoted amphibian parents. After the eggs hatch, the mother carries each tadpole to its own bromeliad pool. Every few days she returns and lays an unfertilised egg for it to eat: the tadpole is fed by its mother.',
      'The red form with blue legs is the "blue jeans" morph from Bocas del Toro, Panama: each island population is a different colour, a natural experiment in how colour evolves.',
      'It eats mostly ants and mites, which is where its skin toxins come from.',
    ],
    care: ['Needs very damp air (80%+) and tiny live food such as springtails and small fruit flies.', 'Bromeliads with water in their cups are essential for breeding.'],
    lesson: 'parental-care',
  },
  toad: {
    sci: 'Bombina orientalis', family: 'Bombinatoridae', status: 'Least Concern', region: 'Korea, north-east China and the Russian Far East',
    habitat: 'Slow streams, ponds and rice paddies in cool, hilly country.',
    facts: [
      'The red belly is a warning. When threatened the toad arches its back and shows its belly in the "unken reflex", a signal that says: I taste terrible.',
      'It is a cool-climate species: comfortable at 18–24 °C, and stressed by heat.',
      'It lives half in water and half on land: it eats on land but soaks in shallow water.',
    ],
    care: ['Needs both land and open water.', 'Keep it below 25 °C.'],
    lesson: 'microclimate',
  },
  newt: {
    sci: 'Pachytriton labiatus', family: 'Salamandridae', status: 'Near Threatened', region: 'Mountain streams of southern and eastern China',
    habitat: 'Cool, fast, oxygen-rich streams under rocks and leaf litter.',
    facts: [
      'The tail is flattened from side to side like a paddle, for swimming in a current.',
      'It lives almost entirely in water, and only occasionally comes ashore. Its skin absorbs oxygen directly, which is why it needs cool, well-aerated water.',
      'Its stream habitats are shrinking as forests are cleared, and it is collected for the pet trade.',
    ],
    care: ['Keep the water under 24 °C: warm water holds less oxygen.', 'Give it moving, well-oxygenated water: a waterfall helps.'],
    lesson: 'oxygen',
  },
  axolotl: {
    sci: 'Ambystoma mexicanum', family: 'Ambystomatidae', status: 'Critically Endangered', region: 'Lake Xochimilco, Mexico City (the only wild population)',
    habitat: 'A network of canals and floating gardens (chinampas), cool and shallow.',
    facts: [
      'Axolotls are neotenic: they never grow up. They keep their external gills and tail fin for life, and breed as "children".',
      'They can regrow whole limbs, parts of the heart, spinal cord and even parts of the brain, which is why they are studied by regeneration researchers.',
      'The wild population is tiny and shrinking, yet there are many thousands in labs and homes: a species that is nearly extinct in nature, and abundant in captivity.',
    ],
    care: ['Needs cold water: 14–20 °C. Above 21 °C it stresses, above 24 °C it can die.', 'Fully aquatic, and it eats live or frozen animal food.'],
    lesson: 'conservation',
    lesson2: 'genetics',
  },
  gecko: {
    sci: 'Lepidodactylus lugubris', family: 'Gekkonidae', status: 'Least Concern', region: 'Islands of the Indo-Pacific',
    habitat: 'Coconut palms, buildings and forest edges, from sea level to hillsides.',
    facts: [
      'Mourning geckos are almost all female. Females lay fertile eggs without mating, a form of cloning called parthenogenesis, and each clutch is a copy of the mother.',
      'Toe pads covered in millions of microscopic hairs (setae) cling to glass using weak molecular forces (van der Waals forces): no glue, no suction.',
      'They sip nectar and lick fruit as well as hunting insects.',
    ],
    care: ['Vertical space matters more than floor space: cork bark and plants on the background.', 'Slightly drier than a frog tank, but they still like a damp corner.'],
    lesson: 'microclimate',
  },
  tadpole: {
    sci: 'Anuran larvae', family: '', status: '', region: 'Pools worldwide',
    habitat: 'Water. Poison frogs carry their tadpoles to small pools in bromeliads and tree holes.',
    facts: ['A tadpole is a different animal from the frog it becomes. It has gills, a tail and a long gut for eating algae.', 'Metamorphosis is driven by thyroid hormone: the tail is reabsorbed, legs grow, lungs replace gills and the gut shortens as the diet changes to animals.'],
    care: ['Clean water, and something to graze.'],
    lesson: 'parental-care',
  },
  eggs: {
    sci: '', family: '', status: '', region: '',
    habitat: 'Laid in water, at the water\'s edge or on a leaf, depending on the species.',
    facts: ['Amphibian eggs have no shell. They are wrapped in jelly and must stay wet: a clutch that dries out dies.'],
    care: ['Keep the humidity high near where eggs are laid.'],
    lesson: 'humidity',
  },
};
