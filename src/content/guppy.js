// The fancy guppy's genes, strains and looks: pure data and pure functions (no imports), shared by the genetics logic
// (sim/genetics.js builds the guppy's loci from GUPPY_LOCI), the bodies (render/creatures/bodies/guppy.js draws a look id) and
// the UI (names, blurbs, rarity, swatches through content/morphs.js). Spec: docs/GENETICS_SPEC.md "guppy".
//
// What is real and what is game-simplified (sources in docs/GENETICS_SPEC.md):
//   real    the traits and their dominance as breeders use them: gold, blond-like gold and albino are autosomal recessive;
//           mosaic, snakeskin, half-black (tuxedo), Moscow, platinum and the swords are dominant; the big "dumbo" ear is
//           recessive; red and blue tails make purple; a big delta tail hides the swords; albino hides black (no half-black,
//           no Moscow body); almost all of a male's colour is sex-limited: females carry the genes and show little of them.
//   simple  every gene is autosomal here (in real guppies most colour genes ride on the X and Y chromosomes, passed father to
//           son); tail size is one in-between gene (delta, fan, round) where real tails are many genes and years of selection.
//
// A PHENOTYPE id (the strain a male shows; `animal.morph`) is a list of tokens joined by '_', in this order, defaults left out:
//   ground (gold | albino) · moscow · platinum · tuxedo · colour (red | purple | blue) · pattern (mosaic | snakeskin | tiger)
//   · tail (fan | round | doublesword | lyre; delta is the default) · dumbo
// so 'red' is a plain red delta, 'albino_red_dumbo' an albino full red with big ears, 'tuxedo_blue_mosaic_lyre' a half-black blue
// mosaic lyre. A LOOK id (which body a fish is drawn with) is a phenotype id for an adult male, 'female_<…>' for a female (only
// what a female shows, plus 'gravid' while she carries a brood) and 'juv_<ground>' for a fry or a young fish not yet coloured.

// The loci, in genotype order. mode: 'inc' (in-between: the two alleles blend, sorted alphabetically), 'rec' (the trait is the
// recessive second allele) or 'dom' (the trait is the dominant first allele; one copy shows it). freq: frequency of the second
// allele in a shop population (where a founder with no chosen strain draws its genes from).
export const GUPPY_LOCI = [
  { key: 'colour', name: 'Tail colour gene', mode: 'inc', alleles: ['B', 'R'], freqAllele: 'R', freq: 0.6, traits: { R: 'red', B: 'blue' }, mixed: 'purple (one of each)' },
  { key: 'gold', name: 'Gold gene', mode: 'rec', alleles: ['G', 'g'], freq: 0.1, traits: { G: 'normal', g: 'gold' } },
  { key: 'albino', name: 'Albino gene', mode: 'rec', alleles: ['A', 'a'], freq: 0.06, traits: { A: 'normal', a: 'albino' } },
  { key: 'size', name: 'Tail size gene', mode: 'inc', alleles: ['L', 'S'], freqAllele: 'L', freq: 0.7, traits: { L: 'big delta', S: 'small round' }, mixed: 'fan (one of each)' },
  { key: 'sword', name: 'Sword gene', mode: 'dom', alleles: ['W', 'w'], freq: 0.9, traits: { W: 'swords', w: 'no swords' } },
  { key: 'mosaic', name: 'Mosaic gene', mode: 'dom', alleles: ['M', 'm'], freq: 0.9, traits: { M: 'mosaic', m: 'plain' } },
  { key: 'snake', name: 'Snakeskin gene', mode: 'dom', alleles: ['K', 'k'], freq: 0.93, traits: { K: 'snakeskin', k: 'plain' } },
  { key: 'tuxedo', name: 'Half-black gene', mode: 'dom', alleles: ['T', 't'], freq: 0.92, traits: { T: 'half-black', t: 'normal' } },
  { key: 'moscow', name: 'Moscow gene', mode: 'dom', alleles: ['F', 'f'], freq: 0.95, traits: { F: 'Moscow (coloured body)', f: 'normal' } },
  { key: 'platinum', name: 'Platinum gene', mode: 'dom', alleles: ['P', 'p'], freq: 0.95, traits: { P: 'platinum head', p: 'normal' } },
  { key: 'dumbo', name: 'Big ear gene', mode: 'rec', alleles: ['E', 'e'], freq: 0.08, traits: { E: 'normal', e: 'big ears' } },
];
const L = Object.fromEntries(GUPPY_LOCI.map((l, i) => [l.key, i]));

