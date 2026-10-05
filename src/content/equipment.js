// Equipment you can buy and fit. Each item says what it does in the
// simulation and what it teaches, and is unlocked by rank and paid for with
// funds (sandbox mode owns everything). `group` sorts the shop.

export const GEAR = {
  // --- Instruments: you can't manage what you can't measure ---------------
  hygro: {
    id: 'hygro', group: 'Instruments', name: 'Thermo-hygrometer', level: 1, price: 0, owned: true, icon: 'gauge',
    blurb: 'Shows temperature and relative humidity. The first thing any keeper fits.',
    teach: 'Humidity is relative: air at 25 °C holds about twice as much water vapour as air at 15 °C, so the same amount of water reads as a lower percentage when the tank warms up.',
  },
  testKit: {
    id: 'testKit', group: 'Instruments', name: 'Water test kit', level: 2, price: 30, icon: 'flask',
    blurb: 'Measures ammonia, nitrite and nitrate. Essential while a new tank cycles.',
    teach: 'Ammonia and nitrite are toxic to fish and amphibian larvae long before you can see anything wrong; only a test tells you.',
  },
  logger: {
    id: 'logger', group: 'Instruments', name: 'Data logger', level: 4, price: 140, icon: 'chart',
    blurb: 'Records every reading and draws the Lab charts, so you can see cause and effect over days.',
    teach: 'A graph turns "something is wrong" into "the humidity fell every day at noon when the lamp came on".',
  },
  // --- Light ---------------------------------------------------------------
  led: {
    id: 'led', group: 'Light', name: 'LED bar', level: 1, price: 0, owned: true, icon: 'sun',
    blurb: 'A basic dimmable LED bar with a timer.',
    teach: 'Plants photosynthesise only while the lamp is on: light intensity times hours per day sets how much energy they get. Too little and they stretch and stall; too much and algae takes over.',
  },
  ledPro: {
    id: 'ledPro', group: 'Light', name: 'Pro LED array', level: 5, price: 260, icon: 'sun',
    blurb: 'Brighter, with adjustable colour temperature and a slow sunrise and sunset.',
    teach: 'Warm light (2700 K) and cool light (6500 K) grow plants about equally, but they change how a tank looks: cool light makes greens and blues pop, warm light makes wood and frogs glow.',
  },
  basking: {
    id: 'basking', group: 'Light', name: 'Basking lamp', level: 4, price: 55, icon: 'flame', placeable: true,
    blurb: 'A spot lamp that makes a warm patch, a thermal gradient for geckos and other animals to choose from.',
    teach: 'Reptiles and amphibians are ectotherms: they regulate their body temperature by moving between warm and cool places. A tank with one uniform temperature takes that choice away.',
  },
  uvb: {
    id: 'uvb', group: 'Light', name: 'Low UVB tube', level: 4, price: 60, icon: 'sun',
    blurb: 'A low-output UVB tube (UV index about 2 in the light) for shade-loving reptiles and amphibians such as the crocodile skink.',
    teach: 'UVB light lets skin make vitamin D3, which an animal needs to use the calcium in its food; without it bones soften over months. Forest-floor animals need only a little: a low tube over part of the tank, with shade to retreat to.',
  },
  // --- Climate --------------------------------------------------------------
  heater: {
    id: 'heater', group: 'Climate', name: 'Heater and thermostat', level: 1, price: 0, owned: true, icon: 'thermo',
    blurb: 'Keeps the tank at a set minimum temperature.',
    teach: 'A thermostat is a feedback loop: it measures, compares with the set point and switches. Most of the automation in this game is the same idea.',
  },
  fan: {
    id: 'fan', group: 'Climate', name: 'Ventilation fan', level: 2, price: 40, icon: 'fan',
    blurb: 'Moves air through the tank: dries it, cools it, evens out hot and damp spots and stops mould.',
    teach: 'Stale, saturated air lets mould and fungus win. Good vivaria are humid but not stagnant: ventilation is what separates a rainforest from a sauna.',
  },
  fogger: {
    id: 'fogger', group: 'Climate', name: 'Ultrasonic fogger', level: 4, price: 95, icon: 'cloud', placeable: true,
    blurb: 'Makes cool, dense fog. Raises humidity fast around where you put it, and slightly cools the air.',
    teach: 'An ultrasonic disc shakes water into 1–5 micrometre droplets, which evaporate quickly. Because evaporation takes heat from the air, fog is cool, and it hugs the ground because it is heavier than warm air.',
  },
  mister: {
    id: 'mister', group: 'Climate', name: 'Rain system', level: 3, price: 180, icon: 'rain',
    blurb: 'Nozzles along the top that make a rain shower on a timer. Waters the plants and the soil and keeps moss lush.',
    teach: 'Rainforest animals cue on the seasons: the start of the wet season triggers breeding in many dart frogs. A programmable rain system lets you copy it.',
  },
  chiller: {
    id: 'chiller', group: 'Climate', name: 'Cooling unit', level: 5, price: 190, icon: 'snow',
    blurb: 'Pulls the tank down toward a set temperature in a heatwave. Essential for cold-water species like axolotls.',
    teach: 'Axolotls come from high-altitude lakes near Mexico City and are stressed above about 21 °C. Warm water holds less dissolved oxygen, so heat and suffocation arrive together.',
  },
  // --- Water ----------------------------------------------------------------
  filterSponge: {
    id: 'filterSponge', group: 'Water', name: 'Sponge filter', level: 2, price: 25, icon: 'filter', owned: true,
    blurb: 'A sponge in a box outside the tank: its pump pulls water from the pool through the sponge and sends it back clean.',
    teach: 'A filter does two jobs: the sponge traps the particles, and the bacteria living in it turn ammonia into nitrate. The more surface, the more of both. Rinse it in old tank water when it clogs: tap water would kill the bacteria.',
  },
  filterMatten: {
    id: 'filterMatten', group: 'Water', name: 'Corner foam filter (Mattenfilter)', level: 3, price: 40, icon: 'filter',
    blurb: 'A thick block of coarse foam walls off a back corner of the water; a small pump behind it pulls water slowly through the whole face.',
    teach: 'With a huge face and a slow flow there is no suction anywhere: baby shrimp, tadpoles and tiny fish cannot be pulled in, and the foam is a vast home for nitrifying bacteria. Moss grows over it and hides it.',
  },
  filterCanister: {
    id: 'filterCanister', group: 'Water', name: 'Canister filter', level: 5, price: 150, icon: 'filter',
    blurb: 'Lots of biological media in a sealed box. A big jump in how much life the water can carry.',
    teach: 'Biological capacity is surface area. Ceramic media has a huge internal surface, so a small volume can hold a colony large enough for a full stocked tank. Plumbed through bulkheads or hidden behind the background, it keeps the media out of the water. Its intake sucks: cover it with a sponge pre-filter or it takes baby shrimp and fry.',
  },
  filterHobS: {
    id: 'filterHobS', group: 'Water', name: 'Hang-on-back filter Alder', level: 2, price: 35, icon: 'filter',
    blurb: 'A box that hangs on the back rim: a pump in it lifts the water up a tube, through its media, and lets it fall back over a lip. Made for tanks of 18-76 litres.',
    teach: 'The falling sheet of water stirs the surface, and that is where oxygen gets in, with no air pump. The tube has to lift the water all the way to the rim, so it moves much more in a deep pool than in a shallow one, and its intake pulls small animals in unless you fit a sponge over it.',
  },
  filterHobM: {
    id: 'filterHobM', group: 'Water', name: 'Hang-on-back filter Birch', level: 3, price: 55, icon: 'filter',
    blurb: 'A box that hangs on the back rim: a pump in it lifts the water up a tube, through its media, and lets it fall back over a lip. Made for tanks of 76-190 litres.',
    teach: 'The falling sheet of water stirs the surface, and that is where oxygen gets in, with no air pump. The tube has to lift the water all the way to the rim, so it moves much more in a deep pool than in a shallow one, and its intake pulls small animals in unless you fit a sponge over it.',
  },
  filterHobL: {
    id: 'filterHobL', group: 'Water', name: 'Hang-on-back filter Oak', level: 4, price: 90, icon: 'filter',
    blurb: 'A box that hangs on the back rim: a pump in it lifts the water up a tube, through its media, and lets it fall back over a lip. Made for tanks of 227-416 litres.',
    teach: 'The falling sheet of water stirs the surface, and that is where oxygen gets in, with no air pump. The tube has to lift the water all the way to the rim, so it moves much more in a deep pool than in a shallow one, and its intake pulls small animals in unless you fit a sponge over it.',
  },
  filterInternalS: {
    id: 'filterInternalS', group: 'Water', name: 'Internal filter Pebble', level: 2, price: 25, icon: 'filter',
    blurb: 'A small pump and a foam cartridge in one body that stands in the pool. No hoses, no cabinet. Made for tanks of 30-60 litres.',
    teach: 'It cleans the water it stands in: the pump pulls it through the foam and a nozzle puts it back near the surface. The foam face is large, so the pull is gentle, but the media is small and clogs sooner than a box outside the tank.',
  },
  filterInternalM: {
    id: 'filterInternalM', group: 'Water', name: 'Internal filter Cobble', level: 3, price: 40, icon: 'filter',
    blurb: 'A small pump and a foam cartridge in one body that stands in the pool. No hoses, no cabinet. Made for tanks of 80-180 litres.',
    teach: 'It cleans the water it stands in: the pump pulls it through the foam and a nozzle puts it back near the surface. The foam face is large, so the pull is gentle, but the media is small and clogs sooner than a box outside the tank.',
  },
  filterInternalL: {
    id: 'filterInternalL', group: 'Water', name: 'Internal filter Boulder', level: 4, price: 70, icon: 'filter',
    blurb: 'A small pump and a foam cartridge in one body that stands in the pool. No hoses, no cabinet. Made for tanks of over 350 litres.',
    teach: 'It cleans the water it stands in: the pump pulls it through the foam and a nozzle puts it back near the surface. The foam face is large, so the pull is gentle, but the media is small and clogs sooner than a box outside the tank.',
  },
  filterBedS: {
    id: 'filterBedS', group: 'Water', name: 'Tower pump Tern', level: 4, price: 45, icon: 'filter',
    blurb: 'The false bottom\'s bed of bio-rings, with a pump in the slotted tower that pulls the water down through it.',
    teach: 'The space under the land is already a bed of bio-rings; a pump in the slotted tower makes the water run through it instead of leaving it to drift. All that surface holds a big colony and nothing in the tank can reach the intake. It needs a build with a false bottom, the water must stay over the pump, and it cannot be rinsed without lifting the land.',
  },
  filterBedM: {
    id: 'filterBedM', group: 'Water', name: 'Tower pump Heron', level: 4, price: 55, icon: 'filter',
    blurb: 'The false bottom\'s bed of bio-rings, with a pump in the slotted tower that pulls the water down through it.',
    teach: 'The space under the land is already a bed of bio-rings; a pump in the slotted tower makes the water run through it instead of leaving it to drift. All that surface holds a big colony and nothing in the tank can reach the intake. It needs a build with a false bottom, the water must stay over the pump, and it cannot be rinsed without lifting the land.',
  },
  filterBedL: {
    id: 'filterBedL', group: 'Water', name: 'Tower pump Crane', level: 5, price: 75, icon: 'filter',
    blurb: 'The false bottom\'s bed of bio-rings, with a pump in the slotted tower that pulls the water down through it.',
    teach: 'The space under the land is already a bed of bio-rings; a pump in the slotted tower makes the water run through it instead of leaving it to drift. All that surface holds a big colony and nothing in the tank can reach the intake. It needs a build with a false bottom, the water must stay over the pump, and it cannot be rinsed without lifting the land.',
  },
  autofeeder: {
    id: 'autofeeder', group: 'Feeding', name: 'Auto-feeder', level: 3, price: 70, icon: 'bowl',
    blurb: 'Drops fish food once a day at 10:00.',
    teach: 'Overfeeding is the most common way to ruin a tank: uneaten food rots into ammonia.',
  },
  flyCulture: {
    id: 'flyCulture', group: 'Feeding', name: 'Fruit fly culture', level: 3, price: 20, icon: 'bug',
    blurb: 'A culture that releases a few flightless fruit flies and a bit of rotting fruit every other day for frogs and geckos. The flies breed on the fruit and the litter.',
    teach: 'Dart frogs eat live prey all their lives. Keepers run several cultures so there is always a fresh one ready.',
  },
  // --- Foundation (chosen when building) -------------------------------------
  drainageLeca: {
    id: 'drainageLeca', group: 'Foundation', name: 'Drainage layer', level: 1, price: 15, icon: 'layers', foundation: 0.6,
    blurb: 'A layer of clay pebbles under the soil so extra water can drain away from the roots.',
    teach: 'Soil needs both water and air. Where it stays saturated, roots suffocate and rot, and the anaerobic bacteria that take over smell of rotten eggs. A drainage layer holds the extra water below the roots.',
  },
  falseBottom: {
    id: 'falseBottom', group: 'Foundation', name: 'False bottom with drain', level: 4, price: 95, icon: 'layers', foundation: 1,
    blurb: 'A raised mesh floor with a drain: the professional way to build a wet tank that never sours.',
    teach: 'A false bottom (a plenum) is an egg-crate grid on short PVC legs, covered with fibreglass mesh so the soil cannot sift through. The water below circulates under the whole land, and the bio-rings or clay pebbles in it are one big filter bed; a pump in a slotted access tube in a back corner lifts it up hidden tubing to a waterfall, and lifts out for cleaning. Keep the water line just under the mesh, or the soil turns to mud.',
  },
  // --- Automation -------------------------------------------------------------
  controller: {
    id: 'controller', group: 'Automation', name: 'Automation controller', level: 7, price: 480, icon: 'cpu',
    blurb: 'Reads the sensors and runs your rules: "if humidity is below 80 % then run the fogger". Lets a tank run itself while you are away.',
    teach: 'Automation is feedback control. Too aggressive a rule makes a tank swing up and down; too timid and it drifts. Testing it with the Vacation button shows which.',
  },
};

