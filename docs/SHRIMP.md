# Dwarf shrimp

The cherry shrimp and the blue dream (*Neocaridina davidi*): the model, how it moves, what it does, and its colour lines. Before this
they were a procedural body that read as a little lobster (thick plates with dark rims, thick legs splayed like a spider's) driven by
the generic crawler (walk somewhere at random, rest, now and then swim or flick).

## The model

`art-src/raw/shrimp_mesh.glb` (the owner's scan, 10k triangles) baked by `node tools/bake-creature.mjs shrimp`:

* **Rig** (`tools/rig/shrimp.mjs`): the scan is split into body and limbs by thickness (`tools/rig/appendages.mjs segment`), then the
  limbs are classified: the front pair with the pincers (leg ids 15 / 16: they pick at the ground and carry to the mouth), the walking
  legs (1 … 4, the two sides half a cycle apart; the `invert.wave` rig steps them in a wave from tail to head), the antenna stubs (7 / 8),
  the eyes (analytic eyes, `finish.eyes`), the tail fan (body: it curls with the tail flick). The rig also **adds geometry** the scan
  lacks: long antenna whips (as long as the body), short forked antennules, five pairs of swimmerets under the abdomen (leg id 10: they
  beat while it swims and fan slowly while it stands) and an egg clutch (leg id 14, folded to a point inside the abdomen unless the shrimp
  is berried: `invert.eggs` and the `spread` channel in `render/creatures/instanced.js`). The scan's tail fan is folded to 60 % of its span
  and its walking legs drawn in under the body (a shrimp does not stand like a spider).
* **Size**: scaled by the body (`rig.length`, not the whips): 1.6 cm from the rostrum to the base of the fan, about 2 cm to its tip, a
  grown female. Males are drawn smaller (`a.sizeK` 0.76 … 0.84, females 0.95 … 1.05; saved).
* **Leg ids above 8** need `rigLeg: 16` in the manifest (the baked `_RIG` attribute stores leg / rigLeg).
* **Colour**: one texture for every colour line. It is a pigment mask (`tools/paint/shrimp.mjs maskTexel`): R pigment density (1 coloured
  … 0 clear shell: the belly, the joints, the fan's rim, pale flecks), G shading (occlusion, the seams between the plates, the pigment
  cells' stipple), B how far toward the deeper back colour. `render/creatures/material.js` (`finish.palette`) colours it per line from
  `content/morphs.js SHRIMP_PALETTE`; the eggs are yellow by their rig id. The blue dream is the same file in blue (`paletteMorph`).

## Colour lines (genetics)

`sim/genetics.js`: three recessive pigment genes and a dominant pattern gene, the hobby's simplified picture.

| genes (two copies each, rili one) | line |
|---|---|
| none | wild brown (glassy, `clear` 0.7) |
| red | cherry red |
| yellow | yellow |
| blue | blue |
| red + yellow | orange |
| yellow + blue | green jade |
| red + blue | chocolate |
| red + yellow + blue | black rose |
| any of the above + rili | the same with a clear band across the middle (red rili, …, carbon rili) |

Allele frequencies for a random founder (the store's "random mix"; a chosen line is bred true): red 0.5, yellow 0.15, blue 0.12,
rili 0.03. A save from before the blue and rili genes has two genes: `genetics.js complete()` reads the missing ones as the common allele.
Names, rarity, price and swatches: `content/morphs.js`. Each line is its own mesh key (`shrimp:blue`), all drawing the one file.

## Behaviour: `sim/shrimp.js`

Pure, like `crab.js` and `herp.js`; `tests/shrimp.test.mjs`. `Animals.shrimp()` senses and carries out.

| mode | when | what it does |
|---|---|---|
| `graze` | most of the time | stands and picks with the pincers (several picks a second), shuffles a few mm or turns now and then; after 25 … 100 s moves to another patch, by walking (3 … 10 cm) or swimming (9 … 26 cm), preferring rich patches (moss, wood, stone, plants; bare sand least) |
| `food` | food it can smell (38 cm), once the scent has spread (1.2 s per cm since it landed) | walks or swims to it; each shrimp stands at its own place round it and picks fast; a flake is picked clean by many bites; cast shells are picked at for their minerals |
| flick | a danger within 4 cm (a fish that eats shrimp; the camera only when it swoops) | one snap of the tail, backwards, then `hide` |
| `hide` | soft after a moult, or frightened | to the best cover near (overhangs, moss, water plants) and stays, picking slowly |
| `moult` | every 21 … 35 days (7 … 12 young) | to cover, a still spell, the snap: the old shell stays on the bottom on its side (`render/creatures/shells.js`, glassy, crumbling as it is picked at, gone in one or two days); soft for 3 … 8 game hours |
| `swarm` | a male hears a grown female that has just moulted (45 cm) | swims fast from place to place round where she was for 20 … 60 game minutes (the "mating dance"); she is berried for about a month after (eggs under the tail, swimmerets fanning) |

The berried state is drawn; births are still the sim's breeding chance (`sim/sim.js`), not tied to it.

## Checking

* `npm run test:unit` (`tests/shrimp.test.mjs`, `tests/genetics.test.mjs`).
* `node tools/bench.mjs 'shrimp:*' --src=glb --views=three,top` (every line), `--pose=claw --extra='{"eye":1,"breath":1,"throat":1}'`
  (pincers, antennae, swimmerets), `--pose=hop --extra='{"hop":1}'` (tail flick), `--pose=stand --extra='{"pose":1}'` (eggs).
* `node tools/look.mjs --species=shrimp --spot=bottom --count=8 --food=6 --view=three --dist=17` (a group crowding food in the tank).
