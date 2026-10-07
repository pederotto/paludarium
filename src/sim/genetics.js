// Game-simplified Mendelian genetics: pure logic, no DOM, no three.js, seedable.
// See docs/GENETICS_SPEC.md. Text for names and morphs lives in content/morphs.js.
//
// A genotype is an array with one two-character string per locus, alleles sorted with the dominant one
// first ('Aa'); incomplete-dominance loci sort alphabetically ('BR'). `morphOf` turns it into a morph id.

import { LOCI_TEXT, MORPHS, morphName, morphRarity } from '../content/morphs.js';
import { GUPPY_LOCI, GUPPY_STRAINS, guppyPhenotype } from '../content/guppy.js';

// Chance that an inherited allele flips to the other allele of its locus. Changeable: `config.mutation = 0`
// switches mutations off, or pass `{ mutation }` to `breed`.
export const MUTATION = 0.01;
export const config = { mutation: MUTATION };

// A small seedable random generator (mulberry32): `makeRng(7)()` gives numbers in [0, 1).
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The data. `alleles` are listed in genotype order (dominant first; for incomplete loci B before R).
// `freq` is the wild frequency of `freqAllele`, used for founders with no chosen morph.

const rec = (dom, low, freq) => ({ alleles: [dom, low], incomplete: false, freqAllele: low, freq });
const tail = (freq) => ({ alleles: ['B', 'R'], incomplete: true, freqAllele: 'R', freq });
// A locus whose dominant allele is the trait (mosaic, swords …): one copy shows it, and the plain fish is the double recessive.
// `dom` only changes the words (describe) and which births count as "a hidden gene showed up"; the arithmetic is rec's.
const dom = (a, low, freq) => ({ ...rec(a, low, freq), dom: true });
const fromSpec = (l) => (l.mode === 'inc' ? { alleles: l.alleles, incomplete: true, freqAllele: l.freqAllele, freq: l.freq } : l.mode === 'dom' ? dom(l.alleles[0], l.alleles[1], l.freq) : rec(l.alleles[0], l.alleles[1], l.freq));
const hom = (g, a) => g[0] === a && g[1] === a;

export const SPECIES_GENETICS = {
  axolotl: {
    loci: [rec('A', 'a', 0.15), rec('M', 'm', 0.10), rec('L', 'l', 0.25)],
    morphs: ['wild', 'leucistic', 'golden', 'melanoid', 'white_albino'],
    resolve: (g) => (hom(g[1], 'm') ? 'melanoid'
      : hom(g[0], 'a') && hom(g[2], 'l') ? 'white_albino'
        : hom(g[0], 'a') ? 'golden'
          : hom(g[2], 'l') ? 'leucistic' : 'wild'),
  },
  dartfrog: {
    loci: [rec('B', 'b', 0.2), rec('S', 's', 0.25)],
    morphs: ['cobalt_spotted', 'cobalt_clean', 'sky_spotted', 'sky_clean'],
    resolve: (g) => `${hom(g[0], 'b') ? 'sky' : 'cobalt'}_${hom(g[1], 's') ? 'clean' : 'spotted'}`,
  },
  // The fancy guppy: eleven genes (content/guppy.js), the strain a male shows read off them; females carry the same genes and
  // show little of them (the look, content/guppy.js guppyLook). `morphs` here is what a dealer sells; a tank breeds many more.
  guppy: {
    loci: GUPPY_LOCI.map(fromSpec),
    morphs: GUPPY_STRAINS,
    resolve: guppyPhenotype,
  },
  betta: {
    loci: [tail(0.6), rec('X', 'x', 0.1)],
    morphs: ['red', 'purple', 'blue', 'cellophane'],
    resolve: (g) => (hom(g[1], 'x') ? 'cellophane' : g[0] === 'RR' ? 'red' : g[0] === 'BB' ? 'blue' : 'purple'),
  },
  // Dwarf shrimp (Neocaridina davidi), the hobby's simplified picture of its colour lines: three recessive pigment genes and a
  // dominant pattern gene. Red, yellow and blue each need two copies; stacked they make orange (red + yellow), green jade
  // (yellow + blue), chocolate (red + blue) and black (all three). The rili gene (one copy is enough) clears a band across the
  // middle of a coloured shrimp. A shrimp with none of the pigments is the wild brown. (Saves from before the blue and rili genes
  // have two genes: the missing ones read as the common allele, see `complete`.)
  shrimp: {
    loci: [rec('W', 'r', 0.5), rec('Y', 'y', 0.15), rec('B', 'b', 0.12), rec('L', 'l', 0.97)],
    morphs: ['wild', 'red', 'yellow', 'orange', 'blue', 'green', 'chocolate', 'black',
      'red_rili', 'yellow_rili', 'orange_rili', 'blue_rili', 'green_rili', 'chocolate_rili', 'black_rili'],
    resolve: (g) => {
      const r = hom(g[0], 'r'), y = hom(g[1], 'y'), b = !!g[2] && hom(g[2], 'b'), rili = !!g[3] && g[3][0] === 'L';
      const c = r && y && b ? 'black' : r && b ? 'chocolate' : y && b ? 'green' : r && y ? 'orange' : r ? 'red' : y ? 'yellow' : b ? 'blue' : 'wild';
      return rili && c !== 'wild' ? `${c}_rili` : c;
    },
  },
};

