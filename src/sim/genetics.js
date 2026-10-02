// Game-simplified Mendelian genetics: pure logic, no DOM, no three.js, seedable.
// See docs/GENETICS_SPEC.md. Text for names and morphs lives in content/morphs.js.
//
// A genotype is an array with one two-character string per locus, alleles sorted with the dominant one
// first ('Aa'); incomplete-dominance loci sort alphabetically ('BR'). `morphOf` turns it into a morph id.

import { LOCI_TEXT, MORPHS, morphName, morphRarity } from '../content/morphs.js';

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
  guppy: {
    loci: [tail(0.6), rec('G', 'g', 0.1)],
    morphs: ['red', 'purple', 'blue', 'gold'],
    resolve: (g) => (hom(g[1], 'g') ? 'gold' : g[0] === 'RR' ? 'red' : g[0] === 'BB' ? 'blue' : 'purple'),
  },
  betta: {
    loci: [tail(0.6), rec('X', 'x', 0.1)],
    morphs: ['red', 'purple', 'blue', 'cellophane'],
    resolve: (g) => (hom(g[1], 'x') ? 'cellophane' : g[0] === 'RR' ? 'red' : g[0] === 'BB' ? 'blue' : 'purple'),
  },
  shrimp: {
    loci: [rec('W', 'r', 0.5), rec('Y', 'y', 0.15)],
    morphs: ['wild', 'red', 'yellow', 'orange'],
    resolve: (g) => {
      const r = hom(g[0], 'r'), y = hom(g[1], 'y');
      return r && y ? 'orange' : r ? 'red' : y ? 'yellow' : 'wild';
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
  return sp && genes ? sp.resolve(genes) : null;
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

// A genotype that shows `morph`. Recessive morphs are homozygous; other morphs may carry hidden genes
// (chosen with the wild frequencies, so a "cobalt, many spots" frog is usually but not always pure).
export function genotypeForMorph(id, morph, rng = Math.random) {
  const cands = allGenotypes(id).filter((x) => x.morph === morph);
  if (!cands.length) throw new Error(`Unknown morph "${morph}" for ${id}`);
  const total = cands.reduce((s, x) => s + x.p, 0);
  let r = rng() * total;
  for (const x of cands) { r -= x.p; if (r < 0) return [...x.genes]; }
  return [...cands[cands.length - 1].genes];
}

// ---------------------------------------------------------------------------
// Inheritance.

// One child: a random allele from each parent at every locus, each flipping with probability `mutation`.
export function breed(id, genesA, genesB, rng = Math.random, { mutation = config.mutation } = {}) {
  const sp = need(id);
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
  const two = (g) => [g[0], g[1]];
  const rows = two(genesA[i]), cols = two(genesB[i]);
  const grid = rows.map((r) => cols.map((c) => norm(locus, r, c)));
  return { name: LOCI_TEXT[id]?.[i]?.name ?? `Gene ${i + 1}`, locus: i, rows, cols, grid, cellP: 0.25, totals: locusOutcomes(id, i, genesA, genesB) };
}

// The exact probability of each morph in the offspring of two animals (no mutation), by enumerating the loci.
export function outcomes(id, genesA, genesB) {
  const sp = need(id);
  let list = [{ genes: [], p: 1 }];
  sp.loci.forEach((_, i) => {
    const dist = Object.entries(locusOutcomes(id, i, genesA, genesB));
    list = list.flatMap((x) => dist.map(([g, p]) => ({ genes: [...x.genes, g], p: x.p * p })));
  });
  const out = {};
  for (const x of list) { const m = sp.resolve(x.genes); out[m] = (out[m] ?? 0) + x.p; }
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
  const mc = sp.resolve(child);
  if (mc === sp.resolve(genesA) || mc === sp.resolve(genesB)) return false;
  return sp.loci.some((locus, i) => !locus.incomplete && genesA[i][0] !== genesA[i][1] && genesB[i][0] !== genesB[i][1] && hom(child[i], locus.alleles[1]));
}

// ---------------------------------------------------------------------------
// Words for the UI.

// Per-locus text: [{ name, genotype, state, label, text }]. `state`: 'normal' | 'carrier' | 'shows' for ordinary
// genes, 'first' | 'mixed' | 'second' for in-between genes. Example text: "Albino gene: Aa, carrier".
export function describe(id, genes) {
  const sp = need(id);
  return sp.loci.map((locus, i) => {
    const info = LOCI_TEXT[id]?.[i] ?? { name: `Gene ${i + 1}`, traits: {} };
    const g = genes[i];
    const t = (a) => info.traits[a] ?? a;
    let state, label;
    if (locus.incomplete) {
      state = g[0] !== g[1] ? 'mixed' : g[0] === locus.alleles[0] ? 'first' : 'second';
      label = state === 'mixed' ? (info.mixed ?? 'mixed') : t(g[0]);
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