export const GEAR_GROUPS = ['Instruments', 'Light', 'Climate', 'Water', 'Feeding', 'Foundation', 'Automation'];

// What the controller can read and switch. Each sensor gives a number; each
// actuator sets an Env field to a value while its rule is true.
export const SENSORS = {
  temp: { name: 'Temperature', unit: '°C', min: 10, max: 40, step: 0.5, get: (E) => E.temp },
  humidity: { name: 'Humidity', unit: '%', min: 20, max: 100, step: 1, get: (E) => E.humidity },
  light: { name: 'Light', unit: '', min: 0, max: 1.4, step: 0.05, get: (E) => E.bright() },
  soil: { name: 'Soil moisture', unit: '%', min: 0, max: 100, step: 1, get: (E) => E.soil * 100 },
  nitrate: { name: 'Nitrate', unit: 'ppm', min: 0, max: 100, step: 1, get: (E) => E.nitrate },
  ammonia: { name: 'Ammonia', unit: 'ppm', min: 0, max: 3, step: 0.05, get: (E) => E.ammonia },
  hour: { name: 'Time of day', unit: 'h', min: 0, max: 24, step: 0.5, get: (E) => (E.minute % 1440) / 60 },
  water: { name: 'Water level', unit: 'cm', min: 0, max: 80, step: 0.5, get: (E, W) => W.water.level },
};