export const GUPPY_COLOURS = ['red', 'purple', 'blue'];
export const GUPPY_TAILS = ['delta', 'fan', 'round', 'doublesword', 'lyre'];
const GROUNDS = ['gold', 'albino'], PATTERNS = ['mosaic', 'snakeskin', 'tiger'];

// Strains a dealer sells (the Animals tool and the shop): each a phenotype id. Founders of a strain get a genotype that shows it.
export const GUPPY_STRAINS = [
  'red', 'blue', 'purple', 'gold_red', 'gold_blue', 'albino_red', 'albino_purple', 'albino_blue', 'moscow_blue', 'moscow_purple',
  'tuxedo_red', 'tuxedo_blue', 'platinum_red', 'red_mosaic', 'blue_mosaic', 'purple_snakeskin', 'blue_tiger',
  'red_doublesword', 'blue_lyre', 'red_round', 'red_dumbo', 'albino_red_dumbo',
];

// ---- Genotype -> phenotype ------------------------------------------------------------------------------------------------
const two = (g, a) => g[0] === a && g[1] === a;
const has = (g, a) => g[0] === a || g[1] === a;

// The phenotype a genotype shows in a male, as an object.
export function guppyTraits(genes) {
  const g = (k) => genes[L[k]];
  const albino = two(g('albino'), 'a');
  const col = g('colour'), size = g('size');
  const sword = has(g('sword'), 'W'), mosaic = has(g('mosaic'), 'M'), snake = has(g('snake'), 'K');
  const len = size === 'LL' ? 'delta' : size === 'LS' ? 'fan' : 'round';
  return {
    ground: albino ? 'albino' : two(g('gold'), 'g') ? 'gold' : 'wild',
    colour: col === 'RR' ? 'red' : col === 'BB' ? 'blue' : 'purple',
    moscow: !albino && has(g('moscow'), 'F'),                       // albino: no melanin, no dark Moscow body
    platinum: has(g('platinum'), 'P'),
    tuxedo: !albino && has(g('tuxedo'), 'T'),                        // albino hides the black rear half
    pattern: mosaic && snake ? 'tiger' : mosaic ? 'mosaic' : snake ? 'snakeskin' : 'plain',
    tail: !sword || len === 'delta' ? len : len === 'fan' ? 'lyre' : 'doublesword',   // a big delta hides the swords
    dumbo: two(g('dumbo'), 'e'),
  };
}

export function guppyId(p) {
  const t = [];
  if (p.ground && p.ground !== 'wild') t.push(p.ground);
  if (p.moscow) t.push('moscow');
  if (p.platinum) t.push('platinum');
  if (p.tuxedo) t.push('tuxedo');
  t.push(p.colour);
  if (p.pattern && p.pattern !== 'plain') t.push(p.pattern);
  if (p.tail && p.tail !== 'delta') t.push(p.tail);
  if (p.dumbo) t.push('dumbo');
  return t.join('_');
}
export const guppyPhenotype = (genes) => guppyId(guppyTraits(genes));

