// The fancy guppy's genes, strains and looks: pure data and pure functions (no imports), shared by the genetics logic
// (sim/genetics.js builds the guppy's loci from GUPPY_LOCI), the bodies (render/creatures/bodies/guppy.js draws a look id) and
// the UI (names, blurbs, rarity, swatches through content/morphs.js). Spec: docs/GENETICS_SPEC.md "guppy".
//
// What is real and what is game-simplified (sources in docs/GENETICS_SPEC.md):
//   real    the traits and their dominance as breeders use them: gold, blond-like gold and albino are autosomal recessive;
//           mosaic, snakeskin, half-black (tuxedo), Moscow, platinum and the swords are dominant; the big "dumbo" ear is
//           recessive; red and blue tails make purple; a big delta tail hides the swords; albino hides black (no half-black,
//           no Moscow body); almost all of a male's colour is sex-limited: females carry the genes and show little of them.
//   real    (7 Oct, the owner's reference aquajocund.com/guppy-genetics-chart) the sex chromosomes: Moscow, the swords, snakeskin,
//           platinum and Japan blue ride on the Y (father to son, never through a female); mosaic, grass, half-black and neon on the X
//           (a daughter carries her father's, a son's come from his mother); ground colours and the rest are ordinary genes.
//   simple  the tail colour gene is an ordinary gene here, so red x blue still gives purple; tail shape is five genes (size, two
//           swords, point, flag) where real tails are many genes and years of selection; ribbon males cannot sire (real).
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
  { key: 'sword', name: 'Top sword gene', link: 'y', mode: 'dom', alleles: ['W', 'w'], freq: 0.9, traits: { W: 'swords', w: 'no swords' } },
  { key: 'mosaic', name: 'Mosaic gene', link: 'x', mode: 'dom', alleles: ['M', 'm'], freq: 0.9, traits: { M: 'mosaic', m: 'plain' } },
  { key: 'snake', name: 'Snakeskin gene', link: 'y', mode: 'dom', alleles: ['K', 'k'], freq: 0.93, traits: { K: 'snakeskin', k: 'plain' } },
  { key: 'tuxedo', name: 'Half-black gene', link: 'x', mode: 'dom', alleles: ['T', 't'], freq: 0.92, traits: { T: 'half-black', t: 'normal' } },
  { key: 'moscow', name: 'Moscow gene', link: 'y', mode: 'dom', alleles: ['F', 'f'], freq: 0.95, traits: { F: 'Moscow (coloured body)', f: 'normal' } },
  { key: 'platinum', name: 'Platinum gene', link: 'y', mode: 'dom', alleles: ['P', 'p'], freq: 0.95, traits: { P: 'platinum head', p: 'normal' } },
  { key: 'dumbo', name: 'Big ear gene', mode: 'rec', alleles: ['E', 'e'], freq: 0.08, traits: { E: 'normal', e: 'big ears' } },
  // added 7 Oct 2026 from the owner's photos (black, yellow cobra, white lyretail, Japan blue red sword):
  { key: 'yellow', name: 'Yellow gene', mode: 'rec', alleles: ['Y', 'y'], freq: 0.15, traits: { Y: 'normal', y: 'yellow (no red)' } },
  { key: 'white', name: 'White tail gene', mode: 'rec', alleles: ['V', 'v'], freq: 0.12, traits: { V: 'normal', v: 'white tail' } },
  { key: 'black', name: 'Black gene', mode: 'dom', alleles: ['N', 'n'], freq: 0.95, traits: { N: 'black fins', n: 'normal' } },
  { key: 'leopard', name: 'Leopard gene', mode: 'dom', alleles: ['D', 'd'], freq: 0.92, traits: { D: 'leopard spots', d: 'plain' } },
  { key: 'grass', name: 'Grass gene', link: 'x', mode: 'dom', alleles: ['Q', 'q'], freq: 0.9, traits: { Q: 'grass dots', q: 'plain' } },
  { key: 'japan', name: 'Japan blue gene', link: 'y', mode: 'dom', alleles: ['J', 'j'], freq: 0.93, traits: { J: 'Japan blue body', j: 'normal' } },
  { key: 'neon', name: 'Neon gene', link: 'x', mode: 'dom', alleles: ['O', 'o'], freq: 0.94, traits: { O: 'neon band', o: 'normal' } },
  // fin genes (7 Oct, owner: "remember fin genes and the different fins combinations"; the Encyclo-Fish sheet's twelve tails)
  { key: 'sword2', name: 'Bottom sword gene', link: 'y', mode: 'dom', alleles: ['U', 'u'], freq: 0.9, traits: { U: 'bottom sword', u: 'none' } },
  { key: 'point', name: 'Pointed tail gene', mode: 'dom', alleles: ['C', 'c'], freq: 0.9, traits: { C: 'pointed tail', c: 'normal' } },
  { key: 'flag', name: 'Flag tail gene', mode: 'rec', alleles: ['H', 'h'], freq: 0.12, traits: { H: 'normal', h: 'straight edges' } },
  { key: 'ribbon', name: 'Ribbon gene', mode: 'dom', alleles: ['I', 'i'], freq: 0.95, traits: { I: 'ribbon fins (males cannot sire)', i: 'normal' } },
  { key: 'swallow', name: 'Swallow gene', mode: 'rec', alleles: ['Z', 'z'], freq: 0.1, traits: { Z: 'normal', z: 'swallow (long fins)' } },
  // sex chromosomes, always the last gene: XX a female, XY a male (sim/genetics.js 'Sex chromosomes')
  { key: 'sex', name: 'Sex chromosomes', mode: 'sex', alleles: ['X', 'Y'], traits: { X: 'X', Y: 'Y' } },
];
const L = Object.fromEntries(GUPPY_LOCI.map((l, i) => [l.key, i]));

