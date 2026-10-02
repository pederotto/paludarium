# Design notes

## Goals

A paludarium simulator that is **playable** (a career with goals and rewards, a sandbox for free building), **teaching** (every mechanic has a Field-guide page and a live demonstration) and **entertaining** (late game turns building into automation, exhibitions and stress tests), while staying **beautiful** and honest as a simulation of real terrariums.

## Layers

```
src/util      math helpers (clamp, lerp, rng, hash, smoothstep): no scene, no DOM, imports nothing
src/content   species/plant info, concepts, biotopes, equipment, economy, levels, achievements, commissions…  (data)
src/sim       World: tank, terrain, hydro, erosion, env, climate, equipment, animals, plants, ecology, generator
src/game      career, market, metrics, curator, commissions, tutorial, events, vacation  (pure logic, unit-tested)
src/render    terrain/water meshes, lens overlays, shaders, creature system (kit, mesher, material, instanced, glb)
src/engine    Gfx (pipeline, quality presets), Stage (glass, lights, daylight), CameraRig, portraits
src/editor    ToolController: the in-game editor (pointer, selection, tools, keys, smart placement)
src/ui        Preact HUD and panels, driven by signals in store.js
src/app       Game (owns the renderer and world), Director (career flow, save/load, ticks), Care actions, saves
src/diag      the metrics recorder (docs/METRICS.md): imports nothing, is handed window.game at run time; main.jsx loads it only for ?metrics
```

The first six layers form a stack: each imports only the layers listed before it (`render` and `engine` also leave out `game`), apart from the exceptions below. `editor`, `ui` and `app` sit on top and use each other and everything below them (the UI store is state they all share). `tests/architecture.test.mjs` checks this from the import graph, and that there are no import cycles, so a new violation fails the test, and so does an exception that no longer exists.

Rules of thumb: `sim` and `game` know nothing about the DOM; `content` is data; `ui` reads signals and calls actions.

The known exception is the biggest piece of debt: **sim entities own their scene objects**. `Terrain`, `Decor`, `Plants`, `Animals`, `Sim`/`Ecology` and `World` (which creates `render/water.js`) build their own meshes and materials and so import from `render/`; one content module (`commissions`) reads the species and plant tables that live beside them. The numerical kernels (`hydro`, `erosion`, `support`, `climate`, `env`, `humus`, `genetics`, `placement`, `waterbodies`, `flylife`, `plantpond`, `kits`, `jobs`, `gridmesh`) make no scene objects, and the unit tests run them under Node. Splitting views from models would pay the debt down; until then keep new numerical code in the pure kind of module.

## Rendering

three.js r186 `WebGPURenderer` with TSL. The post chain is a `RenderPipeline`: scene pass (non-multisampled so GTAO can gather depth) → GTAO → bloom → tone mapping → optional depth of field (photo mode) → SMAA → RCAS-style sharpening. Quality presets adapt resolution to frame time. Glass condensation is a shader driven by the dew-point calculation.

## Frame budget and background work

A frame has 16 ms and the renderer takes about half of it, so nothing slow may run inside one. Slow processes that need no real time are **jobs** (`sim/jobs.js`): generators that `yield` between pieces, run a few pieces a frame by `Jobs.pump(budget)`. `Game.frame` gives the world about 1.2 ms of every frame (0.3 ms after a slow one). Erosion is the user: `Erosion.take()` turns the flow gathered over 0.2 s into a window, `Erosion.steps()` runs it piece by piece (scan, capacity, each sweep, the pool, the paint, each slump pass), and `Water._commit()` applies the changed ground to the mesh and the water in three pieces, but only after 4 s and only once some cell has moved by 0.05 cm (`COMMIT` in `render/water.js`; at normal speed erosion moves the ground about 0.01 cm a minute, so a commit is rare). `Erosion.run()` is the same code run in one go, for tests and tools; tests assert the two end in exactly the same place. Terrain and wall meshes refresh without allocating (`sim/gridmesh.js`, `Terrain.update`), which also makes sculpting cheaper.

## Loading

Building a world is mostly building shaders. three.js keys a compiled shader by the *instance* of every node in the material graph, by `object.uuid` for instanced meshes, by the render context and by the ids of the lights, so a rebuilt tank never reuses the old one's shaders (about 130 builds, a second on a fast machine and several times that on a slow one). Hence:

* a species' mesh (and so its body meshing job, its material and its shaders) exists only once an animal of that species does (`Animals.meshFor`); a tank holds about a dozen of the 27 species;
* the title screen's tank (`Game.showcase`) is reset and reused when a game with the same kind of tank starts (`Game.restartTank`, `World.restart`), which costs about 0.15 s and no shaders. Nobody has touched it, so it holds nothing a new world would not;
* materials made from identical creature finishes are shared (`creatures/instanced.js`).

## Performance notes

Measured with `tools/perf.mjs` (load, frame rate, long tasks, CPU profile; `--cpu=4 --dpr=2` approximates a mid-range laptop) and `tools/drawcalls-by-kind.mjs`. Things that mattered, and the traps:

