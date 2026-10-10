import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGuppy } from '../src/content/guppy.js';
import {
  isMaleGenes, SPECIES_GENETICS, hasGenetics, randomGenotype, genotypeForMorph, morphOf, breed, describe, punnett, outcomes, outcomeList,
  rarity, allGenotypes, makeRng, config, MUTATION, isSurprise, recessiveFromCarriers, suggestPair, carriedGenes, locusOutcomes,
} from '../src/sim/genetics.js';
import { MORPHS, LOCI_TEXT, morphFactor, morphInfo } from '../src/content/morphs.js';

const N = 20000;
const near = (got, want, tol, msg) => assert.ok(Math.abs(got - want) <= tol, `${msg ?? ''} got ${got.toFixed(4)}, want ${want} ± ${tol}`);
const ids = Object.keys(SPECIES_GENETICS);

// An independent statement of the spec's morph tables, written as functions of the allele pairs.
const H = (g, a) => g[0] === a && g[1] === a;
const SPEC = {
  axolotl: (g) => (H(g[1], 'm') ? 'melanoid' : H(g[0], 'a') && H(g[2], 'l') ? 'white_albino' : H(g[0], 'a') ? 'golden' : H(g[2], 'l') ? 'leucistic' : 'wild'),
  dartfrog: (g) => (H(g[0], 'b') ? (H(g[1], 's') ? 'sky_clean' : 'sky_spotted') : (H(g[1], 's') ? 'cobalt_clean' : 'cobalt_spotted')),
  // the guppy's genes (content/guppy.js), restated: colour BR, gold g, albino a, tail size LS, top sword W (Y), mosaic M (X), snakeskin K
  // (Y), half-black T (X), Moscow F (Y), platinum P (Y), big ear e, yellow y, white v, black N, leopard D, grass Q (X), Japan blue J (Y),
  // neon O (X), bottom sword U (Y), point C, flag h, ribbon I, swallow z, sex; albino hides gold, half-black, Moscow and black; long tails
  // hide the swords
  guppy: (g) => {
    const D = (x, a) => x.includes(a), albino = H(g[2], 'a'), black = !albino && D(g[13], 'N'), yellow = H(g[11], 'y'), white = H(g[12], 'v');
    const t = [];
    if (albino) t.push('albino'); else if (H(g[1], 'g')) t.push('gold');
    if (!albino && D(g[8], 'F')) t.push('moscow');
    if (D(g[9], 'P')) t.push('platinum');
    if (D(g[16], 'J')) t.push('japan');
    if (D(g[17], 'O')) t.push('neon');
    if (!albino && D(g[7], 'T')) t.push('tuxedo');
    const base = g[0] === 'RR' ? 'red' : g[0] === 'BB' ? 'blue' : 'purple';
    t.push(black ? 'black' : white ? (yellow ? 'pastel' : 'white') : yellow ? { red: 'yellow', purple: 'lime', blue: 'green' }[base] : base);
    const mo = D(g[5], 'M'), sn = D(g[6], 'K'), le = D(g[14], 'D'), gr = D(g[15], 'Q');
    const pat = sn && le ? 'cobra' : sn && mo ? 'tiger' : sn ? 'snakeskin' : le ? 'leopard' : mo ? 'mosaic' : gr ? 'grass' : null;
    if (pat) t.push(pat);
    const top = D(g[4], 'W'), bot = D(g[18], 'U'), pt = D(g[19], 'C'), fl = H(g[20], 'h');
    const tail = g[3] === 'LL' ? (fl ? 'flag' : pt ? 'veil' : 'delta') : top && bot ? (g[3] === 'LS' ? 'lyre' : 'doublesword') : top ? 'topsword' : bot ? 'bottomsword'
      : g[3] === 'LS' ? (pt ? 'spade' : 'fan') : pt ? (fl ? 'pin' : 'spear') : 'round';
    if (tail !== 'delta') t.push(tail);
    if (D(g[21], 'I')) t.push('ribbon');
    if (H(g[22], 'z')) t.push('swallow');
    if (H(g[10], 'e')) t.push('dumbo');
    return t.join('_');
  },
  harlequin: (g) => (H(g[0], 'g') ? 'mint' : 'orange'),
  betta: (g) => (H(g[1], 'x') ? 'cellophane' : g[0] === 'RR' ? 'red' : g[0] === 'BB' ? 'blue' : 'purple'),
  shrimp: (g) => {
    const r = H(g[0], 'r'), y = H(g[1], 'y'), b = H(g[2], 'b'), rili = g[3] === 'LL' || g[3] === 'Ll';
    const c = r && y && b ? 'black' : r && b ? 'chocolate' : y && b ? 'green' : r && y ? 'orange' : r ? 'red' : y ? 'yellow' : b ? 'blue' : 'wild';
    return rili && c !== 'wild' ? c + '_rili' : c;
  },
};

