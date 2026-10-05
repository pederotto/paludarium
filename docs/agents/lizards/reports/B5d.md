# B5d report: water below the substrate (claude-opus-5-5)

**Result: done.** All three builds now have water below the ground. The sim simulates it, the cut-away at the glass draws it, and in the X-ray and Bottom layers it shows as a body, all at the level the sim hands out.
**What the sim models now** (starter tank 90x45, pool 11.90 cm; browser run below):
- False bottom: the plenum as before (plenum.js:117-149). 10.72 cm, 17.38 L. The pump holds it 1.2 cm under the pool.
- LECA layer (0 < E.drainage < 1): a simulated water table at 11.90 cm, 12.54 L. Before this change it was a drawn constant of 1.2 cm and 0 L. The land is open to the pool, so the table settles at the pool's line and the 3 cm layer is flooded (lead's decision, no seal).
- Plain substrate (E.drainage = 0): water table at 11.90 cm, 11.36 L. Before this change there was nothing.
- Litres are counted cell by cell on a 3 cm grid, up to each cell's ground (min(level, ground) x porosity). Under the pool only the bed's pores count; the pool's own water stays the hydraulics'.
**Parts** (src/sim/plenum.js unless named):
- Base: `belowGround(E, pool)` :242 returns {mode, layerH, level, L}. soilside.update :180 reads only that: the cut-away's `u.water` and the body's `u.level`. The old 1.2 cm constant and the L+6 clamp are gone.
- LECA and plain substrate: profiles LECA/SOIL :47-48. plenumStep takes an optional profile and shape :85, with the same maths for the plenum, so the plenum tests are unchanged. `groundGrid` :174 and `groundShape` :193 handle litres to level (sorted cells, prefix sums, bisection). `stepGround` :213 runs from stepPlenum's early return :135, so sim.js is untouched.
- Water accounting: sources are rain and misting on the land above the pool line (soaked down, tau 120 min) and seep in from the pool. Sinks are seep out to the pool and wicking into dry soil. The pool pays through Hydro.exchange (like the plenum's screen), and `held` resets when a build is first fitted. Env fields groundLevel and groundSoak are in env.js:62-63 and KEYS :99, so Env.reset (clearAll) clears them (checked).
- Plain substrate draws a saturated, darker band under the table with a wet line at it (soilside.js:147, branch on uniforms). LECA keeps its existing under-water shading, now at the simulated level.
- X-ray body: soilside.js makeBody :254 and rebuildBody :270. It is one mesh (537 vertices in 90x45), a sheet on the groundGrid plus walls 1.5 cm inside the glass. Its height is a uniform set by `bodyTop` (:251, min(level, ground - 0.1)), so the water level never rebuilds it; only the ground does (:248). It is drawn like the plumbing ghost (GreaterDepth, transparent, renderOrder 3), with no change to the scene pass. Only in the X-ray and Bottom layers (layers.js:43, :58): 1 draw call there, 0 in Surface. Under a false bottom it is masked to the plenum's footprint (`minG`).
**Guesses (named constants):** LECA_POROSITY 0.45 and SEEP 0.3 L/min per cm of level difference (plenum.js:44-45). Modelled, not from a sheet: the LECA layer is 3 cm (the height soilside already drew); a LECA layer with no pool keeps 1.2 cm, plain soil with no pool keeps 0; plain soil wicks from a table at any depth; the body sits 0.1 cm under the ground.
**Checks.** `node --test tests/belowground.test.mjs tests/plenum.test.mjs tests/architecture.test.mjs` (failed first: "does not provide an export named 'LECA'"):
```
ℹ tests 15
ℹ pass 15
ℹ fail 0
```
- tests/filterflow.test.mjs: 16/16, which includes B5c's 1e-6 L day test, unchanged. The first run failed on another agent's half-landed `LIFT_MARGIN` export; the recheck passed.
- belowground covers: handed level = sim level for all 3 builds; LECA rises with rain, falls back to the pool line, and falls after a 3 L water change; the plain table rises and falls; conservation within 1e-6 L for 3 builds x bed pump on/off x wet/dry soil; body top = level.
- Browser: `node tools/shot.mjs --steps=tools/steps/below-ground.mjs --url=http://127.0.0.1:4630/ --only=desktop` gave 13 PASS, 0 FAIL, and none of my listeners caught a console error. shot.mjs's own log listed two 403 "Failed to load resource" lines, presumably from page load, which my listeners attach after; not investigated. My Chrome exited; PID 64212 belongs to the user's own Chrome and was left alone.
**Open risks:** the look is unseen (no screenshots; body colour, opacity and the saturated band are not tuned). In LECA and plain tanks, rain on the land now drains through the table into the pool, so the pool rises with rain where before that water went nowhere; the false bottom already did this. Every generated LECA tank with a pool deeper than 3 cm shows a flooded layer. The soilside material recompiles once at load (new branch).
**Noticed, not touched:** a high table does not make the land muddy (climate.js:187-191, sim.js:139); that is the user's call.

## Hand-off
- Every number the renderer draws below ground comes from plenum.js `belowGround` :242. Tests check it there, because soilside.js cannot load under node (three/webgpu).
- The ground grid cache `grid` (plenum.js, near :174) is keyed on terrain + groundVer + TANK. The plenum keeps its own `area` cache (:38); do not merge the two.
- Hydro `held` now also tracks the ground's share of the pool (the top-up does not refill it). stepGround resets it only when a build is first fitted.
- Switching the foundation in Care sets the other build's fields to undefined and refills the new one at the pool line (filled with the build, not out of the pool).
- Tests: `node --test tests/belowground.test.mjs tests/plenum.test.mjs tests/filterflow.test.mjs`. Browser numbers: tools/steps/below-ground.mjs (desktop only, about 1 min).
- To tune the look: soilside.js :147-151 (band), :254-266 (body colour and opacity). No sim change is needed for that.
