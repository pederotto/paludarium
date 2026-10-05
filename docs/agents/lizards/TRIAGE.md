# TRIAGE.A: animal backlog (R1-TRIAGE-A), read-only recon at 916eb5a (arch/optimize)

Units are cm. "Confirmed" = read in the code at 916eb5a; "guess" = not yet shown. Nothing was run (no sim, no browser).
Not verified: HANDOFF.md and the two memory notes (my shell greps failed); the A/B result for the karst gecko overlap (status file lists the run, not the number).
Leads checked: finish-plan rows 4-10 are all "todo". `wt-finish` holds 7 STAGED files (herp.js, animals.js, Veil.jsx, lizards.js, salamanders.js, drop-pull, CLAUDE.md): marbled-newt land life, gecko/skink raise, Veil wait. None of it touches any item below except as noted. It is not in the committed tree.

## B1a Fire salamander stalls short of its shelter
1. Code: walk-home goal herp.js:297-300 (`case 'hide'`: `it.goal = home` every frame, `atHome` = within 2.5 cm, herp.js:231); executed by animals.js `herp()` (3851), medium/maxD 3951-3953, `herpStep` (~3971; `free` lambda 3983); home choice `herpHomeScore` firesal branch (4086-4092), `herpFindHome` (~4099), re-pick only when score < 0.28 (3869).
2. Cause (confirmed by reading, mechanism): the home is scored by cover only (herpCover: solid overhead at g+2.2, moss, litter) and by `okFor('land')` at the home point; reachability of the path is never checked. A step is refused when the next point fails `okFor('land')` (water, solid at g+0.5, wall relief), or `walkBlocked` (plant stems, cliff). If the 5 side-steps fail too, `herpStep` clears the goal and pauses 1-2 s (`!ok` branch), then `hide` sets `it.goal = home` again next frame. Nothing ever gives the home up: `herpHomeScore` tests `this.badHomes` (4088) but only the crab pushes to it (2461). `hStuck` (~3908) is reset the same way. So it loops at the first blocked cell. The 12-18 cm is NOT a constant in the walker (arrival 2.5 cm, step stop 0.15 cm): it is where the blocker is. Which blocker (pool edge, stems, overhang solid) is a guess until dumped.
   Standing in water (guess, three routes): (a) `herpStep` lets an animal that is where `okFor` fails step "toward the middle" (3983), not toward shore; (b) mode `soak` allows 1.8 cm of water by design (3952); (c) B1b.
3. Left behind: nothing written. No patch or status file holds a stall fix (grep of finish/team-amph/wk-amph-life/team-interact/wk-contacts/round4 patches: only `herpStep`-free hunks for other items). The notes name no cause; "traced to the walk-home code" is not recorded anywhere I could find. The one firesal hunk in finish.patch:321 is the marbled newt (`a.hm?.onLand` in herpHomeScore), unrelated.
4. Check: extend `tools/steps/amph-life-day.mjs` (seeded, fast-forwarded, cool scene has 3 firesal, per-animal stuck time already reported). Add per firesal and per 10 game min: mode, distance to `a.hh`, `a.hmoved`, depth at pos, and the reason `free` refused. Fails now if: (any firesal in mode `hide`, distance to home 8-25 cm, moved < 0.004 for > 120 s) > 0, or share of firesal time in water deeper than 0.3 cm outside mode `soak` > 0. Pass: both 0 over seeds 1-3 x 24 h. Add a pure unit test in `tests/herp.test.mjs` for any new "give up a home" rule in herp.js.
5. Touches: animals.js (herp region 3851-4190, `herpStep`, `herpHomeScore`), maybe herp.js (hide/needHome). Shared with B1b (same region, same file) and the staged marbled-newt edit in wt-finish (herp.js waterThink/hide). Not the frog pipeline. wt-water2 edits animals.js: merge risk.
6. Size: M (diagnose S, then reachability test + badHomes push + a fallback home).