test('the six species have genetics, everything else does not', () => {
  assert.deepEqual(ids.sort(), ['axolotl', 'betta', 'dartfrog', 'guppy', 'harlequin', 'shrimp']);
  assert.ok(!hasGenetics('neon'));
  assert.equal(morphOf('neon', ['Aa']), null);
  assert.equal(SPECIES_GENETICS.axolotl.loci.length, 3);
  assert.equal(SPECIES_GENETICS.dartfrog.loci.length, 2);
});

test('morph resolution matches the spec table for every species and every genotype', () => {
  for (const id of ids.filter((x) => x !== 'guppy')) {          // (the guppy's 177 147 genotypes: next test)
    const all = allGenotypes(id);
    const nLoci = SPECIES_GENETICS[id].loci.length;
    assert.equal(all.length, 3 ** nLoci, id);
    const seen = new Set();
    let psum = 0;
    for (const x of all) {
      assert.equal(morphOf(id, x.genes), SPEC[id](x.genes), `${id} ${x.genes}`);
      assert.ok(Object.hasOwn(MORPHS[id], morphOf(id, x.genes)), `${id} morph has content`);
      seen.add(morphOf(id, x.genes));
      psum += x.p;
    }
    psum = +psum.toFixed(9);
    assert.equal(psum, 1, `${id} priors sum to 1`);
    assert.deepEqual([...seen].sort(), Object.keys(MORPHS[id]).sort(), `${id}: every morph is reachable and listed`);
    assert.deepEqual([...SPECIES_GENETICS[id].morphs].sort(), Object.keys(MORPHS[id]).sort());
  }
});

test('guppy: the strain matches the rules for random genotypes, every strain sold is reachable, and every strain has words', () => {
  const rng = makeRng(3);
  for (let k = 0; k < 4000; k++) {
    const g = randomGenotype('guppy', rng), m = morphOf('guppy', g);
    assert.equal(m, SPEC.guppy(g), String(g));
    const info = morphInfo('guppy', m);
    assert.ok(info && info.name && info.blurb.length > 10 && info.blurb.length < 140 && info.rarity >= 1 && info.rarity <= 5, m);
  }
  for (const m of SPECIES_GENETICS.guppy.morphs) assert.equal(morphOf('guppy', genotypeForMorph('guppy', m, rng)), m);
  assert.equal(SPECIES_GENETICS.guppy.loci.length, 24);
  const tails = new Set();
  for (let k = 0; k < 20000; k++) tails.add(parseGuppy(morphOf('guppy', randomGenotype('guppy', rng, { female: false }))).tail);
  assert.equal(tails.size, 12, `all twelve tails of the sheet appear: ${[...tails]}`);
});