export const hasGenetics = (id) => !!SPECIES_GENETICS[id];
export const morphList = (id) => SPECIES_GENETICS[id]?.morphs ?? [];
export const lociOf = (id) => SPECIES_GENETICS[id]?.loci ?? [];
export const rarity = (id, morph) => morphRarity(id, morph);

const other = (locus, allele) => (allele === locus.alleles[0] ? locus.alleles[1] : locus.alleles[0]);
const norm = (locus, x, y) => (locus.alleles.indexOf(x) <= locus.alleles.indexOf(y) ? x + y : y + x);

function need(id) {
  const sp = SPECIES_GENETICS[id];
  if (!sp) throw new Error(`No genetics for species "${id}"`);
  return sp;
}

// ---------------------------------------------------------------------------
// Genotypes and morphs.

export function morphOf(id, genes) {
  const sp = SPECIES_GENETICS[id];
  return sp && genes ? sp.resolve(complete(id, genes)) : null;
}

// A genotype with every locus of the species: one written before a locus was added (an old save) gets the common allele there,
// two copies of it (the dominant one where that is the common one).
export function complete(id, genes) {
  const sp = SPECIES_GENETICS[id];
  if (!sp || !genes || genes.length >= sp.loci.length) return genes;
  return sp.loci.map((locus, i) => genes[i] ?? (() => { const c = locus.freq >= 0.5 ? locus.freqAllele : other(locus, locus.freqAllele); return norm(locus, c, c); })());
}

// Every possible genotype of a species with its probability in a wild population (Hardy-Weinberg),
// and the morph it shows. Cached.
const PRIORS = {};
export function allGenotypes(id) {
  if (PRIORS[id]) return PRIORS[id];
  const sp = need(id);
  let list = [{ genes: [], p: 1 }];
  for (const locus of sp.loci) {
    const q = locus.freq, [a0, a1] = locus.alleles;
    const pFirst = locus.freqAllele === a0 ? q : 1 - q;       // frequency of alleles[0]
    const dist = [[a0 + a0, pFirst * pFirst], [a0 + a1, 2 * pFirst * (1 - pFirst)], [a1 + a1, (1 - pFirst) * (1 - pFirst)]];
    list = list.flatMap((x) => dist.map(([g, p]) => ({ genes: [...x.genes, g], p: x.p * p })));
  }
  return (PRIORS[id] = list.map((x) => ({ ...x, morph: sp.resolve(x.genes) })));
}

// A random wild-type founder: each allele drawn from the species' allele frequencies, so it may be a hidden carrier.
export function randomGenotype(id, rng = Math.random) {
  const sp = need(id);
  return sp.loci.map((locus) => {
    const draw = () => (rng() < locus.freq ? locus.freqAllele : other(locus, locus.freqAllele));
    return norm(locus, draw(), draw());
  });
}