## B1b Salamander placement on a pool floor, relocated again and again
1. Code: `placement()` animals.js:782, `case 'newt'` (~822) serves firesal too; `mediumOf` (1381, `newt` falls to `'any'`); `relocate` (1392) called from `keepFree` (1299) and the stuck path.
2. Cause (confirmed by reading for the placement; guess for the loop): `case 'newt'` accepts a click on water and puts the animal at `ground + min(1, depth*0.3)` for every newt, firesal included; there is no firesal branch (it is a land animal: medium 'land', maxD 0.6 in `herp()`). Once on a pool floor `okFor('land')` is false everywhere around, so `herpStep` only moves it toward the tank middle (3983). The stuck/inside paths relocate it with medium `'any'` (`mediumOf`), so the "nearest free cell" is another cell of the same pool: the loop (guess: not run).
3. Left behind: finish-plan row 9 "todo", no code. The comment at animals.js ~3957 ("relocated, swam back, and so on, many times a second") is a landed fix for newts over sunken wood, a different loop.
4. Check: a new node/headless test: `placement('firesal', hit)` on a point with water surface above ground must return `{error}` (fails now: returns a pos); then relocate: 20 relocations of a firesal started on a pool floor must end on `okFor('land')` ground (fails now if `mediumOf` stays 'any'). Needs a World without a browser: only `tests/erosion.test.mjs` and `tests/hydro.test.mjs` build one, so reuse their setup (not verified that Animals can be built the same way); otherwise the amph-life-day probe with a forced placement.
5. Touches: animals.js `placement` + `mediumOf`/`relocate` (a firesal case), possibly `src/ui` message text. Shares animals.js with all; shares logic with B1a (same herp region only if relocate is changed there). Not frog pipeline (frog/toad cases untouched).
6. Size: S.

## B2 Tadpoles never rest on the bottom
1. Code: species 497-502 (`kind 'swim'`, `band 'bottom'`, `school false`); behaviour is the generic fish `swim()` animals.js:1459-1580, band target at 1518 (`floor + 1.0`), height clamp `f2 + 0.5`.
2. Cause (confirmed by reading): `swim()` has no rest state: a steady wander/steer + `a.vel.lerp(desired)`; the only slow-down is the food nibble (`a.nib`). The bottom band only sets a depth target, so a tadpole cruises 1 cm above the floor forever (a grep for rest/idle/hover in swim() finds nothing). Body: FROGS.tadpole (render/creatures/bodies/frogs.js:749) has a single pose.
3. Left behind: finish-plan row 6 "todo". wk-amph-life.status line 7 says "adding caudate+tadpole swim behaviour to my scope"; nothing for tadpole rest is in `swim()` at HEAD (not found in the patches either: the tadpole hunks are probe scenes only).
4. Check: `amph-life-day.mjs` warm scene (6 tadpoles, in the tree). Add, per tadpole, the share of daytime samples with (y - floor) < 1.0 and speed < 0.3 cm/s. Fails now (about 0 by reading; measure it). Pass target is a builder call; a believable share is a guess of 30-50 % by day, from watching real tadpoles, not from a source. Keep `speed 1.6` swim bouts so it still looks alive.
5. Touches: animals.js `swim()` (shared with every fish: gate by a species flag or `sp.young`, so corydoras/loach are unchanged), maybe a rest pose in frogs.js (frog pipeline file: leave it, or ask). Region disjoint from B1/B4 inside animals.js.
6. Size: S-M (M if a rest pose is wanted).

## B3 Salamander larvae drawn as frog tadpoles
1. Code: `herpBirth` animals.js:4172-4190 does `this.add('tadpole', ...)` and sets `c.parent = a.sp`; same species for frog and salamander young; mesh FROGS.tadpole frogs.js:749-770; metamorph sim.js:389-392 (uses `a.parent`); logs sim.js:445,451; prey lists naming 'tadpole' at animals.js:303,316,436; `ecology.js:59` counts 'tadpole'; `ONE` map 510; `where: 'water'` hatching.
2. Cause (confirmed): there is no larva species or body; the firesal larva is the frog tadpole mesh. salamanders.js (`src/render/creatures/bodies`) has no larva.
3. Left behind: finish-plan row 7 "todo"; the probe already places `tadpole` with `parent: 'firesal'` in the cool scene (amph-life-day.mjs), a ready test bed. Staged edits to salamanders.js sit in wt-finish (61 lines, not committed; contents not read).
4. Check: unit test (new `tests/larva.test.mjs`, node): a firesal birth produces animals whose species id is not 'tadpole' and `SPECIES[id].body` resolves to a body with its own sdf; metamorph still returns the parent; `eats` lists that name 'tadpole' also name the larva. Visual: the existing portrait bake (`tools/bake-portraits.mjs --only=<id>`) and one contact sheet by the checker, not a screenshot loop. Whether the body mesher can run in node: not verified.
5. Touches: salamanders.js (new sdf: long body, 3 feathery gill pairs, 4 legs, finned tail; registered via bodies/index.js), animals.js (SPECIES row, `herpBirth`, prey lists, `ONE`), sim.js (hatch/metamorph names), ecology.js (grazer count), portraits. Shares animals.js with all; shares the `tadpole` code with B2 (flag/rest rule must cover the new id); avoid frogs.js and the frog pipeline files. Alternative without a new species id: pick the mesh by `a.parent`; more render plumbing, so the new id is simpler.
6. Size: M.

