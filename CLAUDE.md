# Paludarium

## Assets
- Raw assets are dropped in `art-src/drop/`, any name, any kind, unsorted. When the user says
  they dropped something, or asks for art work, look there first.
- **Paludarium Drop** (https://claude.ai/artifact/3vUJANJZcqCpwkR9gudWs4) is how files get there from
  another computer or a phone. When the user says they dropped files in it: `ArtifactData` query `drops` where
  `status == "waiting"` with `out_dir` (never without: parts are base64). Each manifest says how it travelled:
  - `via: "assets"` (videos and web images, v4): `pieces` [{id, bytes, sha256}]. Fetch each piece with the
    `Artifact` tool, `action: "read"`, `path: <piece id>`, one call per piece (`paths` does not take asset ids); it
    lands as `<id>.<ext>` in the scratchpad's `artifact-files/<artifact uuid>/`. Then
    `node tools/drop-pull.mjs <out_dir> --assets=<that folder> --out=<dest>`; it prints the piece hashes.
  - db parts (other kinds, and anything sent before v4): `ArtifactData` list `drops/<id>/parts` with `out_dir`
    too, then `node tools/drop-pull.mjs <out_dir> --out=<dest>`; it prints the file's sha256.
  The tool checks every byte against the browser's SHA-256 and exits 1 on a bad file. Videos and third-party
  reference pictures go to `paludarium master/.agents/refs/` (never git); game assets to `art-src/drop/`. For each
  file that passed, ONE `update` (a `batch` for several) marks it received: `{ status: "pulled", pulledPieces:
  [<printed hashes>] }` for pieces or `{ status: "pulled", pulledSha256: <printed sha256> }` for parts, plus
  `pulledBytes` and `pulledAt`. Do not delete pieces or parts yourself: the Drop page deletes them once the receipt
  matches what was sent (live while it is open, otherwise the next time it is opened) and sets `assetsLeft: 0` or
  `partsLeft: 0`. Only if the store is full and the page cannot be opened, delete pieces with the `Artifact` tool
  (`action: "delete"`, `path: <piece id>`) or parts with a `batch`. Then process as below.
  Never mark or delete a file that failed its check. For each file: decide what it
  is, optimise it into `public/assets/` (creatures: `npm run import-creatures`; models and
  textures: gltf-transform and sharp as in `tools/import-polyhaven.mjs` and
  `tools/import-seedthree.cjs`), move the original to `art-src/raw/`, add source and licence to
  `CREDITS.md`, run `npm run test:unit`, commit. Never delete an original. Ask if the kind is unclear.
- Size rule: no file over 50 MB in git (GitHub refuses 100 MB). Larger files need Git LFS set up first.
- `public/assets/` is what the game serves; `art-src/` is what we keep. Do not hand-edit
  `public/assets/creatures/manifest.json`: `npm run import-creatures` writes it.
- Hardscape and plant models in `public/assets/models/` are meshopt-compressed with WebP textures: after importing one run `node tools/compress-models.mjs public/assets/models/<name>.glb` (keeps vertex data float32, which sim/decor.js reads). Creature models load only when their species first appears (`Animals.loadModel`).
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
- No secrets in the repo or the game (`docs/SECURITY.md`): the repo is public and the game ships to every browser. Keys live in `.env` (git-ignored) or GitHub Actions secrets, never under a `VITE_` name. `tools/check-secrets.mjs` runs as the pre-commit hook, in the unit tests and after every build; do not bypass it, fix what it finds. Commit with the repo's git identity (the GitHub noreply address in `.git/config`); never pass another `user.email`. The game is all rights reserved (`LICENSE`); third-party code or art needs a licence that allows that (MIT, Apache, CC0, CC-BY; not GPL or share-alike) and its notice in `CREDITS.md`.
- History is never rewritten on shared branches: no rebase, squash or "rebase and merge" of anything already pushed, no force push to `main`. Rewritten copies of the same commits (the old `restructure` branch went into PR #1 with new hashes) made git see every file as edited on both sides; joining them took a merge (fb897f2, 2026-10-02). If `git push origin arch/optimize:main` is refused as non-fast-forward, merge `origin/main` into `arch/optimize` first, never the other way round with a rewrite.
