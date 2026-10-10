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

### harlequin (`harlequin`, the harlequin poison frog, Oophaga histrionica; added 9 Oct 2026)
One locus: `G` black and orange-red (the species' base form) / `g` mint green (the owner's scan's own colours; recessive). Morphs: `orange`
(G_, the default look, rarity 1) and `mint` (gg, rarity 2). Freq: g 0.15. Models: `harlequin.swim` (the base) and `harlequin:mint.swim`
(`tools/rig/morph-copy.mjs` after every rebake of the base: the same body with the other colour map); the draw of a one-body frog takes the
animal's morph (sim/animals.js `oneMesh`), `BODIES['harlequin:mint']` is the stand-in until it has loaded.

### guppy (`guppy`, a livebearer with sex chromosomes: sim/livebearer.js; rebuilt 7 Oct 2026)
24 genes (content/guppy.js `GUPPY_LOCI`, in genotype order; the last is the sex). Reference: the owner's aquajocund.com guppy genetics
chart (colour genes largely on the X, Moscow, swords and body markings on the Y father to son, ground colours autosomal), plus the
Encyclo-Fish sheet's 12 tails, 7 patterns and 28 colours.
- Ordinary genes: tail colour `B`/`R` in-between (RR red, BR purple, BB blue: kept ordinary so red x blue still makes purple); gold `g`,
  albino `a`, yellow `y` (no red: red > yellow, purple > lime, blue > green), white tail `v` (with yellow: pastel), big ear `e`, flag `h`,
  swallow `z` recessive; black `N`, leopard `D`, pointed tail `C`, ribbon `I` dominant; tail size `L`/`S` in-between (LL long, LS medium,
  SS short).
- On the Y (father to son only, a female has none: written '--', a male '-A'): top sword `W`, bottom sword `U`, snakeskin `K`, Moscow `F`,
  platinum `P`, Japan blue `J`.
- On the X (a daughter has her father's X and one of her mother's; a son's comes from his mother: male written 'A-'): mosaic `M`, grass
  `Q`, half-black `T`, neon `O`.
- Sex: 'XX' female, 'XY' male; the father's gamete decides. Fry are half and half; founders come as trios.
Tails (12, the sheet's): LL: flag (hh) > veil (point) > delta, swords hidden; LS: both swords lyre, one sword top/bottom sword, else spade
(point) or fan; SS: both swords double sword, one sword top/bottom sword, else pin (point + flag), spear (point) or round. Patterns:
snakeskin + leopard = cobra, snakeskin + mosaic = tiger, leopard hides mosaic and grass, mosaic and snakeskin hide grass. Albino hides
gold, half-black, Moscow and black. Ribbon males cannot sire (real: the gonopodium is too long). Mutation per allele is the species rate
x 3 / genes (so a baby carries a mutation about as often as in a three-gene species, ~6 %).
Morph ids (the strain a male shows): ground · moscow · platinum · japan · neon · tuxedo · colour · pattern · tail · ribbon · swallow ·
dumbo, defaults left out (`red` = a plain red delta). 47 strains sold (`GUPPY_STRAINS`); 430 080 male strains can be bred, all drawn
differently: each male wears his own tail of the 12 (render/creatures/guppymodel.js, built by art-src/guppy/tails.py), a female her
size class. In the game: the Field Guide page "Breeding guppies" (content/concepts.js `guppy-breeding`, its tables built from
`GUPPY_LOCI` and `GUPPY_TAIL_RECIPES`, every recipe checked against guppyTraits in tests/genetics.test.mjs), linked from a guppy's info
card and the Lab's Genetics tab. Odds: daughters and sons
are enumerated apart; when a pair has over 40 000 phenotype classes the odds come from 20 000 seeded simulated births (`approx`).
`genotypeForMorph(id, morph, rng, { female })` builds a strain's genotype gene by gene (`guppyGenotypeFor`). Old saves are made whole for
the fish's sex (`sexGenes`). Tests: tests/genetics.test.mjs (incl. Y father-to-son, X mother-to-son, births vs exact odds, all 12 tails),
tests/livebearer.test.mjs; in the sim: tools/steps/guppy-breed.mjs (60 game days, two pairs).
Livebearing (sim/livebearer.js): a fed, healthy adult female with a fertile male (her paired male, else any) conceives at `breed` 0.35 a
day (a brood every ~6 game days, as a real female's ~30 days on the game clock), keeps his sperm for 3 more broods, carries for 3 game days
and drops 3-8 fry (fewer as the tank fills: the 60-day probe peaked at 43 of a 40 cap); a breeder who wants a known father uses a virgin
female (the info card says which).
Bodies: the owner's male and female GLBs, each look with its own texture painted at run time (render/creatures/guppymodel.js,
guppypaint.js); fan and round tails are the owner's tail scaled; ribbon and swallow stretch the model's own belly and dorsal fins.

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