test('guppy sex chromosomes: Y genes go father to son only, a son\'s X genes come from his mother, sex is half and half', () => {
  const rng = makeRng(9);
  const father = genotypeForMorph('guppy', 'moscow_blue_doublesword', rng, { female: false });    // Moscow and both swords on his Y
  const mother = genotypeForMorph('guppy', 'blue_mosaic_round', rng, { female: true });            // mosaic on her X, a short tail
  assert.ok(isMaleGenes('guppy', father) && !isMaleGenes('guppy', mother));
  let sons = 0, daughters = 0, sonsMoscow = 0, daughtersMoscow = 0, sonsMosaic = 0;
  const seen = {};
  for (let k = 0; k < 4000; k++) {
    const c = breed('guppy', mother, father, rng, { mutation: 0 }), p = parseGuppy(morphOf('guppy', c));
    seen[morphOf('guppy', c)] = (seen[morphOf('guppy', c)] ?? 0) + 1 / 4000;
    if (isMaleGenes('guppy', c)) { sons++; sonsMoscow += p.moscow ? 1 : 0; sonsMosaic += p.pattern === 'mosaic' ? 1 : 0; assert.equal(p.tail, 'doublesword'); }
    else { daughters++; daughtersMoscow += p.moscow ? 1 : 0; assert.notEqual(p.tail, 'doublesword'); }
  }
  near(sons / 4000, 0.5, 0.03, 'sons');
  assert.equal(sonsMoscow, sons, 'every son has his father\'s Y');
  assert.equal(daughtersMoscow, 0, 'no daughter has a Y gene');
  const mx = mother[5];                                                       // the mosaic gene on her two X
  near(sonsMosaic / sons, mx === 'MM' ? 1 : mx === 'Mm' ? 0.5 : 0, 0.05, 'a son\'s X from his mother');
  // the exact odds agree with the births, strain by strain
  const o = outcomes('guppy', mother, father);
  for (const m of new Set([...Object.keys(o), ...Object.keys(seen)])) near(seen[m] ?? 0, o[m] ?? 0, 0.025, m);
});

test('spec examples', () => {
  assert.equal(morphOf('axolotl', ['AA', 'MM', 'LL']), 'wild');
  assert.equal(morphOf('axolotl', ['AA', 'MM', 'll']), 'leucistic');
  assert.equal(morphOf('axolotl', ['aa', 'MM', 'LL']), 'golden');
  assert.equal(morphOf('axolotl', ['aa', 'MM', 'll']), 'white_albino');
  assert.equal(morphOf('axolotl', ['aa', 'mm', 'll']), 'melanoid');
  assert.equal(morphOf('axolotl', ['Aa', 'Mm', 'Ll']), 'wild');
  assert.equal(morphOf('dartfrog', ['bb', 'ss']), 'sky_clean');
  assert.equal(morphOf('dartfrog', ['Bb', 'Ss']), 'cobalt_spotted');
  assert.equal(morphOf('guppy', ['BR', 'GG']), 'purple');
  assert.equal(morphOf('guppy', ['RR', 'gg']), 'gold_red');        // (a save from before the eleven genes: the others are completed)
  assert.equal(morphOf('betta', ['BB', 'xx']), 'cellophane');
  assert.equal(morphOf('shrimp', ['rr', 'yy']), 'orange');
  assert.equal(morphOf('shrimp', ['Wr', 'YY']), 'wild');
  assert.equal(rarity('axolotl', 'white_albino'), 4);
  assert.equal(rarity('dartfrog', 'sky_clean'), 4);
  assert.equal(rarity('guppy', 'red'), 1);
  assert.equal(rarity('betta', 'cellophane'), 4);
});

test('rarity and price rise together, stay in range, and every locus and morph has text', () => {
  for (const id of ids) {
    assert.ok(LOCI_TEXT[id].length === SPECIES_GENETICS[id].loci.length, id);
    for (const [m, info] of Object.entries(MORPHS[id])) {
      assert.ok(info.rarity >= 1 && info.rarity <= 5, `${id}:${m}`);
      assert.ok(info.name && info.blurb.length > 10 && info.blurb.length < 140, `${id}:${m} text`);
      assert.ok(info.price >= 1, `${id}:${m} price`);
      assert.equal(morphFactor(id, m), info.price);
    }
    const byR = Object.values(MORPHS[id]).sort((a, b) => a.rarity - b.rarity);
    for (let i = 1; i < byR.length; i++) assert.ok(byR[i].price >= byR[i - 1].price);
  }
  assert.equal(morphFactor('neon', 'x'), 1);
});

test('Mendel: Aa x Aa gives about 3 dominant : 1 recessive', () => {
  const rng = makeRng(11);
  let rec = 0;
  for (let i = 0; i < N; i++) if (breed('dartfrog', ['Bb', 'SS'], ['Bb', 'SS'], rng, { mutation: 0 })[0] === 'bb') rec++;
  near(rec / N, 0.25, 0.012, 'bb share');
});

test('Mendel: Aa x aa gives about 1 : 1', () => {
  const rng = makeRng(12);
  let rec = 0;
  for (let i = 0; i < N; i++) if (breed('dartfrog', ['Bb', 'SS'], ['bb', 'SS'], rng, { mutation: 0 })[0] === 'bb') rec++;
  near(rec / N, 0.5, 0.015, 'bb share');
});