## B4a Frogs and geckos pile up in the karst tank
1. Code: gecko shelter choice `herpHomeScore` animals.js:~4062-4072 (`near` term) and `herpFindHome` (~4099); gecko `hide` herp.js:522-527 (`atHome` 2.5 cm); separation `separate()` 3598-3668 and `nudge` 3670; `crowded()` 3448 (hop landing spots only, group 'land'); frog sitting/perch choice ~2123 (not read).
2. Geckos (confirmed by reading, mechanism): a wall home scores `cov*0.5 + near*0.25 + ...` where `near` = 1 if another gecko's home is within 7 cm. That is deliberate positive feedback ("sleeps by day with others") with no capacity limit, so every gecko picks the one best covered spot; they sit within 2.5 cm of the same point; separation is a soft push (wall group, dz = 0) against a goal that pulls them back. Karst has few covered spots, so it shows most (guess for why karst). Frogs: not diagnosed (guess: a few perches/sitting spots with the favourite-perch habit; `crowded` is checked only when a hop target is picked, not when sitting).
   The earlier fix (wk-contacts: sideways fallback in `nudge`, 3662-3664, landed) addresses bodies inside each other, not the choice of one spot, so it would not remove side-by-side piles.
3. Left behind: wk-contacts and wk-fuzz fixes landed (nudge fallback, inside test, relocation; `interact-contacts.mjs`, `interact-fuzz.mjs` in tree). team-interact status 11:42: "A/B karst s1 gecko overlap, nudge guard on/off": result not recorded (not found).
4. Check: `tools/steps/interact-contacts.mjs` (`IC_PRESETS=karst IC_SEEDS=1,2,3`; its `overlap`/`long` counters use a 35 % body-overlap threshold, so they will miss piles that are side by side). Add a pile counter: per second, bucket gecko/frog positions in 3 cm cells, report the largest cluster and seconds with a cluster >= 3 of one species. Fails now if karst shows clusters >= 3 for > 60 s; passes when that is 0 (and 2-gecko pairs allowed for the shared crevice).
5. Touches: animals.js (`herpHomeScore`, maybe `herpFindHome`, frog sit/perch code), herp.js (gecko hide). Shares herpHomeScore with B1a; the frog sit code is in the frog pipeline's neighbourhood (read-only in this run: gait.js, frog swim/leap): if frog sit-spot logic lives there, split frogs from geckos.
6. Size: L (two mechanisms, frog cause unknown).

## B4b Single steps pass through solids
1. Code: walker step `herpStep` animals.js:~3971-3996 (`a.pos.x += ux*step`; `free()` tests the end point only, via `okFor` -> `occ.solidAt(x, g+0.5, z)`, 1596); gecko `stepPlane` ~4000; hops `takeOff`/`leap` (~2795, 2811: landing spot only); `keepFree`/`insideSolid` (1047, 1290-1300) fix it afterwards by relocating.
2. Cause (guess, mechanism confirmed): every move test is a point test at the end of the step, at one height; nothing sweeps the segment. A step longer than a thin solid (large `dt` x `warp` up to 5 in `herp()`, fast hops, thin slate/cork) crosses it, and `keepFree` only sees the animal when it ends inside. Not shown by a run.
3. Left behind: `interact-fuzz.mjs` (in tree) has a `tunnel` detector (lines 148-153: both ends free, solid cell between, d > 0.5, 0.4 cm sampling). Counts per tank/species were never recorded in the notes; not found. wk-contacts' inside test checks belly/middle/back.
4. Check: `FUZZ_MODES=ff FUZZ_PRESETS=karst,swamp FUZZ_SEEDS=1,2,3 FUZZ_SECONDS=300` (and a 60x lapse run) and read the `tunnel` events by species. Fails now when the count > 0 (baseline not yet measured: do this first); pass 0 at 1x and 60x. Second form: a pure test of a new `segmentFree(a, from, to)` helper against a thin synthetic solid.
5. Touches: animals.js (`herpStep`, `geckoMove`, hop landing, `nudge`), possibly occupancy.js (a segment test). Shares animals.js (3600-3700 `nudge` also in B4a; herpStep also in B1a). Not frog gait files.
6. Size: M (S to measure, M to add a sweep without a cost spike: it runs per animal per tick).

