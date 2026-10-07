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
  (skink 4.5 / 9 cm, cost 3; crab 4 / 8, 3; newt and fire salamander 4.2 / 8, 4). `SURFACE_WALKERS` = skink, crab, newt: only those movers use it.
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
Not fixed (open, with the evidence):
- A gecko does not walk over logs. A trial (the gecko as a surface walker, `patches` of the run, `.agents/obstacles/patches/R1.patch`) made it cross logs (3 of 3 runs) and removed the 4-5 cm step-up in one frame, but it made the skink's figure of eight throw about 230 radar teleports per run: not shipped. The cause of the step-up (a layer flip through `SurfaceMap.pick` fed by the blended height) is in `.agents/obstacles/reports/R1.proposal.md`.
- Stamped rocks (boulders, spires, stumps) are ground in the planner but solid in the movers' step test (`occ.walkFree`): a skink climbs onto a boulder and stalls on top, a gecko stalls at its foot (stuck x13), crabs and salamanders are relocated 1-4 times a run (`reports/R2.proposal.md`).
- Toads and frogs treat every log as a wall (a hop's apex is 1-2 cm; `frogWalk` never calls `standOn`): the owner's four-log figure of eight is about 25% reachable for a toad. Options and the frog-motion session's ownership: `reports/S1.md`.
- Fish, newts and shrimp are still relocated 20-290 times in 3 simulated days in the stuck test (a hovering fish counts as stuck: swimmers always `wantsMove`); a dart frog is found inside a solid for 1-2 minutes in most runs (frog code); the fire salamander on free roam shows a teleport storm in about 1 run of 3 on live and on this build.