test('incomplete dominance: RR x BB gives all BR, BR x BR gives 1 : 2 : 1', () => {
  const rng = makeRng(13);
  for (let i = 0; i < 500; i++) assert.equal(breed('guppy', ['RR', 'GG'], ['BB', 'GG'], rng, { mutation: 0 })[0], 'BR');
  const c = { RR: 0, BR: 0, BB: 0 };
  for (let i = 0; i < N; i++) c[breed('guppy', ['BR', 'GG'], ['BR', 'GG'], rng, { mutation: 0 })[0]]++;
  near(c.RR / N, 0.25, 0.012, 'RR'); near(c.BR / N, 0.5, 0.015, 'BR'); near(c.BB / N, 0.25, 0.012, 'BB');
  assert.equal(morphOf('guppy', ['BR', 'GG']), 'purple');
});

test('homozygous parents always breed true (with no mutation)', () => {
  const rng = makeRng(14);
  for (const id of ids.filter((x) => !SPECIES_GENETICS[x].sexed)) {
    const g = genotypeForMorph(id, SPECIES_GENETICS[id].morphs[0], rng);
    const hom = g.map((x) => x[0] + x[0]);
    for (let i = 0; i < 50; i++) assert.deepEqual(breed(id, hom, hom, rng, { mutation: 0 }), hom);
  }
});

test('alleles are conserved: every child allele comes from one parent, one from each', () => {
  const rng = makeRng(15);
  for (const id of ids.filter((x) => !SPECIES_GENETICS[x].sexed)) {
    for (let k = 0; k < 400; k++) {
      const a = randomGenotype(id, rng), b = randomGenotype(id, rng);
      const c = breed(id, a, b, rng, { mutation: 0 });
      assert.equal(c.length, a.length);
      c.forEach((g, i) => {
        assert.equal(g.length, 2);
        const ok = [0, 1].some((p) => [0, 1].some((q) => [a[i][p] + b[i][q], b[i][q] + a[i][p]].includes(g)));
        assert.ok(ok, `${id} locus ${i}: ${g} from ${a[i]} x ${b[i]}`);
        // Dominant allele first, or alphabetical for in-between genes.
        const locus = SPECIES_GENETICS[id].loci[i];
        assert.ok(locus.alleles.indexOf(g[0]) <= locus.alleles.indexOf(g[1]), `${g} sorted`);
      });
    }
  }
});

test('mutation: alleles flip at about the default rate and never when it is 0', () => {
  assert.equal(MUTATION, 0.01);
  assert.equal(config.mutation, 0.01);
  const rng = makeRng(16);
  let flipped = 0, alleles = 0;
  for (let i = 0; i < N * 2; i++) {
    const c = breed('axolotl', ['AA', 'MM', 'LL'], ['AA', 'MM', 'LL'], rng);
    for (const g of c) { alleles += 2; flipped += (g[0] !== g[0].toUpperCase() ? 1 : 0) + (g[1] !== g[1].toUpperCase() ? 1 : 0); }
  }
  near(flipped / alleles, 0.01, 0.0015, 'mutation rate per allele');
  for (let i = 0; i < 2000; i++) assert.deepEqual(breed('axolotl', ['AA', 'MM', 'LL'], ['AA', 'MM', 'LL'], rng, { mutation: 0 }), ['AA', 'MM', 'LL']);
  // A mutation flips to the other allele of that locus, including in-between genes.
  let sawBlue = 0;
  for (let i = 0; i < 2000; i++) if (breed('betta', ['RR', 'XX'], ['RR', 'XX'], rng, { mutation: 0.5 })[0].includes('B')) sawBlue++;
  assert.ok(sawBlue > 1000);
  // The same seed gives the same babies.
  assert.deepEqual(breed('shrimp', ['Wr', 'Yy'], ['Wr', 'Yy'], makeRng(5)), breed('shrimp', ['Wr', 'Yy'], ['Wr', 'Yy'], makeRng(5)));
});

