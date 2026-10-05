# B4b report (step 2; claude-opus-5-5)
Result: call sites in; tunnels fall from 65 to 2 in swamp seed 1 at 180 s. PASS NOT MET: 4 tunnels remain over the runs made (2 in frog-owned lines), and swamp seed 3 and karst were not measured (seed 3: page reloads twice; then the dev server on :4630 went down).
Files: src/sim/occupancy.js (`segmentFree`, `segmentFreeAt`, `cellSolid`, `walkFree`), src/sim/animals.js (takeOff ~1870 arc in 8 chords; leap ~1901 per-tick chord, a blocked hop lands short and counts `a.hopCut`; nudge ~3699; herpStep `swept` ~4011; gecko stepPlane ~4045; crawler step ~1657/1666), tests/segment.test.mjs, tools/steps/interact-fuzz.mjs (`tunnelReloc`, `hopCut`, `hangCut`, `FUZZ_CFGS`), BB/tools/fuzz-agg.mjs, BB/tools/b4b-patch.mjs.
`walkFree` (added after seed 1): walkers are swept to where they end (their height if a piece is under the far end, else the ground). Sweeping at the old height missed a step down through a corner (the seed 1 gecko and fly events).
Before (180 s, swamp seed 1): 1x tunnel 4 (springtail 4); 60x tunnel 61 (springtail 34, fly 18, cricket 5, skink 4); tunnelReloc 3 / 4; stuck 0 / 0. Seeds 2-3 and karst baseline missing (page reloads). 60 s baseline, seeds 1-3: swamp 15 / 52 / 54 at 1x / 60x / lapse; karst 0.
After (180 s), swamp seed 1 (before walkFree): 1x tunnel 0, 60x tunnel 2 (gecko d0.7 patrolling, fly d1.5 walking); seed 2 (with walkFree): 1x tunnel 1 (strawberry frog, its own hop), 60x tunnel 1 (crab d2.3 fleeing).
Push-outs (tunnelReloc, deliberate, listed apart): seed 1 1x skink 1; seed 2 60x skink 2, axolotl 1 (outOfStems, inGlass). The firesal and panther 5-10 cm moves of the baseline are outOfStems/clearOfWall push-outs.
Stuck 0 in every after-run (baseline 0). Hops cut short by a piece: 6; left more than 1 cm above their surface for over 1 s after a cut (`hangCut`): 0; `floating` 0.
Frog-owned, not touched (2002-3200): the crab's step animals.js:2510 (`a.pos.x += ux * step`, end point only) and the frog's own hop (strawberry; flight line not found; frogWalk 2836 and checkPlan ~2815 test end points only).
Check:
1. node --test tests/segment.test.mjs -> tests 4, pass 4, fail 0
2. node --test tests/occupancy.test.mjs -> pass 2, fail 0
3. fuzz lapse 1x+60x 180 s: swamp s1 tunnel 0 / 2, s2 1 / 1; s3 and karst NOT run
Open risks: seed 1 not re-run with walkFree; walkFree has no unit test of its own.
Noticed: swamp seed 2 failed the same way in two of three attempts (navigation at about 116-171 s); it may be another agent's edit, or the game reloading itself (guess).

## Hand-off
- To finish the check once :4630 is back: `FUZZ_MODES=lapse FUZZ_CFGS=1x,60x FUZZ_PRESETS=swamp FUZZ_SEEDS=1,3 FUZZ_SECONDS=180 FUZZ_LOG=<scratch>/a.jsonl node tools/shot.mjs --only=desktop --wait=2500 --steps=tools/steps/interact-fuzz.mjs --url=http://127.0.0.1:4630/`, then karst seed 1; `node BB/tools/fuzz-agg.mjs <log>` (one seed at 180 s, 1x+60x: about 3 min).
- Frog owner: the crab's step 2510 and the frog hop need `this.occ.segmentFreeAt` / `walkFree` (contract in CONTRACTS.md) at their end-point tests.
- B1a (herpStep): `swept()` is the last term of `free()` (cheap early out); keep it last. B4a (nudge): the sweep sits at the top of the `for (const f of [1, 0.5])` loop; a crossing push is skipped, the 0.5 try still runs.
- B4c (swamp inside-solid flood): fuzz `inSolid` (solidAt at y + 0.5, walls excluded), swamp at 180 s: 31-37k at 1x, 2.6-5.2k at 60x per seed; karst 0. By species (seed 3, 60 s): springtail 1907, isopod 1630, reedfrog 1331, panther 907, redeye 670, crab 551. Game side: keepFree animals.js:1300 relocates and counts `stuckStats.inside`.