// A phenotype id back to its traits; null when it is not one (wrong order, unknown token, no colour).
export function parseGuppy(id) {
  if (typeof id !== 'string' || !id) return null;
  const p = { ground: 'wild', colour: null, moscow: false, platinum: false, tuxedo: false, pattern: 'plain', tail: 'delta', dumbo: false };
  for (const t of id.split('_')) {
    if (GROUNDS.includes(t)) p.ground = t;
    else if (t === 'moscow') p.moscow = true;
    else if (t === 'platinum') p.platinum = true;
    else if (t === 'tuxedo') p.tuxedo = true;
    else if (GUPPY_COLOURS.includes(t)) p.colour = t;
    else if (PATTERNS.includes(t)) p.pattern = t;
    else if (GUPPY_TAILS.includes(t)) p.tail = t;
    else if (t === 'dumbo') p.dumbo = true;
    else return null;
  }
  if (!p.colour || guppyId(p) !== id) return null;              // canonical order only, so one strain has one id
  if (p.ground === 'albino' && (p.moscow || p.tuxedo)) return null; // never shown (albino hides them)
  return p;
}

// ---- Looks: what a fish is drawn as ----------------------------------------------------------------------------------------
// A female shows her ground colour, a soft wash of her line's tail colour, the half-black rear (tuxedo females are half black
// too) and big ears, and her tail is bigger in a big-tailed line; she never shows swords, mosaic, snakeskin, Moscow or platinum.
// A fry and a young fish before it matures are greyish and see-through (or gold, or pink-white albino) in either sex.
export function guppyLook(morph, { female = false, adult = true, gravid = false } = {}) {
  const p = parseGuppy(morph) ?? parseGuppy('red');
  if (!adult) return `juv${p.ground !== 'wild' ? '_' + p.ground : ''}`;
  if (!female) return guppyId(p);
  const t = ['female'];
  if (p.ground !== 'wild') t.push(p.ground);
  if (p.tuxedo) t.push('tuxedo');
  t.push(p.colour);
  const size = p.tail === 'delta' ? 'delta' : p.tail === 'fan' || p.tail === 'lyre' ? 'fan' : 'round';
  if (size !== 'delta') t.push(size);
  if (p.dumbo) t.push('dumbo');
  if (gravid) t.push('gravid');
  return t.join('_');
}

// A look id back to { sex: 'male' | 'female' | 'juv', gravid, ...traits }; null when it is not one.
export function parseGuppyLook(key) {
  if (typeof key !== 'string') return null;
  if (key === 'juv' || key.startsWith('juv_')) {
    const g = key.slice(4);
    if (g && !GROUNDS.includes(g)) return null;
    return { sex: 'juv', ground: g || 'wild', colour: 'red', moscow: false, platinum: false, tuxedo: false, pattern: 'plain', tail: 'round', dumbo: false, gravid: false };
  }
  if (key.startsWith('female_')) {
    let rest = key.slice(7).split('_');
    const gravid = rest[rest.length - 1] === 'gravid';
    if (gravid) rest = rest.slice(0, -1);
    const p = parseGuppy(rest.join('_'));
    if (!p || p.moscow || p.platinum || p.pattern !== 'plain' || p.tail === 'doublesword' || p.tail === 'lyre') return null;
    return { sex: 'female', gravid, ...p };
  }
  const p = parseGuppy(key);
  return p ? { sex: 'male', gravid: false, ...p } : null;
}

// ---- Words, rarity, colour --------------------------------------------------------------------------------------------------
const TAIL_WORD = { delta: 'delta', fan: 'fan tail', round: 'round tail', doublesword: 'double sword', lyre: 'lyre tail' };
export function guppyName(id) {
  const p = parseGuppy(id);
  if (!p) return id ?? '';
  const w = [];
  if (p.ground === 'gold') w.push('gold');
  if (p.ground === 'albino') w.push(p.colour === 'red' && !p.dumbo && p.pattern === 'plain' ? 'albino full' : 'albino');
  if (p.moscow) w.push('Moscow');
  if (p.platinum) w.push('platinum');
  if (p.tuxedo) w.push('half-black');
  w.push(p.ground === 'albino' && p.colour === 'purple' ? 'pink' : p.colour);
  if (p.pattern !== 'plain') w.push(p.pattern);
  w.push(TAIL_WORD[p.tail]);
  const s = w.join(' ') + (p.dumbo ? ', big ear' : '');
  return s[0].toUpperCase() + s.slice(1);
}

