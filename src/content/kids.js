// Copy and data for Kids' corner: friendly names, picture-card colours, stickers.
// Plain data, no imports, so it can be tested under Node.

// The six worlds on the "Choose your world" screen (generated presets).
export const WORLDS = [
  { id: 'cascade', name: 'Waterfall Valley', line: 'Water tumbles down the rocks', icon: 'waterfall', c1: '#3aa0c8', c2: '#1f6f8e' },
  { id: 'suriname', name: 'Frog Island', line: 'Tiny blue frogs hop about', icon: 'frog', c1: '#57c27a', c2: '#2c8a57' },
  { id: 'blackwater', name: 'Fish Lagoon', line: 'Shiny fish swim in dark water', icon: 'fish', c1: '#f29b4b', c2: '#b9612a' },
  { id: 'stream', name: 'Little Stream', line: 'A stream splashes between pools', icon: 'drop', c1: '#62c6d6', c2: '#3b84b8' },
  { id: 'karst', name: 'Rock Towers', line: 'Tall rocks and a little gecko', icon: 'tower', c1: '#b8a2f0', c2: '#7a65c2' },
  { id: 'swamp', name: 'Marsh', line: 'Ponds, reeds and crabs', icon: 'sprout', c1: '#c7d95a', c2: '#7f9a2e' },
];

// Friendly animal names. `n` singular, `p` plural, `where`: what to tap.
export const KID_ANIMALS = [
  { id: 'neon', n: 'Neon fish', p: 'neon fish', where: 'water', c: '#4aa8e0' },
  { id: 'guppy', n: 'Guppy', p: 'guppies', where: 'water', c: '#f0a04a' },
  { id: 'loach', n: 'Tiger fish', p: 'tiger fish', where: 'water', c: '#f0b81e' },
  { id: 'cory', n: 'Sandy fish', p: 'sandy fish', where: 'water', c: '#c9a26b' },
  { id: 'ember', n: 'Orange fish', p: 'orange fish', where: 'water', c: '#f07a4a' },
  { id: 'betta', n: 'Betta', p: 'bettas', where: 'water', c: '#e0508a' },
  { id: 'shrimp', n: 'Red shrimp', p: 'shrimp', where: 'water', c: '#e8584a' },
  { id: 'dartfrog', n: 'Blue frog', p: 'blue frogs', where: 'ground', c: '#3b7fd8' },
  { id: 'strawberry', n: 'Red frog', p: 'red frogs', where: 'ground', c: '#e0483c' },
  { id: 'auratus', n: 'Green frog', p: 'green frogs', where: 'ground', c: '#4ab06a' },
  { id: 'toad', n: 'Belly toad', p: 'toads', where: 'ground', c: '#e8a23a' },
  { id: 'newt', n: 'Newt', p: 'newts', where: 'water', c: '#8a7a58' },
  { id: 'firesal', n: 'Fire salamander', p: 'fire salamanders', where: 'ground', c: '#f49a0c' },
  { id: 'redeye', n: 'Red-eyed tree frog', p: 'red-eyed tree frogs', where: 'plants', c: '#e8321a' },
  { id: 'axolotl', n: 'Axolotl', p: 'axolotls', where: 'water', c: '#f0a0b8' },
  { id: 'gecko', n: 'Gecko', p: 'geckos', where: 'wall', c: '#c2a04a' },
  { id: 'crab', n: 'Crab', p: 'crabs', where: 'ground', c: '#b8503c' },
];

export const KID_PLANTS = [
  { id: 'fernph', n: 'Feathery fern', where: 'ground' },
  { id: 'fern', n: 'Fern', where: 'ground' },
  { id: 'weed', n: 'Green carpet', where: 'ground' },
  { id: 'grass', n: 'Grass', where: 'ground' },
  { id: 'bilberry', n: 'Berry bush', where: 'ground' },
  { id: 'bromeliad', n: 'Spiky flower', where: 'ground' },
  { id: 'guzmania', n: 'Star flower', where: 'ground' },
  { id: 'masdevallia', n: 'Little orchid', where: 'wall' },
  { id: 'pothos', n: 'Vine', where: 'wall' },
  { id: 'cattail', n: 'Cattail', where: 'water' },
  { id: 'bamboo', n: 'Tall reeds', where: 'water' },
  { id: 'vallisneria', n: 'Water grass', where: 'water' },
  { id: 'sword', n: 'Sword plant', where: 'water' },
  { id: 'javafern', n: 'Water fern', where: 'water' },
  { id: 'frogbit', n: 'Floaty leaves', where: 'water' },
  { id: 'lily', n: 'Water lily', where: 'water' },
];

