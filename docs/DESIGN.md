# Design notes

## Goals

A paludarium simulator that is **playable** (a career with goals and rewards, a sandbox for free building), **teaching** (every mechanic has a Field-guide page and a live demonstration) and **entertaining** (late game turns building into automation, exhibitions and stress tests), while staying **beautiful** and honest as a simulation of real terrariums.

## Layers

```
src/engine    Gfx (pipeline, quality presets), Stage (glass, lights, daylight), CameraRig, portraits
src/sim       World: tank, terrain, hydro, env, climate, equipment, animals, plants, ecology, generator
src/render    terrain/water meshes, lens overlays, creature system (kit, mesher, material, instanced, glb)
src/game      career, market, metrics, curator, commissions, tutorial, events, vacation  (pure logic, unit-tested)
src/content   species/plant info, concepts, biotopes, equipment, economy, levels, achievements, commissions…
src/app       Game (owns the renderer and world), Director (career flow, save/load, ticks), Care actions, saves
src/ui        Preact HUD and panels, driven by signals in store.js
src/tools     ToolController: pointer, selection, tools, keys
```

Rule of thumb: `sim` and `game` know nothing about the DOM; `content` is data; `ui` reads signals and calls actions.

## Rendering

three.js r186 `WebGPURenderer` with TSL. The post chain is a `RenderPipeline`: scene pass (non-multisampled so GTAO can gather depth) → GTAO → bloom → tone mapping → optional depth of field (photo mode) → SMAA → RCAS-style sharpening. Quality presets adapt resolution to frame time. Glass condensation is a shader driven by the dew-point calculation.

## Creatures

Animals are **signed-distance-field bodies** meshed by an adaptive surface-nets mesher at two levels of detail, animated on the GPU by a vertex rig `[spine, leg, legT, materialId]` (body bend, limb swing) and drawn instanced. Each body file in `render/creatures/bodies/` describes one species; `tools/bench.mjs` renders contact sheets. If a textured model is listed in `public/assets/creatures/manifest.json` the game uses it instead (`glb.js` derives the rig from the mesh shape); see `docs/ASSET_BRIEF.md` for the art pipeline.

## Audio

`engine/audio.js` synthesises the ambience with WebAudio: filtered noise loops for water and rain, oscillator bursts for crickets, frog calls and drips through a small convolution reverb. `main.jsx` starts it on the first user gesture and feeds it the game snapshot twice a second.

## Simulation

The world runs at a fixed step scaled by the speed setting. Environment is **spatial**: `Climate` keeps humidity, temperature, light and soil maps that plants, moss and animals sample and that the lens overlays draw. Equipment feeds the maps; an automation controller evaluates the player's rules. Animals choose where to be by comfort at each point of the tank.

## Game

`Career` holds funds, reputation, rank, unlocks and stats; `market` prices animals and plants and pays for sales; `commissions` are goals with a hold-time; `curator` scores a tank against a real biotope; `tutorial` is a scripted guide; `events` are random incidents; `vacation` fast-forwards the tank unattended. Saves go to IndexedDB (slots, portfolio of tanks).

## Generator

`sim/generator.js` builds a complete terrarium into a `World` from `{preset, seed, tier}`: terrain, water, hardscape, planting and a stocked community, and checks the result is stable. Preset metadata (names, tiers, blurbs) lives in `content/presets.js` so menus do not load the simulation.

## Testing

`npm run test:unit` covers the career and economy. `tools/shot.mjs` plus scripted steps in `tools/steps/` drive the real game in headless Chrome (real Metal WebGPU) at 16:9 and phone sizes. Always check both.
