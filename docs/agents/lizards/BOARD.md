# BOARD (lizard run). Status 2026-10-04: Round 1 done. ALL WAVES AUTHORIZED by the user (strict on tokens: caps in prompts, watchdog on tool calls). Budgets: S 80k, M 200k, L 400k tokens.

Tree: one shared worktree `AG/wt-lizards` (= REPO), branch `feat/lizards` from 916eb5a. Dev server for browser checks: http://127.0.0.1:4630/ (the lead runs it). The lead manages builders directly (no pod managers); one checker (opus), resumed per batch, cross-checks finished tasks and does the final QA. Only one builder at a time implements in animals.js (the lead schedules; the lock is the safety net): build the logic in its own module first, take the lock for the call-site hunk last. If a lock is taken: do not poll, finish the rest, reply "waiting for lock".
Locks: a file named in more than one row is edited only while holding `BB/locks/<file>.lock` (`mkdir` to take, write your task id inside, `rmdir` after your commit). Applies to animals.js, herp.js, bodyplan.js, controller.js, generator.js, plumbing.js.
In flight: at most 2 builders per pod. `+` = new file. `[L]` = needs the lock. Check commands are proposals until the builder's analysis step writes the failing check.

| id | task | owner (model) | files owned | depends | check (fails before, passes after) | budget | status |
|---|---|---|---|---|---|---|---|
| R1 | Round 1 scouts: MAP, RIG_*, MOTION_*, TRIAGE | 4 scouts (sonnet) | BB | - | files exist | 4xS, used 596k | done |
| Z0 | Harness: seeded, fast-forwarded per-animal state dump (pos, state, surface, in water, in solid) for any preset and species mix, plus counters (stuck, pile, tunnel, water time) | inter (opus) | +tools/steps/state-dump.mjs, +tools/steps/state-dump-run.mjs, +tests/state-counters.test.mjs | - | two runs with one seed give the same dump; every animal has rows; counters tested on a synthetic dump | M | proposed |
| G1 | Gecko bones + the shared lizard bake tool and bone list | gecko (opus) | +tools/bake-lizard.mjs, +tools/rig/lizard.mjs, +tools/rig/lizard-gecko.mjs, public/assets/creatures/gecko*.glb, art-src/raw, CREDITS.md, bodyplan.js lizard plan [L], animals.js SPECIES gecko [L], +tests/lizard-rig.test.mjs | decisions 1-3 | bone list covers RIG_gecko anatomy; every vertex weighted; hi 30k / lo 10k tris; skin stretch in walk poses under the frog's limit; bench sheet | L | proposed |
| G2 | Lizard muscle layer (shared list) + gecko values; tail base coupled to hind-leg retraction; toe attach and peel | gecko | bodyplan.js lizard muscles [L], +tests/lizard-muscles.test.mjs | G1 | every group in BRIEF A.2 present and driven by a joint; tail-base swing follows femur retraction | S | proposed |
| G3 | Gecko ethogram from MOTION_gecko + species data | gecko | herp.js gecko profile [L], animals.js herp() gecko branches [L], +tests/gecko-ethogram.test.mjs | G1, Z0, B4a | seeded 48 h: night-active and day-hidden shares, lick, stalk, durations inside the sheet's ranges; state dump in karst agrees | M | proposed |
| G4 | Shared lizard gait, foot planting, surface adhesion; gecko walk, turn, start/stop, idle, climb on glass and bark | gecko | +src/util/lizardgait.js, +src/render/creatures/lizardpose.js, util/contain.js, animals.js footing/draw/wall mode [L], tools/animals-seq.mjs, +tests/lizardgait.test.mjs | G2, G3 | diagonal pairs half a cycle apart; planted foot slips < 0.5 mm; head yaw residual small; belly gap on a wall inside the sheet's range | L | proposed |
| S1 | Skink bones (uses G1's tool) | skink (sonnet) | +tools/rig/lizard-skink.mjs, public/assets/creatures/skink*.glb, art-src/raw, animals.js SPECIES skink [L], tests/lizard-rig.test.mjs (skink cases) | G1 | as G1 for the skink | M | proposed |
| S2 | Skink muscle values | skink | lizard-skink table, tests/lizard-muscles.test.mjs (skink cases) | G2, S1 | as G2 | S | proposed |
| S3 | Skink ethogram from MOTION_skink + species data | skink | skink.js, animals.js skink() [L], +tests/skink-ethogram.test.mjs | S1, Z0 | seeded 48 h: hidden share, near-water share, freeze on startle, never on glass | M | proposed |
| S4 | Skink animation: consumes lizardgait; freeze; entering a hide | skink | skink.js, animals.js skinkHide [L], tests/lizardgait.test.mjs (skink cases) | G4, S3 | freeze within 0.3 s of a startle, holds the sheet's duration; ends inside the cover footprint | M | proposed |
| B4b | Steps pass through solids: swept move test | inter (opus) | sim/occupancy.js, animals.js herpStep/free/hops [L], tools/steps/interact-fuzz.mjs, +tests/segment.test.mjs | Z0 | fuzz `tunnel` events 0 at 1x and 60x (baseline measured first); thin-solid unit test | M | proposed |
| B1b | Salamander placed on a pool floor | amph (sonnet) | animals.js placement/mediumOf/relocate [L], sim/placement.js, tests | Z0 | 200 seeded placements, none in water; relocate lands on land | S | proposed |
| B1a | Salamander stalls short of its shelter, stands in water | amph | herp.js home goal [L], animals.js herpStep/herpFindHome/herpHomeScore [L] | B4b, B1b | state dump: no firesal stalled > 10 min short of home; water time < 1 % | M | proposed |
| B4a | Pile-ups in the karst tank (gecko home scoring; frog cause to find) | inter | animals.js herpHomeScore/separate/nudge [L], herp.js [L], tools/steps/interact-contacts.mjs | B1a | state dump karst x 3 seeds: pile counter 0 | L | proposed |
| B4c | Animals sitting inside solids in the swamp tank (found by B4b: up to 10.7k in-solid checks per run, 0 in karst) | inter (opus) | animals.js keepFree/insideSolid/placement of the affected kinds [L], sim/occupancy.js | B4b | state dump swamp x 3 seeds: inSolid 0 after the first minute | M | proposed |
| B2 | Tadpoles rest on the bottom | amph | animals.js swim() [L] | Z0 | state dump: bottom-rest share inside the target range set in analysis | S | proposed |
| B3 | Salamander larvae get their own body (gills, four legs) | amph | bodies/salamanders.js, bodies/index.js, animals.js species + herpBirth [L], sim.js, ecology.js, +tests/larva.test.mjs | B2 | larva species distinct; body has gill and leg parts; bench sheet | M | proposed |
| B5b | Plants bend and trail with the flow | water (sonnet) | render/shaders.js, render/airflow.js, sim/plants.js, +src/util/plantbend.js, +tests/plantbend.test.mjs | - | lean points down-flow and grows with speed | M | proposed |
| B5a | Fish: current as a force, energy-aware brain | water | +src/sim/fishmind.js, animals.js swim() call site [L], +tests/fishflow.test.mjs | B2 | idle fish drifts; upstream costs more; rests in slack water; heading not locked to the flow | L | proposed |
| B5c | The missing filter type | water | content/equipment.js, sim/filterflow.js, render/plumbing.js [L], ui/panels/Care.jsx, generator.js gear map [L], tests/filterflow.test.mjs | decision 4 | every FILTERS kind round-trips through filterFlow with a pump curve, hoses and stages | M | proposed |
| B5e | Real pump logic for every filter: pump ladder from product sheets (flow, max head, curve), the pump is chosen by the lift and flow the installation needs (the bigger model when the lift demands it); sponge and matten max head corrected | fresh builder (opus) | content/equipment.js, sim/filterflow.js, generator.js gear map [L], ui/panels/Care.jsx, tests/filterflow.test.mjs, BB/FILTER_SHEETS.md (bigger pump rows) | B5c | for every preset tier x filter kind: lift at most 0.8 x the chosen pump's max head, working point on the sheet curve, turnover target met; no pump figure differs from its sheet row | M | proposed |
| B5d | Water below the substrate drawn at the sim's level | water | render/soilside.js, sim/plenum.js, render/layers.js, plumbing.js [L] | decision 5, B5c | drawn level equals the sim level and moves with the pump | M | proposed |
| C1 | Information panel on click, incl. both lizards | ui (sonnet) | ui/hud/InfoBanner.jsx, editor/controller.js [L], ui/theme.css, +tools/steps/select-panel.mjs | - | click animal, plant, gecko, skink: selection set, card opacity 1, inside the viewport; breaking commit named | M | proposed |
| C2 | Follow mode: menu hidden, Esc or tap returns, double-click or long-tap switches | ui | controller.js [L], ui/hud/TopBar.jsx, ui/App.jsx, ui/store.js, +src/editor/followmode.js, +tests/followmode.test.mjs | C1 | state-machine test + browser step on `S.following`, menu flag, camera back at the saved pose | M | proposed |
| D | 12 biotope presets + per-preset automated checks | presets (sonnet) | content/presets.js, content/biotopes.js, generator.js builders [L], content/habitats.js, animals.js SPECIES range fields [L], +tools/steps/preset-check.mjs, +tests/presets.test.mjs | B1b, B4a, B4b, B5c | every preset x 3 seeds x 2 sim days: nothing in water or in solids, pile 0, stuck 0, featured animal inside its ranges | L (top-up likely) | proposed |
| X | Cross-checks: each manager tries to break the other pod's finished tasks | mgrA, mgrB (opus) | BB/reports/X-*.md | per task | verdict per task | in manager budgets (A 300k, B 400k) | proposed |
| Q | Final QA on the integrated tree, frog tests, lizard check in a real tank (B6) | qa (opus) | BB/reports/Q.md | all | every check together; gecko on glass side-on, on bark, on the ground; skink on the ground, under cover, at the water's edge, against the MOTION frame lists | M | proposed |

## Waves
1. Z0, G1, C1, B5b (1,150k)
2. S1, G2, B4b, B1b, C2 (910k)
3. G3, S2, S3, B1a, B4a, B2, B5a (1,710k)
4. G4, S4, B3, B5c, B5d, D (1,750k)
5. remaining cross-checks, integration, Q (300k)

Projected: Round 2 about 5.8M tokens (pod A 2.06M, pod B 3.56M, QA 0.2M) + Round 1 0.6M spent = about 6.4M. Agents: 4 scouts (done) + 2 managers + 7 builders + 1 checker = 14 of 15; one spare for an escalation.

## New presets proposed (11 exist: cascade, suriname, blackwater, stream, karst, swamp, streambank, reedpool, matano, everglades, jar)
| featured | habitat | tank | water | filter |
|---|---|---|---|---|
| redeye | Caribbean-slope rainforest canopy over a pool | tall | 15 % | matten + fogger |
| firesal | beech-forest spring seep, cool | wide | 8 % | sponge |
| marbled | oak-wood pond margin, cool | standard | 50 % | matten |
| axolotl | Xochimilco canal bed, cool and slack | long | 100 % | canister |
| strawberry | bromeliad slope | cube | 3 % | none, false bottom |
| auratus | cacao-grove leaf litter | nano | 10 % | sponge |
| leucomelas | Guiana boulder forest, seasonally dry | tall | 5 % | false bottom |
| bumblebee | pampas grassland rain pools | standard | 20 % shallow | matten |
| loach | hillstream rapids, strong flow | long | 100 % | canister |
| betta | Thai rice-paddy margin, still water | nano | 90 % shallow | sponge, low flow |
| cpd | Shan-plateau spring pond, cool, dense weed | nano | 100 % | matten |
| blueshrimp | mossy mountain pool | cube | 100 % | sponge |
Spare: cory (clearwater sandbank, wide, canister).

## User decisions (2026-10-04)
1. Models: `sample_…213641.596.glb` = gecko (confirmed by the user), `…213008.005.glb` = skink.
2. Baking allowed; gecko tail straightened; proportions as modelled. Gecko at its real size: snout-to-vent 4.4 cm (total about 6.5 cm with the modelled tail), not 9.5 cm.
3. Frog files: the 3-line lizard hook in `src/render/creatures/skeleton.js` is approved, and the bone cap goes from 21 to 25 (toe-fan bones). Lizards get muscles the way the frogs have them (same runtime mechanism). Frog tests must stay green; tell the water session before the edit.
4. B5c = three filter types: the false-bottom bed with its tower pump, a hang-on-back, an internal filter. Pump-driven, no air. Budget M -> L.
5. B5d = all three: a real body of water in the X-ray and bottom views, a simulated level for LECA layers, groundwater in tanks with no false bottom. Budget M -> L.
6. Gait numbers: row R2-GAIT (scout, sonnet, S) reads the user's three sources and appends "Published gait numbers" to MOTION_*.md.
7. CREDITS: the source of the user's models is always "Peder Winterniz".
8. Strict tokens: caps in prompts plus a watchdog on tool calls; wave 1 only is authorized.
9. Agent ceiling raised by the user from 15 to 30 in total ("go past 15, go to 30"). Rule: a fresh agent per unrelated task (small context), resume only where the context is needed (gecko and skink builders across their stages); never more than 5 in flight.
10. (withdrawn by the user the same minute: "ignore the last command") Rule 9 stands: fresh agent per unrelated task, resume where the context is needed.
11. Pumps: "just follow real pump logics and have the bigger one we need accordingly": existing filters are corrected to real pump figures too, and each installation gets the pump size its lift and flow need (row B5e). Filter figures come from product sheets (BB/FILTER_SHEETS.md); the game shows invented names only.
12. Models: "always use opus 5.5 ... for agents, never opus 5 or any other". Every agent from now on is spawned with model opus (Opus 5.5) and states its model id in its reply. The four Sonnet agents already mid-step (Z0, C1, water B5c, amphibians B1b+B2) finish that step and are not resumed afterwards.

## PAUSED 2026-10-04 (usage limit reached; the lead stopped five running agents)
Stopped mid-step, resumable from their transcripts: B4b (call sites + after-run), C2 (follow mode), B5b-fix (pool plants), G3 (gecko brain), B3 (larva body).
Locks left behind (clear only after checking the file state): animals.js.lock controller.js.lock herp.js.lock 
Uncommitted files at the pause:
 M docs/agents/lizards/CONTRACTS.md
 M src/editor/controller.js
 M src/render/airflow.js
 M src/sim/animals.js
 M src/sim/occupancy.js
 M src/ui/hud/InfoBanner.jsx
 M src/ui/hud/TopBar.jsx
 M src/ui/hud/hud2.css
 M src/ui/store.js
 M tests/plantbend.test.mjs
 M tools/steps/interact-fuzz.mjs
?? docs/agents/lizards/reports/B5b-fix.md
?? docs/agents/lizards/reports/G3.proposal.md
?? docs/agents/lizards/tools/b5b-fix.mjs
?? src/editor/followmode.js
?? tests/followmode.test.mjs
?? tools/steps/follow-mode.mjs
animals.js queue after B4b: B5a hook (reports/B5a.hunk.patch), G4 second authorization (reports/G4a.md hand-off), G3 and S3 hunks (reports/S3.hunk.patch), B3 hunk, skink species row, C1b retry. Failed cross-checks to redo: B5b (pool plants), B1b (click path) with B1a, B5d look. Not started: S1b, S4, B4a, B4c, D, final QA. Frog test filter (2 lines) still needs the user.
RESUMED 2026-10-04 evening: the five stopped steps (B4b, C2, B5b-fix, G3, B3) were resumed. Joint push requested by the user: plan in AG/SHARED.md and the Claude Doc https://claude.ai/code/artifact/84818151-7698-4d92-b67d-4280866913ff; the water and Safari sessions were asked to commit on feat/water2 and feat/finish and not to push; the lizard lead integrates (water, then finish, then lizards) and pushes after the user says when.
PUSHED 2026-10-04 late: the user said "push everything" and then "leave the last three steps and include them in the doc". Integration branch integrate/2026-10-04 (AG/wt-integrate) = 916eb5a + feat/finish 284d8d2 + feat/lizards up to b0d36fa + feat/water2 056ba7b; conflicts in manifest.json (water file + gecko re-import) and shaders.js (both imports); 441 unit tests, 439 pass, 0 fail, 2 skipped; build clean; journey without errors; origin/arch/optimize and origin/main at 8e9eb93; Pages run 37259482389 succeeded. NOT in the push: G3 795615a, B3 aa663d2 and later blackboard commits on feat/lizards; B4b is live with an incomplete check. No agents are running.
