# B1b report: fire salamander no longer placed on a pool floor, relocate ends on land (commit follows in git log: "B1b:")
Result: done. A click on water for a fire salamander is now refused ("Fire salamanders can’t swim well. Put them on land."), as the game already does for frog, gecko, skink (it refuses, it does not snap to shore). `relocate` for a firesal searches land cells (mediumOf 'land'). Newt, marbled, axolotl give the same spots as before (compared with a copy of the old rule).
Files: src/sim/placement.js +22 (herpSpot, from the habitat row), src/sim/animals.js 6+/7- (placement case 'newt'/'axolotl' now call herpSpot, import x2, mediumOf +1 line for landBias >= 0.5), tests/herp-spot.test.mjs (new, 4 tests).
Check 1: node --test tests/herp-spot.test.mjs  ->  
  # old rule: 59 of 200 firesal placements under water (59 clicks were on the pool)
  # new rule: firesal refused 59, placed 141, under water 0; newt 121/79, marbled 121/79, axolotl 33/167 placed/refused, identical to the old rule
Check 2 (browser, real karst tank, seeded, 200 clicks per species): firesal placed 64, refused 136 (= every pool click), on a pool floor 0; newt 200 placed, marbled 200 placed, axolotl 109 placed / 91 refused (axolotl is meant to sit on a pool floor).
Check 3 (browser, 20 relocations of a firesal started on a pool floor): old mediumOf ('any') 6 ended on land, 14 did not; new ('land') 20 of 20 on land. mediumOf: firesal 'land', newt 'any', marbled 'any'. Dump (--mix=firesal:6, 3 s, every 1 s): 6 of 6 rows at t=0 not in water, thrown 0.
Also ran: node --test tests/placement.test.mjs -> 
Calls used: 14 of the step-2 budget for B1b (incl. reads). Browser runs: 1 (script in the scratchpad, b1b-e2e.mjs: dump + in-page placements and relocates).
Open: (1) a firesal may still stand in a puddle up to 0.6 cm (the row's maxDepth) and its soak mode wades to 1.8 cm by design; 10 of 24 dump rows in the 3 s run had inWater=1 after placement (wading, B1a territory, not a placement fault). (2) The firesal no longer needs water within 8 cm to be placed: its row says 40 and the "far from water" rule is soft there. (3) Chrome: my run closed its browser; the PIDs ps showed afterwards started after my script exited and are not mine.
Noticed, not touched: herpStep steps "toward the middle" at 3983 (B1a); generator.js:321 and world.js:328 only use pl.pos, so refused spots are skipped there.
