# CONTRACTS (lizard run). Write the entry before making the change. Re-read at claim, proposal and finish.

## Units and axes
- Game: centimetres, an animal faces +z, y up, feet on y = 0 (`bodies/salamanders.js:1`).
- Raw lizard models: normalised (total length 1.0), head at +Z, Y up, X lateral, soles at y = -0.18 (RIG_*.md). Scale to game size in the bake, never at runtime.
- Angles in radians in code, degrees in the sheets. Time in seconds in the brains, sim minutes in `sim.step`.

## Ownership of shared code (one owner each; everyone else consumes)
| code | owner | consumers |
|---|---|---|
| Lizard bone list, bake tool, binding (`tools/bake-lizard.mjs`, `tools/rig/lizard.mjs`) | gecko builder | skink builder |
| Lizard gait, foot planting, surface adhesion (`util/lizardgait.js`, `render/creatures/lizardpose.js`, `util/contain.js`, animals.js footing / wall mode) | gecko builder | skink builder |
| Collision and steering (`sim/occupancy.js`, animals.js `free`/`okFor`/`separate`/`nudge`/`keepFree`, the swept move test) | interactions builder | everyone |
| Home choice and walking home (animals.js `herpFindHome`/`herpHomeScore`/`herpStep` goal logic) | amphibians builder for B1a, then interactions builder for B4a | gecko builder (G3) |
| State dump format and counters (`tools/steps/state-dump.mjs`) | interactions builder | every check that reads a dump |

## Read-only for this run (frog pipeline)
`tools/bake-frogpose.mjs`, `tools/bake-creature.mjs`, `tools/rig/{skeleton,frog,joints-view,skin-stretch,warps,texture}.mjs`, `tools/paint/*`, `tools/frog-lineup.mjs`, `tools/steps/{frog-*,swim-*,leap-film,skin-*}.mjs`, `src/render/creatures/{skeleton,skin}.js`, `bodies/frogs.js`, frog and swim code in animals.js (2002-3200) and gait.js (25-60, 265-426), SWIM rows in bodyplan.js (115-130), tests swim/skin/skeleton, the frog assets. Import from them freely; do not change them. If a lizard cannot be drawn without a change there, stop and tell your manager.

## Locks
A file named in more than one board row is edited only while holding its lock: `mkdir BB/locks/<file>.lock` (fails if taken), write your task id into `owner` inside, `rmdir` after your commit. Keep hunks in animals.js small: logic goes into its own module, animals.js gets the call site.

## Interfaces (filled in by the owner before the change)
- State dump row: (Z0 to define: fields, units, file layout)
- Lizard bone list and manifest `skeleton` entry: (G1 to define)
- `lizardgait` API: (G4 to define)
- `segmentFree(a, from, to)`: (B4b to define)
- New SPECIES range fields for presets (light, substrate, hides, perches, tank mates): (D to define)