## Table
| id | files | shared-with | check | size |
|----|-------|-------------|-------|------|
| B1a | animals.js herp region, herp.js | B1b, B4a, B4b (herpStep), wt-finish staged herp.js | amph-life-day: firesal stuck-at-home and water-time counters = 0 | M |
| B1b | animals.js placement/mediumOf/relocate | B1a, all (animals.js) | placement('firesal', water) errors; relocate lands on land | S |
| B2 | animals.js swim() (flag), maybe frogs.js | B3 (tadpole id), every fish | amph-life-day warm: tadpole floor-rest share | S-M |
| B3 | salamanders.js, bodies/index.js, animals.js, sim.js, ecology.js | B2, wt-finish staged salamanders.js | tests/larva.test.mjs + portrait bake | M |
| B4a | animals.js herpHomeScore/separate, herp.js | B1a, B4b | interact-contacts karst + new pile counter | L |
| B4b | animals.js herpStep/geckoMove/hops, maybe occupancy.js | B1a, B4a | interact-fuzz `tunnel` events = 0 at 1x and 60x | M |

## Shared code
- `src/sim/animals.js` (4613 lines, all six items; wt-water2 is editing it too: merge by hand, one builder per region, or serialise).
- Regions inside it: herp region 3851-4190 (B1a, B1b?, B4a, B4b); `placement`/`relocate` 782-840 and 1381-1440 (B1b); `swim` 1459-1580 (B2); species table + `herpBirth` (B3); `separate`/`nudge` 3598-3680 (B4a, B4b).
- `src/sim/herp.js`: B1a, B4a (gecko hide), and wt-finish's staged marbled-newt edit.
- `src/render/creatures/bodies/salamanders.js`: B3 and wt-finish staged edits. `frogs.js` (B2 optional) belongs to the frog pipeline: do not edit.
- Tools: `tools/steps/amph-life-day.mjs` (B1a, B1b, B2, B3); `tools/steps/interact-contacts.mjs` (B4a); `interact-fuzz.mjs` (B4b). All need Chrome through `tools/shot.mjs`/`amph-life-run.mjs`.
- Parallel-safe pairs (different animals.js regions and files): B3 (render side) with B2; B2 with B1b. Serialise: B1a with B4b (herpStep), B4a with B4b (nudge) and B1a (herpHomeScore).


---

# TRIAGE.B: water, UI, presets (R1-TRIAGE-B)

Read at REPO 916eb5a. Static reading only (no browser, no test run; 30-call cap hit, so some items say "not verified").
cb = confirmed by reading, g = guess. wt-water2 (LIVE, status shows M on waterfx.js, animals.js, gait.js, gait.test.mjs): do not touch.

## B5a Fish and flow
1. Code: `Animals.swim` src/sim/animals.js:1459-1575 (wander + school + food dart + depth band + wall/solid steering -> `desired` -> `steerLimit` -> vel lerp; heading `turnTo(atan2(vel.x, vel.z))` ~:1570). Flow helper src/sim/filterflow.js:86 `poolCurrent(H,x,y,z)` (analytic intake sink + return jet, cm/s), :110 `filterDrift` (food only), :125 `filterAvoid` (called animals.js:992).
2. Today (cb): the fish gets no current force. Flow touches it only through `filterAvoid`: fish under 5 cm and shrimp within R of the overflow are shifted away by min(R-d, 0.5*speed*dt) (a position nudge, not a velocity). `poolCurrent` is never sampled for animals. Species `flow` (0..1, max current borne) only feeds stress against the body's scalar `b.flow` (waterbodies.js:457). Hydro per-cell vx/vz (hydro.js:55) are not read by animals. No energy variable exists: grep `energy|stamina|fatigue` in src/sim finds nothing; closest are `a.hunger`, `a.health`, burst `a.dart` (speed x2.1). Rheotaxis hard-coding: none found, committed or in AG patches/status (grep rheotax|upstream|into the current); only AG/finish-plan.md row 11 "todo". So this is greenfield, not a revert.
3. Left behind: AG/water-live.patch landed in bda74d2 (cb: poolCurrent/filterDrift/filterAvoid are in the tree). water2 status: ripple ride, nothing on fish flow.
4. Check (fails now): node test, seeded, pure sim with a uniform 5 cm/s current: (a) a fish with no goal drifts downstream (mean dx along flow > 0; now 0), (b) same fish, goal 30 cm upstream vs downstream: energy spent upstream >= 2x, time downstream shorter, (c) with two spots offered (slack and fast) it rests in slack >= 80% of rest time, (d) 40 random-goal fish: circular correlation of heading with flow direction |r| < 0.25 (proves no hard-coded facing). Needs a `currentAt(x,y,z)` query and `a.energy`.
5. Files: src/sim/animals.js (water2 is editing it: serialize), src/sim/filterflow.js, src/sim/hydro.js (a flow query), content/animals species fields, new tests/fishflow.test.mjs. Shared: flow query with B5b, filterflow.js with B5c.
6. L.

