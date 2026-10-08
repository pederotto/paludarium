// Names, one-line blurbs, rarity and price for every colour "morph" an animal can show, plus the
// names of its genes. Pure data (only content/guppy.js, itself pure) so career code and Node tests can use it.
// The logic (alleles, which genotype shows which morph) is in sim/genetics.js; see docs/GENETICS_SPEC.md.
//
//   MORPHS[species][morphId] = { name, blurb, rarity (1 common … 5 very rare), price (× the species' buy price) }
//   LOCI_TEXT[species][locusIndex] = { name, traits: { allele: short word }, mixed?: word for an "in between" gene }
//
// Rarity drives the stars in the banner and the price: a rare morph costs (and sells for) more.
//
// The guppy's morphs are strains made of many genes (content/guppy.js): MORPHS.guppy lists the strains a dealer sells, and
// morphInfo / morphName / morphRarity / swatch work out any other strain a tank breeds from its id.
import { GUPPY_STRAINS, GUPPY_LOCI, parseGuppy, guppyName, guppyBlurb, guppyRarity, guppySwatch } from './guppy.js';

export const RARITY_PRICE = { 1: 1, 2: 1.5, 3: 2.5, 4: 4, 5: 6 };
const M = (name, blurb, rarity) => ({ name, blurb, rarity, price: RARITY_PRICE[rarity] });

export const MORPHS = {
  axolotl: {
    wild: M('Wild-type', 'Dark olive-brown with gold speckles, like axolotls in the lakes of Mexico.', 1),
    leucistic: M('Leucistic', 'Pink-white with red feathery gills and dark eyes: the classic pet axolotl.', 2),
    golden: M('Golden albino', 'Golden yellow with pale pink eyes. It has no dark colour at all.', 3),
    melanoid: M('Melanoid', 'Dark as night, with no shiny speckles anywhere.', 3),
    white_albino: M('White albino', 'Cream-white with pink eyes and pale gills. Very rare: it needs two double-recessive genes.', 4),
  },
  dartfrog: {
    cobalt_spotted: M('Cobalt, many spots', 'Deep blue with lots of black spots, like the wild frogs.', 1),
    cobalt_clean: M('Cobalt, few spots', 'Deep blue with hardly any spots.', 2),
    sky_spotted: M('Sky blue, many spots', 'A pale sky-blue frog with bold black spots.', 2),
    sky_clean: M('Sky blue, few spots', 'Pale sky blue and almost spotless. A real prize.', 4),
  },
  guppy: {},          // filled from GUPPY_STRAINS below
  betta: {
    red: M('Red', 'A classic red betta with flowing fins.', 1),
    purple: M('Purple', 'Purple fins: one red gene and one blue gene.', 2),
    blue: M('Blue', 'A deep blue betta.', 2),
    cellophane: M('Cellophane', 'Pale and see-through, like stained glass. Needs two cellophane genes.', 4),
  },
  shrimp: {
    wild: M('Wild brown', 'Clear brownish shrimp with dark speckles, hard to spot in the plants: what the colour lines go back to.', 1),
    red: M('Cherry red', 'The bright red pet shrimp everybody knows. Two red genes.', 1),
    yellow: M('Yellow', 'A sunny yellow shrimp with a golden back. Two yellow genes.', 2),
    orange: M('Orange', 'Red and yellow genes together make a glowing orange.', 3),
    blue: M('Blue', 'A deep blue shrimp. Two blue genes.', 2),
    green: M('Green jade', 'Yellow and blue genes together make a jade green.', 3),
    chocolate: M('Chocolate', 'Red and blue genes together make a dark chocolate brown.', 3),
    black: M('Black rose', 'All three colour genes at once: nearly black, with a glassy shine.', 4),
    red_rili: M('Red rili', 'Red at the head and tail with a clear band across the middle: one rili gene is enough.', 2),
    yellow_rili: M('Yellow rili', 'Yellow with a clear band across the middle.', 3),
    orange_rili: M('Orange rili', 'Orange with a clear band across the middle.', 4),
    blue_rili: M('Blue rili', 'Blue with a clear band across the middle.', 3),
    green_rili: M('Green rili', 'Jade green with a clear band across the middle.', 4),
    chocolate_rili: M('Chocolate rili', 'Chocolate with a clear band across the middle.', 4),
    black_rili: M('Carbon rili', 'Black with a clear band across the middle. Four genes have to line up.', 5),
  },
};