export const ACTUATORS = {
  fan: { name: 'Fan', gear: 'fan', on: 1, off: 0, key: 'fan' },
  fogger: { name: 'Fogger', gear: 'fogger', on: 0.8, off: 0, key: 'fogger' },
  rain: { name: 'Rain shower', gear: 'mister', pulse: 4, key: 'rain' },
  heater: { name: 'Heater setpoint', gear: 'heater', on: 26, off: 18, key: 'setpoint' },
  lamp: { name: 'Lamp power', gear: 'led', on: 1, off: 0.35, key: 'lampPower' },
  chiller: { name: 'Cooling', gear: 'chiller', on: 1, off: 0, key: 'chill' },
};

// Filters: what each kind of filter does to the water. Every filter has its own small pump (not the main pump that feeds the
// outlets) that pushes the main pool's water through the media and back out clean. mediaMax caps the "Filter media" slider,
// flow is the current it adds to the main pool (0 still … 1 strong), oxygen is how much it lifts the pool's oxygen target,
// suction is how many baby shrimp and fry its intake takes (a pre-filter sponge on the intake cuts it to almost nothing).
// lph is the water its pump moves (litres an hour, clean), catch the share of the particles in that water the media keeps,
// hold how much dirt (detritus units) it takes before it is clogged solid (sim.js).
// mount: where it stands (sim/filterflow.js MOUNTS: cabinet | pool | rim | internal | bed), prefilter: a sponge can be fitted over its intake; watts: the pump's power, tank: [min, max] litres the maker rates it for (max null: no upper limit).
// The hardware (sim/filterflow.js turns it into the flow it really gives): pump is the filter pump's rating, lph moved against no
// head and hmax the lift (cm) at which it moves nothing (fit: 'ladder': the PUMPS size fitted at the starter, the sim fits each
// installation its own; closed: a sealed canister, a closed loop, so its pump lifts only to the outlet over the water); hose the inner/outer diameter (mm) of the drain from the overflow down
// to the filter (in) and of the return up to the tank (out), standard aquarium hose sizes; media the head (cm) the clean media
// cost at the rated flow; stages the media in the order the water meets them: id, name, share of that head.
// Filter pumps with real figures (docs/agents/lizards/FILTER_SHEETS.md, "B5e pump ladder": one maker family, invented names): lph the
// flow at no head, hmax the head (cm) at which it moves nothing, watts, bore its hose (mm), adj the range its flow knob sets. A row with
// fit: 'ladder' gets the smallest of these that does its job, per installation (sim/filterflow.js pumpFit). Pelican's bore is an estimate.
export const PUMPS = {
  tern: { id: 'tern', name: 'Tern', lph: 300, hmax: 60, watts: 7, bore: 12, adj: [170, 300] },
  heron: { id: 'heron', name: 'Heron', lph: 600, hmax: 100, watts: 7, bore: 12, adj: [250, 600] },
  crane: { id: 'crane', name: 'Crane', lph: 1000, hmax: 140, watts: 15, bore: 16, adj: [400, 1000] },
  stork: { id: 'stork', name: 'Stork', lph: 2100, hmax: 240, watts: 38, bore: 19, adj: [1400, 2100] },
  pelican: { id: 'pelican', name: 'Pelican', lph: 3000, hmax: 270, watts: 55, bore: 25, adj: [1800, 3000] },
};
export const PUMP_LADDER = ['tern', 'heron', 'crane', 'stork', 'pelican'];