// Tail colours: the tail colour gene's red, purple and blue; the yellow gene takes the red out (yellow, lime, green); the white gene
// takes all colour out (white; with yellow: pastel); the black gene blackens the fins (with Moscow: a full black fish).
export const GUPPY_COLOURS = ['red', 'purple', 'blue', 'yellow', 'lime', 'green', 'white', 'pastel', 'black'];
// The twelve tails of the Encyclo-Fish sheet: tail size (LL long, LS medium, SS short) with the swords, the point and the flag gene.
export const GUPPY_TAILS = ['delta', 'veil', 'flag', 'fan', 'spade', 'lyre', 'topsword', 'bottomsword', 'round', 'spear', 'pin', 'doublesword'];
// How to breed each tail (the breeding guide, ui/panels/widgets.jsx; tests/genetics.test.mjs checks every recipe against guppyTraits):
// tail size L/S (LL long, LS medium, SS short), the top and bottom sword genes (on the Y: from the father), the pointed tail gene (one
// copy) and the flag gene (two copies).
export const GUPPY_TAIL_RECIPES = [
  { tail: 'delta', size: 'LL', recipe: 'long (LL); not pointed, no flag' },
  { tail: 'veil', size: 'LL', point: true, recipe: 'long (LL) + pointed (C)' },
  { tail: 'flag', size: 'LL', flag: true, recipe: 'long (LL) + flag (hh)' },
  { tail: 'fan', size: 'LS', recipe: 'medium (LS); no swords, not pointed' },
  { tail: 'spade', size: 'LS', point: true, recipe: 'medium (LS) + pointed (C)' },
  { tail: 'lyre', size: 'LS', top: true, bottom: true, recipe: 'medium (LS) + top sword (W) + bottom sword (U)' },
  { tail: 'round', size: 'SS', recipe: 'short (SS); no swords, not pointed' },
  { tail: 'spear', size: 'SS', point: true, recipe: 'short (SS) + pointed (C)' },
  { tail: 'pin', size: 'SS', point: true, flag: true, recipe: 'short (SS) + pointed (C) + flag (hh)' },
  { tail: 'topsword', size: 'SS', top: true, recipe: 'short or medium + top sword (W) only' },
  { tail: 'bottomsword', size: 'SS', bottom: true, recipe: 'short or medium + bottom sword (U) only' },
  { tail: 'doublesword', size: 'SS', top: true, bottom: true, recipe: 'short (SS) + top sword (W) + bottom sword (U)' },
];
// A genotype (as content/guppy.js orders the genes) that makes a recipe, everything else plain: for the guide and its test.
export function guppyRecipeGenes(r) {
  const g = GUPPY_LOCI.map((l) => (l.mode === 'sex' ? 'XY' : l.mode === 'rec' ? l.alleles[0].repeat(2) : l.mode === 'inc' ? l.alleles[1].repeat(2) : l.link === 'y' ? '-' + l.alleles[1] : l.link === 'x' ? l.alleles[1] + '-' : l.alleles[1].repeat(2)));
  g[L.colour] = 'RR'; g[L.size] = r.size;
  if (r.top) g[L.sword] = '-W';
  if (r.bottom) g[L.sword2] = '-U';
  if (r.point) g[L.point] = 'Cc';
  if (r.flag) g[L.flag] = 'hh';
  return g;
}
const GROUNDS = ['gold', 'albino'], PATTERNS = ['mosaic', 'snakeskin', 'tiger', 'leopard', 'cobra', 'grass'];