export const KID_PIECES = [
  { id: 'boulder', n: 'Rock', icon: 'rock', c1: '#9aa79e', c2: '#5f6d66' },
  { id: 'wood', n: 'Log', icon: 'log', c1: '#c08a58', c2: '#7a5432' },
  { id: 'roots', n: 'Roots', icon: 'roots', c1: '#b49a6a', c2: '#6f5a34' },
  { id: 'stump', n: 'Stump', icon: 'stump', c1: '#c79a6a', c2: '#7d5a3a' },
  { id: 'spire', n: 'Tall rock', icon: 'tower', c1: '#a9a2c8', c2: '#62608a' },
];

export const KID_KITS = [
  { id: 'waterfall', n: 'Waterfall', icon: 'waterfall', c1: '#4cb4d8', c2: '#2a6e92' },
  { id: 'arch', n: 'Root arch', icon: 'arch', c1: '#c9a06a', c2: '#7d5a34' },
  { id: 'steps', n: 'Stepping stones', icon: 'steps', c1: '#9fb8a8', c2: '#5d7a6a' },
  { id: 'spires', n: 'Rock towers', icon: 'tower', c1: '#b8a2f0', c2: '#6f5ab8' },
  { id: 'island', n: 'Mossy island', icon: 'island', c1: '#7fd08a', c2: '#3a8a52' },
];

export const KID_TERRAIN = [
  { id: 'hill', n: 'Hill', icon: 'hill', c1: '#9ad36a', c2: '#4f9a3a' },
  { id: 'pond', n: 'Pond', icon: 'pond', c1: '#62c6e6', c2: '#2f7fc0' },
];

export const kidAnimal = (id) => KID_ANIMALS.find((a) => a.id === id);
export const kidPlant = (id) => KID_PLANTS.find((a) => a.id === id);
// Tiny helpers that are not pets (never in the tray): the fruit fly's young.
export const KID_BUGS = {
  flylarva: { n: 'Wiggly grub', p: 'wiggly grubs', say: 'A grub is a baby fly. It eats soggy leaves and turns them into soil!' },
  flypupa: { n: 'Sleepy cocoon', p: 'sleepy cocoons', say: 'A cocoon is where a grub rests. Soon a fly will pop out!' },
};
export const animalName = (id, fallback = 'friend') => kidAnimal(id)?.n ?? KID_BUGS[id]?.n ?? fallback;
export const animalPlural = (id, fallback = 'friends') => kidAnimal(id)?.p ?? KID_BUGS[id]?.p ?? fallback;

// Stickers: earned by doing things. Colours pair up into a round badge.
export const STICKERS = [
  { id: 'friend', name: 'First friend', hint: 'Add an animal', icon: 'frog', c1: '#57c27a', c2: '#2c8a57' },
  { id: 'plant', name: 'Green thumb', hint: 'Add a plant', icon: 'leaf', c1: '#9ad36a', c2: '#4f9a3a' },
  { id: 'build', name: 'Builder', hint: 'Build with rocks', icon: 'rock', c1: '#b0b8b2', c2: '#66736c' },
  { id: 'hill', name: 'Hill maker', hint: 'Make a hill', icon: 'hill', c1: '#c7d95a', c2: '#7f9a2e' },
  { id: 'pond', name: 'Pond digger', hint: 'Dig a pond', icon: 'pond', c1: '#62c6e6', c2: '#2f7fc0' },
  { id: 'feed', name: 'Dinner time', hint: 'Feed your pets', icon: 'bowl', c1: '#f2b25a', c2: '#c27a2a' },
  { id: 'rain', name: 'Rain maker', hint: 'Make it rain', icon: 'rain', c1: '#7fb6f0', c2: '#3f6fc0' },
  { id: 'clean', name: 'Sparkly clean', hint: 'Clean the water', icon: 'sparkles', c1: '#7fe0d8', c2: '#2f9a9a' },
  { id: 'photo', name: 'Photographer', hint: 'Take a photo', icon: 'camera', c1: '#f08aa8', c2: '#c04a78' },
  { id: 'named', name: 'Best friends', hint: 'Name an animal', icon: 'pencil', c1: '#f0a05a', c2: '#c05a3a' },
  { id: 'baby', name: 'Baby!', hint: 'See a baby born', icon: 'egg', c1: '#ffd98a', c2: '#e0a03a' },
  { id: 'twin', name: 'Twins', hint: 'Build with Twin', icon: 'twin', c1: '#c0a0f0', c2: '#7a5ac8' },
  { id: 'lapse', name: 'Time traveller', hint: 'Watch time fly', icon: 'clock', c1: '#8aa8f0', c2: '#4a5ac0' },
  { id: 'busy', name: 'Busy tank', hint: 'Have 3 animals', icon: 'paw', c1: '#f07a5a', c2: '#c03a3a' },
  { id: 'forest', name: 'Little forest', hint: 'Grow 5 plants', icon: 'sprout', c1: '#6ad08a', c2: '#2a9a5a' },
  { id: 'happy', name: 'Super happy', hint: 'Fill all the hearts', icon: 'heart', c1: '#ff8fab', c2: '#e0407a' },
  { id: 'night', name: 'Night owl', hint: 'Switch on the night', icon: 'moon', c1: '#7a7ad0', c2: '#3a3a8a' },
  // Story stickers: one per chapter of "Pip finds a home" (content/kids-story.js).
  { id: 'story-home', name: 'Home builder', hint: 'Story: chapter 1', icon: 'frog', c1: '#57c27a', c2: '#2c8a57' },
  { id: 'story-damp', name: 'Rain friend', hint: 'Story: chapter 2', icon: 'rain', c1: '#7fb6f0', c2: '#3f6fc0' },
  { id: 'story-friend', name: "Pip's pal", hint: 'Story: chapter 3', icon: 'heart', c1: '#4a8ae0', c2: '#2a5aa8' },
  { id: 'story-baby', name: 'Frog family', hint: 'Story: chapter 4', icon: 'egg', c1: '#ffd98a', c2: '#e0a03a' },
  { id: 'story-fish', name: 'Fish friends', hint: 'Story: chapter 5', icon: 'fish', c1: '#4aa8e0', c2: '#2a6e92' },
  { id: 'story-shrimp', name: 'Clean team', hint: 'Story: chapter 6', icon: 'sparkles', c1: '#e8584a', c2: '#a8302a' },
];