test('outcomes() sum to 1 and match Punnett arithmetic', () => {
  for (const id of ids) {
    const rng = makeRng(21);
    for (let k = 0; k < 60; k++) {
      const a = randomGenotype(id, rng), b = randomGenotype(id, rng);
      const o = outcomes(id, a, b);
      const sum = Object.values(o).reduce((s, p) => s + p, 0);
      near(sum, 1, 1e-9, `${id} ${a} x ${b}`);
      for (const m of Object.keys(o)) assert.ok(morphInfo(id, m), `${id}:${m}`);
      const l = outcomeList(id, a, b);
      assert.equal(l.length, Object.keys(o).length);
      for (let i = 1; i < l.length; i++) assert.ok(l[i - 1].p >= l[i].p);
    }
  }
  assert.deepEqual(outcomes('dartfrog', ['BB', 'SS'], ['BB', 'SS']), { cobalt_spotted: 1 });
  const o = outcomes('dartfrog', ['Bb', 'Ss'], ['Bb', 'Ss']);
  near(o.cobalt_spotted, 9 / 16, 1e-9); near(o.cobalt_clean, 3 / 16, 1e-9); near(o.sky_spotted, 3 / 16, 1e-9); near(o.sky_clean, 1 / 16, 1e-9);
  near(outcomes('axolotl', ['Aa', 'MM', 'LL'], ['Aa', 'MM', 'LL']).golden, 0.25, 1e-9);
});

test('outcomes() agree with sampling', () => {
  for (const [id, a, b] of [
    ['axolotl', ['Aa', 'Mm', 'Ll'], ['Aa', 'MM', 'Ll']],
    ['guppy', ['BR', 'Gg'], ['BR', 'Gg']],
    ['shrimp', ['Wr', 'Yy'], ['rr', 'Yy']],
    ['betta', ['BR', 'Xx'], ['RR', 'xx']],
  ]) {
    const rng = makeRng(31);
    const want = outcomes(id, a, b), got = {};
    for (let i = 0; i < N; i++) { const m = morphOf(id, breed(id, a, b, rng, { mutation: 0 })); got[m] = (got[m] ?? 0) + 1 / N; }
    for (const m of new Set([...Object.keys(want), ...Object.keys(got)])) near(got[m] ?? 0, want[m] ?? 0, 0.012, `${id} ${m}`);
  }
});

test('genotypeForMorph always shows the requested morph (recessive morphs are homozygous)', () => {
  const rng = makeRng(41);
  for (const id of ids) {
    for (const m of SPECIES_GENETICS[id].morphs) {
      for (let k = 0; k < 40; k++) {
        const g = genotypeForMorph(id, m, rng);
        assert.equal(morphOf(id, g), m, `${id}:${m} ${g}`);
        assert.equal(g.length, SPECIES_GENETICS[id].loci.length);
      }
    }
  }
  assert.deepEqual(genotypeForMorph('dartfrog', 'sky_clean'), ['bb', 'ss']);
  assert.equal(genotypeForMorph('betta', 'cellophane')[1], 'xx');
  assert.throws(() => genotypeForMorph('guppy', 'melanoid'));
  // A common morph can hide carriers, so not every wild-looking animal is pure.
  const carriers = Array.from({ length: 400 }, () => genotypeForMorph('axolotl', 'wild', rng)).filter((g) => g.some((x) => x[0] !== x[1]));
  assert.ok(carriers.length > 20 && carriers.length < 400);
});

test('random founders follow the species allele frequencies', () => {
  const rng = makeRng(51);
  const freq = (id, i, allele) => {
    let n = 0, t = 0;
    for (let k = 0; k < 8000; k++) { const g = randomGenotype(id, rng)[i]; t += 2; n += (g[0] === allele ? 1 : 0) + (g[1] === allele ? 1 : 0); }
    return n / t;
  };
  near(freq('axolotl', 0, 'a'), 0.15, 0.012); near(freq('axolotl', 1, 'm'), 0.10, 0.012); near(freq('axolotl', 2, 'l'), 0.25, 0.012);
  near(freq('dartfrog', 0, 'b'), 0.2, 0.012); near(freq('dartfrog', 1, 's'), 0.25, 0.012);
  near(freq('guppy', 0, 'R'), 0.6, 0.012); near(freq('guppy', 1, 'g'), 0.1, 0.012);
  near(freq('shrimp', 0, 'r'), 0.5, 0.012); near(freq('shrimp', 1, 'y'), 0.15, 0.012); near(freq('shrimp', 2, 'b'), 0.12, 0.012); near(freq('shrimp', 3, 'l'), 0.97, 0.012);
  near(freq('betta', 1, 'x'), 0.1, 0.012);
});

