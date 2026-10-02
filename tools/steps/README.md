# Step scripts

Scripted flows for `tools/shot.mjs`, which drives the real game in the installed Chrome (real WebGPU) at a 16:9 desktop size and at a phone size:

```bash
npm run dev                                   # or: npm run build && npx vite preview --port 4173
node tools/shot.mjs --steps=tools/steps/<name>.mjs [--url=http://localhost:5173/] [--only=desktop|phone] [--out=test-output]
```

Each file exports `async (page, shot, name) => {}`; `shot('name')` saves a screenshot. Checks print `PASS`/`FAIL` or numbers, and most also print page errors at the end. Always look at both sizes. Files starting with `_` are helpers the others import.

Each script starts with a comment saying what it does; this is the map.

| Group | Scripts |
|---|---|
| **Starting, saving, modes** | `play` (the sandbox and its panels), `restart` (the title tank is reused when a game starts: PASS/FAIL), `blank-frames` (a resolution change never presents a blank frame: PASS/FAIL), `home` (Menu ▸ Home ▸ Continue), `saveload`, `career`, `modes-roundtrip`, `kids`, `kidsframe`, `gen-title` |
| **HUD and screens** | `hud2`, `hud2-career`, `hud2-lens`, `ui-review`, `banner`, `phone-codex`, `phone-dock`, `portrait`, `portrait-final`, `sizes-ui`, `fullscreen`, `fullscreen-tanks`, `photo`, `timelapse` |
| **Simulation checks** | `sim` (fast-forward, fails on NaN), `game-logic` (metrics, curator, commissions, events, vacation), `flies`, `flies-save`, `genetics`, `humus`, `plantpond`, `water-conserve`, `water-flow`, `erosion-aging`, `erosion-checks`, `placement`, `stuck`, `crowding`, `eating`, `kits`, `kits-career`, `customtank`, `explorer-build`, `chem`, `deaths` |
| **Generated terrariums** | `gen-check` (stability), `gen-sweep` (every preset at every tier), `gen-preview`, `gen-pieces`, `gen-sheet` (contact sheets), `gen-server`, `hero`, `pond-sizes` |
| **Looking at things** | `frog-swim` (frogs swim: stroke cycle, surges, climb out, swimming-pose model: PASS/FAIL), `creature-close`, `glb-ingame`, `plant-close`, `plumbing`, `mould`, `lens`, `lens-quality`, `glass`, `morphpick` |
| **Performance** | `perf` (starter, grand swamp, time-lapse), `frameprof` (the pieces of `Game.frame`), `drawcalls` (visible meshes by kind), `metrics` (the metrics recorder works in a real browser: PASS/FAIL; needs `--query="?metrics=step&nooverlay"` and a server with the collector, see the file). For load time, frame rate and a CPU profile use `tools/perf.mjs`; for real draw calls per pass, `tools/drawcalls-by-kind.mjs`; for recordings on any machine, `npm run metrics:serve` and `docs/METRICS.md`. |
| **Audio** | `audio` |
| **Debugging leftovers** | `vac-debug`, `vac-debug2`, `shaderr2`, `shaderr3`, `water-tune`, `water-tune2`, `water-tune3`: one-off investigations kept for reference |
