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
    blurb: 'A foam sponge that bacteria grow in, driven by an air stone.',
    teach: 'A filter mostly does not filter: it is a home for nitrifying bacteria. The more surface it has, the more ammonia they can process.',
  },
  filterMatten: {
    id: 'filterMatten', group: 'Water', name: 'Corner foam filter (Mattenfilter)', level: 3, price: 40, icon: 'filter',
    blurb: 'A thick block of coarse foam walls off a back corner of the water; a small air-lift or pump behind it pulls water slowly through the whole face.',
    teach: 'With a huge face and a slow flow there is no suction anywhere: baby shrimp, tadpoles and tiny fish cannot be pulled in, and the foam is a vast home for nitrifying bacteria. Moss grows over it and hides it.',
  },
  filterCanister: {
    id: 'filterCanister', group: 'Water', name: 'Canister filter', level: 5, price: 150, icon: 'filter',
    blurb: 'Lots of biological media in a sealed box. A big jump in how much life the water can carry.',
    teach: 'Biological capacity is surface area. Ceramic media has a huge internal surface, so a small volume can hold a colony large enough for a full stocked tank. Plumbed through bulkheads or hidden behind the background, it keeps the media out of the water. Its intake sucks: cover it with a sponge pre-filter or it takes baby shrimp and fry.',
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

// Filters: what each kind of filter does to the water. mediaMax caps the "Filter media" slider, flow is the current it adds to
// the main pool (0 still … 1 strong), oxygen is how much it lifts the pool's oxygen target, suction is how many baby shrimp and
// fry its intake takes (a pre-filter sponge on the intake cuts it to almost nothing).
export const FILTERS = {
  sponge: { gear: 'filterSponge', name: 'Sponge filter', mediaMax: 0.6, flow: 0.12, oxygen: 1.6, suction: 0, blurb: 'Air-driven foam: gentle, shrimp-safe, small capacity.' },
  matten: { gear: 'filterMatten', name: 'Corner foam filter', mediaMax: 0.85, flow: 0.06, oxygen: 1.4, suction: 0, blurb: 'A wall of coarse foam: no suction, a huge bacterial surface, almost no current.' },
  canister: { gear: 'filterCanister', name: 'Canister filter', mediaMax: 1, flow: 0.42, oxygen: 1.8, suction: 0.6, blurb: 'Most media and the strongest flow; put a sponge over the intake for shrimp and fry.' },
};
export const filterOf = (E) => FILTERS[E.filterKind] ?? FILTERS.sponge;

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