## B5b Plants in the flow
1. Code: `plantMaterial` src/render/shaders.js:249-300 (vertex attr `sway` 0 base .. 1 tip; offset = sin/cos wobble times `mix(amp*AIR.air, underwaterAmp*AIR.flow, underw)*sway^2`, :291-299). `AIR.flow` src/render/airflow.js:16, `waterFlow` ~:24-40, `updateAirflow` :56. Per-plant `material {amp, underwaterAmp, speed}` in src/sim/plants.js:333-486; tufts decor.js:540.
2. Today (cb): the flow field exists per cell (`hydro.vx/vz`, Float32Array N, cm/s) but airflow.js averages <=700 wet cells into one scalar /9, sampled every 0.4 s and eased. The shader gets that scalar only: every plant sways with the same strength, in a fixed sin/cos wobble with no direction, no steady lean and no trailing. The filter's jet/intake (poolCurrent, analytic) is not in vx/vz at all (g: so a plant next to the return would not move).
3. Left behind: nothing in the tree for this; "plant sway follows airflow" is e14048a (the scalar).
4. Check (fails now): factor the bend into a pure function (util) `plantBend(v, swayK, amp)`; node test: lean along flow = k*|v|*sway^2, monotone in |v|, zero at v=0, direction equals flow direction, opposite for opposite flow. Optional second: headless world, a jet at x=0, mean sampled bend vector of a plant 5 cm downstream points along +x (now no direction exists).
5. Files: src/render/shaders.js, src/render/airflow.js, new flow texture/uniform upload (render/uniforms.js), sim/hydro.js or filterflow.js for jet in the field, sim/plants.js params. Shared: flow field with B5a, filterflow.js with B5c.
6. M.

## B5c Filter
1. Code: types in src/content/equipment.js:148-158 `FILTERS` {sponge, matten, canister}; gear rows :70-85 (filterSponge, filterMatten, filterCanister); filterflow.js:19 `FILTER_TOP`, :54 `filterFlow`; drawing src/render/plumbing.js:385 sponge, :419 matten, :460 canister; Care tiles src/ui/panels/Care.jsx:169; env.js:66; generator.js:378; snapshot.js:37; Flow.jsx:53. Tests: tests/filterflow.test.mjs (6 tests: rated flow/clog, lift, working point, hose sizes, stages, off), caresheet.test.mjs:120.
2. Modelled (cb): all three kinds in FILTERS, filterflow, hoses, plumbing, Care. Sponge box and canister are external (cabinet, overflow drain, return hose); matten is the in-tank corner foam with a riser. NOT named anywhere: the repo never says which type is "last". AG/finish-plan.md row 12 says "the filter type not yet modelled in filterflow". Best fit (g): the false bottom's bio-ring bed with its pump in the slotted tower. It is drawn (plumbing.js:497), simulated as a bed (plenum.js, equipment plenumState) and counted as filtration (CARESHEET.md:33) but has no FILTERS row, no pump curve, no stages, no clog, no Care tile, no filterFlow hoses. Other candidates (g): hang-on-back, internal submersible. ASK the user to name it before building. Rule kept: pump-driven, no air systems, external ones under the tank fed by the overflow drain (memory feedback-filters-pump-driven).
3. Left behind: nothing uncommitted for it; fb36038/2957a2a/e2e6683/3c76430 built the three.
4. Check (fails now): extend filterflow.test.mjs to loop `Object.keys(FILTERS)` and for the new kind assert `filterFlow({filter:true, filterKind:K}, 10).kind === K` (now falls back to 'sponge'), working point on the pump curve, real hose sizes, stage shares sum to 1, `filterEff` follows flow, plus a plumbing smoke (no throw building gear).
5. Files: equipment.js, filterflow.js, plumbing.js, Care.jsx, generator.js (gear map), env.js comment, tests/filterflow.test.mjs, portraits/shop icon. Shared: filterflow.js with B5a/B5b; plumbing.js and equipment.js with B5d and D (preset filter choice).
6. M (L if it is the plenum bed with its own pump).

