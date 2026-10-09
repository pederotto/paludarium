# Animals and objects: routes, climbing, wall crossings, turning and fear

How walking animals deal with what is in the tank (logs, rocks, the glass, the background relief, each other) and with danger. All of it came out of the owner's
Test Lab reports of 6 Oct 2026 ("3 toads and 4 logs, they can't do the 8", "animals don't avoid objects or climb over them", "geckos can't get from the wall back to
the ground", "the skink's head went through the back wall", "frogs turn on the spot and then walk"). The Test Lab (`lab.html`, `src/lab/`) is where each piece was
found and where it is judged; the rule for frogs in `CLAUDE.md` (a frog moves only through a body movement) is untouched by it.

## 1. Going round: the route planner

- `src/sim/labroute.js` (pure, `tests/labroute.test.mjs`): a `Grid` of 1.5 cm cells (open or blocked, plus a cost per cell), A* over it (8 ways, no corner cutting), the route
  pulled straight where the way is clear. A shortcut must be open and cost no more than the way it replaces, so a route never cuts across a log it went round.
- `Animals.labGrid(a, sp)` builds the grid for one body size: blocked is what the movers themselves refuse (`okFor`: glass, a piece under the belly, the background
  relief, the wrong medium), plus the body's drawn width off the side glass and its reach off the front glass and the relief (`wallGap` = 0.75 x its longest end + 0.3), room
  round a piece (its radius, part of its length; a hopper keeps its nose's reach), a newt's steep ground (`cliffAt`), plants' stems. A hopper treats a rise of the ground over
  `HOP_RISE` (4 cm) or 5 x its size as a wall; a skink and a crab cross a low step (their movers never look at cliffs). Kept at least 1.5 s per body size, longer while nothing
  changes (`occ.version`, `World.groundVer`, bumped by `groundChanged`): the ground changes all the time under erosion and a rebuild per change would be a hitch.
- Used by the Test Lab's drives (`labSteer`: a path waypoint that lies inside a piece or cannot be reached is skipped and counted; a go-to goes as near as it can; a route
  that gets nowhere for 4 s is made again with 0.8 cm more room, three times, then the waypoint is skipped) and by the animals' own minds (`steerGoal`: the skink, crab,
  newt/salamander and floor gecko; the goal itself where the straight line is clear, so open ground is unchanged). Frogs and toads pick among checked hop candidates and need no
  route; `labFrogPlan` adds a short sidestep when the direct line is shut. Fish steer through the occupancy grid (`swim`) and are not routed.
- The lab draws the route from the selected animal and says route / skipped / stranded in its readout.

## 2. Going over: the surface layer

- `src/sim/surfaces.js` (pure, `tests/surfaces.test.mjs`): per grid cell the layers a body can stand on, lowest first (the ground, then the top of each piece), each with the room above
  it and its normal; `stand`, `pick` and a smooth (bilinear) `heightAt`. `CLIMB`: how high a walker steps up and drops, and what a cell it climbs over costs the planner
  (skink 4.5 / 9 cm, cost 3; crab 4 / 8, 3; newt and fire salamander 4.2 / 8, 4; gecko 8 / 14, 2). `SURFACE_WALKERS` = skink, crab, newt, gecko: only those movers use it (the gecko since 7 Oct, section 8).
- `Occupancy.bakeSurfaces` (baked, never raycast per frame): each column's solid stretches of the occupancy grid give the pieces' tops, and the exact top and normal come from a
  ray down onto the piece's mesh (the voxels are 1.5 cm and thickened by a cell, so a top read from them alone is up to 1.5 cm too high). `Animals.surfaces()` bakes lazily and at most
  every 1.5 s.
- `okFor(medium, x, z, maxDepth, r, fine, climber)`: a climber is let into a cell whose solid it can step onto (`canClimb`). `standOn` sets its height from the surface under its middle
  (`PIECE_LIFT` 0.35 cm above a piece: the blended surface can sit a little under a bumpy trunk and the engine would take the body for inside it). `footing()` poses a body on the
  plane through its feet; for these walkers the feet sample the piece tops (`footH`), so it is drawn standing on the log. `freeWalledIn` does not count a log a climber can step onto as a wall.