// Strains a dealer sells (the Animals tool and the shop): each a phenotype id. Founders of a strain get a genotype that shows it.
export const GUPPY_STRAINS = [
  'red', 'blue', 'purple', 'gold_red', 'gold_blue', 'albino_red', 'albino_purple', 'albino_blue', 'moscow_blue', 'moscow_purple',
  'tuxedo_red', 'tuxedo_blue', 'platinum_red', 'red_mosaic', 'blue_mosaic', 'purple_snakeskin', 'blue_tiger',
  'red_doublesword', 'blue_lyre', 'red_round', 'red_dumbo', 'albino_red_dumbo',
  'yellow', 'green', 'white', 'black', 'moscow_black', 'red_leopard', 'yellow_cobra', 'blue_grass', 'japan_red', 'neon_red',
  'platinum_yellow', 'tuxedo_yellow', 'tuxedo_pastel', 'albino_platinum_white', 'japan_red_doublesword', 'white_lyre',
  'blue_veil', 'red_flag', 'red_spade', 'yellow_topsword', 'albino_red_bottomsword', 'blue_spear', 'red_pin', 'yellow_leopard_veil_ribbon', 'black_swallow',
];

// ---- Genotype -> phenotype ------------------------------------------------------------------------------------------------
const two = (g, a) => g[0] === a && g[1] === a;
const has = (g, a) => g[0] === a || g[1] === a;

// The phenotype a genotype shows in a male, as an object.
export function guppyTraits(genes) {
  const g = (k) => genes[L[k]] ?? (GUPPY_LOCI[L[k]].mode === 'rec' ? GUPPY_LOCI[L[k]].alleles[0].repeat(2) : GUPPY_LOCI[L[k]].alleles[1].repeat(2));
  const albino = two(g('albino'), 'a');
  const col = g('colour'), size = g('size');
  const top = has(g('sword'), 'W'), bottom = has(g('sword2'), 'U'), point = has(g('point'), 'C'), flag = two(g('flag'), 'h');
  const mosaic = has(g('mosaic'), 'M'), snake = has(g('snake'), 'K');
  const leopard = has(g('leopard'), 'D'), grass = has(g('grass'), 'Q');
  const yellow = two(g('yellow'), 'y'), white = two(g('white'), 'v'), black = !albino && has(g('black'), 'N');   // albino: no black
  // long tails hide the swords; a medium tail with both swords is a lyre, a short one a double sword; one sword shows alone
  const tail = size === 'LL' ? (flag ? 'flag' : point ? 'veil' : 'delta')
    : top && bottom ? (size === 'LS' ? 'lyre' : 'doublesword') : top ? 'topsword' : bottom ? 'bottomsword'
      : size === 'LS' ? (point ? 'spade' : 'fan') : point ? (flag ? 'pin' : 'spear') : 'round';
  const base = col === 'RR' ? 'red' : col === 'BB' ? 'blue' : 'purple';
  const colour = black ? 'black' : white ? (yellow ? 'pastel' : 'white') : yellow ? { red: 'yellow', purple: 'lime', blue: 'green' }[base] : base;
  return {
    ground: albino ? 'albino' : two(g('gold'), 'g') ? 'gold' : 'wild',
    colour,
    moscow: !albino && has(g('moscow'), 'F'),                       // albino: no melanin, no dark Moscow body
    platinum: has(g('platinum'), 'P'),
    japan: has(g('japan'), 'J'),
    neon: has(g('neon'), 'O'),
    tuxedo: !albino && has(g('tuxedo'), 'T'),                        // albino hides the black rear half
    // snakeskin with leopard is cobra, with mosaic tiger; leopard hides mosaic and grass, mosaic and snakeskin hide grass
    pattern: snake && leopard ? 'cobra' : snake && mosaic ? 'tiger' : snake ? 'snakeskin' : leopard ? 'leopard' : mosaic ? 'mosaic' : grass ? 'grass' : 'plain',
    tail,
    dumbo: two(g('dumbo'), 'e'),
    ribbon: has(g('ribbon'), 'I'),
    swallow: two(g('swallow'), 'z'),
  };
}