## B5d Water below the substrate
1. Code: sim src/sim/plenum.js:22 `PLENUM`, :39 `plenumArea`, :67 `plenumStep`, :117 `stepPlenum`; render src/render/soilside.js:171-185 (uniforms), strips along front and both side glasses (:198), `INSET` 0.04 cm; tower water line plumbing.js:497.
2. Modelled (cb): `E.plenumH` (mesh height, cm over the glass floor), `E.plenumLevel` (cm over the glass floor, undefined without a false bottom), `E.plenumL` (litres), `E.plenumSoak` (litres on the way down), `E.plenum` {state ('mud' when over the mesh), flows {pump,...}}; porosity 0.85 (soil 0.35 over the mesh), drain lip 0.5 cm under the mesh, saturated over +4 cm, open to the pool through a screen (gap 2 L/min/cm). Drawn (cb): a cut-away at the glass only: false bottom (mode 2) draws water at min(plenumLevel, plenumH+6) in tea colour with a flow along the glass toward the tower (soilside.js:171-185); LECA (mode 1) a constant 1.2 cm; none (mode 0) nothing. Missing (g, needs a render to confirm): water exists only as a thin skin behind the glass (not a body: no volume in X-ray/Bottom layer, only the tower); tanks without a false bottom have no below-ground water field at all; LECA level is not simulated; where the front ground slopes below the mesh the glass shows none. The brief's "never drawn" may be stale: water-live.status 11:32 says the plenum is visible at the front 0 -> ~11 cm and the right side glass, and bda74d2 holds it (cb for the code, not verified on screen).
3. Left behind: AG/water-live.patch = landed in bda74d2.
4. Check (fails now): node, seeded: generate the starter false-bottom tank, step 1 sim day, assert the number the shader uses (`u.water`, factor to a pure `plenumDrawLevel(E, W)`) equals `E.plenumLevel` clamped, changes when the pump runs, and exists for LECA as a simulated value (now constant). Pixel check second: count tea-coloured pixels in the front-glass strip before/after raising the level.
5. Files: soilside.js, plenum.js, layers.js (X-ray/Bottom), plumbing.js. Shared: plumbing.js with B5c.
6. S to M.

## C1 Information panel
1. Code: panel src/ui/hud/InfoBanner.jsx (205 lines; card placed each frame via `g.frameHooks`, :72-125; hidden when `!sel || sel.obj?.dead` :125), mounted src/ui/App.jsx:32 only when `playing && !kids && !photo && !lapse`. State `S.selection` store.js:~29. Pick: controller.js pointerdown :207 arms `_tap` only when tool is 'view'/'inspect' and not `smart.on`; pointerup (<6 px, <500 ms) calls `tap()` :261 -> `Animals.pick` animals.js:4554 (ray-to-point distance / (size*0.7) < 2.2), then plants.near(4), piece, pool -> `select()` :279. Data: species-info.js skink :55, gecko :369; plant-info.js.
2. Today: could not reproduce (no browser). Panel data covers the gecko and the skink (cb). Cause not identified by reading (not verified). Candidates (g): (a) 142347c (follow card beside the animal): card is `position:absolute; left:0; top:0` (theme.css:211) and shown only via the frame-hook `place()`: `opacity=0` when `v.z > 1`, silent if `focusOf` or the projection misbehaves on the WebGPU path, so the card exists in DOM but invisible; (b) a5e3672 touched InfoBanner (FlowerLine) and controller (pieces only), 6b84a03 changed dblclick/_taps; (c) an overlay eating pointer events (bda74d2 added a loading screen with tips, Veil.jsx). Controller pointer and `tap()` code show no edit that disables selection. Commit that broke it: NOT FOUND. Bisect range proposal: 6b84a03..916eb5a, test 142347c^/142347c first.
3. Left behind: nothing in the tree or AG status files about it (not grepped beyond the status leads).
4. Check (fails now): browser step (or Playwright via tools/shot.mjs --steps): project an animal's `pos` to the screen with `game.camera`, click it, assert `S.selection.value.obj === animal`, `.banner` exists, `getComputedStyle(.banner).opacity === '1'`, its rect lies inside the viewport; repeat for a plant, the gecko and the skink. Cheap first diagnostic: after one click read `S.selection.value` and `.banner` opacity/rect. No test or tools/steps file touches selection today (grep).
5. Files: InfoBanner.jsx, controller.js, theme.css/hud2.css, maybe animals.js pick. Shared: controller.js with C2.
6. S (cause known) to M (if the cause is the WebGPU projection or overlay).

