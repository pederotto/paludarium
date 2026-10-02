# Paludarium

## Assets
- Raw assets are dropped in `art-src/drop/`, any name, any kind, unsorted. When the user says
  they dropped something, or asks for art work, look there first.
- **Paludarium Drop** (https://claude.ai/artifact/3vUJANJZcqCpwkR9gudWs4) is how files get there from
  another computer. When the user says they dropped files in it: `ArtifactData` list `drops` with
  `out_dir` in the scratchpad, list each `drops/<id>/parts` the same way for every manifest with
  `status: "waiting"`, run `node tools/drop-pull.mjs <out_dir>` (joins the parts, checks size and
  SHA-256, writes into `art-src/drop/`; exits 1 on a bad file), then for each file that passed
  delete its part documents and `update` its manifest to `status: "pulled"`. Then process as below.
  Never delete parts of a file that failed its check. For each file: decide what it
  is, optimise it into `public/assets/` (creatures: `npm run import-creatures`; models and
  textures: gltf-transform and sharp as in `tools/import-polyhaven.mjs` and
  `tools/import-seedthree.cjs`), move the original to `art-src/raw/`, add source and licence to
  `CREDITS.md`, run `npm run test:unit`, commit. Never delete an original. Ask if the kind is unclear.
- Size rule: no file over 50 MB in git (GitHub refuses 100 MB). Larger files need Git LFS set up first.
- `public/assets/` is what the game serves; `art-src/` is what we keep. Do not hand-edit
  `public/assets/creatures/manifest.json`: `npm run import-creatures` writes it.
- Species and plant pictures (Add menu, Field Guide, Kids) are files in `public/assets/portraits/`: after adding or changing a creature or plant model run `node tools/bake-portraits.mjs [--only=<id>]`. A missing picture is rendered live in the player's browser, which is slow (a second renderer, every model: about a minute, freezes of seconds).
- Back up with `npm run backup` after any batch of assets (see `tools/backup.sh`).
- `dist/` and `test-output/` are build output and are git-ignored.

## Structure and speed
- `docs/DESIGN.md` has the layering rules and the performance notes; read them before touching rendering, loading or anything that runs every frame. `tests/architecture.test.mjs` fails on a new layer violation or an import cycle (`src/util` ▸ `content` ▸ `sim` ▸ `game` ▸ `render` ▸ `engine`, then `editor`/`ui`/`app` on top).
- Measure, do not guess: `npm run build && npx vite preview --port 4173`, then `node tools/perf.mjs` (load, frame rate, long tasks; `--profile=1` for a CPU profile, `--cpu=4 --dpr=2` for a mid-range device). Compare builds interleaved and more than once: the first seconds in headless Chrome are noisy.
- Freezes come from steps, not from steady play: before and after a change that adds materials, meshes or a loading step, run `node tools/journey.mjs [--webgl]` against a preview build and compare the per-step freezes. Shaders build in the background under a per-frame budget (`engine/compiler.js`); a loading screen waits with `game.settle()`. A change that alters the scene pass (its MRT or samples) recompiles every scene shader: avoid it outside a deliberate preset change.
- Nothing slow inside a frame. Slow processes that need no real time are generators run by `sim/jobs.js` under a per-frame budget (erosion is the model). A material must not evaluate expensive noise per fragment: use `noise3` (render/noise3.js, a baked volume) or bake it into a texture, or branch on a uniform (the glass dew once cost half a retina frame).
- Starting a game from the title reuses the title tank (`Game.restartTank`); anything that makes a tank keep state outside `World.clearAll`/`World.restart` has to reset it there. `tools/steps/restart.mjs` checks it.
- Anything that resizes the canvas or rebuilds the pipeline must happen before the frame is drawn, never after (a blank frame is presented otherwise: `tools/steps/blank-frames.mjs`). `engine/governor.js` owns render scale, preset and frame cap; do not add other adaptive logic next to it.
- Record on the real screen, not only on the Mac: `npm run metrics:serve` (add `-- --https` for the WebGPU path) and open the printed address on the other computer, or `npm run metrics:run -- --label=<x>` for a headless run with the same recorder; read recordings with `npm run metrics:report` (`docs/METRICS.md`). Before and after any change to rendering, plants, animals or loading, record the same scenario and compare (`-- --compare <before> <after>`); keep the numbers in the Baselines table of that file. `src/diag` must not import game code (it is handed `window.game`); it costs nothing unless the address has `?metrics`.

## Git and publishing
- "Push" means the live site too: GitHub Pages (https://pederotto.github.io/paludarium/) deploys `main` on every push (`.github/workflows/pages.yml`, which runs the unit tests and the build). Work happens on `arch/optimize`; after `npm run test:unit` passes, push the branch and then `git push origin arch/optimize:main`, which only succeeds as a fast-forward. Check the Actions run finishes.
- History is never rewritten on shared branches: no rebase, squash or "rebase and merge" of anything already pushed, no force push to `main`. Rewritten copies of the same commits (the old `restructure` branch went into PR #1 with new hashes) made git see every file as edited on both sides; joining them took a merge (fb897f2, 2026-10-02). If `git push origin arch/optimize:main` is refused as non-fast-forward, merge `origin/main` into `arch/optimize` first, never the other way round with a rewrite.
