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

## Not done
- A marbled newt body (the salamander session owns `salamanders.js`).
- Visible filter hardware (a foam block in the corner, the pump tower and egg-crate at the glass), a cut-away of the plenum.
- Monstera leaves have no holes (the procedural blade has none); java moss and anubias are simple procedural shapes.
- Not measured with the metrics tool on the Windows laptop; the lazy plant meshes should make loading cheaper, unmeasured.