export const FILTERS = {
  sponge: { gear: 'filterSponge', mount: 'cabinet', prefilter: false, name: 'Sponge filter', mediaMax: 0.6, flow: 0.12, oxygen: 1.6, suction: 0, lph: 120, catch: 0.5, hold: 24, blurb: 'A sponge in an external box, a strainer on its intake: gentle, shrimp-safe, small capacity; needs a rinse every few weeks.',
    pump: PUMPS.heron, fit: 'ladder', hose: { in: [16, 22], out: [12, 16] }, media: 17,
    stages: [['mech', 'Coarse sponge', 0.5], ['bio', 'Fine bio sponge', 0.35], ['chem', 'Carbon pad', 0.15]] },
  matten: { gear: 'filterMatten', mount: 'pool', prefilter: false, name: 'Corner foam filter', mediaMax: 0.85, flow: 0.06, oxygen: 1.4, suction: 0, lph: 150, catch: 0.45, hold: 60, blurb: 'A wall of coarse foam with a pump behind it: no suction, a huge surface, almost no current; goes months between rinses.',
    pump: PUMPS.tern, fit: 'ladder', hose: { out: [12, 16] }, media: 7,
    stages: [['mech', 'Coarse foam face', 0.6], ['bio', 'Foam core', 0.4]] },
  canister: { gear: 'filterCanister', mount: 'cabinet', prefilter: true, name: 'Canister filter', mediaMax: 1, flow: 0.42, oxygen: 1.8, suction: 0.6, lph: 400, catch: 0.85, hold: 40, blurb: 'Most media, fine floss and the strongest flow; put a sponge over the intake for shrimp and fry.',
    pump: PUMPS.heron, fit: 'ladder', closed: true, hose: { in: [19, 27], out: [16, 22] }, media: 22,
    stages: [['mech', 'Coarse sponge', 0.3], ['bio', 'Ceramic rings', 0.2], ['chem', 'Fine floss and carbon', 0.5]] },
  // The three new families in three sizes each, from the maker sheets of one real product line per family (docs/agents/lizards/FILTER_SHEETS.md):
  // pump.lph is the maximum flow at no head, hmax the maximum head (cm) where the sheet has one (the tower pumps), watts and tank (litres the
  // maker rates it for) as listed, the bed's 12 / 16 mm hose from the sheet. estimates, no sheet: hmax of the hang-on-back (40 cm: a real one only runs with the water near the rim) and internal (55 cm) pumps;
  // NOT from a sheet, modelled:
  // and all their hose bores, hold, catch, suction, flow, oxygen. lph (the rated flow) and media are worked out from the pump and the lift in the
  // game (sim/filterflow.js): lph the working point of a clean filter at a 12 cm pool, media the head that clogs it down to 30 % when solid.
  hobS: { gear: 'filterHobS', mount: 'rim', prefilter: true, name: 'Hang-on-back filter Alder', mediaMax: 0.8, flow: 0.3, oxygen: 2, suction: 0.35, lph: 225, catch: 0.7, hold: 35, watts: 7, tank: [18,76],
    blurb: 'Hangs on the back rim: foam, carbon and ceramic rings, and a falling lip that stirs the surface. Strong in a deep pool; put a sponge over the intake for shrimp and fry. Made for tanks of 18-76 litres.',
    pump: { lph: 379, hmax: 40 }, hose: { in: [19,27] }, media: 15,
    stages: [['mech', 'Foam pad', 0.3], ['chem', 'Carbon', 0.3], ['bio', 'Ceramic bio rings', 0.4]] },
  hobM: { gear: 'filterHobM', mount: 'rim', prefilter: true, name: 'Hang-on-back filter Birch', mediaMax: 0.8, flow: 0.38, oxygen: 2, suction: 0.45, lph: 450, catch: 0.7, hold: 55, watts: 7, tank: [76,190],
    blurb: 'Hangs on the back rim: foam, carbon and ceramic rings, and a falling lip that stirs the surface. Strong in a deep pool; put a sponge over the intake for shrimp and fry. Made for tanks of 76-190 litres.',
    pump: { lph: 757, hmax: 40 }, hose: { in: [25,34] }, media: 15,
    stages: [['mech', 'Foam pad', 0.3], ['chem', 'Carbon', 0.3], ['bio', 'Ceramic bio rings', 0.4]] },
  hobL: { gear: 'filterHobL', mount: 'rim', prefilter: true, name: 'Hang-on-back filter Oak', mediaMax: 0.8, flow: 0.5, oxygen: 2, suction: 0.6, lph: 1010, catch: 0.7, hold: 90, watts: 14, tank: [227,416],
    blurb: 'Hangs on the back rim: foam, carbon and ceramic rings, and a falling lip that stirs the surface. Strong in a deep pool; put a sponge over the intake for shrimp and fry. Made for tanks of 227-416 litres.',
    pump: { lph: 1892, hmax: 40 }, hose: { in: [25,34] }, media: 15,
    stages: [['mech', 'Foam pad', 0.3], ['chem', 'Carbon', 0.3], ['bio', 'Ceramic bio rings', 0.4]] },
  internalS: { gear: 'filterInternalS', mount: 'internal', prefilter: false, name: 'Internal filter Pebble', mediaMax: 0.55, flow: 0.28, oxygen: 1.5, suction: 0.2, lph: 375, catch: 0.55, hold: 20, watts: 5, tank: [30,60],
    blurb: 'A pump and foam in one body that stands in the pool: no hoses, gentle pull, small capacity; rinse it often. Made for tanks of 30-60 litres.',
    pump: { lph: 480, hmax: 55 }, hose: { out: [12,16] }, media: 12.5,
    stages: [['mech', 'Mechanical foam', 0.6], ['bio', 'Bio foam', 0.4]] },
  internalM: { gear: 'filterInternalM', mount: 'internal', prefilter: false, name: 'Internal filter Cobble', mediaMax: 0.55, flow: 0.34, oxygen: 1.5, suction: 0.25, lph: 475, catch: 0.55, hold: 30, watts: 6, tank: [80,180],
    blurb: 'A pump and foam in one body that stands in the pool: no hoses, gentle pull, small capacity; rinse it often. Made for tanks of 80-180 litres.',
    pump: { lph: 650, hmax: 55 }, hose: { out: [12,16] }, media: 12.5,
    stages: [['mech', 'Mechanical foam', 0.6], ['bio', 'Bio foam', 0.4]] },
  internalL: { gear: 'filterInternalL', mount: 'internal', prefilter: false, name: 'Internal filter Boulder', mediaMax: 0.55, flow: 0.55, oxygen: 1.5, suction: 0.35, lph: 1175, catch: 0.55, hold: 50, watts: 27, tank: [350,null],
    blurb: 'A pump and foam in one body that stands in the pool: no hoses, gentle pull, small capacity; rinse it often. Made for tanks of over 350 litres.',
    pump: { lph: 2000, hmax: 55 }, hose: { out: [16,22] }, media: 12.5,
    stages: [['mech', 'Mechanical foam', 0.6], ['bio', 'Bio foam', 0.4]] },
  bedS: { gear: 'filterBedS', mount: 'bed', prefilter: false, name: 'Tower pump Tern', mediaMax: 1, flow: 0.15, oxygen: 0.8, suction: 0, lph: 245, catch: 0.35, hold: 80, watts: 7, tank: null,
    blurb: 'A pump on the floor of the false bottom\'s slotted tower, pulling the water down through the bed of bio-rings: huge surface, nothing to pull in, slow to clog and hard to clean.',
    pump: PUMPS.tern, hose: { out: [12,16] }, media: 13,
    stages: [['mech', 'Screen and fines', 0.3], ['bio', 'Bio-ring bed', 0.7]] },
  bedM: { gear: 'filterBedM', mount: 'bed', prefilter: false, name: 'Tower pump Heron', mediaMax: 1, flow: 0.18, oxygen: 0.8, suction: 0, lph: 470, catch: 0.35, hold: 110, watts: 7, tank: null,
    blurb: 'A pump on the floor of the false bottom\'s slotted tower, pulling the water down through the bed of bio-rings: huge surface, nothing to pull in, slow to clog and hard to clean.',
    pump: PUMPS.heron, hose: { out: [12,16] }, media: 22.5,
    stages: [['mech', 'Screen and fines', 0.3], ['bio', 'Bio-ring bed', 0.7]] },
  bedL: { gear: 'filterBedL', mount: 'bed', prefilter: false, name: 'Tower pump Crane', mediaMax: 1, flow: 0.24, oxygen: 0.8, suction: 0, lph: 820, catch: 0.35, hold: 150, watts: 15, tank: null,
    blurb: 'A pump on the floor of the false bottom\'s slotted tower, pulling the water down through the bed of bio-rings: huge surface, nothing to pull in, slow to clog and hard to clean.',
    pump: PUMPS.crane, hose: { out: [16,22] }, media: 31.5,
    stages: [['mech', 'Screen and fines', 0.3], ['bio', 'Bio-ring bed', 0.7]] },
};
export const filterOf = (E) => FILTERS[E.filterKind] ?? FILTERS.sponge;
// How clogged the filter is (0 clean … 1 solid) and how much of its rated flow it still passes (0 when it is off): the flow
// sim/filterflow.js found for its pump, head and media (Env.filterFlow, every sim step), or a plain estimate before the first.
export const filterClog = (E) => Math.max(0, Math.min(1, (E.filterDirt ?? 0) / filterOf(E).hold));
export const filterEff = (E) => (!E.filter ? 0 : E.filterFlow?.kind === (E.filterKind ?? 'sponge') ? Math.min(1.25, E.filterFlow.lph / filterOf(E).lph) : 1 - 0.75 * filterClog(E));

