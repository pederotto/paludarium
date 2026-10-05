# B5b-fix report: pool plants lean with the filter's current (claude-opus-5-5)
**Result:** DONE. Pool plants now stand in water and lean down-flow; with the filter off they stand still; land plants get nothing.
**Files:** src/render/airflow.js (`waterAtPlant` new :~53: depth = `water.surfaceAt(x,z,0.3)` - base, the animals' waterTop rule; push = `currentAt` (sim/currentat.js) in stream/pond cells, the same sum written out in main-pool `res` cells; `plantFlow` uses it; probe rewritten: pool plant + pump on/off), tests/plantbend.test.mjs (fake world keeps the pool as `res`+`level` like sim/hydro.js; the old stream-jet test replaced by the pool test), BB/tools/b5b-fix.mjs (page run).
**Check:** `node --test tests/plantbend.test.mjs tests/architecture.test.mjs` -> `tests 13` / `pass 13` / `fail 0`. Failing first: `the pool covers it: 4 cm ... got 0`.
**Page** (`node tools/shot.mjs --url=http://127.0.0.1:4630/ --only=desktop --steps=docs/agents/lizards/tools/b5b-fix.mjs`, starter tank, pump 119.9 L/h, pool level 11.9):
- flowDepth > 0: vallisneria 15/15, sword 2/2, javafern 3/3, cattail 2/2; land weed 0/5, grass 0/10 (before: every plant 0).
- `__AIR.probe('vallisneria')`, pool plant 4 cm down the return's axis, 8.7 cm under water: errDeg 0 (vs the field) but only 0.05 cm/s, 88.6 deg off the bare axis (its sample point is 2.8 cm above the narrow jet: entrainment only); lean 0.17 deg on, 0 off.
- Row of 6 vallisneria in the pool 4-24 cm down the axis, filter on: 0.05/0.18/7.68/1.07/0.02/0.02 cm/s; the moving ones 12.8/17.6/18.3 deg off the bare axis (intake pull and spread included); lean 0.2/0.6/19.7/3.4/0/0.1 deg. Filter off (env.filter=false, 9 s, lph 0): all 0. **On-off lean difference: 19.7 deg at 12 cm, 3.4 deg at 16 cm, under 1 deg elsewhere.**
- Cost: plantFlow **0.0068 ms/frame at 31 plants, 0.0080 at 37** (was 0.0025-0.0074 at about 30); 0.12 ms per 0.4 s call, worst 0.4 ms (timer steps). Console: two 403s only (as before).
**Screenshots (not opened):** test-output/plants/pool-filter-on.png, test-output/plants/pool-filter-off.png (same 640x360 crop at x 374, y 360 of 1280x720; clamped at the bottom edge, so the row may sit near its top).
**Open risks:** one sample height per plant (base + min(depth/2, 4 cm), a guess): the jet is narrow, so plants 4-8 cm from the nozzle barely lean though a tall leaf crosses it; sampling over the leaf's height would catch it. leanDeg assumes stiffness 1 and reach = 0.4 x plant height. Stream plants' currentAt calls add to fishmind COST.ms.
**Noticed, not touched:** sim/currentat.js:22 gates on `H.d[c] >= 0.3`, so FISH in the main pool feel no filter current either (same bug); fix there `|| H.res?.[c]`, then `waterAtPlant`'s pool branch can go.
## Hand-off
- Depth/flow per plant: src/render/airflow.js `waterAtPlant(W, x, y0, z, out)`; main pool = `hydro.res[c]`, its water is `hydro.level`, not `d` (sim/hydro.js:673-685).
- Page run: the command above (`--url` is required: shot.mjs defaults to :5173). macOS has no `timeout`. Probe: `__AIR.probe(id, stiffness)` -> on/off/dLeanDeg.
- Sample height knob: `SAMPLE_UP` in airflow.js; the jet: sim/filterflow.js `poolCurrent` :160.