test('describe: carriers, shown traits, in-between genes', () => {
  const d = describe('axolotl', ['Aa', 'MM', 'll']);
  assert.equal(d[0].text, 'Albino gene: Aa, carrier');
  assert.equal(d[0].state, 'carrier');
  assert.equal(d[1].state, 'normal');
  assert.equal(d[2].state, 'shows');
  assert.match(d[2].text, /Leucistic gene: ll, shows leucistic/);
  const g = describe('guppy', ['BR', 'GG']);
  assert.equal(g[0].state, 'mixed');
  assert.match(g[0].text, /purple/);
  assert.deepEqual(carriedGenes('axolotl', ['Aa', 'Mm', 'LL']), ['Albino gene', 'Melanoid gene']);
  assert.deepEqual(carriedGenes('guppy', ['BR', 'GG']), []);
});

test('punnett square: four cells with the right genotypes and probabilities', () => {
  const p = punnett('dartfrog', 0, ['Bb', 'SS'], ['Bb', 'SS']);
  assert.deepEqual(p.grid, [['BB', 'Bb'], ['Bb', 'bb']]);
  assert.deepEqual(p.totals, { BB: 0.25, Bb: 0.5, bb: 0.25 });
  assert.equal(p.name, 'Blue shade gene');
  const q = punnett('guppy', 0, ['RR', 'GG'], ['BB', 'GG']);
  assert.deepEqual(q.grid, [['BR', 'BR'], ['BR', 'BR']]);
  assert.deepEqual(q.totals, { BR: 1 });
  assert.deepEqual(locusOutcomes('axolotl', 1, ['AA', 'Mm', 'LL'], ['AA', 'mm', 'LL']), { Mm: 0.5, mm: 0.5 });
});

test('surprises, carriers and the suggestion line', () => {
  assert.ok(isSurprise('axolotl', ['AA', 'MM', 'LL'], ['AA', 'MM', 'LL'], ['aa', 'MM', 'LL']));
  assert.ok(!isSurprise('axolotl', ['Aa', 'MM', 'LL'], ['Aa', 'MM', 'LL'], ['aa', 'MM', 'LL']));
  assert.ok(recessiveFromCarriers('axolotl', ['Aa', 'MM', 'LL'], ['Aa', 'MM', 'LL'], ['aa', 'MM', 'LL']));
  assert.ok(!recessiveFromCarriers('axolotl', ['aa', 'MM', 'LL'], ['Aa', 'MM', 'LL'], ['aa', 'MM', 'LL']));
  assert.ok(!recessiveFromCarriers('guppy', ['BR', 'GG'], ['BR', 'GG'], ['BB', 'GG']));
  const s = suggestPair('axolotl', ['Aa', 'MM', 'LL'], ['Aa', 'MM', 'LL']);
  assert.equal(s.morph, 'golden');
  assert.match(s.text, /25% chance of golden albino/);
  assert.match(suggestPair('guppy', ['RR', 'GG'], ['BB', 'GG']).text, /purple/);
  assert.match(suggestPair('shrimp', ['WW', 'YY'], ['WW', 'YY']).text, /wild brown/);
});

test('economy: a rare morph costs more to buy and sells for more, and buying then selling never pays', async () => {
  const { Career } = await import('../src/game/career.js');
  const { sellPrice } = await import('../src/game/market.js');
  const { ANIMALS, SELL_CAP } = await import('../src/content/economy.js');
  const c = new Career();
  assert.equal(c.cost('animal', 'guppy', 1), 2);
  assert.ok(c.cost('animal', 'guppy', 1, 'gold_red') > c.cost('animal', 'guppy', 1, 'red'));
  assert.equal(c.cost('animal', 'axolotl', 1, 'white_albino'), Math.ceil(60 * morphFactor('axolotl', 'white_albino')));
  assert.equal(c.cost('animal', 'neon', 6, 'whatever'), c.cost('animal', 'neon', 6));
  const common = { sp: 'axolotl', morph: 'wild', age: 100 * 1440, health: 1 };
  const rare = { sp: 'axolotl', morph: 'white_albino', age: 100 * 1440, health: 1 };
  for (let day = 0; day < 60; day++) {
    assert.ok(sellPrice(rare, day) >= sellPrice(common, day));
    assert.ok(sellPrice(rare, day) <= Math.floor(ANIMALS.axolotl.price * morphFactor('axolotl', 'white_albino') * SELL_CAP));
  }
  assert.ok(sellPrice(rare, 5) > sellPrice(common, 5));
  assert.equal(sellPrice({ sp: 'guppy', age: 100 * 1440, health: 1 }, 3) > 0, true);   // animals without a morph still sell
});