// The false bottom's bio-rings as media (0 … 0.3, as far as the plenum is under water), added to the sump's. A bed filter that is running
// is that media working as the filter: it counts through its FILTERS row (media, flow, clog) and not a second time here.
export const plenumBio = (E) => (E.filter && FILTERS[E.filterKind]?.mount === 'bed' ? 0 : E.drainage >= 1 ? 0.3 * (E.plenum ? Math.max(0.25, Math.min(1, E.plenum.filled * 1.3)) : 1) : E.drainage > 0 ? 0.1 : 0);

// The water you fill and change with: it sets the hardness (GH, °dH) and pH the tank drifts back to.
export const WATER_SOURCES = {
  tap: { name: 'Tap water', ph: 7.5, gh: 10, blurb: 'Moderately hard, slightly alkaline: fine for most fish, shrimp and newts.' },
  soft: { name: 'Rain or RO water', ph: 6.6, gh: 1, blurb: 'Soft and slightly acid, like a rainforest stream. Shrimp molt badly in it.' },
  remin: { name: 'RO water, remineralised', ph: 7.1, gh: 6, blurb: 'Soft water with the minerals shrimp need added back: GH about 6.' },
  hard: { name: 'Hard lake water', ph: 8.2, gh: 14, blurb: 'Hard and alkaline, like the rift lakes of Sulawesi: for panther crabs.' },
};
export const sourceOf = (E) => WATER_SOURCES[E.waterSource] ?? WATER_SOURCES.tap;