- A log with a top above the limit is a wall to that animal: a 5 cm log is a wall to the salamander, 4.5 cm is the skink's limit.

## 3. The wall and the glass

- `geckoCross` / `geckoCrossStart`: the step between the background and the floor is one movement, a quarter circle about the wall's foot (the belly turning from the relief to the ground,
  the legs stepping, 0.8-2.5 s) instead of a 4 cm jump (the radar's `teleport`). Both directions.
- `wallNeed` also checks the drawn nose, tail and sides (once the mesh is measured), and `wallBlocks` makes the skink, crab and the herp walker refuse a step that pushes further into the
  relief: a skink's head went 0.2 cm through it and it stood there stepping in place.

## 4. Turning while walking (frogs)

The frog's `turn` state used to turn through the whole angle on the spot (98% of all its turning, measured in the lab), then crouch or walk. Now a walk or a hop sets off once the body is
within `TURN_GO` (0.5 rad) of its way, the crouch keeps turning, the walk moves along the body's heading (slower the further round it still is), and the take-off's yaw twist finishes the rest.
Measured under a lab figure of eight: about 41% on the spot. Not measured: free-roaming hops.

## 5. Fear

- The explicit pairs (the skink's, the crab's, `herpThreat`'s) and the keeper's lens keep priority and are never switched off. `src/sim/threat.js` (pure, `tests/threat.test.mjs`) adds triggers for
  pairs on no list: a neighbour of another kind that is at least 1.3 x its size (a crab's claws x 1.5) AND moving (> 0.6 cm/s) or within 3.5 cm, on its level (6 cm), inside its awareness
  radius; its own kind never frightens it. A much bigger neighbour is reported nearer than it is (distance / factor, factor up to 2), so it scares from further off. `Animals.threatPlus` looks
  at the neighbours every 0.2 s per animal (staggered) and only when no listed pair found a threat. Among the game's species no one eats another (no `eats` list crosses crab, skink, newt,
  salamander, toad, gecko, frogs), so among them fear is a startle by size and motion.
- Where the skink knows no cover or the crab no safe burrow it used to run a fixed 12-15 cm straight away. `Animals.escapeGoal` scores spots on rings (5, 9, 14, 20 cm) over the planner's
  grid: distance from the threat + niche - 0.6 x path (`escapeScore`), spots at least 4 cm further than it is and not within 5 cm of the glass, the best four routed, the winner kept 1.2 s.
  Niches: skink = cover or a log's crest (`skinkNiche`), crab = cover or shallow water (`crabNiche`).
- Frogs had no fear at all. `frogFear` / `frogFleePlan` / `frogNiche`: a frightened frog drops what it was doing, hops away hop after hop (no long sit, a refused hop is retried at once), and
  after one hop (or 2.5 s, or once it is clear) does what its species does to be safe: a frog with toe pads climbs (`perchSpot`: a plant, wood, the glass), a toad or a European frog
  (`PADLESS`) hops into water if some is within 30 cm and not on the threat's side, and swims (in the water the fear is over). Calm for 3 s ends it (not once it is on its way to the water).
  Lab drives and the keeper's lens do not trigger it.
- Not done: a toad's dive, an escape niche for the newt/salamander (`herpEscape` is unchanged), fear of the lens for frogs, frogs fleeing from the skink while perched.

## 6. Testing

- Unit: `tests/labroute.test.mjs`, `tests/surfaces.test.mjs`, `tests/threat.test.mjs`.
- Lab steps (run ONE browser at a time; check `uptime` first): `tools/steps/lab-avoid.mjs` (gecko crossings, relief clearance, a figure of eight across four logs per species) and
  `tools/steps/lab-scenarios.mjs` (JSON scenarios in `tools/scenarios/`: `lab-fear.json`, `lab-surfaces.json`; one result line each, new build against the live site as the "before").
- Compare runs only at the same machine load: a run at load 30 gave 119 relocations where load 5 gave 8. The first use of a species loads its model (a toad: seconds); `lab.apply` rebuilds the
  world, so animals must be read from `lab.game.world.animals` after it.

## 7. Where it stands (6 Oct 2026, live d9548b3)

Verified in the lab, single runs: toads at the owner's four logs 1/72 waypoints -> 13-27/72 with a clean radar; three crabs 115/40/31 with about 7 relocations (before: 49/263/2938 with 25, one
crab never left its pocket); fire salamanders 23/12/5 with 11 (before 4/2/3 with 22-25); two skinks among the four logs 26 teleports + 32 relocations -> 1 + 1; a gecko crossing the foot of the wall,
worst step 0.47 cm per 40 ms; a dart frog hops, hops and climbs 19-21 cm; a toad hops and swims. NOT measured: frame cost (no ABBA), `journey.mjs`, the Windows laptop, the iPhone; behaviour
numbers are single runs (the project bar is three); WebGL 2 was only loaded, not exercised.

## 8. Round 6 (7 Oct 2026): the obstacle matrix and what it found

`tools/scenarios/gen-obstacle-matrix.mjs` writes `tools/scenarios/lab-obstacles.json`: every walking species (toad, dart frog, red-eyed tree frog, gecko, skink, crab, newt, fire salamander) against the same six obstacle layouts, one animal each (a 23 cm log
with a way round, a 40 cm log with none, three boulders in a line, a cork tube and a slate, the owner's four logs as a figure of eight, and free roaming among them). Run it with `tools/steps/lab-scenarios.mjs` (`SCEN=`), several times: single runs are noisy.
Fixed (each verified in the Lab, 2-3 runs, radar counts in brackets):
- `planRoute` (labroute.js): a goal behind a wall that shuts the tank, with the body already at the nearest place it can get, came back as "the goal itself": a red-eyed tree frog hopped at a 40 cm log, was refused and relocated 8 times a run (now 0).
- `labGrid`: cells under a slab propped over the ground (slate, cork) were open in the planner but refused by the hop's back-height test: a toad was relocated 4-6 times a run (now 0). The grid now shuts a cell the body's back does not clear.
- `noseClamp` / `noseClear`: a 16 cm fire salamander was sent to a path waypoint 4 cm off the side glass, faced it and stood with its nose on the pane; `relocate` then moved it 1 cm and it was pinned again, 12 relocations and 10 teleports a run on the figure of eight (now 0 on 3 runs). The waypoint is moved in to where the nose fits and relocate keeps a body's whole length off the side glass.
- Crawlers found inside a buried boulder shell were relocated back into the same pocket (hundreds of times in the game's stuck test): `shellClear` in relocate's crawler part, and an animal re-found inside within 30 s is relocated far. `stuck.mjs` now prints `insideGame` (the game's own `insideSolid`), which shows the test's `insideTicks` (about 4300 of 4320) is mostly the test's own counting.
- Lab: the radar log used a key that two rows could share (duplicate-key errors); each row has its own.
- Stamped rocks (boulders, spires, stumps): the skink stalled on top of a boulder (stuck x13, 3 of 3 runs), crabs and salamanders were relocated 1-4 times a run. A stamped rock is ground in the height field and never an occupancy solid, so the movers' step tests were free; what refused the step was `offCliff` (animals.js), the safety net that undoes a step onto a "cliff": `cliffAt` was only a slope test (ground gradient^2 > 3) with no height limit, so a rock face rising 3.6 cm counted as a cliff for a skink that steps 4.5 cm (800 reverted steps at x=-2.85, measured), while `labGrid` shut cliff cells only for newts and so planned straight at the rock. Now `cliffAt(x, z, a)` for a skink, crab or newt also needs a face rise (the 9-point stencil in `src/sim/facerise.js`) above the walker's step limit (`CLIMB`), passed from `offCliff`, `walkBlocked` and `labGrid`; frogs, toads and geckos keep the old test. 'goto past 3 boulders in a line', 3 runs each: skink, crab and fire salamander reached 3 of 3 with an empty radar (before: skink stuck, crab 2-4 relocations, salamander 1-3); toad and red-eye unchanged; the dart frog showed one spin in 2 of 3 runs (frog code untouched, cause not found). `tests/boulders.test.mjs`.
- The skink's figure-of-eight "teleports" (3-4 a run, 8 Oct) were two bugs in `inGlass`, not a seam or a frame-time spike (a per-frame hunter over 110 s at 1x and 4x saw no other step over 1.2 cm). (1) A skink spawned with its tail past the side pane was pushed 3-9 cm in one frame when its real body box replaced the stand-in's circle: a ground walker's glass push is now eased in at `GLASS_EASE` (0.3 cm) a call (`src/sim/glassease.js`; climbers, hoppers, swimmers and flies keep the full push). (2) After any push `inGlass` set `pos.y` to the soil height, so a surface walker on a log whose body box touched the front glass was dropped 2-4 cm and lifted again by `standOn` three times a lap, a 4 cm jump at the same spot every lap (0.6, 13.6): it now calls `standOn` for surface walkers. Found in the runner with the hunter hooked into it (`probes/lab-scenarios-detail.mjs` in the run's blackboard); it showed only after the runner's all-species warm-up, which changed the skink's route onto that log, so a run of the skink alone did not show it. After the fix: 0 teleports in 3 of 3 runs with the all-species warm-up, one of them the full 17-scenario matrix (before: 3-4 a run in 5 of 5 runs); the skink alone was clean before and after.
Not fixed (open, with the evidence):
- A gecko now walks over logs, cork and slate and over boulders (7 Oct, phase 2): it is a surface walker (`CLIMB.gecko`, `standOn` in `geckoMove`'s floor branch) and its rise follows its travel (`limitRise` in `surfaces.js`, remembered height `a._so*`; `SurfaceMap.pick` admits a layer from the cell's real layer height, not the blended one: that feedback made a step up a log end jump 2-5 cm in one frame). The same trial first threw ~230 skink teleports in one report; on a clean tree it did not (skink figure of eight 315-357 cm walked, radar empty in 9 of 9 runs; one of 3 runs on the first clean check showed 110 teleport events, never again in 12 runs; cause unproven).
- The gecko's boulder stall was `outOfBank` (animals.js), not the mover: at a rock lip the footing plane is 55 degrees steep, the snout counted as 'in a bank' and the gecko was pushed back 0.3 cm every frame (792 backward writes measured). For a surface walker the ground below the body's middle is a drop, not a bank, and a rise ahead within its step limit is the foot of what it climbs (`notABank`, `tests/surfaces.test.mjs`). Gecko 'goto past 3 boulders', 3 runs: reached over the top (maxY 6.8-6.9) with an empty radar (before: stuck x13). The same rule now applies to skink, crab and newt; checked on their figure-of-eight and free-roam scenarios (unchanged). Not explained: the old gecko teleport at the back wall (geckoCrossStart) did not recur and its cause was never seen; the gecko's pose over a boulder lip was checked by numbers only.
- Toads and frogs treat every log as a wall (a hop's apex is 1-2 cm; `frogWalk` never calls `standOn`): the owner's four-log figure of eight is about 25% reachable for a toad. Options and the frog-motion session's ownership: `reports/S1.md`.
- Fish, newts and shrimp are still relocated 20-290 times in 3 simulated days in the stuck test (a hovering fish counts as stuck: swimmers always `wantsMove`); a dart frog is found inside a solid for 1-2 minutes in most runs (frog code); the fire salamander on free roam shows a teleport storm in about 1 run of 3 on live and on this build.


### 8.R6a (8 Oct 2026): the stuck watchdog reads a swimmer's intent
- Why: in the stuck test about half of all fish relocations were fish that meant to stay (holding station in the lee of a rock, resting in slack water, nibbling, creeping the last 2 cm to their spot); only fish with a spot more than 2.5 cm away and full intent were really pinned.
- `src/sim/stuckintent.js` `stuckIntent(a, sp, ctx)` returns `rest | hold | creep | go | none` from the fish mind (`a.fm.I.hold`, `fm.resting`, `fm.goal` distance, `fm.fleeT`, `I.escape`), `a.nib`, `a.rest.resting` and a Lab drive goal (`a.lab.goal` = go). `Animals.wantsMove` (swim kind only) is true for `go` and `none`; shrimp, newt, axolotl, snail and crab are untouched (their relocations are frustrated targets and pockets, not idling).
- Bounded: an asleep intent counts as such for at most `HOLD_CAP` = 150 s in a row (`a.holdS`, kept by `keepFree`; reset by any `go` and by a stuck decision); after that the watchdog is awake. `insideSolid` is checked first in `keepFree` and is never exempt. Every exempted second is counted: `stuckStats.held[species]`.
- Tests: `tests/stuckintent.test.mjs`. Measuring: `tools/steps/stuck.mjs` prints `cls` (stuck decisions and relocations per fish species, by the fish's own class hold / creep / go / inside), `heldS`, and its still-timer no longer calls `A.wantsMove`; `tools/steps/lab-scenarios.mjs` prints `stuck=` (stuckStats deltas) and `cls=` per scenario; Lab scenarios L1 (fish-lee) and L2 (fish-pocket, the masking control) are in `tools/scenarios/lab-swimmers.json`.
- Read counts next to walked/reached, and compare builds only in the same session (relocation counts depend on machine load; shares do not).
- Masking control (the one that matters): `tools/steps/lab-pin-control.mjs` pins four fish in open water (every `keepFree` puts them back) and sets their mind: cory and neon with a spot 6 cm away ('go'), loach and guppy with a spot where they are ('hold'). 4 runs, 2 per tree: the 'go' fish fire identically on the unfixed and the fixed build (47 stuck decisions / 46 relocations and 66 / 65 in the 60 s runs); the 'hold' fish fire every 3.5 s on the unfixed build and exactly once, at 154 animal-s (HOLD_CAP 150 + 3.5), with no relocation on the fixed one. Paired stuck-test runs, 8 of them, 3 scenes, order alternated: fish relocations -59% (suriname), -89% (swamp), -91% (blackwater); the `go` class in swamp fell too because a false-positive teleport feeds later stuck chains (57-82% of the base build's `go` relocations came within 30 s of the same fish's previous one), in suriname it did not move (80 vs 73). Absolute counts move with machine load; compare only back to back.
- Measured and NOT changed: clearing the fish mind's goal at the first back-off (R6b) would not help: the goal at the second stuck equals the first in only 23% of cases. A relocation moves a fish a median 4 cm and 43% are stuck again within 10 s, so the remaining 'go' class is not fixed by this change (cause open: a guess is steering that flip-flops between the goal and obstacle avoidance).

## 9. The spatial contract (R8, 8 Oct 2026)

The obstacle bugs of fish, shrimp, snails, newts and skinks came from the parts disagreeing about where a body may be: the crawl step tested
0.5 cm over the ground while insideSolid tested 0.8 of the body's height (a snail stepped under a ledge and was at once "inside"),
`walledin.js` had a third copy of the old test, inGlass snapped walkers to the soil, minds picked goals inside pieces, and relocate left the
mind's goal in place. Now there is one contract, in three parts.

**One predicate.** `Occupancy.canOccupy(x, z, layer, body, y)` (sim/occupancy.js), on the 2.5D layer map (sim/surfaces.js): O(1), no
rays, no allocation. A body is anything with `bh` (height) and `rad` (radius); it needs `clearNeed = max(0.5, bh)` of room. On the ground
(layer 0) the voxel column must be free from the body's belly (insideBody's lowest sample) to its height, at its feet's real height (the
terrain is not flat across a 1.5 cm cell). On a piece's top the baked clearance counts, unless the voxels above run more than
`WALL_IN_CELL` (4.5 cm) higher: then something taller stands in that cell. A body wider than the shells' one-cell thickening is tested at
its radius too. Everything else asks it:
- `Animals.canStep(a, x, z)`: the movers' step test (okFor's solid test with a body, herpStep, crawl, shrimpWalk, the turning pivot,
  `walledin.js`). A climber steps onto the layer `SurfaceMap.pick` gives from the layer it stands on (`standY`); any other walker stays on
  the ground.
- `Animals.insideSolid(a)`: first the same predicate on the layer it stands on; only a body it refuses is looked at with rays. So a step
  canStep allowed is never found inside a piece on the next tick (tests/spatialcontract.test.mjs checks the predicate against the voxels).
- `Animals.isValidGoal(a, x, z)`: inside the glass by its radius, in front of the background, not banned, and a place the body fits.

**Goals.** No mind commits a destination that fails isValidGoal: the minds' own pickers ask `sense.valid` (sim/goals.js `validGoal`:
shrimp swarm and shuffle, crab and skink forage, herp legs and courtship, fish candidates through `s.ok`); the finders here (graze spots,
hides, homes, shores, food, prey, escapes) filter by it; and `vetGoal` checks the final destination of every mover after the engine's own
swaps. A goal that fails is dropped and the animal stays put rather than walk into a piece.

**The goal protocol.** Every animal has `a.abortGoal(reason, cooldownMs)` (installed in `add`); each mind implements its own `abort()`
(shrimp, fish, skink, crab, herp) and is registered as `a.mind` when it is made (`adopt`), so the engine never reaches into a mind's fields.
relocate calls `a.abortGoal('relocated', 20000)`: the mind gives its goal up and the spot it failed at (3 cm round it) is no goal for 20 s.
A mover that cannot get on calls `a.abortGoal('blocked')`.

**Where a body really is.** A climber's layer is the layer of the cell it is in nearest its feet (`layerUnder`). On a piece it stands on the
real bark or stone under it: `max(baked layer, Occupancy.topBelow)` + PIECE_LIFT, one ray down, cast again only when it has moved
(`contactTop`). "Really inside" (`Occupancy.inside`) is the nearest face seen from behind in 3 of 5 directions, not a count of crossings:
open and hollow meshes fooled the count. A frog on a perch (a stem, a piece, the glass) is tested along its contact normal, not straight up,
and never against the piece it clings to: `Occupancy.roomAlong` (out from the contact along the contact normal, at its belly and most of its height), asked of every point of a climb route (`perchRoute`) and of a perched frog (`perchInside`), the same predicate both ways. A sit spot (a piece top, a broad leaf) needs `roomFor` above it (`perchFits`). Every mover that sets a body down asks canStep: the walk, the slide, `nudge` (two
bodies pushed apart), `outOfStems`, `outOfBank`, a leap's landing, `walledin.js`.

**Glass.** `inGlass` moves a body in X and Z only; its height belongs to the movers (terrain clamp, standOn). Swimmers get swim()'s floor
(0.5 cm) in the end-of-tick check, as walkers get the ground.

**Watchdog.** `stuckintent.js` covers swimmers, crawlers and grazers: the displacement timer runs only while the animal travels to a spot
('go': a spot more than 0.5 cm away for a crawler, a grazing shuffle included: a shuffle that is blocked has no speed but is still travel);
holding station, resting, nibbling, grazing where it stands or creeping the last of the way sleeps it for at most HOLD_CAP (150 s); it
wakes when 'go' moves the body less than 0.25 cm in 3.5 s, plus 0.1 cm per unit of size for a body in the water (a pinned fish is carried to and fro by the water and evaded a flat 0.25; for walkers the size term put relocations up 33 %: a maggot crawls only 0.56 cm in 3.5 s). A short hold, rest, graze or creep (under 3.5 s) PAUSES the timer and a longer one resets it: a fish pinned 2.5 cm from its spot flickered between 'go' and 'creep' every few frames and a reset on every flicker let it push against a rock for 44 s; a pause that outlived a minute's legitimate hold called the fish stuck as it set off (fish relocations +43 %, back to par with the reset).

**Two bugs the stand-still probe found (9 Oct).** A female guppy that had mated kept her stored sperm in `a.st`, the strike field, and `Animals.move` skips an animal with a strike: she froze for good (now `a.sperm`; a save from before is read the new way, world.js). A shrimp shuffling to a spot a few millimetres off circled it for ever (its body turns about its legs): `shrimpWalk` gives a spot up after 2 s without getting nearer.

**Test:** `tools/steps/stuck.mjs` now calls an animal inside only when it is really in a piece's mesh (rays), not in one of its thickened
voxels (which every animal on a log is: base and new both showed `insideTicks` = every tick), has two skinks, and prints a verdict for the
focus set (fish, shrimp, snails, skinks).
