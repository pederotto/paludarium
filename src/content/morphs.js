// Names, one-line blurbs, rarity and price for every colour "morph" an animal can show, plus the
// names of its genes. Pure data (no imports) so career code and Node tests can use it.
// The logic (alleles, which genotype shows which morph) is in sim/genetics.js; see docs/GENETICS_SPEC.md.
//
//   MORPHS[species][morphId] = { name, blurb, rarity (1 common … 5 very rare), price (× the species' buy price) }
//   LOCI_TEXT[species][locusIndex] = { name, traits: { allele: short word }, mixed?: word for an "in between" gene }
//
// Rarity drives the stars in the banner and the price: a rare morph costs (and sells for) more.

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
  guppy: {
    red: M('Red tail', 'A fiery red guppy.', 1),
    purple: M('Purple tail', 'Purple: a red gene and a blue gene blended together.', 2),
    blue: M('Blue tail', 'A cool blue guppy.', 2),
    gold: M('Gold', 'Shiny gold all over. The gold gene hides the tail colour.', 3),
  },
  betta: {
    red: M('Red', 'A classic red betta with flowing fins.', 1),
    purple: M('Purple', 'Purple fins: one red gene and one blue gene.', 2),
    blue: M('Blue', 'A deep blue betta.', 2),
    cellophane: M('Cellophane', 'Pale and see-through, like stained glass. Needs two cellophane genes.', 4),
  },
  shrimp: {
    wild: M('Wild brown', 'Clear brownish shrimp, hard to spot in the plants.', 1),
    red: M('Cherry red', 'The bright red pet shrimp everybody knows.', 1),
    yellow: M('Yellow', 'A sunny yellow shrimp.', 2),
    orange: M('Orange', 'Red and yellow genes together make a glowing orange.', 3),
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
  guppy: [
    { name: 'Tail colour gene', traits: { R: 'red', B: 'blue' }, mixed: 'purple (one of each)' },
    { name: 'Gold gene', traits: { G: 'normal', g: 'gold' } },
  ],
  betta: [
    { name: 'Fin colour gene', traits: { R: 'red', B: 'blue' }, mixed: 'purple (one of each)' },
    { name: 'Cellophane gene', traits: { X: 'normal', x: 'cellophane' } },
  ],
  shrimp: [
    { name: 'Red gene', traits: { W: 'wild brown', r: 'red' } },
    { name: 'Yellow gene', traits: { Y: 'normal', y: 'yellow' } },
  ],
};

// A colour to draw the morph with in the UI (dots and bars); the real look comes from the 3D body.
export const SWATCH = {
  axolotl: { wild: '#6b5a3a', leucistic: '#f2c6cd', golden: '#e6b935', melanoid: '#26252b', white_albino: '#f5eed9' },
  dartfrog: { cobalt_spotted: '#2f55c8', cobalt_clean: '#2a48b0', sky_spotted: '#72bdee', sky_clean: '#9bd3f5' },
  guppy: { red: '#e04a3f', purple: '#8e5bc4', blue: '#3f7fe0', gold: '#ebc23d' },
  betta: { red: '#d8323a', purple: '#8a4fc0', blue: '#2f5fd0', cellophane: '#e8edf0' },
  shrimp: { wild: '#9b8364', red: '#d8323a', yellow: '#eed23a', orange: '#f08a2c' },
};
export const swatch = (sp, morph) => SWATCH[sp]?.[morph] ?? '#999';

export const morphInfo = (sp, morph) => MORPHS[sp]?.[morph] ?? null;
export const morphName = (sp, morph) => MORPHS[sp]?.[morph]?.name ?? morph ?? '';
export const morphIds = (sp) => Object.keys(MORPHS[sp] ?? {});
// How much more (or less) a morph costs and sells for than the species' usual price.
export const morphFactor = (sp, morph) => MORPHS[sp]?.[morph]?.price ?? 1;
export const morphRarity = (sp, morph) => MORPHS[sp]?.[morph]?.rarity ?? 1;
export const stars = (rarity, max = 5) => '★'.repeat(rarity) + '☆'.repeat(Math.max(0, max - rarity));