// The substrate the land is built of (Care > Foundation). drain: added to how fast wet soil dries (sim/climate.js), mould:
// times the food mould finds in wet soil (sim.js), color: the soil profile seen through the glass (render/soilside.js, by index).
export const SUBSTRATES = {
  soil: { name: 'Topsoil and peat', drain: 0, mould: 1, blurb: 'Cheap and rich, but it packs down and sours when kept wet.' },
  abg: { name: 'ABG mix', drain: 0.35, mould: 0.7, blurb: 'Fir bark, tree-fern fibre, charcoal, peat and sphagnum: open, airy and slow to rot. The standard for vivariums.' },
  coir: { name: 'Coco coir', drain: -0.15, mould: 1.1, blurb: 'Coconut husk fibre: holds a lot of water and stays damp; mixes well with bark.' },
  sphagnum: { name: 'Coir under sphagnum moss', drain: -0.25, mould: 0.85, blurb: 'Coir with a top layer of living sphagnum: holds water and humidity like a sponge, and resists mould.' },
};
export const SUBSTRATE_ORDER = ['soil', 'abg', 'coir', 'sphagnum'];
export const substrateOf = (E) => SUBSTRATES[E.substrate] ?? SUBSTRATES.soil;

// The false bottom's water (Env.plenumH is the height of the mesh over the glass floor, cm; the plenum's water is the pool's
// water, so its line is the pool's level). 'mud': the water is over the mesh and the land soaks it up; 'low': the plenum is
// mostly dry, its filter bed out of the water; 'good': just under the mesh.
export function plenumState(E, level) {
  if (!(E.drainage >= 1) || !(E.plenumH > 0)) return null;
  const rel = level - E.plenumH;
  return { rel, state: rel > 0.3 ? 'mud' : rel < -4 ? 'low' : 'good', filled: Math.max(0, Math.min(1, level / E.plenumH)) };
}