export const LOCI_TEXT = {
  axolotl: [
    { name: 'Albino gene', traits: { A: 'normal', a: 'albino' } },
    { name: 'Melanoid gene', traits: { M: 'normal', m: 'melanoid' } },
    { name: 'Leucistic gene', traits: { L: 'normal', l: 'leucistic' } },
  ],
  dartfrog: [
    { name: 'Blue shade gene', traits: { B: 'cobalt', b: 'sky blue' } },
    { name: 'Spot gene', traits: { S: 'many spots', s: 'few spots' } },
  ],
  guppy: GUPPY_LOCI.map(({ name, traits, mixed }) => (mixed ? { name, traits, mixed } : { name, traits })),
  betta: [
    { name: 'Fin colour gene', traits: { R: 'red', B: 'blue' }, mixed: 'purple (one of each)' },
    { name: 'Cellophane gene', traits: { X: 'normal', x: 'cellophane' } },
  ],
  shrimp: [
    { name: 'Red gene', traits: { W: 'wild brown', r: 'red' } },
    { name: 'Yellow gene', traits: { Y: 'normal', y: 'yellow' } },
    { name: 'Blue gene', traits: { B: 'normal', b: 'blue' } },
    { name: 'Rili gene', traits: { L: 'rili (clear band)', l: 'solid' } },
  ],
};

// A colour to draw the morph with in the UI (dots and bars); the real look comes from the 3D body.
export const SWATCH = {
  axolotl: { wild: '#6b5a3a', leucistic: '#f2c6cd', golden: '#e6b935', melanoid: '#26252b', white_albino: '#f5eed9' },
  dartfrog: { cobalt_spotted: '#2f55c8', cobalt_clean: '#2a48b0', sky_spotted: '#72bdee', sky_clean: '#9bd3f5' },
  betta: { red: '#d8323a', purple: '#8a4fc0', blue: '#2f5fd0', cellophane: '#e8edf0' },
  shrimp: { wild: '#9b8364', red: '#d8323a', yellow: '#eed23a', orange: '#f08a2c', blue: '#2f5fd0', green: '#3f9a5a', chocolate: '#5a3424', black: '#1c1a22',
    red_rili: '#e8868a', yellow_rili: '#f2e08a', orange_rili: '#f4b07a', blue_rili: '#8aa8e8', green_rili: '#8ac49a', chocolate_rili: '#9a7a6a', black_rili: '#6a6872' },
};

// How a dwarf shrimp's colour line is drawn (render/creatures/material.js `palette`): `base` the pigment on the flanks, `deep` the
// pigment on the back, `glass` the unpigmented shell (clear, faintly tinted), as sRGB hex; a rili line (`_rili`) has the same colours
// with the middle of the body cleared to glass.
export const SHRIMP_PALETTE = {
  wild: { base: 0x7d7255, deep: 0x3f3a26, glass: 0xd8dccc },
  red: { base: 0xc0141c, deep: 0x7a0a12, glass: 0xf0c8c0 },
  yellow: { base: 0xe8b00c, deep: 0xb07800, glass: 0xfff0c4 },
  orange: { base: 0xec5a10, deep: 0xa83206, glass: 0xffdcc4 },
  blue: { base: 0x1d44b8, deep: 0x0c1f6e, glass: 0xc8d6f2 },
  green: { base: 0x2f8a3e, deep: 0x14502a, glass: 0xd2ecd4 },
  chocolate: { base: 0x5a2c1a, deep: 0x2e140a, glass: 0xe0cfc4 },
  black: { base: 0x1c1a24, deep: 0x08080c, glass: 0xc8ccd4 },
};
export const shrimpPalette = (morph = 'red') => {
  const rili = /_rili$/.test(morph ?? '');
  return { ...(SHRIMP_PALETTE[(morph ?? 'red').replace(/_rili$/, '')] ?? SHRIMP_PALETTE.red), rili };
};
const guppyInfo = (id) => (parseGuppy(id) ? M(guppyName(id), guppyBlurb(id), guppyRarity(id)) : null);
for (const id of GUPPY_STRAINS) MORPHS.guppy[id] = guppyInfo(id);
const GUPPY_INFO = new Map();
const info = (sp, morph) => {
  const m = MORPHS[sp]?.[morph];
  if (m || sp !== 'guppy' || !morph) return m ?? null;
  if (!GUPPY_INFO.has(morph)) GUPPY_INFO.set(morph, guppyInfo(morph));
  return GUPPY_INFO.get(morph);
};
export const swatch = (sp, morph) => (sp === 'guppy' ? guppySwatch(morph) : SWATCH[sp]?.[morph] ?? '#999');

export const morphInfo = (sp, morph) => info(sp, morph);
export const morphName = (sp, morph) => info(sp, morph)?.name ?? morph ?? '';
export const morphIds = (sp) => Object.keys(MORPHS[sp] ?? {});
// How much more (or less) a morph costs and sells for than the species' usual price.
export const morphFactor = (sp, morph) => info(sp, morph)?.price ?? 1;
export const morphRarity = (sp, morph) => info(sp, morph)?.rarity ?? 1;
export const stars = (rarity, max = 5) => '★'.repeat(rarity) + '☆'.repeat(Math.max(0, max - rarity));
