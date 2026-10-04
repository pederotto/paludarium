# Keeper's care sheets in the game (2026-10)

The user supplied care sheets for paludarium animals, a bioactive cleanup crew and filtration (a false-bottom build guide).
This note says what of it is in the game, where, and what is left. Branch `feat/caresheet`.

## Animals

| id | species | kind / brain | body | notes |
|---|---|---|---|---|
| cpd | Celestial pearl danio | swim (school) | `bodies/tetras.js` TETRAS.cpd | pH 6.5–7.5, GH 5–12, gentle flow, keep 6+ |
| pygmy | Everglades pygmy sunfish | swim | user's sunfish model, `public/assets/creatures/pygmy.glb` (SDF fallback TETRAS.pygmy) | still water, territorial males, eats young shrimp |
| blueshrimp | Blue dream shrimp | crawlWater | `crustaceans.js` shrimp('blue') | a separate species, not a shrimp gene (old saves' genotypes stay valid) |
| panther | Panther crab | crab, `PANTHER` profile (`sim/crab.js`) | `crustaceans.js` crab('panther') | aquatic: no exit/drowning/digging, hauls out (`haul` mode), hard water |
| skink | Red-eyed crocodile skink | skink (`sim/skink.js`) | `bodies/lizards.js` | hide/forage/soak/bask/freeze/flee/play dead; UVB and warm spot |
| bumblebee | Bumblebee toad | frog, `drowns` | `frogs.js` melanophryniscus | water ≤ 2.5 cm or it drowns |
| reedfrog | Starry night reed frog | frog + `perch` | `frogs.js` heterixalus | climbs plants by day (`Animals.perchFrog`), down at dusk |
| marbled | Marbled newt | newt (salamander session's brain) | falls back to BODIES.newt until BODIES.marbled exists | cool water, still |
| purpleiso, pandaking, springpink | crew variants | crawlLand | palette variants of isopod/springtail | `crew` weight for mould and litter; panda king `drowns` (falls in without a ramp) |

Every new species has: a SPECIES row (`sim/animals.js`), HABITAT row, shop row (`content/economy.js`), Field guide entry
(`content/species-info.js`), a baked portrait. Group sizes for territorial species come sexed (one male).

## Care rules (`Sim.careStress`, `sim/sim.js`)
Species fields: `ph`, `gh`, `flow`, `uvb`, `bask`, `land` (hint), `flock`, `territorial`, `crew`, `drowns`. Penalties are
small on purpose: the game's stress scale is steep (0.1 stress kills in about four game days), so a mildly wrong setup costs
little and a badly wrong one still kills; UVB and warm-spot deficits build up over days.

## Water and filtration
- Per water body: `ph`, `gh` (mixed along flows with the rest of `CHEM`), `flow` (`sim/waterbodies.js`). GH drifts to the
  water source plus rock (`MINERAL`); pH to what GH buffers, minus CO2, nitrate and tannins (`TANNIN`: wood, roots, cork).
- `content/equipment.js`: `FILTERS` (sponge, corner foam "Mattenfilter", canister: media cap, flow, oxygen, intake
  suction that takes baby shrimp and fry unless the pre-filter is on), `WATER_SOURCES` (tap, soft/RO, remineralised RO,
  hard lake water). Gear `filterMatten`, `uvb`. The false bottom adds a filter bed (bio-rings in the plenum).
- Care panel: filter tiles, pre-filter toggle, water source; Light tab: UVB tube. Status drawer: pH, GH, current.
- Concept cards: `water-hardness`, `filtration` (includes the false-bottom build steps), `uvb`.

## Plants and hardscape
Plants `anubias`, `javamoss`, `monstera` (procedural). Plant species meshes are now built on first use (they were all built
at start for every tank). Pieces `cork` (a split bark tube: a hide, the arch's inside stays free for animals) and `slate`.

## Presets and biotopes
`streambank` (New Guinea, skink), `reedpool` (Madagascar, reed frogs, danios, blue shrimp, false bottom), `matano` (Lake
Matano, panther crab, hard water, canister, slate), `everglades` (pygmy sunfish, still water). Each biotope also yields a
commission. New biotope features: `hardwater`, `softwater`, `stillwater`, `uvb`, `falsebottom`.

## Checks
- `node --test tests/*.test.mjs` (tests/caresheet.test.mjs: skink mind, panther profile, tables, species completeness).
- `GEN_LIST="streambank:1:standard,reedpool:1:standard,matano:1:standard,everglades:1:standard" node tools/shot.mjs --steps=tools/steps/gen-check.mjs --only=desktop`
  (10 game days, no deaths; the existing presets also pass).
- `tools/steps/caresheet.mjs` (every new species in one tank, a day, modes and stress reasons), `caresheet-look.mjs`,
  `preset-look.mjs` (pictures), `tools/bodycheck.mjs <id>` (mesh triangles and rig sanity).
- Sunfish model: `tools/bake-texcolors.mjs` then `tools/bake-sunfish.mjs` then `npm run import-creatures`.

## Second pass (2026-10-02 evening)
What the first pass listed as not built or simplified, now in:

- **Food** (`content/foods.js`, `sim/animals.js` feed/food, `app/actions.js` Care.feed/feeders, Care > Feeding): prepared
  foods are items in the water with a kind: flakes (float, sink slowly), pellets (sink at once), bloodworms (a thawed cube
  breaks into wriggling worms). `flake` in a diet stands for all three (`dietOf`); the pygmy sunfish lists only `bloodworm`
  (the auto-feeder drops freeze-dried bloodworms for fish like it). Live feeders are species with `feeder: true`: crickets,
  dubia roaches, earthworms (dig in, `crew`), waxworms; bought by the cup and let go near the animals that eat them, never
  bred, never counted as losses, no refuge (all catchable). Diets updated (skink, toad, fire salamander, newts, gecko, reed
  frog). The Feeding tab lists who in the tank eats what; the Field guide shows real food names. Concept card `feeding`.
- **Seashore springtails** (`springsea`): walk the water's surface film and the wet shore (crawl medium `surface`), graze
  the new **surface film** (`Env.film`: grows on still water with detritus, broken by current, halves gas exchange when
  thick, `film` grazers clean it). Frog and fish food.
- **False bottom as real water** (`content/equipment.js plenumState`, `Env.plenumH`): the egg-crate height is a setting
  (set to just over the water when the false bottom is first fitted; Care > Foundation slider with the water line's
  distance to the mesh). Water over the mesh: `mud`, the land soaks up (climate soil waterlogged, `drainEff` 0, plants
  "waterlogged roots", a journal warning once a day). Water far under it: the plenum's filter bed counts only as far as it
  is wet.
- **Substrates** (`SUBSTRATES`: topsoil, ABG mix, coco coir, coir under sphagnum): drainage and mould food; **black foam
  background** (`Env.backdrop`, a uniform in the wall shader, `U.backdrop`).
- **The build through the glass** (`render/soilside.js`): one mesh of strips inside the front and side glass from the floor
  to the ground, one material, layers from uniforms: LECA balls with water in the bottom, or the egg-crate with bio-rings and
  the plenum's water at its true distance under the mesh, the fibreglass mesh, the substrate's grains, bark, charcoal,
  fibres or sphagnum, the litter, mud when flooded. Drawn as a cut-away scaled to the ground at the glass (generated tanks
  slope down to ~4 cm at the front).
- **Filter hardware** (`render/plumbing.js filterGear`, same merged mesh and material as the pump): pump-driven, no air.
  Sponge box and canister stand in the cabinet under the tank, fed by an overflow standpipe through the floor, the return
  jetting back through a second bulkhead; corner foam block with its pump and riser; the false bottom's open slotted tower
  shows the plenum's water line. `sim/filterflow.js` (2026-10-04): each pump's curve against the lift from the cabinet, the
  media stages' clog and the hose; real hose sizes (9/12 to 19/27 mm), the water's speed in each hose drawn as v = Q / A.
- **Pieces**: `bamboopole` (upright or leaning), `floatlog` (rides the water level: `Decor.settle`/`refloat`), `pebbles`
  (smooth river pebbles, stamped: a gentle textured slope). **Plants**: `fissidens`, `rotala` (stem plant, pink tips);
  monstera leaves with real holes, anubias with stalks and oval leaves, java moss as branching strands (`shapedLeaf`).
- **Tank-shape rules**: species `minL` (litres), `minH` (cm), `land` share against `World.landShare()`; mild stress
  (`Sim.tankRules`) and a Tank line in the Field guide with this tank's numbers.
- **Marbled newt** body (`BODIES.marbled`, `salamanders.js`): the paddle-tail frame slimmer and longer, green blotches in a
  black lace, orange back stripe, newt rig.
- **Reed frogs** perch on plants, wood, cork, roots, stumps, bamboo poles, floating logs (ray-cast tops) and the glass
  (belly to the glass, head up); each frog has a habit (`perchLike`); they wade or swim to the foot of a climb; `perch.left`
  says why one came down (dusk, hunting, hungry).
- **UVB and the warm spot are local**: `Climate.uvbAt` (the tube beside the basking lamp, 60% of the width, leaves shade it,
  fades with depth), averaged per animal over three days (`a.uvAvg`); the warm spot counts only if the animal spends about an
  hour a day at its basking temperature (`a.baskAvg`).
- **Isopods walk in**: a heavy crawler that cannot swim (`drowns`) can lose its footing on a steep bank (a drop of over 6 mm
  a centimetre ahead), or be pushed in; in the water it walks the bottom to a slope or a ramp of rock, wood or bark and climbs
  out (`Animals.sunkCrawl`), or drowns.

Checks: `tests/caresheet.test.mjs` (foods, plenum, substrates, rows), `tools/steps/caresheet2.mjs` (a day with every food,
the pieces and plants, flood test, pictures), `tools/steps/perch.mjs`, `tools/steps/isopod-bank.mjs`,
`tools/steps/soil-look.mjs`. gen-check: streambank, reedpool, matano, everglades, suriname, starter jar: 10 days, no deaths.

## Not done
- Not measured with the metrics tool on the Windows laptop: the soil profile adds one material (a dozen hash lookups per
  fragment on a strip at the glass) and the feeders four small species meshes, built when first fed.
- Feeders are not dusted or gut-loaded in the sim (calcium is not modelled); crickets do not bite sleeping animals.
- The UVB tube has no visible fixture of its own; the soil profile is not drawn on the back glass (the background is there).