export function guppyId(p) {
  const t = [];
  if (p.ground && p.ground !== 'wild') t.push(p.ground);
  if (p.moscow) t.push('moscow');
  if (p.platinum) t.push('platinum');
  if (p.japan) t.push('japan');
  if (p.neon) t.push('neon');
  if (p.tuxedo) t.push('tuxedo');
  t.push(p.colour);
  if (p.pattern && p.pattern !== 'plain') t.push(p.pattern);
  if (p.tail && p.tail !== 'delta') t.push(p.tail);
  if (p.ribbon) t.push('ribbon');
  if (p.swallow) t.push('swallow');
  if (p.dumbo) t.push('dumbo');
  return t.join('_');
}
export const guppyPhenotype = (genes) => guppyId(guppyTraits(genes));

// A phenotype id back to its traits; null when it is not one (wrong order, unknown token, no colour).
export function parseGuppy(id) {
  if (typeof id !== 'string' || !id) return null;
  const p = { ground: 'wild', colour: null, moscow: false, platinum: false, japan: false, neon: false, tuxedo: false, pattern: 'plain', tail: 'delta', dumbo: false, ribbon: false, swallow: false };
  for (const t of id.split('_')) {
    if (GROUNDS.includes(t)) p.ground = t;
    else if (t === 'moscow') p.moscow = true;
    else if (t === 'platinum') p.platinum = true;
    else if (t === 'tuxedo') p.tuxedo = true;
    else if (t === 'japan') p.japan = true;
    else if (t === 'neon') p.neon = true;
    else if (GUPPY_COLOURS.includes(t)) p.colour = t;
    else if (PATTERNS.includes(t)) p.pattern = t;
    else if (GUPPY_TAILS.includes(t)) p.tail = t;
    else if (t === 'dumbo') p.dumbo = true;
    else if (t === 'ribbon') p.ribbon = true;
    else if (t === 'swallow') p.swallow = true;
    else return null;
  }
  if (!p.colour || guppyId(p) !== id) return null;              // canonical order only, so one strain has one id
  if (p.ground === 'albino' && (p.moscow || p.tuxedo || p.colour === 'black')) return null; // never shown (albino hides them)
  return p;
}

// ---- Looks: what a fish is drawn as ----------------------------------------------------------------------------------------
// A female shows her ground colour, a soft wash of her line's tail colour, the half-black rear (tuxedo females are half black
// too) and big ears, and her tail is bigger in a big-tailed line; she never shows swords, patterns, Moscow, platinum, Japan blue or neon.
// A fry and a young fish before it matures are greyish and see-through (or gold, or pink-white albino) in either sex.
// A tail's size class (the size gene): what a female of that line shows and which of the drawn tails stands in for it.
export const tailSize = (tail) => (['delta', 'veil', 'flag'].includes(tail) ? 'delta' : ['fan', 'spade', 'lyre', 'topsword', 'bottomsword'].includes(tail) ? 'fan' : 'round');
export function guppyLook(morph, { female = false, adult = true, gravid = false } = {}) {
  const p = parseGuppy(morph) ?? parseGuppy('red');
  if (!adult) return `juv${p.ground !== 'wild' ? '_' + p.ground : ''}`;
  if (!female) return guppyId(p);
  const t = ['female'];
  if (p.ground !== 'wild') t.push(p.ground);
  if (p.tuxedo) t.push('tuxedo');
  t.push(p.colour);
  const size = tailSize(p.tail);
  if (size !== 'delta') t.push(size);
  if (p.swallow) t.push('swallow');
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
    return { sex: 'juv', ground: g || 'wild', colour: 'red', moscow: false, platinum: false, japan: false, neon: false, tuxedo: false, pattern: 'plain', tail: 'round', dumbo: false, ribbon: false, swallow: false, gravid: false };
  }
  if (key.startsWith('female_')) {
    let rest = key.slice(7).split('_');
    const gravid = rest[rest.length - 1] === 'gravid';
    if (gravid) rest = rest.slice(0, -1);
    const p = parseGuppy(rest.join('_'));
    if (!p || p.moscow || p.platinum || p.japan || p.neon || p.ribbon || p.pattern !== 'plain' || !['delta', 'fan', 'round'].includes(p.tail)) return null;
    return { sex: 'female', gravid, ...p };
  }
  const p = parseGuppy(key);
  return p ? { sex: 'male', gravid: false, ...p } : null;
}

