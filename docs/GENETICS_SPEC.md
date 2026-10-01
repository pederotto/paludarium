# Genetics spec (game-simplified Mendelian genetics)

Shared contract between the logic (src/sim/genetics.js, src/content/morphs.js), the renderer (morph bodies under
src/render/creatures/bodies/) and the UI. The genetics are real in kind (alleles, dominance, carriers, Punnett
squares, incomplete dominance, mutation) but simplified to one to three loci per species so a player can reason about them.

## Data model

- A **locus** has two alleles, written as single characters. Upper case is the dominant or "normal" allele unless the
  locus says otherwise.
- An animal's **genotype** is an array with one two-character string per locus, in locus order, alleles sorted with the
  dominant one first: `['Aa', 'MM', 'll']`. Incomplete-dominance loci use `R`/`B` and sort alphabetically (`'BR'`).
- `animal.genes` holds the genotype, `animal.morph` the phenotype id (see tables), both set when the animal appears
  (founders from the shop or the Animals tool; children by `breed`). Animals of species without genetics have neither.
- Eggs and tadpoles carry the genotype of the animal they will become (clutch eggs carry both parents' genotypes and each
  hatchling draws its own genotype).
- Inheritance: for each locus take one random allele from each parent. Mutation: each inherited allele flips to the other
  allele of that locus with probability `MUTATION` (default 0.01, exported and changeable). A child whose morph differs
  from what either parent could produce without mutation is logged as "a surprise".
- Founders: bought or released with a chosen morph get the matching genotype (homozygous for recessive morphs). Founders
  without a chosen morph sample each locus from the species allele frequencies (`freq`), so wild-looking animals can
  be hidden carriers.

## Species, loci and morphs

Morph ids are also the body variants the renderer provides: `BODIES['<species>:<morph>']` (see bodies/index.js), each a
body factory with the same signature as `BODIES['<species>']`. `BODIES['<species>']` stays the default (first morph).

### axolotl (`axolotl`; currently never breeds: give it `breed: 0.03`, adultDays 30, eggs like a newt clutch)
Loci (complete dominance, recessive traits): `A` normal / `a` albino; `M` normal / `m` melanoid; `L` normal / `l` leucistic.
Resolution order: `mm` -> `melanoid`; `aa` and `ll` -> `white_albino`; `aa` -> `golden`; `ll` -> `leucistic`; else `wild`.
Morphs: `wild` (dark olive-brown with gold speckle, dark eyes, rarity 1), `leucistic` (pink-white, dark eyes, red gills, rarity 2;
the current default look), `golden` (golden-yellow albino, pale pink eyes, rarity 3), `melanoid` (uniform near-black, rarity 3),
`white_albino` (white-cream, pink eyes, pale pink gills, rarity 4). Freq: a 0.15, m 0.10, l 0.25.

### dartfrog (`dartfrog`, blue poison frog, already breeds)
Loci: `B` cobalt / `b` sky blue (recessive); `S` many spots / `s` few spots (recessive).
Morphs: `cobalt_spotted` (B_ S_, the current look, rarity 1), `cobalt_clean` (B_ ss, rarity 2), `sky_spotted` (bb S_, rarity 2),
`sky_clean` (bb ss, rarity 4). Freq: b 0.2, s 0.25.

### guppy (`guppy`, already breeds)
Loci: `C` tail colour with INCOMPLETE dominance, alleles `R` and `B`: `RR` red, `BR` purple (the heterozygote is intermediate),
`BB` blue; `G` normal / `g` gold (recessive; `gg` overrides the colour).
Morphs: `red`, `purple`, `blue`, `gold`. Rarity: red 1, blue 2, purple 2, gold 3. Freq: R 0.6, g 0.1.

### betta (`betta`; currently never breeds: give it `breed: 0.02`, adultDays 40)
Loci: `C` incomplete dominance `R`/`B`: `RR` red, `BR` purple, `BB` blue; `X` normal / `x` cellophane (recessive, pale translucent).
Morphs: `red`, `purple`, `blue`, `cellophane`. Rarity: red 1, purple 2, blue 2, cellophane 4. Freq: R 0.6, x 0.1.

### shrimp (`shrimp`, cherry shrimp, already breeds)
Loci: `W` wild brown / `r` red (recessive, the common pet "cherry"); `Y` normal / `y` yellow (recessive).
Morphs: `wild` (W_ Y_, translucent brown, rarity 1), `red` (rr Y_, rarity 1), `yellow` (W_ yy, rarity 2), `orange` (rr yy, rarity 3).
Freq: r 0.5, y 0.15.

Every other species has no genetics.

## Logic API (src/sim/genetics.js, pure, no DOM, no three.js, seedable)

`SPECIES_GENETICS[id]` (loci, morph resolver, frequencies), `hasGenetics(id)`, `randomGenotype(id, rng)`,
`genotypeForMorph(id, morphId, rng)` (a genotype that shows that morph; recessive morphs homozygous, others may carry),
`morphOf(id, genes)`, `breed(id, genesA, genesB, rng, { mutation })` returning a child genotype, `describe(id, genes)`
(per-locus human text: name, alleles, "carrier", "normal", "shows"), `punnett(id, locusIndex, genesA, genesB)` (a 2x2 grid of
genotype strings with probabilities), `outcomes(id, genesA, genesB)` (probability of each morph in the offspring, exact, by
enumerating the loci), `rarity(id, morph)`. Content text in src/content/morphs.js (names, one-line blurbs, rarity, price multiplier).

## Rendering contract

`createSpeciesMesh(scene, id, { morph })` in src/sim/animals.js builds one instanced creature mesh per (species, morph), using
`BODIES['<id>:<morph>']` when present and `BODIES[id]` otherwise; each animal is drawn by the mesh of its own `morph`.
Bodies are built by passing a palette/pattern parameter to the same body builder, not by copy-pasting geometry.
