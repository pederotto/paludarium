# X-B1 cross-check (claude-opus-5-5, 26 calls). Steps: BB/tools/x-b1-*.mjs (run `node tools/shot.mjs --steps=BB/tools/<f> --url=http://127.0.0.1:4630/`), images BB/tools/tmp/xb1/
## B5b plants in the flow: FAILS in the pool (unit tests 10/10 pass)
- `__AIR.probe('vallisneria')` (x-b1-b5b.mjs, starter tank, sponge filter 120 L/h): `"src":"fastest cell 48.35 cm/s","errDeg":0,"speed":48.35`, msPerFrame 0.0065, worst 0.4 ms.
  Direction is right, but only in a stream cell. The filter return (8.5, 4.4, 11.1) sits in the pool, and every point 3-36 cm downstream has hydro d < 0.3, so the probe never reached its "return nozzle" branch.
- x-b1-hd.mjs: `pool samples 503, with H.d>=0.3: 21, mean H.d 0.07`. flowDepth = 0 for every plant (vallisneria x5, sword, javafern, grass, weed, cattail). Jet (poolCurrent) at the plants is 0.00-0.01.
  plantFlow drops a plant when H.d < 0.3 (airflow.js:67-72), and pool water is not in H.d, so no submerged plant in the pool ever leans. The unit tests' fake world puts water in H.d.
- Image b5b-onoff.png, filter on and off side by side: the same upright vallisneria and grasses in both, no lean near the sponge filter, nothing jitters, folds or stretches. The emergent case could not be judged because nothing bends. (The camera rig has no `.target`, so these are crops.)
## B1b fire salamander off the pool floor: FAILS in the player's click path (`node --test tests/herp-spot.test.mjs`: tests 4, pass 4, fail 0)
- x-b1-b1b.mjs: real mouse clicks with the animal tool on generated presets (standard tier); depth = W.water.surfaceAt - a.pos.y at the animal.
  `swamp firesal at placement: water 9/16 placed ... [firesal,firesal@1.84,firesal@4.84,firesal@2.99]`: 3 were under water 80 ms after the click.
  `swamp firesal after 8 s: n=21 sub>0.6:11 sub>1.5:11 swimming:0 ... maxSub=6.27`
  `cascade firesal after 8 s: n=11 sub>0.6:7 sub>1.5:7 swimming:0 ... maxSub=12.94` (in cascade all 11 were dry at placement).
- Newt (swamp): placed in water and near it, refused far from water ("Newts need water nearby"), as designed. Axolotl (swamp): refused in water 1.1-3.8 cm deep ("at least 4 cm"), which is correct.
  Not verified: an axolotl in deep water. In cascade the newt and axolotl clicks did nothing (no animal added, no toast, tool=animal); cause not found. Reedpool was not run.
- Caveat: my water/edge/land labels come from my own pick, so they are approximate; the under-water numbers are measured at the animal. Guess: something after placement() moves them (add() or the first move steps). B1b checked placement() output, not where the animal stands after a click.
## C1 click panel, animals: VERIFIED
- `C1_START=career node tools/shot.mjs --steps=tools/steps/select-panel.mjs`: desktop and phone gecko, skink, dartfrog `hits 10/10 ... PASS`, animal-front 10/10, gecko-stall `selected=yes ... PASS`. The overall RESULT FAIL comes from the plant rows (plant-stem, plant-front), which I did not judge.
- x-b1-c1.mjs: `.hud-stack` pointer-events none. The commission chip (button.cchip) is `pe=auto HIT`, and a real click or tap opens Studio on both sizes. Dock buttons hit 4/4 on both. The hint toast is pe=none by design.
  The stack's box: desktop 449 sweep points reach the canvas and 67 hit a child; phone 305 canvas, 67 child. Old dead zone (x 380-900, y 559-653): 283 of 324 points reach the canvas; the other 41 land on the visible commission chip.
  Not tested: the layer chip and lens legend (not rendered in X-ray). Selecting an animal inside the zone: only 1 of 8 points has tank under it in the career view (the rest is the cabinet); that gecko was selected.
## B5d water below the substrate: numbers VERIFIED, look only partly convincing
- `node --test tests/belowground.test.mjs`: tests 4, pass 4, fail 0. below-ground.mjs: `PASS plain: body 11.904 cm and cut-away 11.903 cm = belowGround 11.903 cm (11.36 L, pool 11.9 cm)`, `PASS plain: hidden in Surface`, `PASS no console errors`.
- Levels: false bottom 10.72 cm (17.4 L) under a pool at 11.90 cm; plain substrate 11.90 cm (11.4 L), at the pool line. Both are believable.
- Image b5d-grid.png (X-ray on top, Surface below): in X-ray the body is a see-through beige slab across the front at about pool height. With the false bottom it covers only the pool's footprint; with plain substrate it spans the whole front, with dark rock and root shapes inside. To me it reads as sand, not water (colour not tuned). In Surface no body is drawn in either build, and the false bottom adds its white grate at front right. Not compared with a before-commit view.
## Best images: B5b BB/tools/tmp/xb1/b5b-onoff.png ; B5d BB/tools/tmp/xb1/b5d-grid.png ; B1b and C1 have numbers only.
Noticed: a vite HMR error for /src/util/lizardmuscles.js (another agent's edit) during the phone run. I ran below-ground.mjs twice in a row by mistake. The Chromes left in ps started 11 s before the check, after my runs, so they are not mine; left alone.