// ---- Words, rarity, colour --------------------------------------------------------------------------------------------------
const TAIL_WORD = { delta: 'delta', veil: 'veil tail', flag: 'flag tail', fan: 'fan tail', spade: 'spade tail', lyre: 'lyre tail', topsword: 'top sword',
  bottomsword: 'bottom sword', round: 'round tail', spear: 'spear tail', pin: 'pin tail', doublesword: 'double sword' };
export function guppyName(id) {
  const p = parseGuppy(id);
  if (!p) return id ?? '';
  const w = [];
  if (p.ground === 'gold') w.push('gold');
  if (p.ground === 'albino') w.push(p.colour === 'red' && !p.dumbo && p.pattern === 'plain' ? 'albino full' : 'albino');
  if (p.moscow && p.colour !== 'black') w.push('Moscow');
  if (p.platinum) w.push('platinum');
  if (p.japan) w.push('Japan blue');
  if (p.neon) w.push('neon');
  if (p.tuxedo) w.push('half-black');
  w.push(p.ground === 'albino' && p.colour === 'purple' ? 'pink' : p.colour === 'black' && p.moscow ? 'full black' : p.colour);
  if (p.pattern !== 'plain') w.push(p.pattern);
  w.push(TAIL_WORD[p.tail]);
  const s = w.join(' ') + (p.ribbon ? ', ribbon' : '') + (p.swallow ? ', swallow' : '') + (p.dumbo ? ', big ear' : '');
  return s[0].toUpperCase() + s.slice(1);
}

export function guppyBlurb(id) {
  const p = parseGuppy(id);
  if (!p) return '';
  const tail = { delta: 'a broad delta tail', veil: 'a long veil tail', flag: 'a square flag tail', fan: 'a fan tail', spade: 'a spade tail', lyre: 'a lyre tail with long tips',
    topsword: 'a top sword', bottomsword: 'a bottom sword', round: 'a small round tail', spear: 'a spear tail', pin: 'a pin tail', doublesword: 'two long swords' }[p.tail];
  const s = [];
  const col = p.ground === 'albino' ? { purple: 'pink', blue: 'pale sky blue', red: 'bright red' }[p.colour] ?? p.colour : p.colour;
  s.push(p.ground === 'albino' ? `Albino with red eyes, ${col} tail` : p.colour === 'black' && p.moscow ? 'Black all over' : `${p.ground === 'gold' ? 'Gold body, ' : ''}${col} tail`);
  if (p.moscow && p.colour !== 'black') s.push('a dark velvet body');
  if (p.platinum) s.push('a white metal head');
  if (p.japan) s.push('a metallic blue front');
  if (p.neon) s.push('a neon band');
  if (p.tuxedo) s.push('a black rear half');
  const PAT = { mosaic: 'dark mosaic on the tail', snakeskin: 'snakeskin chain and lace', tiger: 'snakeskin body, mosaic tail', leopard: 'leopard spots', cobra: 'cobra bars and leopard rosettes', grass: 'fine grass dots' };
  if (PAT[p.pattern]) s.push(PAT[p.pattern]);
  s.push(tail);
  if (p.ribbon) s.push('long ribbon fins');
  if (p.swallow) s.push('swallow fins');
  if (p.dumbo) s.push('huge pectoral fins');
  const out = s.join(', ') + '.';
  return out.length < 138 ? out : out.slice(0, 134) + '...';
}

