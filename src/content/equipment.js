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
  filterCanister: {
    id: 'filterCanister', group: 'Water', name: 'Canister filter', level: 5, price: 150, icon: 'filter',
    blurb: 'Lots of biological media in a sealed box. A big jump in how much life the water can carry.',
    teach: 'Biological capacity is surface area. Ceramic media has a huge internal surface, so a small volume can hold a colony large enough for a full stocked tank.',
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
    teach: 'A false bottom keeps the soil above a reservoir, so the water table is under your control. It is how bioactive tanks stay healthy for years.',
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