test('achievements and commissions read the genetics metrics', async () => {
  const { ACHIEVEMENTS } = await import('../src/content/achievements.js');
  const get = (id) => ACHIEVEMENTS.find((a) => a.id === id);
  assert.ok(get('punnett') && get('rare-find') && get('surprise'));
  assert.ok(!get('punnett').test({}, { genetics: { recessivesBred: 0 } }));
  assert.ok(get('punnett').test({}, { genetics: { recessivesBred: 1 } }));
  assert.ok(get('rare-find').test({}, { genetics: { maxBredRarity: 4 } }) && !get('rare-find').test({}, { genetics: { maxBredRarity: 3 } }));
  assert.ok(get('surprise').test({}, { genetics: { mutations: 2 } }) && !get('surprise').test({}, {}));
});

test('shrimp: a genotype saved before the blue and rili genes still resolves and breeds (the missing genes read as the common allele)', () => {
  assert.equal(morphOf('shrimp', ['rr', 'yy']), 'orange');
  assert.equal(morphOf('shrimp', ['rr', 'YY', 'bb', 'Ll']), 'chocolate_rili');
  assert.equal(morphOf('shrimp', ['rr', 'yy', 'bb', 'll']), 'black');
  const kid = breed('shrimp', ['Wr', 'Yy'], ['rr', 'yy', 'Bb', 'll'], makeRng(3));
  assert.equal(kid.length, 4);
});

test('the guppy breeding guide: every tail recipe makes its tail, and the guide page exists and is linked', async () => {
  const { GUPPY_TAIL_RECIPES, GUPPY_TAILS, guppyRecipeGenes, guppyTraits } = await import('../src/content/guppy.js');
  const { CONCEPTS } = await import('../src/content/concepts.js');
  const { ANIMAL_INFO } = await import('../src/content/species-info.js');
  assert.deepEqual(GUPPY_TAIL_RECIPES.map((r) => r.tail).sort(), [...GUPPY_TAILS].sort());
  for (const r of GUPPY_TAIL_RECIPES) assert.equal(guppyTraits(guppyRecipeGenes(r)).tail, r.tail, r.recipe);
  // a long tail hides the swords
  assert.equal(guppyTraits(guppyRecipeGenes({ size: 'LL', top: true, bottom: true })).tail, 'delta');
  const c = CONCEPTS['guppy-breeding'];
  assert.ok(c && c.widget === 'guppy' && c.sections.length >= 5);
  assert.equal(ANIMAL_INFO.guppy.lesson2, 'guppy-breeding');
  for (const r of c.related) assert.ok(CONCEPTS[r], r);
});

test('the owner\'s strain models are real strains: they parse, round-trip and are sold', async () => {
  const fs = await import('node:fs');
  const { GUPPY_STRAINS, parseGuppy, guppyId } = await import('../src/content/guppy.js');
  const ov = JSON.parse(fs.readFileSync(new URL('../art-src/creatures/overrides.json', import.meta.url), 'utf8'));
  const ids = Object.keys(ov.guppy.guppy.strains ?? {});
  assert.ok(ids.length >= 15, `${ids.length} strain models`);
  for (const id of ids) {
    const p = parseGuppy(id);
    assert.ok(p && guppyId(p) === id && p.sex !== 'female', id);
    assert.ok(GUPPY_STRAINS.includes(id), `${id} sold`);
    assert.ok(fs.existsSync(new URL(`../public/assets/creatures/${ov.guppy.guppy.strains[id].file}`, import.meta.url)), `${id} file`);
  }
});
