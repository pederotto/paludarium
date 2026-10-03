// Field-guide entries for every animal: real natural history, real care.
// (Game numbers such as price and unlock rank live in economy.js; the ranges
// the simulation enforces live with each species in sim/animals.js.)
//
//   sci      scientific name         status   IUCN Red List category (or 'captive-bred')
//   region   where it lives          habitat  what its home is like
//   facts    natural history         care     what a keeper needs to do
//   lesson   a concept card this animal illustrates (content/concepts.js)

export const ANIMAL_INFO = {
  // ---- From the keeper's care sheets (2026-10) ----
  cpd: {
    sci: 'Danio margaritatus', family: 'Danionidae', status: 'Vulnerable', region: 'Shan Plateau, Myanmar and northern Thailand',
    habitat: 'Shallow, spring-fed ponds and marshes on a high plateau, dense with grasses and water plants; clear, still, neutral water.',
    facts: [
      'It was found only in 2006 and became a sensation in the hobby; the first wild population was nearly fished out within a year.',
      'Males spar constantly, fins spread, but rarely hurt each other: the display decides who gets to spawn in the moss.',
      'The eggs are scattered in fine plants and hatch in three days; the parents eat any they find.',
    ],
    care: ['Keep 6 to 10 or more, in a tank with dense moss and roots.', '22–26 °C, pH 6.5–7.5, GH 5–12, only gentle flow.', 'Feed micro-pellets, baby brine shrimp and crushed flakes.'],
    lesson: 'water-hardness',
  },
  pygmy: {
    sci: 'Elassoma evergladei', family: 'Elassomatidae', status: 'Least Concern', region: 'Southeastern United States: Florida to the Carolinas',
    habitat: 'Weedy, still margins of swamps, ditches and ponds, among stems and mats of vegetation; cool in winter.',
    facts: [
      'At about 3 cm it is one of the smallest fish in North America.',
      'A courting male turns velvet black with glittering blue spangles and dances in front of a female, fins spread, rocking from side to side.',
      'It hunts like a heron: it hangs still among the stems and snaps up tiny crustaceans that drift past.',
    ],
    care: ['One male to two or three females per 20 litres; males hold small territories.', 'Still water, no strong filter: a sponge or foam filter.', 'Live or frozen food (baby brine shrimp, daphnia, worms); it ignores flakes and eats baby shrimp.'],
    lesson: 'filtration',
  },
  blueshrimp: {
    sci: 'Neocaridina davidi', family: 'Atyidae', status: 'captive-bred', region: 'Taiwan and southern China (wild form)',
    habitat: 'Wild relatives are brown and live in plant-choked streams; the blue is a line kept pure by breeders.',
    facts: [
      'Every colour line of this shrimp is the same species. Mix two colours and within a few generations the young drift back toward wild brown.',
      'A shrimp grows by molting its shell; the new one needs calcium and magnesium from the water, which is what GH measures.',
    ],
    care: ['Start with 10 to 15 for a colony.', 'pH 6.8–8.0, GH 6–12: in very soft water molts fail.', 'Keep the intake of any filter covered; babies are tiny.'],
    lesson: 'water-hardness',
  },
  panther: {
    sci: 'Parathelphusa pantherina', family: 'Gecarcinucidae', status: 'Endangered', region: 'Lake Matano, Sulawesi, Indonesia',
    habitat: 'An ancient, very deep rift lake with clear, warm, alkaline water; the crabs live among rocks and sunken wood along the shore.',
    facts: [
      'Lake Matano is more than a million years old and full of species found nowhere else: snails, shrimp, fish and crabs that evolved in it.',
      'Unlike land crabs it spends most of its life under water, climbing out onto roots and rocks now and then.',
      'Strong claws and a big appetite: in a mixed tank it takes snails and shrimp.',
    ],
    care: ['80% water, 15–25 cm deep, with caves of slate and roots that reach above the surface.', '24–28 °C, hard alkaline water: pH 7.5–8.5, GH 8–15 for its shell.', 'Keep one, or a true male–female pair.'],
    lesson: 'water-hardness',
  },
  skink: {
    sci: 'Tribolonotus gracilis', family: 'Scincidae', status: 'Least Concern', region: 'New Guinea',
    habitat: 'Humid forest floor near streams and swamps: under logs, in leaf litter and around the roots of sago palms.',
    facts: [
      'The orange rings around its eyes and the rows of spiky scales on its back give it its name: a dragon in miniature.',
      'Threatened, it may freeze, squeak, or flop over and play dead.',
      'A female lays a single egg at a time and is said to stay with it, which is unusual for a lizard.',
    ],
    care: ['80% land, a shallow pool (5–7 cm) with a textured way out.', '23–27 °C with a mild 28–29 °C warm spot, 80–90% humidity, low UVB.', 'Deep litter, cork bark and moss to hide in; one animal or a bonded pair, never two males.'],
    lesson: 'uvb',
  },
  bumblebee: {
    sci: 'Melanophryniscus stelzneri', family: 'Bufonidae', status: 'Least Concern', region: 'Central Argentina and Uruguay',
    habitat: 'Rocky grassland and hill country; it breeds in rain pools after storms.',
    facts: [
      'It walks rather than hops, and when threatened rolls onto its back to flash its red soles and belly: the colours warn that its skin is toxic.',
      'It is active by day, which makes it one of the few toads you see moving about.',
    ],
    care: ['Keep 4 to 6 together.', 'A poor swimmer: water no deeper than 2–3 cm with gentle slopes, or it drowns.', 'Micro-food only: springtails, small fruit flies, pinhead crickets dusted with calcium.'],
    lesson: 'bioactive',
  },
  reedfrog: {
    sci: 'Heterixalus alboguttatus', family: 'Hyperoliidae', status: 'Least Concern', region: 'Southern and eastern Madagascar',
    habitat: 'Reeds and shrubs around marshes, rice paddies and pools, from forest edge to open country.',
    facts: [
      'Its starry spots and orange legs make it look like a tiny night sky on legs.',
      'By day it sits pressed flat on a leaf or stem, legs tucked in, which saves water; it hunts at dusk.',
      'Males call in chorus from vegetation over water in the rainy season.',
    ],
    care: ['A tall tank with 70% water and plenty of broad leaves, bamboo and branches above it.', '24–29 °C air, 70–85% humidity.', 'Keep 3 to 5; feed fruit flies and small crickets dusted with calcium and vitamins.'],
    lesson: 'parental-care',
  },
  marbled: {
    sci: 'Triturus marmoratus', family: 'Salamandridae', status: 'Least Concern', region: 'Iberian Peninsula and western France',
    habitat: 'Ponds and slow water in spring; woods, hedges and stone walls the rest of the year.',
    facts: [
      'In the breeding season the male grows a tall crest along his back; out of it the newt lives on land.',
      'Females and young keep an orange stripe down the spine.',
    ],
    care: ['Cool: 15–21 °C; above about 23 °C it suffers.', 'Half water (10–15 cm, still, with a slate ramp out) and half damp mossy land.', 'One male to two or three females.'],
    lesson: 'microclimate',
  },
  purpleiso: {
    sci: 'Trichorhina tropicalis', family: 'Platyarthridae', status: 'captive-bred', region: 'Tropical America (spread worldwide)',
    habitat: 'Wet soil and rotting wood; in a tank it lives deep, down by the drainage layer.',
    facts: ['It hardly ever comes to the surface, so it is the crew member you forget you have.'],
    care: ['Very damp soil; it does not drown in a waterlogged layer as easily as bigger isopods.'],
    lesson: 'bioactive',
  },
  pandaking: {
    sci: 'Cubaris sp. "Panda King"', family: 'Armadillidae', status: 'captive-bred', region: 'Thailand (a captive line)',
    habitat: 'Damp limestone and leaf litter; it rolls into a ball when disturbed.',
    facts: ['One of the most prized isopods in the hobby, bred from a handful of wild animals.', 'Heavy and slow to breed: a colony takes months to grow.'],
    care: ['Damp ground with dry bark to rest on.', 'It can fall into open water and drown: keep land raised and give bark ramps out.'],
    lesson: 'bioactive',
  },
  springpink: {
    sci: 'Pseudosinella sp.', family: 'Entomobryidae', status: 'captive-bred', region: 'Tropical cultures',
    habitat: 'Warm, damp substrate and moss.',
    facts: ['Springtails are water-repellent: they float on the surface film rather than drown, and graze along the shoreline.'],
    care: ['Warm and damp; breeds more slowly than the white springtail.'],
    lesson: 'mould',
  },
  springsea: {
    sci: 'Anurida maritima (and kin)', family: 'Neanuridae', status: 'captive-bred', region: 'Shorelines and pond margins worldwide',
    habitat: 'The surface film of still water and the wet margin around it.',
    facts: ['A coat of water-repellent wax and tiny hairs traps air, so it stands on the water like on a floor and breathes under a bubble if it is pushed under.', 'It grazes the oily, bacterial skin that forms on still water, and the algae and dead matter at the waterline.'],
    care: ['Needs open water with a shoreline; it does nothing on dry land.', 'Keeps the surface film down, which lets the water take up more oxygen.', 'Fish and frogs pick them off the surface: a living food that restocks itself.'],
    lesson: 'bioactive',
  },
  cricket: {
    sci: 'Gryllodes sigillatus', family: 'Gryllidae', status: 'captive-bred', region: 'Feeder farms (a south-west Asian cricket)',
    habitat: 'Dry, warm boxes of egg-crate.',
    facts: ['The banded cricket is smaller, quieter and softer than the house cricket, and climbs less.', 'A cricket is mostly water and protein and poor in calcium: keepers dust it with calcium powder and feed it well first ("gut-loading").'],
    care: ['Feed only as many as get eaten in about ten minutes.', 'Crickets left in the tank hide, nibble on plants and can bite a sleeping frog: take the leftovers out.'],
    lesson: 'feeding',
  },
  dubia: {
    sci: 'Blaptica dubia', family: 'Blaberidae', status: 'captive-bred', region: 'Feeder farms (native to Central and South America)',
    habitat: 'Dark, warm litter.',
    facts: ['Dubia cannot climb smooth glass or fly, and do not smell: the keeper\'s favourite roach.', 'More meat and less shell than a cricket of the same size.'],
    care: ['A staple for skinks and salamanders; offer from a dish so they do not dig into the soil.', 'Uneaten ones burrow into the litter and live there for weeks.'],
    lesson: 'feeding',
  },
  earthworm: {
    sci: 'Eisenia fetida / Dendrobaena veneta', family: 'Lumbricidae', status: 'captive-bred', region: 'Compost heaps worldwide',
    habitat: 'Damp compost and leaf litter.',
    facts: ['A worm breathes through its moist skin, which is why it comes up when soil floods.', 'Worms are close to a complete diet for newts, salamanders and axolotls: the classic food.'],
    care: ['Cut big worms for small animals.', 'Leftovers dig into damp soil and turn litter into humus; in dry soil they die.'],
    lesson: 'bioactive',
  },
  waxworm: {
    sci: 'Galleria mellonella', family: 'Pyralidae', status: 'captive-bred', region: 'Beehives worldwide (a pest of old combs)',
    habitat: 'Old honeycomb.',
    facts: ['About a quarter fat: it is the chocolate of the feeder world.'],
    care: ['A treat once a week, or to fatten up a thin animal after breeding or illness.', 'Too many make an animal fat and lazy.'],
    lesson: 'feeding',
  },
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
  loach: {
    sci: 'Chromobotia macracanthus', family: 'Botiidae', status: 'Near Threatened', region: 'Rivers of Sumatra and Borneo, Indonesia',
    habitat: 'Slow, shaded lowland rivers and flooded forest, with roots and fallen wood to hide in.',
    facts: [
      'The bold yellow-and-black stripes are the same in every clown loach, and they fade a little when it feels stressed.',
      'It can make clicking sounds, and when it feels safe it sometimes lies on its side as if asleep, which worries new keepers.',
      'Two sharp spines hide under each eye. They are used to defend against predators, and they can catch in a net.',
    ],
    care: ['Keep at least five: alone they hide and sulk.', 'Give them caves and wood, and keep the water warm (24 to 30 °C) and clean.'],
    lesson: 'nitrogen-cycle',
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
  flylarva: {
    sci: 'Drosophila melanogaster (larva)', family: 'Drosophilidae', status: 'Not assessed', region: 'Worldwide',
    habitat: 'Inside rotting fruit and damp leaf litter.',
    facts: [
      'Fruit flies have complete metamorphosis: egg, larva (the maggot), pupa, adult. The maggot looks nothing like the fly and has no legs or wings.',
      'A maggot eats almost all day and grows about fifty times heavier in four days, moulting twice. It tunnels through the rot and breathes through two spots at the tail.',
      'Maggots are a composting crew: their feeding and their frass (droppings) break litter and fruit down into humus faster, and release nitrogen that plants can use.',
      'They need damp but not flooded ground, and they starve when the rot runs out. That is why a fly culture booms and then collapses.',
    ],
    care: ['Give them rotting fruit or a thick layer of damp leaf litter.', 'Frogs and newts eat a few; most of a crop becomes flies.'],
    lesson: 'carrying-capacity',
  },
  flypupa: {
    sci: 'Drosophila melanogaster (pupa)', family: 'Drosophilidae', status: 'Not assessed', region: 'Worldwide',
    habitat: 'Stuck to dry surfaces: a leaf, the glass or the background.',
    facts: [
      'When a maggot is full it crawls to a dry place, its skin hardens into an amber barrel (the puparium) and it stops moving.',
      'Inside, the maggot dissolves almost completely and is rebuilt as a fly: this is the "complete" in complete metamorphosis.',
      'At 25 °C the pupa takes about four days. Cooler tanks slow it down, and below 12 °C it does not develop at all.',
    ],
    care: ['Leave them alone: pupae cannot move or eat.', 'Warmth speeds the cycle: at 25 °C the whole egg-to-adult trip takes about ten days.'],
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
  firesal: {
    sci: 'Salamandra salamandra', family: 'Salamandridae', status: 'Least Concern', region: 'Forests of central and southern Europe',
    habitat: 'Cool, damp deciduous forest near small streams, hiding under logs and leaf litter by day.',
    facts: [
      'The bright yellow-orange on black is a warning: its skin and the glands behind its eyes make a toxin that tastes terrible to predators.',
      'It is mostly a land animal and comes out on damp nights, especially after rain. Females return to a clear stream to give birth to live larvae.',
      'No two are alike: the pattern of yellow blotches is as individual as a fingerprint, and scientists use it to recognise single animals.',
    ],
    care: ['Keep it cool: under 22 °C, and ideally 15 to 18 °C.', 'Give it damp leaf litter, hiding places and a shallow water dish. Never let the air dry out.'],
    lesson: 'humidity',
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
