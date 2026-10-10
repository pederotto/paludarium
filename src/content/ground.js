// Ground palettes: which texture each terrain slot wears in a tank of a given climate (the bottom of the tank, the stone of its
// background). The terrain material (render/shaders.js substrateMaterial) blends six slots by per-vertex weights; a palette swaps the
// pictures behind five of them (slot 4, the moss, is built in the shader). Textures live in public/assets/ground/: the first six are the
// original photos (Poly Haven, SeedThree), the others are baked from the generated landscape models' colour maps by tools/bake-ground.py.
// All 512 px and tileable, so a swap never changes a texture's size. A tank has one palette (`World.groundSet`, saved with it).
export const SLOTS = ['soil', 'sand', 'gravel', 'rock', 'moss', 'stone'];

export const GROUND_SETS = {
  // The game's own look since the start: forest soil, pebbles for sand, grey gravel, mossy rock, lichen stone.
  forest: { soil: 'forest_ground_04.jpg', sand: 'clean_pebbles.jpg', gravel: 'gravel.jpg', rock: 'mossy_rock.jpg', moss: 'moss.jpg', stone: 'lichen_rock.jpg' },
  // Cool temperate woods and ponds (beech, oak, paddy margins): the forest floor, pale river sand under the water.
  temperate: { sand: 'quartz_sand.jpg' },
  // Wet tropical forest floor: red-brown clay under the litter.
  tropical: { soil: 'red_earth.jpg', sand: 'quartz_sand.jpg' },
  // Sandy river and lake beds: dark mud, pale quartz sand, rounded stones.
  river: { soil: 'mud_dark.jpg', sand: 'quartz_sand.jpg', gravel: 'clean_pebbles.jpg', stone: 'darkrock.jpg' },
  // Tannin-dark water: black mud and the same pale sand; the stain is in the water.
  blackwater: { soil: 'mud_dark.jpg', sand: 'quartz_sand.jpg', gravel: 'clean_pebbles.jpg', stone: 'darkrock.jpg' },
  // Karst, caves, dry-stone slopes: thin pale scree over lime-poor earth.
  limestone: { soil: 'dry_earth.jpg', sand: 'quartz_sand.jpg', gravel: 'scree_limestone.jpg', rock: 'limestone.jpg', stone: 'darkrock.jpg' },
  // Hot dry country (waits for the arid climate profile): dust, sand, sandstone scree, red rock.
  arid: { soil: 'dry_earth.jpg', sand: 'desert_sand.jpg', gravel: 'scree_sandstone.jpg', rock: 'sandstone.jpg', stone: 'redrock.jpg' },
};

// Which palette a habitat gets (keys of content/biotopes.js). A biotope not listed wears the forest one.
export const BIOTOPE_GROUND = {
  newguinea: 'tropical', madagascar: 'tropical', suriname: 'tropical', costarica: 'tropical', bocas: 'tropical', cacao: 'tropical', bolivar: 'tropical', kerala: 'tropical', mataatlantica: 'tropical', choco: 'tropical',
  matano: 'river', xochimilco: 'river', sumatra: 'river', thai: 'river', shan: 'river', putumayo: 'river', araguaia: 'river', trinidad: 'river', tapajos: 'river', orinoco: 'river',
  blackwater: 'blackwater', java: 'blackwater',
  china: 'temperate', korea: 'temperate', cordoba: 'temperate', teutoburg: 'temperate', galicia: 'temperate', taiwan: 'temperate', satoyama: 'temperate',
  everglades: 'limestone', pacific: 'limestone', thaicave: 'limestone', liwu: 'limestone', mittelgebirge: 'limestone',
};
export const groundForBiotope = (biotope) => BIOTOPE_GROUND[biotope] ?? 'forest';

// The file of a slot in a palette: what the palette sets, else the forest one.
export const groundFile = (set, slot) => (GROUND_SETS[set] ?? GROUND_SETS.forest)[slot] ?? GROUND_SETS.forest[slot];