## C2 Follow mode
1. Code: `follow(obj)` controller.js:358 (sets `S.following`), `followFrame` :365, `zoomTo` :308 (flies in, follows animals :320), per-frame use :465-470, `select()` :279 (null also stops following), Esc :859, TopBar.jsx:47-55 (capture-phase Esc), dblclick :244, Zen body class fullscreen.js:65, App.jsx:26-35 (menu parts), InfoBanner.jsx:129-133 follow button, Kids `reset()` KidCard.jsx:68-70.
2. Today (cb): the menu is never hidden by following: TopBar, ToolRail, ToolOptions, StatusDrawer, Bottom render whenever playing. Esc: with a selection it calls `select(null)` (stops following, camera stays where it is, no menu change); with nothing selected and tool 'view' it opens the menu (TopBar.jsx:55). A single tap on empty space = `select(null)` = stop following, camera not returned. A tap on another animal selects it but `following` stays on the old one (only the button or zoomTo set it). dblclick needs two taps within 500 ms and only moves the camera target to the hit terrain/wall/water point (:244-256); no long-tap handler exists (grep). No shared "initial camera pose" restore for the adult UI found (not verified; Kids has `reset()`).
3. Left behind: c118f79/142347c/6b84a03 shaped follow (camera keeps the player's angle); nothing uncommitted known.
4. Check (fails now): a node test of a small pure state machine `followMode` (extract: states idle/follow, events esc, tap-empty, dbl/long on animal B, tap on animal) asserting: while following `menuHidden === true`; esc/tap-empty -> idle + `homePose` restored + menu back; dbl-tap or long-tap on another animal -> follow = B, menu still hidden; plain tap on B does NOT switch. Browser step second: screenshot-free assertions on `S.following`, a `S.hud` flag and `game.camera` position vs the saved initial pose (distance < 0.5 cm).
5. Files: controller.js, TopBar.jsx, App.jsx or a `S.followHide` flag, store.js, hud2.css, KidCard.jsx. Shared: controller.js and InfoBanner.jsx with C1.
6. M.

## D Presets
Table (cb: ids, names, tiers, biotope data via node import of presets.js/biotopes.js; filter/gear cb only where generator.js restock sets it; water share and substrate per builder NOT verified: read generator.js:406-1010).

| id | name | tiers | featured / animals | plants | temp C / RH % | filter, gear (generator) |
|---|---|---|---|---|---|---|
| cascade | Cascade canyon | cube..show (8) | newt, shrimp, springtail | javafern, fernph, weed | 14-23 / 70-95 | not set (sponge default, g) |
| suriname | Suriname forest island | nano..show (7) | dartfrog, springtail, isopod, fly | bromeliad, fernph, fern, pothos, grass, guzmania | 23-28 / 80-97 | not set (sponge) |
| blackwater | Blackwater lagoon | nano..show (7) | cardinal, neon, cory, shrimp | sword, javafern, vallisneria | 24-29 / 70-100 | not set (sponge) |
| stream | Mountain stream | nano,tall,standard,wide,grand | toad, springtail, isopod, fly | grass, fernph, weed, bilberry | 16-24 / 60-90 | not set (sponge) |
| karst | Karst towers | cube..show (8) | gecko, fly, springtail | pothos, bromeliad, grass, fern | 23-30 / 55-85 | not set (sponge) |
| swamp | Lowland swamp | cube..show (8) | crab, shrimp, isopod, springtail | fern, fernph, pothos, weed | 24-29 / 80-98 | not set (sponge) |
| streambank | Crocodile skink creek | standard..show (5) | skink, purpleiso, springtail | fernph, pothos, bromeliad, weed | 23-28 / 80-98 | matten, false bottom, uvb, basking, remin water pH7 GH6, setpoint 25 |
| reedpool | Reed frog marsh | tall..show (6) | reedfrog, springtail, fly | cattail, bamboo, bromeliad, pothos, frogbit | 24-29 / 70-90 | matten, false bottom, fogger, remin, setpoint 26 |
| matano | Lake Matano shore | standard..show (5) | panther crab, snail | javafern, vallisneria | 24-28 / 70-100 | canister + prefilter, hard water pH8.1 GH13, setpoint 26 |
| everglades | Pygmy sunfish swamp | nano,standard,long,wide,grand | pygmy sunfish, springtail, isopod | cattail, grass, frogbit, weed | 18-26 / 65-95 | matten, remin pH7 GH6, setpoint 22 |
| jar | Moss jar | jar (34x26x38) | crab, shrimp, isopod, springtail | fern, fernph, pothos, weed | 24-29 / 80-98 | not set |

Count: 11 presets (PRESET_ORDER presets.js:82). Tank shapes: boxes by tier, tanks.js:4-43: jar 34x26x38, cube 30^3, nano 60x36x48, tall 60x45x90, standard 90x45x60, long 150x40x50, wide 120x60x60, grand 130x60x80, show 180x70x90 (w x d x h cm) plus a custom size (any preset but the jar). Featured animal: none is a field; the first biotope animal is the de-facto one (g). Lizards: karst (gecko), streambank (skink); neither shares a preset with another lizard.
Species preferred-range data (cb: animals.js SPECIES, ~44 rows; schema comment :195-206): `temp [lo,hi]` on most rows (:215-260), `humidity` = a single minimum % (e.g. :246 80, :254 60), `ph [lo,hi]`/`gh [lo,hi]` on ~10 rows, `flow` max current, `bask` C (2 rows), `uvb`, `land` share, `flock [min,max]`, `territorial`, `minL`/`minH` (tank size). Hard placement limits per species in src/content/habitats.js:6-23 (`zone, minDepth, maxDepth, water, cover, rhMin, tMax`). No species has the full set: no light-level range (only uvb/bask), no substrate preference, no hide/perch counts (only `cover` distance), no compatible-tank-mates list (only diet `eats`, size-based prey rule animals.js:1924, `territorial`, `flock`). Biotope climate (biotopes.js:6-117) gives temp and humidity per preset.
Automated checks today (cb): tests/tanks.test.mjs:43 (preset tiers exist), tests/caresheet.test.mjs:144 (4 newer presets have a biotope, biotope animals have HABITAT rows), caresheet.test.mjs skink/crab comfort. Browser probes, not in `npm run test:unit`: tools/steps/crowding.mjs (overlapPairs, inSolid, beyondGlass, behindWall over 2 sim days; one generated tank, not every preset), collide.mjs (COLLIDE_PRESETS default karst,suriname), amph-life-day.mjs. Not present: a per-preset run that checks spawns in water or inside solids, pile-ups, stuck animals, or that tank temperature/RH/pH/flow sit inside the featured animal's ranges. Whether `generateTerrarium` can run headless in node: not verified (World may need three/webgpu; check how tests/herp.test.mjs builds a world).
Proposed check (fails now): `tests/presets.test.mjs` (or a tools script): for each preset x its smallest tier x 3 seeds: generate, run 2 sim days at 20x, assert: 0 animals in a solid or out of the water for a swimmer, 0 overlap pairs > 3 s, no animal with the same position +/- 1 cm for 6 h (stuck), `temp/humidity/ph/gh/flow` inside the featured species' ranges for >= 90% of the day, minL/minH met. Print one number per column. Files: new test, species fields for light/substrate/hides/mates in animals.js (water2 is editing), generator.js, presets.js. 6. L.

## Summary table

| id | files | shared with | check | size |
|---|---|---|---|---|
| B5a | animals.js, filterflow.js, hydro.js, tests/fishflow | B5b, B5c; water2 live in animals.js | drift, energy ratio, slack rest, heading r<0.25 | L |
| B5b | shaders.js, airflow.js, uniforms.js, plants.js, hydro.js | B5a, B5c | pure `plantBend` lean along flow, monotone | M |
| B5c | equipment.js, filterflow.js, plumbing.js, Care.jsx, generator.js, tests/filterflow | B5a, B5b, B5d, D | `filterFlow` kind round-trip for new kind | M |
| B5d | soilside.js, plenum.js, layers.js, plumbing.js | B5c | `plenumDrawLevel` = sim level; LECA simulated | S-M |
| C1 | InfoBanner.jsx, controller.js, theme.css, App.jsx | C2 | click -> selection + visible banner (browser) | S-M |
| C2 | controller.js, TopBar.jsx, App.jsx, store.js, KidCard.jsx | C1 | `followMode` state machine | M |
| D | presets.js, biotopes.js, generator.js, animals.js, habitats.js, new tests | B5c (filters), lizards | per-preset 2-day run, ranges | L |

## Shared code
src/sim/animals.js (B5a, D; water2 live), src/sim/filterflow.js (B5a, B5b, B5c), src/sim/hydro.js (B5a, B5b), src/render/plumbing.js (B5c, B5d), src/content/equipment.js (B5c, D), src/editor/controller.js (C1, C2), src/ui/hud/InfoBanner.jsx (C1, C2), src/ui/App.jsx and store.js (C1, C2), src/sim/generator.js (B5c, D), src/render/layers.js (B5d, C2 none), src/render/shaders.js + airflow.js (B5b only).

Noticed, not touched: AG/wt-water2 edits animals.js/waterfx.js: B5a and D collide with it. BRIEF says "the water under the substrate has never been drawn" but a5e3672/bda74d2 draw it at the glass: ask the user what is missing.