// What the little guide says. One line at a time.
export const SAY = {
  start: 'Hello! Tap an animal to meet it.',
  noAnimals: 'Add a friend! Tap Animals.',
  hungry: (who) => `The ${who} are hungry. Tap Feed!`,
  hungryOne: (who) => `The ${who} is hungry. Tap Feed!`,
  dirty: 'The water looks dirty. Clean it!',
  dry: 'It is too dry. Try the rain!',
  plants: 'Add a plant to make it cozier.',
  build: 'Build a rock or a waterfall!',
  rain: 'Try the rain!',
  photo: 'Take a photo of your world!',
  name: 'Tap an animal and give it a name.',
  twin: 'Try Twin: what you build is copied!',
  lapse: 'Watch time fly. Try Time-lapse in More!',
  helper: 'Too busy? Switch on the Care helper.',
  cheer: ['Everyone is happy. Great job!', 'Your world looks lovely!', 'What a cozy home!'],
  sticker: (n) => `New sticker: ${n}!`,
  baby: (who) => `A baby ${who}!`,
};

// A short "Did you know?" fact: the shortest whole first sentence of the species' facts.
export function shortFact(info, max = 120) {
  const facts = info?.facts ?? [];
  const firsts = facts.map((f) => (f.match(/^.*?[.!?](\s|$)/)?.[0] ?? f).trim()).filter((s) => s.length >= 24);
  const ok = firsts.filter((s) => s.length <= max).sort((a, b) => a.length - b.length);
  return ok[0] ?? (firsts[0] ? firsts[0].slice(0, max - 1).replace(/\s\S*$/, '') + '…' : '');
}

// What an animal likes, in plain words, with icon hints. `sp` is a SPECIES entry.
export function animalLikes(sp) {
  const chips = [];
  const mid = (sp.temp[0] + sp.temp[1]) / 2;
  const warm = mid >= 24 ? 'warm' : mid < 21 ? 'cool' : 'cosy';
  chips.push({ icon: warm === 'cool' ? 'snow' : 'sun', text: warm === 'cool' ? 'Cool' : warm === 'warm' ? 'Warm' : 'Cosy' });
  const aquatic = sp.kind === 'swim' || sp.kind === 'crawlWater' || sp.kind === 'axolotl';
  if (aquatic) chips.push({ icon: 'drop', text: 'Clean water' });
  else if (sp.humidity && sp.humidity >= 65) chips.push({ icon: 'rain', text: 'Damp air' });
  else chips.push({ icon: 'leaf', text: 'Hiding spots' });
  if (sp.school) chips.push({ icon: 'paw', text: 'Friends' });
  else chips.push({ icon: 'bowl', text: sp.eats?.includes('flake') ? 'Fish food' : 'Tasty bugs' });
  const damp = !aquatic && sp.humidity >= 65;
  const line = aquatic ? `I like it ${warm} and I love clean water.` : `I like it ${warm}${damp ? ' and damp' : ''}.`;
  return { line, chips };
}

export function plantLikes(sp) {
  const chips = [];
  const water = /aquatic|floating/.test(sp.habitat);
  const shade = sp.light <= 0.35;
  chips.push({ icon: shade ? 'cloud' : 'sun', text: shade ? 'Shade' : 'Sunshine' });
  chips.push(water ? { icon: 'drop', text: 'Water' } : { icon: 'rain', text: sp.humidity?.[0] >= 60 ? 'Damp air' : 'Fresh air' });
  const line = water ? `I like to live in the water${shade ? ' in the shade' : ''}.` : `I like ${shade ? 'shade' : 'sunshine'} and ${sp.humidity?.[0] >= 60 ? 'damp air' : 'fresh air'}.`;
  return { line, chips };
}