// How hard a strain is to come by (1 common … 5 very rare): rare genes and stacks of them score higher.
const SCORE = { blue: 1, purple: 1, yellow: 2, lime: 2, green: 3, white: 3, pastel: 4, black: 3, gold: 2, albino: 3, moscow: 2, platinum: 2, japan: 2, neon: 2, tuxedo: 1,
  mosaic: 1, snakeskin: 2, tiger: 3, leopard: 2, cobra: 4, grass: 1, veil: 1, flag: 3, fan: 0, spade: 2, round: 1, spear: 2, pin: 4, topsword: 2, bottomsword: 2,
  doublesword: 2, lyre: 3, ribbon: 3, swallow: 3, dumbo: 2 };
export function guppyRarity(id) {
  const p = parseGuppy(id);
  if (!p) return 1;
  let s = (SCORE[p.colour] ?? 0) + (SCORE[p.ground] ?? 0) + (SCORE[p.pattern] ?? 0) + (SCORE[p.tail] ?? 0);
  if (p.moscow) s += SCORE.moscow;
  if (p.platinum) s += SCORE.platinum;
  if (p.tuxedo) s += SCORE.tuxedo;
  if (p.japan) s += SCORE.japan;
  if (p.neon) s += SCORE.neon;
  if (p.ribbon) s += SCORE.ribbon;
  if (p.swallow) s += SCORE.swallow;
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
  yellow: { tail: [0xfff07a, 0xffd21e, 0xf0a010], body: 0xf8d040 },
  lime: { tail: [0xe8f87a, 0xb8e030, 0x78b018], body: 0xc0e040 },
  green: { tail: [0x9cf0b0, 0x2ec080, 0x10806a], body: 0x30b088 },
  white: { tail: [0xffffff, 0xf2f4f6, 0xd8dee6], body: 0xf0f2f4 },
  pastel: { tail: [0xfffbe8, 0xfff0c0, 0xf6d898], body: 0xfff0c8 },
  black: { tail: [0x3a3c48, 0x16171e, 0x08080c], body: 0x18181e },
};
export function guppySwatch(id) {
  const p = parseGuppy(id);
  if (!p) return '#999';
  const k = p.ground === 'albino' && (p.colour === 'blue' || p.colour === 'purple') ? (p.colour === 'blue' ? 'albinoBlue' : 'albinoPurple') : p.colour;
  const h = GUPPY_HEX[k].tail[1];
  return '#' + (p.moscow ? ((h >> 1) & 0x7f7f7f) : h).toString(16).padStart(6, '0');
}