// Phenotype classes: at a complete-dominance locus 'Aa' looks like 'AA', so the two are one class (written 'AA'); an in-between
// locus keeps its three genotypes. Every resolver treats 'Aa' and 'AA' alike, so enumerating classes gives the same morphs and
// probabilities as enumerating genotypes, far faster for a species with many genes (the guppy: 4 608 classes, 177 147 genotypes).
// `dist` is one locus's genotype distribution { 'Aa': p, … }; returns [[class, p, { genotype: p within the class }], …].
function classes(locus, dist) {
  if (locus.incomplete) return Object.entries(dist).filter(([, p]) => p > 0).map(([g, p]) => [g, p, { [g]: 1 }]);
  const [a0] = locus.alleles, top = a0 + a0, out = [];
  const pd = Object.entries(dist).filter(([g, p]) => p > 0 && g[0] === a0), ps = pd.reduce((s, [, p]) => s + p, 0);
  if (ps > 0) out.push([top, ps, Object.fromEntries(pd.map(([g, p]) => [g, p / ps]))]);
  for (const [g, p] of Object.entries(dist)) if (p > 0 && g[0] !== a0) out.push([g, p, { [g]: 1 }]);
  return out;
}
const priorDist = (locus) => {
  const q = locus.freq, [a0, a1] = locus.alleles, p0 = locus.freqAllele === a0 ? q : 1 - q;
  return { [a0 + a0]: p0 * p0, [a0 + a1]: 2 * p0 * (1 - p0), [a1 + a1]: (1 - p0) * (1 - p0) };
};
// Enumerate the product of per-locus class lists: [{ genes (class representatives), p, within (per locus) }].
function enumerate(lists) {
  let list = [{ genes: [], p: 1, within: [] }];
  for (const cl of lists) list = list.flatMap((x) => cl.map(([g, p, w]) => ({ genes: [...x.genes, g], p: x.p * p, within: [...x.within, w] })));
  return list;
}
const CLASS_PRIORS = {};
function priorClasses(id) {
  if (CLASS_PRIORS[id]) return CLASS_PRIORS[id];
  const sp = need(id);
  return (CLASS_PRIORS[id] = enumerate(sp.loci.map((l) => classes(l, priorDist(l)))).map((x) => ({ ...x, morph: sp.resolve(x.genes) })));
}
const drawFrom = (w, rng) => {
  let r = rng();
  const e = Object.entries(w);
  for (const [g, p] of e) { r -= p; if (r < 0) return g; }
  return e[e.length - 1][0];
};

// A genotype that shows `morph`. Recessive morphs are homozygous; other morphs may carry hidden genes
// (chosen with the wild frequencies, so a "cobalt, many spots" frog is usually but not always pure).
export function genotypeForMorph(id, morph, rng = Math.random) {
  const cands = priorClasses(id).filter((x) => x.morph === morph);
  if (!cands.length) throw new Error(`Unknown morph "${morph}" for ${id}`);
  const total = cands.reduce((s, x) => s + x.p, 0);
  let r = rng() * total, pick = cands[cands.length - 1];
  for (const x of cands) { r -= x.p; if (r < 0) { pick = x; break; } }
  return pick.within.map((w) => drawFrom(w, rng));
}

// ---------------------------------------------------------------------------
// Inheritance.

// One child: a random allele from each parent at every locus, each flipping with probability `mutation`.
export function breed(id, genesA, genesB, rng = Math.random, { mutation = config.mutation } = {}) {
  const sp = need(id);
  genesA = complete(id, genesA); genesB = complete(id, genesB);
  return sp.loci.map((locus, i) => {
    let x = genesA[i][rng() < 0.5 ? 0 : 1];
    let y = genesB[i][rng() < 0.5 ? 0 : 1];
    if (rng() < mutation) x = other(locus, x);
    if (rng() < mutation) y = other(locus, y);
    return norm(locus, x, y);
  });
}

// What a parent's gametes carry at one locus: [{ allele, p }].
function gametes(g) {
  return g[0] === g[1] ? [{ allele: g[0], p: 1 }] : [{ allele: g[0], p: 0.5 }, { allele: g[1], p: 0.5 }];
}

// Distribution of the child's genotype at one locus: { 'Aa': 0.5, ... }. Exact.
export function locusOutcomes(id, i, genesA, genesB) {
  const locus = need(id).loci[i];
  genesA = complete(id, genesA); genesB = complete(id, genesB);
  const out = {};
  for (const x of gametes(genesA[i])) for (const y of gametes(genesB[i])) {
    const k = norm(locus, x.allele, y.allele);
    out[k] = (out[k] ?? 0) + x.p * y.p;
  }
  return out;
}

// A Punnett square for one locus: parent A's gametes down the side, parent B's across the top.
// { name, rows: ['A','a'], cols: ['A','a'], grid: [['AA','Aa'],['Aa','aa']], cellP: 0.25, totals: { AA: .25, Aa: .5, aa: .25 } }
export function punnett(id, i, genesA, genesB) {
  const sp = need(id), locus = sp.loci[i];
  genesA = complete(id, genesA); genesB = complete(id, genesB);
  const two = (g) => [g[0], g[1]];
  const rows = two(genesA[i]), cols = two(genesB[i]);
  const grid = rows.map((r) => cols.map((c) => norm(locus, r, c)));
  return { name: LOCI_TEXT[id]?.[i]?.name ?? `Gene ${i + 1}`, locus: i, rows, cols, grid, cellP: 0.25, totals: locusOutcomes(id, i, genesA, genesB) };
}