export function guppyBlurb(id) {
  const p = parseGuppy(id);
  if (!p) return '';
  const tail = { delta: 'a broad delta tail', fan: 'a fan tail', round: 'a small round tail', doublesword: 'two long swords', lyre: 'a lyre tail with long tips' }[p.tail];
  const s = [];
  s.push(p.ground === 'albino' ? `Albino with red eyes, ${p.colour === 'purple' ? 'pink' : p.colour === 'blue' ? 'pale sky blue' : 'a bright red'} tail` : `${p.ground === 'gold' ? 'Gold body, ' : ''}${p.colour} tail`);
  if (p.moscow) s.push('a dark velvet body');
  if (p.platinum) s.push('a white metal head');
  if (p.tuxedo) s.push('a black rear half');
  if (p.pattern === 'mosaic') s.push('dark mosaic on the tail');
  if (p.pattern === 'snakeskin') s.push('a snakeskin chain on the body and lace on the tail');
  if (p.pattern === 'tiger') s.push('snakeskin body, mosaic tail');
  s.push(tail);
  if (p.dumbo) s.push('huge pectoral fins');
  const out = s.join(', ') + '.';
  return out.length < 138 ? out : out.slice(0, 134) + '...';
}

// How hard a strain is to come by (1 common … 5 very rare): rare genes and stacks of them score higher.
const SCORE = { blue: 1, purple: 1, gold: 2, albino: 3, moscow: 2, platinum: 2, tuxedo: 1, mosaic: 1, snakeskin: 2, tiger: 3, round: 1, doublesword: 2, lyre: 3, dumbo: 2 };
export function guppyRarity(id) {
  const p = parseGuppy(id);
  if (!p) return 1;
  let s = (SCORE[p.colour] ?? 0) + (SCORE[p.ground] ?? 0) + (SCORE[p.pattern] ?? 0) + (SCORE[p.tail] ?? 0);
  if (p.moscow) s += SCORE.moscow;
  if (p.platinum) s += SCORE.platinum;
  if (p.tuxedo) s += SCORE.tuxedo;
  if (p.dumbo) s += SCORE.dumbo;
  return Math.min(5, 1 + Math.ceil(s / 2));
}

// Tail and body colours as sRGB hex, read off the owner's two reference sheets (.agents/refs/guppy-1007: the Casa Dupeixe strain
// poster and the Encyclo-Fish shapes / patterns / colours sheet). Albino keeps the red pigment (erythrophores) and loses the black,
// so its blue turns pale sky blue and its purple pink.
export const GUPPY_HEX = {
  red: { tail: [0xff6a1a, 0xe8201c, 0xb80f18], body: 0xe84a28 },
  purple: { tail: [0xc070f0, 0x8c3cd8, 0x5c1ea8], body: 0x7a40c0 },
  blue: { tail: [0x58c8ff, 0x2a78f0, 0x1838b8], body: 0x2a6ad8 },
  albinoBlue: { tail: [0xc8ecff, 0x8cccf8, 0x5aa8ec], body: 0xa8d8f4 },
  albinoPurple: { tail: [0xffb8d8, 0xf070b0, 0xd0408c], body: 0xf0a0c8 },
};
export function guppySwatch(id) {
  const p = parseGuppy(id);
  if (!p) return '#999';
  const k = p.ground === 'albino' && p.colour !== 'red' ? (p.colour === 'blue' ? 'albinoBlue' : 'albinoPurple') : p.colour;
  const h = GUPPY_HEX[k].tail[1];
  return '#' + (p.moscow ? ((h >> 1) & 0x7f7f7f) : h).toString(16).padStart(6, '0');
}
