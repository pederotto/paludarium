// Concept cards for the Field Guide: the science behind what happens in a
// tank. Each has short sections, "Did you know" facts and "Try it" tasks that
// the game can check, and may show a live widget wired to the current tank.
//
// section = { h?, p?: string[], ul?: string[], fact?: string, tryit?: string }
// widget  = 'nitrogen' | 'watercycle' | 'dewpoint' | 'photoperiod' | 'oxygen' | 'feedback' | 'lens' | 'punnett'

export const CONCEPTS = {
  'water-hardness': {
    title: 'Hard water, soft water and pH', icon: 'flask',
    blurb: 'Why a crab from a rift lake and a danio from a forest pond want different water.',
    sections: [
      { p: ['Water carries dissolved minerals. GH (general hardness) measures calcium and magnesium, in degrees (°dH). Rain is soft (close to 0); water that has run through limestone is hard (12 and more).'] },
      { p: ['pH says how acid or alkaline the water is: 7 is neutral, lower is acid, higher is alkaline. Hard water holds its pH up; in soft water it swings. CO₂ from breathing animals and rotting food lowers it, most at night; tannins from wood and leaves lower it too.'] },
      { h: 'Who needs what', ul: ['Shrimp and crabs build a new shell at every molt from the minerals in the water: too soft and the molt fails.', 'Forest fish such as cardinals and pearl danios come from soft, neutral to acid water.', 'The panther crab comes from Lake Matano, hard and alkaline (pH 8).'] },
      { fact: 'You set the hardness mostly with the water you use for changes: tap, rain or RO water, or RO water with minerals added back.' },
      { tryit: 'In Care > Water choose a water source, change some water, and watch pH and GH in the status drawer settle.' },
    ],
    related: ['nitrogen-cycle', 'biotope', 'filtration'],
  },
  filtration: {
    title: 'Filters and false bottoms', icon: 'filter',
    blurb: 'Three ways to keep a paludarium\'s water clean, and the build that hides one under the land.',
    sections: [
      { p: ['A paludarium\'s water is shallow and collects everything that runs off the land. A filter here is mostly a home for the bacteria of the nitrogen cycle, so surface area matters more than force.'] },
      { h: 'Three kinds', ul: [
        'A corner foam filter (Mattenfilter): a block of coarse foam walls off a corner, with a small pump or air-lift behind it. No suction, so baby shrimp and tadpoles are safe; a huge surface for bacteria.',
        'A canister: lots of media outside the tank, through bulkheads or hidden behind the background. The most capacity and current, but its intake needs a sponge over it.',
        'A false bottom (plenum): an egg-crate floor on PVC legs under the land, covered with fibreglass mesh. The water under it, full of bio-rings or clay pebbles, is one big filter bed.',
      ] },
      { h: 'Building a false bottom', ul: [
        'Put the pump in a back corner of the water, inside a slotted PVC tube with foam around the slots, so it can be lifted out later: never seal a pump in.',
        'Cut the egg-crate to the land, stand it on legs of equal length, zip-tie mesh over it and fold the mesh up the walls.',
        'Run tubing from the pump up behind the background to the waterfall; build the bank where land meets water from egg-crate, slate or cork.',
        'Fill the plenum with bio-media, keep the water line half an inch below the mesh, and lay the soil on top.',
      ] },
      { fact: 'Flow matters to the animals as well: a pygmy sunfish or a newt wants almost still water, a stream fish wants a current.' },
      { tryit: 'In Care > Water pick a filter, then look at the current in the status drawer.' },
    ],
    related: ['nitrogen-cycle', 'drainage', 'bioactive'],
  },
  feeding: {
    title: 'Feeding: flakes, worms and crickets', icon: 'bowl',
    blurb: 'What each animal eats, and why the size and the timing matter.',
    sections: [
      { p: ['Fish and shrimp take prepared food: flakes float and sink slowly for the mid-water fish, pellets sink at once for bottom fish, crabs and newts, and frozen or freeze-dried bloodworms tempt fussy eaters such as the pygmy sunfish.'] },
      { p: ['Frogs, toads, skinks, geckos and salamanders only strike at food that moves. They live on feeder insects bred for them: fruit flies and springtails for the smallest frogs, crickets and dubia roaches for skinks, geckos and toads, earthworms for newts and salamanders, and fatty waxworms as a treat.'] },
      { h: 'The keeper\'s rules', ul: [
        'Size: a feeder no longer than the gap between the animal\'s eyes.',
        'Gut-load and dust: feed the insects well first and roll them in calcium powder, because an insect alone is poor in calcium.',
        'Little and often: what is not eaten in ten minutes rots (prepared food) or hides and lives on (crickets, roaches, worms).',
      ] },
      { fact: 'An earthworm is close to a complete food for a newt; a waxworm is about a quarter fat.' },
      { tryit: 'In Care > Feeding drop pellets or bloodworms, or a cup of crickets, and watch who comes for them.' },
    ],
    related: ['bioactive', 'nitrogen-cycle'],
  },
  uvb: {
    title: 'Light you cannot see: UVB', icon: 'sun',
    blurb: 'Why a shy skink still needs a little ultraviolet.',
    sections: [
      { p: ['UVB light lets skin make vitamin D3, and the body needs D3 to use the calcium in its food. Without it, bones soften over months (metabolic bone disease).'] },
      { p: ['Animals of the forest floor get little sun and need little UVB: a low tube over part of the tank, with shade to retreat to, is enough. Desert reptiles need far more.'] },
      { fact: 'Glass and most plastic block UVB: a lamp must shine through mesh or straight in.' },
      { tryit: 'Fit a low UVB tube and watch a crocodile skink\'s needs clear in the Inspector.' },
    ],
    related: ['microclimate', 'photoperiod'],
  },
  'nitrogen-cycle': {
    title: 'The nitrogen cycle', icon: 'flask', widget: 'nitrogen',
    blurb: 'Why a new tank is dangerous, and how it becomes safe.',
    sections: [
      { p: ['Every animal you feed produces waste, and waste contains nitrogen. In water it appears first as ammonia, which is poisonous: fish gills burn, and amphibian larvae die at very low levels.'] },
      { h: 'Three steps', ul: [
        'Ammonia (NH₃ / NH₄⁺) comes from waste and rotting food. It is toxic at 0.25 ppm and up.',
        'Bacteria of the genus Nitrosomonas (and related archaea) turn ammonia into nitrite (NO₂⁻). Nitrite is also toxic: it stops blood carrying oxygen.',
        'A second group, Nitrobacter and Nitrospira, turn nitrite into nitrate (NO₃⁻), which is far less harmful and is fertiliser for plants.',
      ] },
      { p: ['These bacteria live on every surface: filter media, substrate, stones. A new tank has almost none, so at first the ammonia has nowhere to go. It rises, then nitrite rises, and only when both are gone is the tank "cycled". This takes about 4–6 weeks.'] },
      { fact: 'You can cycle a tank with no animals at all: add a little ammonia, feed the bacteria, and wait. This "fishless cycle" is the humane way to start.' },
      { h: 'Where does nitrate go?', p: ['It builds up until something removes it: plants take it up as food, a water change dilutes it, and in oxygen-free pockets of mud other bacteria turn it into harmless nitrogen gas.'] },
      { tryit: 'Buy a test kit, dose ammonia in a new tank and watch the three lines rise and fall in the Lab. Wait for ammonia and nitrite to reach zero before you add animals.' },
    ],
    related: ['algae', 'oxygen', 'quarantine'],
  },
  'water-cycle': {
    title: 'The water cycle in a jar', icon: 'drop', widget: 'watercycle',
    blurb: 'How a sealed jar can water itself for years.',
    sections: [
      { p: ['Water evaporates from the soil and pools. Plants also pump water up through their roots and release it from their leaves: this is called transpiration. Together they fill the air with vapour.'] },
      { p: ['Where the air touches cooler glass, the vapour condenses into droplets, which run down and drip back into the soil. That is rain. A sealed terrarium is a tiny copy of the planet\'s water cycle.'] },
      { fact: 'In 1960 David Latimer planted spiderwort in a 10-gallon glass carboy, watered it once in 1972 and then sealed it. It has grown ever since, with no fresh air or water.' },
      { h: 'Why closed tanks need balance', p: ['In a sealed jar, everything that goes in stays in. If it is too wet, mould wins; too dry, plants wilt; too much light, it overheats. Small changes matter.'] },
      { tryit: 'Build a Moss jar. Watch the glass: morning fog and beads that vanish in the afternoon show it is working.' },
    ],
    related: ['dew-point', 'humidity', 'bioactive'],
  },
  humidity: {
    title: 'Humidity', icon: 'drop',
    blurb: 'Relative humidity, and why frogs care.',
    sections: [
      { p: ['Relative humidity (RH) is how much water vapour is in the air compared with the most it could hold at that temperature. 100% means saturated: any more condenses.'] },
      { p: ['Warm air holds much more vapour: roughly twice as much for every 10 °C. So when a tank warms up, the same water reads as a lower percentage, and when it cools, the reading rises.'] },
      { h: 'Why amphibians need it', p: ['A frog breathes partly through its skin, which has to stay wet to let oxygen through. In dry air it loses water faster than it can replace it. Poison frogs from rainforests need 80% or more; a fire-bellied toad from cooler hills is fine with 60%.'] },
      { tryit: 'Look at the humidity lens (press L). The damp and dry spots are different: waterfalls and moss raise it, lamps and open lids lower it.' },
    ],
    related: ['dew-point', 'microclimate', 'mould'],
  },
  'dew-point': {
    title: 'Dew point and the foggy glass', icon: 'cloud', widget: 'dewpoint',
    blurb: 'Why the glass fogs, and what a keeper does about it.',
    sections: [
      { p: ['The dew point is the temperature at which air becomes saturated. Cool air below it, and the vapour condenses. Any surface colder than the dew point gets wet.'] },
      { p: ['Tank glass is about room temperature, but the air inside is warmer and wetter. If the dew point of the air is above the temperature of the glass, the glass fogs. It is the same reason a cold glass of water "sweats" on a summer day.'] },
      { h: 'Fixing it', ul: ['Lower the humidity a little: a fan, or open the lid a crack.', 'Raise the glass temperature: a warmer room.', 'Or wipe it. Fog is not a fault. It is a sign that the water cycle works.'] },
      { tryit: 'Slide the temperature and humidity below and see how much fog to expect. Then press "Wipe glass" in the Care panel.' },
    ],
    related: ['water-cycle', 'humidity'],
  },
  photoperiod: {
    title: 'Light: intensity and hours', icon: 'sun', widget: 'photoperiod',
    blurb: 'How much light plants really need.',
    sections: [
      { p: ['Plants make sugar from light, water and carbon dioxide. The energy a plant gets in a day depends on how bright the lamp is and how long it stays on: this is the daily light integral. Doubling the hours is like doubling the brightness.'] },
      { p: ['Different plants need different amounts. A fern evolved under the forest canopy and is happy at a fraction of the light that a water lily needs. A canopy above it casts shade: the ground under a thick fern gets far less light.'] },
      { h: 'Too much', p: ['Excess light with spare nutrients feeds algae, which grow faster than plants. The fix is rarely more light: shorter days, floating plants for shade, and more plants using up the nutrients.'] },
      { fact: 'Chlorophyll absorbs mostly red and blue light and reflects green, which is why leaves look green. That is also why some grow lamps look purple.' },
      { tryit: 'Shorten the light period to 8 hours and watch which plants stall. Then use the light lens to find which corners are shaded.' },
    ],
    related: ['algae', 'microclimate'],
  },
  humus: {
    title: 'Litter, humus and fertility', icon: 'sprout',
    blurb: 'How fallen leaves become rich soil.',
    sections: [
      { p: ['Plants shed leaves, animals die and food is left over. On the ground this becomes litter. Fungi, bacteria and the clean-up crew (isopods, springtails) rot it into humus: dark, crumbly, nutrient-rich soil that slowly feeds the plants, which then drop more leaves.'] },
      { h: 'What speeds it up or slows it down', ul: [
        'Warmth and damp: rot is quickest in warm, moist soil and nearly stops when it is cold or bone dry.',
        'Air: waterlogged soil has no oxygen, so litter sits and sours.',
        'A crew: isopods and springtails eat litter and leave frass, which is humus already.',
        'Too much stale, wet litter grows mould; a fan or a crew keeps it in check.',
      ] },
      { fact: 'A handful of forest topsoil holds more living things than there are people on Earth.' },
      { tryit: 'Switch the lens to Fertility and watch the ground under your ferns turn rich over a few weeks. Add isopods and compare.' },
    ],
    related: ['bioactive', 'mould', 'nitrogen-cycle'],
  },
  bioactive: {
    title: 'The bioactive tank', icon: 'sprout',
    blurb: 'A cleaning crew that keeps the floor alive.',
    sections: [
      { p: ['A bioactive vivarium has a working soil ecosystem. Instead of scooping waste, you introduce the animals that eat it: springtails, isopods and worms. They turn droppings, leaf litter and dead plants into nutrients for the plants.'] },
      { h: 'How to build one', ul: [
        'A drainage layer at the bottom (clay pebbles) so extra water has somewhere to go.',
        'A soil mix above it that holds moisture but stays airy.',
        'Leaf litter on the surface: food and hiding places for the crew.',
        'Springtails first: they eat mould. Add isopods once there is enough food.',
      ] },
      { fact: 'Springtails can reach tens of thousands per square metre in forest soil. In a bioactive tank they multiply until they run out of food, a population limited by food, not by space.' },
      { tryit: 'Add springtails and isopods, then watch the mould and detritus numbers in the Vitals panel stay low.' },
    ],
    related: ['drainage', 'mould', 'carrying-capacity'],
  },
  drainage: {
    title: 'Drainage and soil moisture', icon: 'layers',
    blurb: 'Roots need air as well as water.',
    sections: [
      { p: ['Plant roots breathe. Water-logged soil has no air, so roots suffocate and rot. Bacteria that live without oxygen take over and make hydrogen sulfide: the rotten-egg smell of a swamp.'] },
      { p: ['A drainage layer or a false bottom gives extra water somewhere to go, below the roots. Water rises into the soil by capillary action as the soil above dries, so the roots stay damp, not drowned.'] },
      { h: 'Soil moisture in the game', p: ['Rain, mist, waterfalls and neighbouring water wet the soil. Drainage, warmth, light and moving air dry it. Ferns and moss like it moist; cattails and sedges like it soaked.'] },
      { tryit: 'Look at the soil lens. If a whole area is saturated and plants look sick, add drainage or a fan.' },
    ],
    related: ['bioactive', 'mould'],
  },
  'soil-moisture': { alias: 'drainage' },
  algae: {
    title: 'Algae', icon: 'leaf',
    blurb: 'It is not dirt: it is a sign of imbalance.',
    sections: [
      { p: ['Algae need only light and nutrients, and they grow faster than any plant. In a healthy tank they are held in check because plants, snails and shrimp use up the nutrients and eat the algae.'] },
      { h: 'The stages of a new tank', ul: [
        'Diatoms: a brown film in the first weeks, fed by silicates in new substrate. It disappears by itself.',
        'Green algae: when light and nutrients outrun what the plants can use.',
        'Cyanobacteria ("blue-green algae") is not an alga at all but a bacterium, and it appears when the water is nutrient-rich and still.',
      ] },
      { p: ['Fix the cause: shorter days, more plants, floating plants for shade, less feeding, water changes, and grazers.'] },
    ],
    related: ['photoperiod', 'nitrogen-cycle', 'succession'],
  },
  mould: {
    title: 'Mould and stale air', icon: 'cloud',
    blurb: 'White fuzz on the wood.',
    sections: [
      { p: ['Mould is a fungus. It feeds on dead organic matter, and wet still air is perfect for it. Fluffy white mould on new wood is very common and mostly harmless: springtails eat it within days.'] },
      { p: ['Serious mould needs three things: saturated air, something to eat (rotting food or dead plants) and no airflow. Take away any one. A fan is the strongest tool: it moves saturated air away from the surface.'] },
      { tryit: 'Turn the fan off and let the humidity stay above 92%. Watch the mould. Then add isopods and a fan and see how it recovers.' },
    ],
    related: ['bioactive', 'humidity', 'drainage'],
  },
  succession: {
    title: 'How a tank settles in', icon: 'sprout',
    blurb: 'Bare glass to living forest.',
    sections: [
      { p: ['Ecologists call the way a place fills with life succession. On bare rock, lichens arrive first, then moss, then grasses and shrubs. Each stage makes conditions that the next needs.'] },
      { p: ['A new tank goes through the same steps in weeks: bacteria and diatoms, then algae, then moss and plants filling in, then a stable community. Adding animals too early skips a step that they need.'] },
      { fact: 'The word "established" means the tank has enough plants to use its own nutrients and enough bacteria to process its own waste. That takes about three months.' },
    ],
    related: ['nitrogen-cycle', 'algae'],
  },
  'carrying-capacity': {
    title: 'Populations and carrying capacity', icon: 'chart',
    blurb: 'Why animals stop multiplying.',
    sections: [
      { p: ['A population grows fast when food is plentiful, then slows down as it uses up food and space. The largest number a place can sustain is its carrying capacity.'] },
      { p: ['Predators and prey follow each other in cycles: more prey, more predators, fewer prey, fewer predators. Refuges (moss, leaf litter) stop predators from eating the very last prey and make the system stable.'] },
      { h: 'In your tank', ul: ['Springtails and isopods multiply until food is short.', 'Dart frogs eat flies and springtails: a frog needs a culture to feed on.', 'Guppies will fill any tank you give them: control them by feeding less.'] },
    ],
    related: ['bioactive'],
  },
  microclimate: {
    title: 'Microclimates and gradients', icon: 'lens', widget: 'lens',
    blurb: 'Every corner of a tank is different, and that is a good thing.',
    sections: [
      { p: ['A microclimate is the climate of a small area: the damp spot by a waterfall, the warm ledge under the lamp, the cool floor under the ferns. In real rainforest the temperature and humidity change with every metre of height.'] },
      { p: ['Amphibians and reptiles are ectotherms: they cannot heat themselves. They regulate temperature by moving between warm and cool places. A tank with one uniform climate takes that choice away. A gradient lets the animal look after itself.'] },
      { tryit: 'Cycle the lens overlay (L): humidity, temperature, light and soil. Put a basking lamp at one end and see the temperature gradient appear. Then look for where the frogs spend their day.' },
    ],
    related: ['humidity', 'photoperiod'],
  },
  oxygen: {
    title: 'Oxygen in water', icon: 'drop', widget: 'oxygen',
    blurb: 'Why warm water suffocates.',
    sections: [
      { p: ['Water holds far less oxygen than air, and warm water holds less than cold: about 9.1 mg/L at 20 °C but only 7.6 mg/L at 30 °C. Warm water also makes animals burn oxygen faster. Heat and suffocation arrive together.'] },
      { p: ['Oxygen comes into water at the surface and where it is agitated: a waterfall or a filter outlet churns water and dissolves oxygen. At night, plants stop producing oxygen and breathe it, so the level dips before dawn.'] },
      { tryit: 'Raise the heater. Watch oxygen fall, and see which animals mind first: newts and axolotls, which come from cold water, are the first to suffer.' },
    ],
    related: ['nitrogen-cycle'],
  },
  quarantine: {
    title: 'Quarantine', icon: 'lock',
    blurb: 'Keeping new animals apart, and why.',
    sections: [
      { p: ['A chytrid fungus (Batrachochytrium dendrobatidis) has driven at least 90 species of amphibians to presumed extinction and harmed hundreds more, spread partly by the trade in animals. It infects the skin, which frogs need for breathing.'] },
      { p: ['Keepers quarantine new animals in a plain tub for four to eight weeks before adding them to a display, and never share tools between tanks. The same rule protects fish from ich and other parasites.'] },
    ],
    related: ['conservation'],
  },
  'parental-care': {
    title: 'Poison frog parents', icon: 'frog',
    blurb: 'Tadpoles that get a piggyback ride.',
    sections: [
      { p: ['Most frogs lay hundreds of eggs and leave them. Poison frogs lay a handful and stay. A male guards the clutch, keeps it moist and, when the eggs hatch, carries the tadpoles to water on his back.'] },
      { p: ['In the rainforest canopy the water is in bromeliad cups. There each tadpole lives in a tiny pool. In the strawberry poison frog the mother returns to feed each tadpole with unfertilised eggs.'] },
      { tryit: 'Put a bromeliad on the background above the waterline. Watch for eggs after a heavy rain.' },
    ],
    related: ['humidity', 'conservation'],
  },
  'feedback-control': {
    title: 'Feedback control', icon: 'cpu', widget: 'feedback',
    blurb: 'How thermostats and controllers think.',
    sections: [
      { p: ['A thermostat measures the temperature, compares it with a target and switches a heater on or off. This is a feedback loop: the output changes the thing that is being measured.'] },
      { p: ['If the loop switches at exactly the target, it chatters on and off. Real controllers have a dead band (hysteresis): on at 22 °C, off at 24 °C. Too wide a band and the temperature swings; too narrow and the equipment wears out.'] },
      { p: ['Delay makes it harder: a fogger takes minutes to change the humidity. A controller that reacts too fast overshoots, then swings back.'] },
      { tryit: 'Buy a controller. Write a rule: when humidity is below 82%, run the fogger. Run a Vacation and read the report.' },
    ],
    related: ['humidity'],
  },
  biotope: {
    title: 'Biotopes', icon: 'home',
    blurb: 'Copying one real place.',
    sections: [
      { p: ['A biotope is a specific habitat in a specific place: "a blackwater stream in the Rio Negro basin" rather than "a rainforest". Building one means using only the animals, plants, water and stone found there, and matching its climate.'] },
      { p: ['It teaches ecology: you learn why each part is there. A blackwater tank has leaf litter and driftwood because the forest sheds them into the river, and the tannins they release stain and acidify the water, which is what the fish evolved in.'] },
    ],
    related: ['conservation', 'composition'],
  },
  composition: {
    title: 'Composition: designing a scene', icon: 'grid',
    blurb: 'Why some tanks look natural and others look cluttered.',
    sections: [
      { ul: [
        'Focal point: one thing the eye goes to first. Place it off centre, near one of the thirds.',
        'Odd numbers: three or five rocks look natural; two or four look staged.',
        'Layers: low plants in front, medium in the middle, tall at the back gives depth.',
        'Flow: water, roots and stones can lead the eye through the scene.',
        'Negative space: leave open ground or water. Empty space makes the busy parts stand out.',
        'Unity and variety: repeat a few shapes and textures, and vary their size.',
      ] },
      { tryit: 'Turn on the composition guides in the camera menu and check where your focal point falls.' },
    ],
    related: ['biotope'],
  },
  conservation: {
    title: 'Conservation and the keeper', icon: 'trophy',
    blurb: 'What "Critically Endangered" means, and what keepers can do.',
    sections: [
      { p: ['The IUCN Red List sorts species by risk: Least Concern, Near Threatened, Vulnerable, Endangered, Critically Endangered, Extinct in the Wild and Extinct. Amphibians are the most threatened vertebrate group: about two in five species are at risk.'] },
      { p: ['Captive breeding cannot replace habitat, but it can keep a species alive and teach people about it. The axolotl is nearly gone from its one lake but is common in labs and homes, and each captive-bred animal is one that was not taken from the wild.'] },
    ],
    related: ['quarantine', 'biotope'],
  },
  genetics: {
    title: 'Colour genetics', icon: 'wand', widget: 'punnett',
    blurb: 'Why two pink axolotls can have a dark baby, and how to breed the colour you want.',
    sections: [
      { p: ['Every animal has two copies of each gene, called alleles: one from its mother and one from its father. Gene versions get letters. A capital letter (A) is usually the normal, dominant allele; a small letter (a) is the recessive one.'] },
      { h: 'Dominant and recessive', ul: [
        'A dominant allele wins: an animal with AA or Aa looks normal.',
        'A recessive allele only shows when both copies are the small letter: aa. An albino axolotl is aa.',
        'A carrier (Aa) looks normal but hides one recessive copy and can pass it on. Two carriers can have an albino baby, about one in four.',
      ] },
      { h: 'The Punnett square', p: ['A Punnett square lists what each parent can give: two alleles across the top, two down the side. Each box is one possible baby, and each box has the same chance. Aa × Aa gives AA, Aa, Aa and aa: three normal looking babies for every albino, with two of the three carrying the hidden gene.'] },
      { h: 'In-between genes', p: ['Some genes blend instead of hiding. A guppy\'s tail colour has two alleles, red (R) and blue (B). RR is red, BB is blue and BR, one of each, is purple. A red and a blue guppy can only have purple babies; two purple guppies make red, purple and blue in a 1 : 2 : 1 mix. This is called incomplete dominance.'] },
      { h: 'Mutations', p: ['Now and then a gene is copied wrongly and an allele flips. In the game about one baby gene in a hundred does. Most of the time nobody notices, but sometimes a mutation makes a colour that nobody in the family carries. Real breeders found many pet colours this way.'] },
      { fact: 'The white albino axolotl is aa and ll together: it needs two recessive genes at once, so it is rare unless you plan for it. Breeders call that selective breeding: they keep the animals with the colour they want and pair them on purpose.' },
      { h: 'Breeding on purpose', ul: [
        'Tap an animal and press Pair up, then tap its partner. Marked pairs breed with each other.',
        'Open the Lab, Genetics tab: choose two animals and see the odds for every colour before you pair them.',
        'A rare colour sells for more. Keep a line of carriers and you can make it again and again.',
      ] },
      { tryit: 'Release two golden or carrier axolotls, pair them up, and watch the Genetics tab. Which colours can their babies have? Count what really hatches.' },
    ],
    related: ['conservation'],
  },
};

// Resolve aliases.
for (const [id, c] of Object.entries(CONCEPTS)) if (c.alias) CONCEPTS[id] = { ...CONCEPTS[c.alias], id, hidden: true };
for (const [id, c] of Object.entries(CONCEPTS)) c.id = id;