// The exact probability of each morph in the offspring of two animals (no mutation), by enumerating the loci's phenotype classes.
export function outcomes(id, genesA, genesB) {
  const sp = need(id);
  const out = {};
  for (const x of enumerate(sp.loci.map((l, i) => classes(l, locusOutcomes(id, i, genesA, genesB))))) {
    const m = sp.resolve(x.genes);
    out[m] = (out[m] ?? 0) + x.p;
  }
  return out;
}

// The same, as a list sorted from the most to the least likely: [{ morph, p }].
export function outcomeList(id, genesA, genesB) {
  return Object.entries(outcomes(id, genesA, genesB)).map(([morph, p]) => ({ morph, p })).sort((a, b) => b.p - a.p);
}

// Would this child surprise a player? Its morph is impossible for these parents without a mutation.
export function isSurprise(id, genesA, genesB, child) {
  return !((outcomes(id, genesA, genesB)[morphOf(id, child)] ?? 0) > 0);
}

// The textbook moment: a child shows a recessive gene at a locus where both parents only carried it
// (both heterozygous), and looks different from both of them.
export function recessiveFromCarriers(id, genesA, genesB, child) {
  const sp = need(id);
  genesA = complete(id, genesA); genesB = complete(id, genesB); child = complete(id, child);
  const mc = sp.resolve(child);
  if (mc === sp.resolve(genesA) || mc === sp.resolve(genesB)) return false;
  return sp.loci.some((locus, i) => !locus.incomplete && !locus.dom && genesA[i][0] !== genesA[i][1] && genesB[i][0] !== genesB[i][1] && hom(child[i], locus.alleles[1]));
}

// ---------------------------------------------------------------------------
// Words for the UI.

// Per-locus text: [{ name, genotype, state, label, text }]. `state`: 'normal' | 'carrier' | 'shows' for ordinary
// genes, 'first' | 'mixed' | 'second' for in-between genes. Example text: "Albino gene: Aa, carrier".
export function describe(id, genes) {
  const sp = need(id);
  genes = complete(id, genes);
  return sp.loci.map((locus, i) => {
    const info = LOCI_TEXT[id]?.[i] ?? { name: `Gene ${i + 1}`, traits: {} };
    const g = genes[i];
    const t = (a) => info.traits[a] ?? a;
    let state, label;
    if (locus.incomplete) {
      state = g[0] !== g[1] ? 'mixed' : g[0] === locus.alleles[0] ? 'first' : 'second';
      label = state === 'mixed' ? (info.mixed ?? 'mixed') : t(g[0]);
    } else if (locus.dom) {
      // The trait is the dominant allele: one copy shows it, two copies breed true.
      if (g[0] === locus.alleles[0]) { state = 'shows'; label = g[1] === locus.alleles[0] ? `shows ${t(g[0])} (two copies: breeds true)` : `shows ${t(g[0])} (one copy)`; }
      else { state = 'normal'; label = t(g[0]); }
    } else if (g[0] !== g[1]) { state = 'carrier'; label = 'carrier'; }
    else if (g[0] === locus.alleles[0]) { state = 'normal'; label = t(g[0]); }
    else { state = 'shows'; label = `shows ${t(g[0])}`; }
    return { name: info.name, genotype: g, state, label, text: `${info.name}: ${g}, ${label}` };
  });
}

// Hidden recessive genes an animal carries without showing: ['Albino gene', ...].
export function carriedGenes(id, genes) {
  return describe(id, genes).filter((d) => d.state === 'carrier').map((d) => d.name);
}

// "Pair these two for a 25% chance of golden": the rarest morph neither parent shows, or else a
// plain statement about what they will have.
export function suggestPair(id, genesA, genesB) {
  const list = outcomeList(id, genesA, genesB);
  const ma = morphOf(id, genesA), mb = morphOf(id, genesB);
  const fresh = list.filter((o) => o.morph !== ma && o.morph !== mb).sort((a, b) => rarity(id, b.morph) - rarity(id, a.morph) || b.p - a.p);
  const pct = (p) => {
    if (p >= 0.995) return 'a certain';
    const n = Math.round(p * 100) || 1;
    return `${/^(8|11|18)/.test(String(n)) ? 'an' : 'a'} ${n}%`;
  };
  if (fresh.length) {
    const f = fresh[0];
    return { morph: f.morph, p: f.p, text: `Pair these two for ${pct(f.p)} chance of ${morphName(id, f.morph).toLowerCase()}.` };
  }
  if (list.length === 1) return { morph: list[0].morph, p: 1, text: `All their babies will be ${morphName(id, list[0].morph).toLowerCase()}.` };
  return { morph: list[0].morph, p: list[0].p, text: `Their babies will look like the parents: ${list.map((o) => morphName(id, o.morph).toLowerCase()).join(' or ')}.` };
}

export { MORPHS };
