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
- Back up with `npm run backup` after any batch of assets (see `tools/backup.sh`).
- `dist/` and `test-output/` are build output and are git-ignored.