* `renderer.info.render.calls` counts `render()` calls, not draws; use `drawCalls`. The real draw count is about 220 a frame, which is not a bottleneck. The cost is per pixel and the CPU cost of three's per-object bookkeeping.
* **Never evaluate expensive noise per fragment.** The glass's dew (two 3D Worley fields and a simplex over the big panes, drawn for both faces) cost about half of a retina frame (31 ms of 59), with or without dew on the glass. The pattern never changes, only how much of it shows (`U.condense`), so it is baked into tileable half-float textures (`util/noise.js`, `render/dew.js`; the bake starts the first time there is dew and takes a few hundred milliseconds in 3 ms slices) and the shader takes two samples behind `If(U.condense > …)`. The baked field has the statistics of the 3D noise it replaced (`tests/noise.test.mjs` checks the distribution against the analytic one), and the glass-only coverage of dew matched the original to within a few percent at every level. A frame is now 29 ms at 2160x1350, dewy or not.
* Frame cost is roughly linear in pixels (about 10 ms per megapixel on an M1 once the glass is cheap). Ambient occlusion is the largest feature (about 8 ms at 2160x1350); bloom, shadows, terrain, water and plants are each under 1 ms. The adaptive resolution scaler (`Gfx.frame`) settles at a pixel ratio of about 1.27 at that size.
* **A frame is never presented blank.** Changing the canvas size clears it, so a resolution change made after the frame was drawn presented one blank frame each time: a black flash, worst in the first seconds when shader-compile stalls make the scaler jumpy (found on a Windows laptop on the WebGL 2 path; `tools/steps/blank-frames.mjs` fails if the order of `gfx.frame` and `gfx.render` in `Game.frame` is swapped back). The governor (`engine/governor.js`, tested in `tests/governor.test.mjs`) decides the render scale, the preset (Low, Balanced, High) and the frame cap, never from warm-up frames (a tank load, a pipeline rebuild, a resize) and never from one stall (a window is judged by its median), moves rarely (two slow windows to go down, six fast ones to go up) and does not retry a level that just failed. The bottom rung is a 30 fps cap, because a GPU that is busy all the time freezes the whole desktop, not just the game. `Game.start` limits the loop to `gfx.maxFps` (60 by default, 30 or none in Settings, `?fps=N` in the address), so a 120 Hz screen no longer doubles the GPU work. Weak adapters (Adreno, Mali, Intel integrated, software) start on Low; what the governor settles on is remembered per browser (`paludarium.gfx` in local storage).
* Opened over plain `http://` from another machine (not localhost) a page is not a secure context, so there is no WebGPU and the game runs on the WebGL 2 path: heavier, and the one to test on weak machines.
* **Measure on the screen that matters.** `src/diag` (docs/METRICS.md) records frames, GPU latency, long tasks, resizes, load phases and the device from inside the page, and sends them to the machine serving the game (`npm run metrics:serve`), or runs headless on the Mac (`npm run metrics:run`), so a laptop and the Mac are compared with the same code. It found, among other things, that the black flash of a resize after the draw is a WebGL 2 problem (on WebGPU Chrome keeps the picture), and it is the way to check any change to rendering, plants, animals or loading.
* Headless Chrome recompiles Metal shaders for every fresh profile, so the first seconds of any measurement are noisy: compare builds interleaved and more than once.

Animals are **signed-distance-field bodies** meshed by an adaptive surface-nets mesher at two levels of detail, animated on the GPU by a vertex rig `[spine, leg, legT, materialId]` (body bend, limb swing) and drawn instanced. Each body file in `render/creatures/bodies/` describes one species; `tools/bench.mjs` renders contact sheets. Translucent parts (fins, wings, gills, egg jelly) are drawn in a second, alpha-blended pass (`instanced.js`), so they are smooth instead of dithered. Eyes are drawn analytically in the material (`finish.eyes`: pupil shape, iris ring, catchlight). Meshes without textures are baked by `tools/bake-creature.mjs` (orient, scale, simplify to two levels of detail, paint every vertex from `tools/paint/<species>.mjs`, meshopt-compress); `tools/paint/eyes.mjs` places analytic eyes. If a textured model is listed in `public/assets/creatures/manifest.json` the game uses it instead (`glb.js` derives the rig from the mesh shape); see `docs/ASSET_BRIEF.md` for the art pipeline.

## Audio

`engine/audio.js` synthesises the ambience with WebAudio: filtered noise loops for water and rain, oscillator bursts for crickets, frog calls and drips through a small convolution reverb. `main.jsx` starts it on the first user gesture and feeds it the game snapshot twice a second.

## Simulation

The world runs at a fixed step scaled by the speed setting. Environment is **spatial**: `Climate` keeps humidity, temperature, light and soil maps that plants, moss and animals sample and that the lens overlays draw. Equipment feeds the maps; an automation controller evaluates the player's rules. Animals choose where to be by comfort at each point of the tank.

## Game

`Career` holds funds, reputation, rank, unlocks and stats; `market` prices animals and plants and pays for sales; `commissions` are goals with a hold-time; `curator` scores a tank against a real biotope; `tutorial` is a scripted guide; `events` are random incidents; `vacation` fast-forwards the tank unattended. Saves go to IndexedDB (slots, portfolio of tanks).

## Building tools

`ToolController` (src/editor) owns pointer, selection, brushes and undo. Mirror duplicates each stroke, placement and path across x = 0 and undoes as one step. Kits (`content/kits.js` data, `sim/kits.js` builder) place pieces through the same code path as the Hardscape tool, priced from `content/economy.js` in career mode. Time-lapse (`app/timelapse.js`) boosts the game loop (`game.lapse`) and steps the simulation in 10-minute slices with animals moving between them, so the result matches real play.

## Generator

`sim/generator.js` builds a complete terrarium into a `World` from `{preset, seed, tier}`: terrain, water, hardscape, planting and a stocked community, and checks the result is stable. Preset metadata (names, tiers, blurbs) lives in `content/presets.js` so menus do not load the simulation.

## Testing

`npm run test:unit` covers the career and economy, the numerical kernels (water, erosion and its job form, genetics, placement, kits…), the mesh arithmetic and the layering of `src/` (`tests/architecture.test.mjs`). `tools/shot.mjs` plus scripted steps in `tools/steps/` drive the real game in headless Chrome (real Metal WebGPU) at 16:9 and phone sizes. Always check both.