// ---- A genotype for a strain -------------------------------------------------------------------------------------------------------
// With eighteen genes the phenotype classes number 589 824, too many to list and filter (sim/genetics.js genotypeForMorph does that for
// the other species): the strain's traits say what each gene must be, and a gene the strain does not show (hidden by albino, by a
// delta tail, by the black gene, by a pattern that covers another) is drawn from the shop population. `rng` gives 0…1.
export function guppyGenotypeFor(id, rng = Math.random, { female = false } = {}) {
  const p = parseGuppy(id);
  if (!p) throw new Error(`Unknown morph "${id}" for guppy`);
  const out = [];
  const pick = (i, opts) => {                                   // opts: genotypes allowed; weighted by the shop frequencies
    const l = GUPPY_LOCI[i], q = l.freq, [a0, a1] = l.alleles, f1 = l.mode === 'inc' ? (l.freqAllele === a0 ? q : 1 - q) : 1 - q;
    const w = (g) => (g === a0 + a0 ? f1 * f1 : g === a1 + a1 ? (1 - f1) * (1 - f1) : 2 * f1 * (1 - f1));
    const tot = opts.reduce((s, g) => s + w(g), 0);
    let r = rng() * tot;
    for (const g of opts) { r -= w(g); if (r < 0) return g; }
    return opts[opts.length - 1];
  };
  const dom = (i, on) => { const [a0, a1] = GUPPY_LOCI[i].alleles; return on ? [a0 + a0, a0 + a1] : [a1 + a1]; };
  const rec = (i, on) => { const [a0, a1] = GUPPY_LOCI[i].alleles; return on ? [a1 + a1] : [a0 + a0, a0 + a1]; };
  const any = (i) => { const l = GUPPY_LOCI[i], [a0, a1] = l.alleles; return [a0 + a0, a0 + a1, a1 + a1]; };
  const albino = p.ground === 'albino', black = p.colour === 'black';
  const white = p.colour === 'white' || p.colour === 'pastel', yellow = ['yellow', 'lime', 'green', 'pastel'].includes(p.colour);
  const base = { red: 'RR', yellow: 'RR', purple: 'BR', lime: 'BR', blue: 'BB', green: 'BB' }[p.colour];
  const size = tailSize(p.tail), size2 = { delta: 'LL', fan: 'LS', round: 'SS' }[size];
  const long = size === 'delta';
  const topOn = ['lyre', 'doublesword', 'topsword'].includes(p.tail), botOn = ['lyre', 'doublesword', 'bottomsword'].includes(p.tail);
  for (const l of GUPPY_LOCI) {
    const i = L[l.key];
    let o;
    switch (l.key) {
      case 'colour': o = base && !black && !white ? [base] : any(i); break;
      case 'yellow': o = black ? any(i) : rec(i, yellow); break;
      case 'white': o = black ? any(i) : rec(i, white); break;
      case 'black': o = albino ? any(i) : dom(i, black); break;
      case 'gold': o = albino ? any(i) : rec(i, p.ground === 'gold'); break;
      case 'albino': o = rec(i, albino); break;
      case 'size': o = [size2]; break;
      case 'sword': o = long ? any(i) : dom(i, topOn); break;
      case 'sword2': o = long ? any(i) : dom(i, botOn); break;
      case 'point': o = topOn || botOn ? any(i) : dom(i, ['veil', 'spade', 'spear', 'pin'].includes(p.tail)); break;
      case 'flag': o = topOn || botOn || size === 'fan' ? any(i) : p.tail === 'flag' || p.tail === 'pin' ? rec(i, true) : ['delta', 'veil', 'spear'].includes(p.tail) ? rec(i, false) : any(i); break;
      case 'snake': o = dom(i, ['snakeskin', 'tiger', 'cobra'].includes(p.pattern)); break;
      case 'leopard': o = dom(i, ['leopard', 'cobra'].includes(p.pattern)); break;
      case 'mosaic': o = ['leopard', 'cobra'].includes(p.pattern) ? any(i) : dom(i, ['mosaic', 'tiger'].includes(p.pattern)); break;
      case 'grass': o = p.pattern === 'plain' ? dom(i, false) : p.pattern === 'grass' ? dom(i, true) : any(i); break;
      case 'tuxedo': o = albino ? any(i) : dom(i, p.tuxedo); break;
      case 'moscow': o = albino ? any(i) : dom(i, p.moscow); break;
      case 'platinum': o = dom(i, p.platinum); break;
      case 'japan': o = dom(i, p.japan); break;
      case 'neon': o = dom(i, p.neon); break;
      case 'ribbon': o = dom(i, p.ribbon); break;
      case 'swallow': o = rec(i, p.swallow); break;
      case 'dumbo': o = rec(i, p.dumbo); break;
      case 'sex': out.push(female ? 'XX' : 'XY'); continue;
      default: o = any(i);
    }
    let g = pick(i, o);
    // onto the chromosomes: a male keeps one X allele (the one the strain needs, if it needs one), a female has no Y
    if (l.link === 'y') g = female ? '--' : '-' + (g.includes(l.alleles[0]) && o.every((x) => x.includes(l.alleles[0])) ? l.alleles[0] : g[rng() < 0.5 ? 0 : 1]);
    else if (l.link === 'x' && !female) g = (o.every((x) => x.includes(l.alleles[0])) ? l.alleles[0] : o.every((x) => !x.includes(l.alleles[0])) ? l.alleles[1] : g[rng() < 0.5 ? 0 : 1]) + '-';
    out.push(g);
  }
  return out;
}

// A ribbon male cannot sire (his gonopodium is too long to use: breeders keep ribbon lines through ribbon females).
export const guppyFertile = (genes) => !has(genes?.[L.ribbon] ?? 'ii', 'I');
