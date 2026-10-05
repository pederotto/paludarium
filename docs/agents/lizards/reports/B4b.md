# B4b report (step 2, INTERIM: waiting for the animals.js lock; claude-opus-5-5)
Status: helper and test green and committed. The animals.js call sites are written as an exact-match patch (`BB/tools/b4b-patch.mjs`) but NOT applied: `BB/locks/animals.js.lock` is held by C1b. After-run not done (it needs the patch).
- src/sim/occupancy.js (after `solidAt`): `segmentFree(a, from, to)`, `segmentFreeAt(a, x0, y0, z0, x1, y1, z1, min = CELL / 3)`, `cellSolid(i, j, k)`. Exact voxel walk (Amanatides-Woo); cells solid at the start are ignored until left; moves under `min` return 1; early out at the first solid; counts `sweepStats[a.sp]`. Contract: CONTRACTS.md line 27.
- tests/segment.test.mjs: written first and red (`o.segmentFree is not a function` x4), now green: thin wall never crossed (2000 random moves each way, stop point outside), free moves never refused, along/inside a wall not refused, short moves skipped.
- tools/steps/interact-fuzz.mjs: tunnel hits carry `by` (push tag), `doing`, `hop`, `kind`. Deliberate push-outs (relocate, keepFree, inGlass, clearOfWall, outOfStems, outOfBank, offCliff) count as `tunnelReloc`, apart from `tunnel`. `FUZZ_CFGS=1x,60x` picks the speeds in lapse mode. BB/tools/fuzz-agg.mjs sums a log.
- Point 3 (firesal/panther 5-10 cm moves): push-outs, not steps. Firesal: `clearOfWall` + `outOfStems` (doing m:hide); panther (the crab, kind crab) and one skink: `outOfStems`. Deliberate, so now listed as `tunnelReloc`. Their lines in animals.js were not looked up.
- Baseline at 180 s (lapse mode): swamp seed 1 only. 1x: tunnel 4 (springtail hops), tunnelReloc 3, stuck 0. 60x: tunnel 61 (springtail 34, fly 18 walking + fluttering, cricket 5, skink 4 pushed 2.5 cm by nudge), tunnelReloc 4, stuck 0. Seeds 2-3 and karst lost to a page reload from another agent's edit ("Execution context was destroyed"): MISSING.
- Fly walking tunnels come from the generic crawler step animals.js:1657 and 1666 (`okFor` + `bumps` test the end point only), so the patch covers those two lines too, beyond the four named sites.
- Patch hunks: takeOff after the `need` line (~1870; 8 chords along the arc as leap flies it, min 0; blocked = next try); leap (~1886; this tick's chord; blocked = lands short and rests); herpStep `free` (~3990; + `swept`); nudge (~3680; skips a push that crosses a piece); stepPlane (~4021; shortens the step); crawler 1657 and 1666.
- Cost: a step under 0.5 cm returns after one hypot (all walking at 1x). 60x steps of 1-5 cm: about 10 cell reads at most, early out. takeOff: 8 chords once per hop.
Check:
1. node --test tests/segment.test.mjs -> tests 4, pass 4, fail 0
2. node --test tests/occupancy.test.mjs -> pass 2, fail 0
3. after-run: NOT run (patch not applied)
Open risks: a blocked leap stops mid-air (y kept; the walker's ground follow must settle it: watch `floating`); the stepPlane and crawler sweeps may raise stuck at 60x.

## Hand-off
- Resume: `mkdir BB/locks/animals.js.lock` + owner B4b; `node BB/tools/b4b-patch.mjs src/sim/animals.js && node --check src/sim/animals.js` (exits 2 without writing if an anchor moved); after-run; commit animals.js by path; `rmdir` the lock.
- After-run (swamp about 4 min; a vite reload kills a run, so re-run once): `FUZZ_MODES=lapse FUZZ_CFGS=1x,60x FUZZ_PRESETS=swamp FUZZ_SEEDS=1,2,3 FUZZ_SECONDS=180 FUZZ_LOG=<scratch>/a.jsonl node tools/shot.mjs --only=desktop --wait=2500 --steps=tools/steps/interact-fuzz.mjs --url=http://127.0.0.1:4630/`, then karst seed 1; `node BB/tools/fuzz-agg.mjs <log>`.
- B1a (herpStep 3972-3997): the patch appends `&& swept(nx, nz)` to `free()`; keep it last in the chain (cheap early out) if you rewrite `free`.
- B4a (nudge 3677): the patch adds a sweep at the top of the `for (const f of [1, 0.5])` loop; a push that crosses a piece is skipped and the 0.5 try still runs.
- B4c (swamp inside-solid flood): fuzz `inSolid` (solidAt at y + 0.5, walls excluded), swamp seed 1 at 180 s: 33k at 1x, 4.2k at 60x; karst 0. Seed 3 at 60 s by species: springtail 1907, isopod 1630, reedfrog 1331, panther 907, redeye 670, crab 551, firesal 105, toad 90. Game side: keepFree animals.js:1300 relocates and counts `stuckStats.inside`. Cause not looked into.
